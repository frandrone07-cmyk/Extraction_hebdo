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
  return `<svg class="sokhnaci-svg" viewBox="0 0 112 112" role="img" aria-label="Sokhnaci, guide du tableau de bord">
    <defs><pattern id="sok-wax" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#f2a31b"/><circle cx="4" cy="4" r="3.3" fill="#17365d"/><circle cx="4" cy="4" r="1.3" fill="#f6e3b0"/><path d="M12 8l3 3-3 3-3-3z" fill="#c2362b"/><circle cx="12" cy="2" r="1.1" fill="#1b7f4f"/><circle cx="2" cy="13" r="1.1" fill="#1b7f4f"/></pattern></defs>
    <ellipse class="baby-shadow" cx="56" cy="106" rx="30" ry="4.5"/>
    <g class="baby-arm baby-arm-left"><path class="baby-skin" d="M40 72c-7 2-11 8-12 16l-1 8c0 4 5 5 6 1l3-8c3-4 6-8 7-13z"/><circle class="baby-skin" cx="29" cy="98" r="4"/><path class="baby-wax" d="M40 70c-8 1-13 6-14 12l8 3c2-4 5-8 9-11z"/></g>
    <g class="baby-arm baby-arm-right"><path class="baby-skin" d="M72 72c7 2 11 8 12 16l1 8c0 4-5 5-6 1l-3-8c-3-4-6-8-7-13z"/><circle class="baby-skin" cx="83" cy="98" r="4"/><path class="baby-wax" d="M72 70c8 1 13 6 14 12l-8 3c-2-4-5-8-9-11z"/></g>
    <path class="baby-shirt" d="M38 71c5-5 11-8 18-8s13 3 18 8l9 35H29z"/>
    <path class="baby-neck baby-skin" d="M50 58h12v10l-6 8-6-8z"/>
    <path class="baby-shirt-collar" d="M47 68l9 9 9-9"/>
    <ellipse class="baby-hair-back" cx="56" cy="31" rx="33" ry="29"/>
    <circle class="baby-hair-back" cx="26" cy="38" r="9"/><circle class="baby-hair-back" cx="86" cy="38" r="9"/>
    <circle class="baby-ear baby-skin" cx="34" cy="46" r="5"/><circle class="baby-ear baby-skin" cx="78" cy="46" r="5"/>
    <circle class="baby-earring" cx="34" cy="53" r="2.4"/><circle class="baby-earring" cx="78" cy="53" r="2.4"/>
    <ellipse class="baby-face baby-skin" cx="56" cy="45" rx="22" ry="25"/>
    <path class="baby-hair" d="M33 38c-1-14 9-23 23-23s24 9 23 23c-6-7-14-10-23-10s-17 3-23 10z"/>
    <path class="baby-wrap" d="M25 27c10-12 52-12 62 0l-3 8c-10-8-46-8-56 0z"/>
    <path class="baby-wrap-knot" d="M56 12c-6-7-14-4-12 3 2 5 9 4 12-3zm0 0c6-7 14-4 12 3-2 5-9 4-12-3z"/>
    <path class="baby-brow" d="M42 41q5-4 10 0m8 0q5-4 10 0"/>
    <ellipse class="baby-eye" cx="47" cy="47" rx="2.3" ry="3"/><ellipse class="baby-eye" cx="65" cy="47" rx="2.3" ry="3"/>
    <ellipse class="baby-cheek" cx="40" cy="56" rx="5" ry="2.6"/><ellipse class="baby-cheek" cx="72" cy="56" rx="5" ry="2.6"/>
    <path class="baby-mouth-smile" d="M49 59q7 7 14 0"/><ellipse class="baby-mouth-open" cx="56" cy="60" rx="3.6" ry="4.5"/><path class="baby-mouth-flat" d="M51 60h10"/>
  </svg>`;
}

// Meilleure voix féminine française disponible sur l'appareil (le navigateur n'en fournit pas de voix wolof).
function choisirVoix() {
  if (!("speechSynthesis" in window)) return null;
  const francaises = window.speechSynthesis.getVoices().filter((voix) => /^fr/i.test(voix.lang));
  const feminines = /(denise|eloise|vivienne|brigitte|hortense|julie|amelie|amélie|audrey|marie|aurelie|aurélie|google fran|female|femme)/i;
  const masculines = /(paul|henri|claude|thomas|nicolas|male|homme)/i;
  return francaises.find((voix) => feminines.test(voix.name) && !masculines.test(voix.name)) || francaises.find((voix) => !masculines.test(voix.name)) || francaises[0] || null;
}

function parler() {
  if (!voiceEnabled || !segmentsCourants.length || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  segmentsCourants.forEach((segment, index) => {
    utterance = new SpeechSynthesisUtterance(segment.oral);
    utterance.lang = "fr-FR";
    const voix = choisirVoix();
    if (voix) utterance.voice = voix;
    utterance.rate = 0.94;
    utterance.pitch = 1.08;
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
  widget.setAttribute("aria-label", "Sokhnaci, guide vocal du tableau de bord");
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
