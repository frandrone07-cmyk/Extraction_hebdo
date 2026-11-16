import { creerSituation, repondre, versAffichage, versOral } from "./sokhnaci-dialogue.js";

const CLE_VOIX = "completude-sokhnaci-voice";
let widget = null;
let currentText = "";
let segmentsCourants = [];
let modeleCourant = null;
const HUMEUR_PAR_EMOTION = { neutre: "attentif", souriante: "serein", preoccupee: "alerte", encourageante: "vigilant", felicitations: "content" };
const LIBELLE_HUMEUR = { alerte: "Point d’attention", vigilant: "À surveiller", attentif: "Analyse en cours", content: "En progression", serein: "Situation conforme" };
let voiceEnabled = true;
let utterance = null;

function moyenne(values) {
  const usable = values.filter((value) => value !== null && value !== undefined);
  return usable.length ? usable.reduce((a, b) => a + b, 0) / usable.length : null;
}

// Tendance sur les 3 dernieres semaines disponibles (pas seulement la
// comparaison a 1 semaine) : permet de distinguer une simple fluctuation
// d'une vraie stagnation ou d'une progression soutenue.
function tendanceRecente(serie) {
  const valeurs = serie.filter((value) => value !== null && value !== undefined);
  if (valeurs.length < 3) return null;
  const [a, b, c] = valeurs.slice(-3);
  const d1 = b - a;
  const d2 = c - b;
  if (d1 <= -1 && d2 <= -1) return "baisse";
  if (d1 >= 1 && d2 >= 1) return "hausse";
  if (Math.abs(d1) < 1 && Math.abs(d2) < 1) return "stagnation";
  return null;
}

function svgMarkup() {
  return `<svg class="sokhnaci-svg" viewBox="0 0 112 112" role="img" aria-label="Bébé Sokhnaci, guide du tableau de bord">
    <ellipse class="baby-shadow" cx="56" cy="104" rx="29" ry="5"/>
    <g class="baby-arm baby-arm-left"><path class="baby-skin" d="M39 69c-7 1-11 6-13 13l-4 7c-2 4 2 7 5 4l8-7c5-3 8-7 10-12z"/><circle class="baby-skin" cx="23" cy="94" r="4"/></g>
    <g class="baby-arm baby-arm-right"><path class="baby-skin" d="M73 69c7 1 11 6 13 13l4 7c2 4-2 7-5 4l-8-7c-5-3-8-7-10-12z"/><circle class="baby-skin" cx="89" cy="94" r="4"/></g>
    <path class="baby-shirt" d="M37 69c6-5 12-7 19-7s13 2 19 7l7 27H30z"/>
    <path class="baby-shirt-collar" d="m47 66 9 8 9-8"/>
    <circle class="baby-ear baby-skin" cx="31" cy="43" r="7"/><circle class="baby-ear baby-skin" cx="81" cy="43" r="7"/>
    <ellipse class="baby-face baby-skin" cx="56" cy="43" rx="27" ry="29"/>
    <path class="baby-hair" d="M29 43c-3-17 8-31 25-32 19-1 31 12 29 31-4-4-7-9-8-15-6 6-15 9-24 8-7 0-13-2-18-6-1 5-2 10-4 14z"/>
    <path class="baby-tuft" d="M48 13c-2-7 3-11 8-8 3-6 10-3 9 3 6-1 8 5 4 9-7-3-14-4-21-4z"/>
    <path class="baby-brow" d="M42 40q5-4 10 0m8 0q5-4 10 0"/>
    <ellipse class="baby-eye" cx="47" cy="46" rx="2.2" ry="3"/><ellipse class="baby-eye" cx="65" cy="46" rx="2.2" ry="3"/>
    <ellipse class="baby-cheek" cx="39" cy="55" rx="5" ry="2.5"/><ellipse class="baby-cheek" cx="73" cy="55" rx="5" ry="2.5"/>
    <path class="baby-mouth-smile" d="M49 57q7 7 14 0"/><ellipse class="baby-mouth-open" cx="56" cy="59" rx="3.5" ry="4.5"/><path class="baby-mouth-flat" d="M51 59h10"/>
    <path class="baby-shirt-mark" d="M53 84h6m-3-3v6"/>
  </svg>`;
}

function parler() {
  if (!voiceEnabled || !segmentsCourants.length || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  segmentsCourants.forEach((segment, index) => {
    utterance = new SpeechSynthesisUtterance(segment.oral);
    utterance.lang = "fr-FR";
    utterance.rate = 0.94;
    utterance.pitch = 1.04;
    utterance.onstart = () => {
      widget?.classList.add("speaking");
      if (widget) widget.dataset.geste = segment.geste || "";
    };
    if (index === segmentsCourants.length - 1) utterance.onend = utterance.onerror = () => widget?.classList.remove("speaking");
    window.speechSynthesis.speak(utterance);
  });
}

function humeur(model) {
  const rate = moyenne(model.districts.map((district) => district.tauxMoyen));
  const previous = moyenne(model.districts.map((district) => district.tauxPrecedent));
  const critical = model.districts.filter((district) => district.statut === "critique").length;
  const tendance = tendanceRecente(model.evolution?.moyenne_generale || []);
  if (rate !== null && rate < model.seuils.critique) return "alerte";
  if (tendance === "baisse") return "alerte";
  const comparable = moyenne(model.districts.map((district) => district.tauxComparable));
  if (previous !== null && comparable !== null && comparable - previous >= model.seuils.baisse) return "content";
  if (critical > 0) return "vigilant";
  if (rate !== null && rate >= model.seuils.conforme) return "serein";
  return "attentif";
}

function afficherDialogue(dialogue, humeurForcee = null, { speak = false } = {}) {
  segmentsCourants = dialogue.segments.map((segment) => ({ ...segment, affichage: versAffichage(segment.texte), oral: versOral(segment.texte) }));
  currentText = segmentsCourants.map((segment) => segment.affichage).join(" ");
  const mood = humeurForcee || HUMEUR_PAR_EMOTION[dialogue.emotion] || "attentif";
  const bubble = widget.querySelector(".sokhnaci-bubble");
  bubble.textContent = currentText;
  bubble.setAttribute("aria-label", currentText);
  bubble.scrollTop = 0;
  widget.querySelector(".sokhnaci-svg").setAttribute("data-mood", mood);
  widget.querySelector(".sokhnaci-state").textContent = LIBELLE_HUMEUR[mood];
  if (speak) parler();
}

function render(model, { speak = false } = {}) {
  modeleCourant = model;
  afficherDialogue(creerSituation(model), humeur(model), { speak });
}

function poserQuestion(texte) {
  if (!modeleCourant) return;
  afficherDialogue(repondre(texte, modeleCourant), null, { speak: voiceEnabled });
}

function majBoutonVoix(bouton) {
  const etat = voiceEnabled ? "activée" : "coupée";
  bouton.textContent = `Voix : ${etat}`;
  bouton.setAttribute("aria-pressed", String(voiceEnabled));
  bouton.setAttribute("aria-label", `Voix : ${etat}, cliquer pour ${voiceEnabled ? "désactiver" : "activer"}`);
}

export function replierSokhnaci() {
  if (!widget || widget.classList.contains("collapsed")) return;
  widget.classList.add("collapsed");
  widget.querySelector(".sokhnaci-launcher").hidden = false;
}

export function initSokhnaci(model) {
  if (widget) { render(model); return; }
  try { voiceEnabled = localStorage.getItem(CLE_VOIX) !== "false"; } catch { voiceEnabled = true; }
  widget = document.createElement("section");
  widget.className = "sokhnaci-widget";
  widget.setAttribute("aria-label", "Bébé Sokhnaci, guide vocal du tableau de bord");
  widget.innerHTML = `<div class="sokhnaci-card"><div class="sokhnaci-top"><div><p class="eyebrow">VOTRE GUIDE</p><strong>Sokhnaci</strong><span class="sokhnaci-state"></span></div><button class="sokhnaci-collapse" type="button" aria-label="Réduire Sokhnaci">−</button></div><div class="sokhnaci-content"><div class="sokhnaci-character">${svgMarkup()}</div><p class="sokhnaci-bubble" tabindex="0"></p><div class="sokhnaci-actions"><button class="sokhnaci-speak" type="button">▶ Écouter le résumé</button><button class="sokhnaci-voice" type="button" aria-pressed="true"></button></div><form class="sokhnaci-ask" autocomplete="off"><input type="text" name="question" maxlength="120" placeholder="Posez votre question…" aria-label="Poser une question à Sokhnaci"><button type="submit">Demander</button></form></div></div><button class="sokhnaci-launcher" type="button" aria-label="Ouvrir le résumé Sokhnaci" hidden><span class="sokhnaci-mini" aria-hidden="true"></span><span>Sokhnaci</span></button>`;
  document.body.appendChild(widget);
  widget.querySelector(".sokhnaci-collapse").addEventListener("click", replierSokhnaci);
  widget.querySelector(".sokhnaci-launcher").addEventListener("click", () => {
    widget.classList.remove("collapsed");
    widget.querySelector(".sokhnaci-launcher").hidden = true;
  });
  widget.querySelector(".sokhnaci-speak").addEventListener("click", parler);
  widget.querySelector(".sokhnaci-ask").addEventListener("submit", (event) => {
    event.preventDefault();
    const champ = event.currentTarget.elements.question;
    poserQuestion(champ.value);
    champ.value = "";
  });
  widget.querySelector(".sokhnaci-voice").addEventListener("click", (event) => {
    voiceEnabled = !voiceEnabled;
    try { localStorage.setItem(CLE_VOIX, String(voiceEnabled)); } catch { /* stockage facultatif */ }
    majBoutonVoix(event.currentTarget);
    if (voiceEnabled) parler(); else window.speechSynthesis?.cancel();
  });
  majBoutonVoix(widget.querySelector(".sokhnaci-voice"));
  render(model, { speak: voiceEnabled });
  return widget;
}

export function mettreAJourSokhnaci(model) {
  if (widget) render(model);
}
