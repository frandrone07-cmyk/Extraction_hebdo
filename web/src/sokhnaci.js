import { creerSituation, repondre, versAffichage, versOral } from "./sokhnaci-dialogue.js";

const CLE_VOIX = "completude-sokhnaci-voice";
const DOSSIER_AUDIO_WOLOF = "audio/wo/";
let widget = null;
let currentText = "";
let segmentsCourants = [];
let modeleCourant = null;
let lectureId = 0;
let audioCourant = null;
let ecouteEnCours = null;
let marcheTimer = null;
const audiosAbsents = new Set();
const HUMEUR_PAR_EMOTION = { neutre: "attentif", souriante: "serein", preoccupee: "alerte", encourageante: "vigilant", felicitations: "content" };
const LIBELLE_HUMEUR = { alerte: "Point d’attention", vigilant: "À surveiller", attentif: "Analyse en cours", content: "En progression", serein: "Situation conforme" };
let voiceEnabled = true;

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
    <ellipse class="baby-shadow" cx="56" cy="108" rx="28" ry="4"/>
    <g class="sok-leg sok-leg-l"><rect class="baby-skin" x="47" y="94" width="6" height="11" rx="2.5"/><ellipse class="sok-shoe" cx="48" cy="106.5" rx="5.5" ry="2.6"/></g>
    <g class="sok-leg sok-leg-r"><rect class="baby-skin" x="59" y="94" width="6" height="11" rx="2.5"/><ellipse class="sok-shoe" cx="64" cy="106.5" rx="5.5" ry="2.6"/></g>
    <g class="sok-body">
      <g class="baby-arm baby-arm-left"><path class="baby-skin" d="M40 72c-7 2-11 8-12 16l-1 8c0 4 5 5 6 1l3-8c3-4 6-8 7-13z"/><circle class="baby-skin" cx="29" cy="98" r="4"/><path class="baby-wax" d="M40 70c-8 1-13 6-14 12l8 3c2-4 5-8 9-11z"/></g>
      <g class="baby-arm baby-arm-right"><path class="baby-skin" d="M72 72c7 2 11 8 12 16l1 8c0 4-5 5-6 1l-3-8c-3-4-6-8-7-13z"/><circle class="baby-skin" cx="83" cy="98" r="4"/><path class="baby-wax" d="M72 70c8 1 13 6 14 12l-8 3c-2-4-5-8-9-11z"/></g>
      <path class="baby-shirt" d="M38 71c5-5 11-8 18-8s13 3 18 8l8 28H30z"/>
      <path class="baby-neck baby-skin" d="M50 58h12v10l-6 8-6-8z"/>
      <path class="baby-shirt-collar" d="M47 68l9 9 9-9"/>
      <g class="sok-head">
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
      </g>
    </g>
  </svg>`;
}

// Les voix du navigateur se chargent après le démarrage (Chrome) : on attend leur liste.
const voixDisponibles = new Promise((resolve) => {
  if (!("speechSynthesis" in window)) { resolve([]); return; }
  const lister = () => window.speechSynthesis.getVoices();
  if (lister().length) { resolve(lister()); return; }
  window.speechSynthesis.addEventListener("voiceschanged", () => resolve(lister()), { once: true });
  setTimeout(() => resolve(lister()), 1500);
});
const FEMININES = /(denise|eloise|éloïse|vivienne|brigitte|hortense|julie|amelie|amélie|audrey|marie|aurelie|aurélie|jacqueline|celeste|céleste|josephine|joséphine|sylvie|google fran|female|femme)/i;
const MASCULINES = /(paul|henri|claude|thomas|nicolas|antoine|remy|rémy|mathieu|male|homme)/i;
function noteVoix(voix) {
  if (!/^fr/i.test(voix.lang)) return -1000;
  let note = 0;
  if (/natural|neural|online/i.test(voix.name)) note += 40;
  if (FEMININES.test(voix.name)) note += 30;
  if (MASCULINES.test(voix.name)) note -= 100;
  if (/^fr[-_]fr$/i.test(voix.lang)) note += 5;
  return note;
}
// Renvoie la meilleure voix féminine française et si elle est bien identifiée comme féminine.
async function choisirVoix() {
  const voix = (await voixDisponibles).filter((v) => /^fr/i.test(v.lang));
  const classees = voix.map((v) => ({ voix: v, note: noteVoix(v) })).sort((x, y) => y.note - x.note);
  const meilleure = classees[0];
  return meilleure ? { voix: meilleure.voix, feminine: FEMININES.test(meilleure.voix.name) && !MASCULINES.test(meilleure.voix.name) } : { voix: null, feminine: false };
}

function arreterLecture() {
  lectureId += 1;
  window.speechSynthesis?.cancel();
  audioCourant?.pause();
  audioCourant = null;
  if (widget) {
    widget.classList.remove("speaking");
    widget.dataset.geste = "";
  }
}

// Un enregistrement réel (web/audio/wo/<nom>.wav ou .mp3) est joué en priorité pour le wolof ;
// à défaut, la voix de synthèse prend le relais.
function essayerAudio(url) {
  if (audiosAbsents.has(url)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audioCourant = audio;
    audio.onended = () => resolve(true);
    audio.onerror = () => { audiosAbsents.add(url); resolve(false); };
    audio.play().catch(() => resolve(false));
  });
}
async function jouerAudio(nom) {
  return (await essayerAudio(`${DOSSIER_AUDIO_WOLOF}${nom}.wav`)) || (await essayerAudio(`${DOSSIER_AUDIO_WOLOF}${nom}.mp3`));
}

async function jouerVoix(segment) {
  if (!("speechSynthesis" in window)) return;
  const { voix, feminine } = await choisirVoix();
  await new Promise((resolve) => {
    try {
      const parole = new SpeechSynthesisUtterance(segment.oral);
      parole.lang = "fr-FR";
      if (voix) parole.voice = voix;
      parole.rate = 0.94;
      parole.pitch = feminine ? 1.04 : 1.14;
      const securite = setTimeout(resolve, Math.max(3500, segment.oral.length * 95));
      const fin = () => { clearTimeout(securite); resolve(); };
      parole.onend = parole.onerror = fin;
      parole.onstart = () => widget?.classList.add("speaking");
      window.speechSynthesis.speak(parole);
    } catch {
      resolve();
    }
  });
}

async function lire(segments) {
  arreterLecture();
  const id = lectureId;
  for (const segment of segments) {
    if (id !== lectureId) return;
    widget.classList.add("speaking");
    widget.dataset.geste = segment.geste || "";
    let joue = false;
    if (segment.audio) joue = await jouerAudio(segment.audio);
    if (!joue && id === lectureId) await jouerVoix(segment);
  }
  if (id === lectureId) {
    widget.classList.remove("speaking");
    widget.dataset.geste = "";
  }
}

function parler() {
  if (!voiceEnabled || !segmentsCourants.length) return;
  lire(segmentsCourants);
}

function marcher(duree = 2600) {
  if (!widget || widget.classList.contains("collapsed") || widget.classList.contains("listening")) return;
  widget.classList.add("walking");
  clearTimeout(marcheTimer);
  marcheTimer = setTimeout(() => widget.classList.remove("walking"), duree);
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
  marcher(2200);
  afficherDialogue(repondre(texte, modeleCourant), null, { speak: voiceEnabled });
}

function message(texte, emotion = "neutre") {
  afficherDialogue({ emotion, segments: [{ langue: "fr", texte, geste: "inclinaison_ecoute" }] }, null, { speak: voiceEnabled });
}

function ecouterQuestion(bouton) {
  const Reconnaissance = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Reconnaissance) return;
  if (ecouteEnCours) { ecouteEnCours.stop(); return; }
  arreterLecture();
  const reconnaissance = new Reconnaissance();
  reconnaissance.lang = "fr-FR";
  reconnaissance.interimResults = true;
  reconnaissance.continuous = false;
  const champ = widget.querySelector(".sokhnaci-ask input");
  let finale = "";
  let erreur = false;
  reconnaissance.onstart = () => {
    widget.classList.add("listening");
    bouton.setAttribute("aria-pressed", "true");
    widget.querySelector(".sokhnaci-state").textContent = "Je vous écoute…";
  };
  reconnaissance.onresult = (event) => {
    let texte = "";
    for (const resultat of event.results) texte += resultat[0].transcript;
    champ.value = texte;
    if (event.results[event.results.length - 1].isFinal) finale = texte;
  };
  reconnaissance.onerror = (event) => {
    erreur = true;
    message(event.error === "not-allowed" || event.error === "service-not-allowed"
      ? "Autorisez le micro dans votre navigateur pour que je puisse vous écouter."
      : "Je n’ai pas bien entendu. Pouvez-vous répéter ?");
  };
  reconnaissance.onend = () => {
    widget.classList.remove("listening");
    bouton.setAttribute("aria-pressed", "false");
    ecouteEnCours = null;
    if (finale.trim()) { champ.value = ""; poserQuestion(finale); }
    else if (!erreur) message("Pardon, pouvez-vous répéter ?");
  };
  ecouteEnCours = reconnaissance;
  try { reconnaissance.start(); } catch { ecouteEnCours = null; }
}

function majBoutonVoix(bouton) {
  const etat = voiceEnabled ? "activée" : "coupée";
  bouton.textContent = `Voix : ${etat}`;
  bouton.setAttribute("aria-pressed", String(voiceEnabled));
  bouton.setAttribute("aria-label", `Voix : ${etat}, cliquer pour ${voiceEnabled ? "désactiver" : "activer"}`);
}

export function replierSokhnaci() {
  if (!widget || widget.classList.contains("collapsed")) return;
  arreterLecture();
  widget.classList.add("collapsed");
  widget.querySelector(".sokhnaci-launcher").hidden = false;
}

export function initSokhnaci(model) {
  if (widget) { render(model); return; }
  try { voiceEnabled = localStorage.getItem(CLE_VOIX) !== "false"; } catch { voiceEnabled = true; }
  const microDisponible = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  widget = document.createElement("section");
  widget.className = "sokhnaci-widget";
  widget.setAttribute("aria-label", "Sokhnaci, guide vocal du tableau de bord");
  widget.innerHTML = `<div class="sokhnaci-card"><div class="sokhnaci-top"><div><p class="eyebrow">VOTRE GUIDE</p><strong>Sokhnaci</strong><span class="sokhnaci-state"></span></div><button class="sokhnaci-collapse" type="button" aria-label="Réduire Sokhnaci">−</button></div><div class="sokhnaci-content"><div class="sokhnaci-character">${svgMarkup()}</div><p class="sokhnaci-bubble" tabindex="0"></p><div class="sokhnaci-actions"><button class="sokhnaci-speak" type="button">▶ Écouter le résumé</button><button class="sokhnaci-voice" type="button" aria-pressed="true"></button></div><form class="sokhnaci-ask" autocomplete="off"><input type="text" name="question" maxlength="120" placeholder="Posez votre question…" aria-label="Poser une question à Sokhnaci"><button class="sokhnaci-mic" type="button" aria-pressed="false" aria-label="Poser la question à voix haute"${microDisponible ? "" : " hidden"} title="Parlez en français : le navigateur ne reconnaît pas encore le wolof">🎤</button><button type="submit">Demander</button></form></div></div><button class="sokhnaci-launcher" type="button" aria-label="Ouvrir le résumé Sokhnaci" hidden><span class="sokhnaci-mini" aria-hidden="true"></span><span>Sokhnaci</span></button>`;
  document.body.appendChild(widget);
  widget.querySelector(".sokhnaci-collapse").addEventListener("click", replierSokhnaci);
  widget.querySelector(".sokhnaci-launcher").addEventListener("click", () => {
    widget.classList.remove("collapsed");
    widget.querySelector(".sokhnaci-launcher").hidden = true;
  });
  widget.querySelector(".sokhnaci-speak").addEventListener("click", parler);
  widget.querySelector(".sokhnaci-mic").addEventListener("click", (event) => ecouterQuestion(event.currentTarget));
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
    if (voiceEnabled) parler(); else arreterLecture();
  });
  majBoutonVoix(widget.querySelector(".sokhnaci-voice"));
  widget.classList.add("entering", "walking");
  setTimeout(() => widget?.classList.remove("entering", "walking"), 2400);
  setInterval(() => { if (!widget.classList.contains("speaking")) marcher(2600); }, 20000);
  render(model, { speak: voiceEnabled });
  return widget;
}

export function mettreAJourSokhnaci(model) {
  if (widget) render(model);
}
