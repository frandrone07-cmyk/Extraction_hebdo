import { creerSituation, versAffichage, versOral } from "./sokhnaci-dialogue.js";
import { phraseAction } from "./sokhnaci-actions.js";
import { interpreterEntree } from "./sokhnaci-cerveau.js";
import { avatar3dAutorise, obtenir3D } from "./sokhnaci-3d.js";
import { gesteA, humeurPhrase, planifierGestes } from "./sokhnaci-gestes.js";
import { creerMarcheur } from "./marche.js";
import { effacerMiseEnAvant, mettreEnAvant } from "./mise-en-avant.js";

const CLE_VOIX = "completude-sokhnaci-voice";
const CLE_VOIX_CHOISIE = "completude-sokhnaci-voix-nom";
const DELAIS_NOUVEL_ESSAI = [8000, 40000, 180000];
const ECHECS_MAX = 3;
const VOIX_PIPER = "fr_FR-siwis-medium";
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
let piper = null;
let piperPromesse = null;
let piperEnCache = false;
let piperAbandonne = false;
let echecsSynthese = 0;
let statutVoix = null;
let contexteAudio = null;
let volume = 1;
const avatarsExternes = new Set();
let planGestes = [];
let segmentsLecture = [];
// Le suivi visuel dans la page ne s'active que pour une lecture demandée (bouton Écouter, question), jamais pour
// l'accueil automatique ; il s'arrête dès que l'utilisateur fait défiler la page lui-même.
let suiviPage = false;
// Grand écran : la carte flottante devient une présentatrice en pied dans une colonne à droite (comme en mode TV).
const ECRAN_PRESENTATRICE = window.matchMedia("(min-width: 1360px)");
let marcheur = null;
let emotionDialogue = "neutre";
let gesteActuel = null;
const syntheses = new Map();

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

const DEFS_WAX = `<svg class="sokhnaci-defs" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute"><defs><pattern id="sok-wax" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#f2a31b"/><circle cx="4" cy="4" r="3.3" fill="#17365d"/><circle cx="4" cy="4" r="1.3" fill="#f6e3b0"/><path d="M12 8l3 3-3 3-3-3z" fill="#c2362b"/><circle cx="12" cy="2" r="1.1" fill="#1b7f4f"/><circle cx="2" cy="13" r="1.1" fill="#1b7f4f"/></pattern><pattern id="sok-ankara" width="18" height="18" patternUnits="userSpaceOnUse"><rect width="18" height="18" fill="#1b4fa3"/><circle cx="9" cy="9" r="6.5" fill="#d6336c"/><circle cx="9" cy="9" r="4" fill="#fff4d6"/><circle cx="9" cy="9" r="1.8" fill="#1b4fa3"/><path d="M0 0l4 4M18 0l-4 4M0 18l4-4M18 18l-4-4" stroke="#f59f00" stroke-width="1.6"/></pattern><pattern id="sok-bazin" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="#233f8f"/><path d="M0 14L14 0M-3 3L3 -3M11 17L17 11" stroke="#e8c963" stroke-width=".7" opacity=".75"/><path d="M7 3.5l2 3.5-2 3.5-2-3.5z" fill="#e8c963"/></pattern></defs></svg>`;

export function svgMarkup(decoratif = false) {
  return `<svg class="sokhnaci-svg" viewBox="0 0 112 112" ${decoratif ? 'aria-hidden="true"' : 'role="img" aria-label="Sokhnaci, guide du tableau de bord"'}>
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

// Voix originale : modèle Piper « siwis » (voix féminine française) exécuté dans le navigateur.
// Tout est automatique : préchargement en arrière-plan, cache persistant (téléchargement une seule fois),
// nouvelles tentatives, hébergeur de secours, et retour à la voix de l'appareil au moindre problème.
function annoncerVoix(texte, duree = 0) {
  emettre("voix", { texte });
  if (!statutVoix) return;
  statutVoix.textContent = texte;
  if (duree) setTimeout(() => { if (statutVoix.textContent === texte) statutVoix.textContent = ""; }, duree);
}

// Moteur dans un Web Worker (sokhnaci-voix-worker.js) : modèle, session ONNX et phonémiseur chargés une seule fois,
// la page reste fluide pendant la synthèse, et les phrases devenues inutiles sont annulées.
let travailleur = null;
let compteurSynthese = 0;
const attentesSynthese = new Map();

function chargerPiper() {
  if (piperPromesse) return piperPromesse;
  piperPromesse = new Promise((resolve, reject) => {
    try { navigator.storage?.persist?.(); } catch { /* facultatif */ }
    try {
      travailleur = new Worker(new URL("./sokhnaci-voix-worker.js", import.meta.url), { type: "module" });
    } catch (erreur) { reject(erreur); return; }
    const echec = (raison) => {
      travailleur?.terminate();
      travailleur = null;
      for (const resoudre of attentesSynthese.values()) resoudre(null);
      attentesSynthese.clear();
      reject(new Error(raison));
    };
    const garde = setTimeout(() => echec("chargement trop long"), 240000);
    travailleur.onerror = () => {
      clearTimeout(garde);
      if (piper) { reinitialiserVoix(); return; } // panne après démarrage : on relance le moteur proprement
      echec("moteur de voix indisponible");
    };
    travailleur.onmessage = (evenement) => {
      const m = evenement.data || {};
      if (m.type === "progression" && m.pourcent >= 0) annoncerVoix(`Je prépare ma voix originale (téléchargement unique) : ${m.pourcent} %`);
      else if (m.type === "pret") {
        clearTimeout(garde);
        piper = travailleur;
        piperEnCache = true;
        echecsSynthese = 0;
        annoncerVoix(m.dejaLa ? "" : "Ma voix originale est prête.", 4000);
        resolve(travailleur);
      } else if (m.type === "erreur") { clearTimeout(garde); echec(m.message); }
      else if (m.type === "audio" || m.type === "echec") {
        const resoudre = attentesSynthese.get(m.cle);
        attentesSynthese.delete(m.cle);
        resoudre?.(m.type === "audio" ? new Blob([m.wav], { type: "audio/wav" }) : (m.annule ? "annule" : null));
      }
    };
    travailleur.postMessage({ type: "init" });
  }).catch((erreur) => {
    piperPromesse = null;
    piper = null;
    throw erreur;
  });
  return piperPromesse;
}

// Le moteur de voix s'est arrêté en cours de route : les phrases en attente passent à la voix de l'appareil
// et un nouveau moteur est démarré quelques secondes plus tard (le modèle est déjà en cache).
function reinitialiserVoix() {
  try { travailleur?.terminate(); } catch { /* déjà arrêté */ }
  travailleur = null;
  piper = null;
  piperPromesse = null;
  for (const resoudre of attentesSynthese.values()) resoudre(null);
  attentesSynthese.clear();
  syntheses.clear();
  setTimeout(() => demarrerPiperAutomatique(), 4000);
}

async function voixDejaTelechargee() {
  try {
    const dossier = await (await navigator.storage.getDirectory()).getDirectoryHandle("piper");
    return (await (await dossier.getFileHandle(`${VOIX_PIPER}.onnx`)).getFile()).size > 1000;
  } catch { return false; }
}

// Démarrage automatique, avec nouvelles tentatives espacées et reprise quand la connexion revient.
function demarrerPiperAutomatique(tentative = 0) {
  if (piperAbandonne || piper) return;
  if (navigator.connection?.saveData) return;
  if (navigator.webdriver && !window.__sokhnaciPiper) return; // tests automatisés : pas de téléchargement
  if (typeof Worker === "undefined") return;
  chargerPiper().then(() => {
    if (modeleCourant) prechauffer(segmentsCourants);
  }).catch(() => {
    if (tentative < DELAIS_NOUVEL_ESSAI.length) {
      setTimeout(() => demarrerPiperAutomatique(tentative + 1), DELAIS_NOUVEL_ESSAI[tentative]);
    } else {
      annoncerVoix("Voix de l’appareil utilisée (la voix originale n’est pas joignable pour le moment).", 8000);
    }
  });
}

const delai = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));

// Une phrase longue est découpée aux virgules : le premier morceau, court, part très vite pendant que la suite
// est fabriquée. Les morceaux restent des groupes de sens (jamais au milieu d'un mot).
export function decouper(texte, premier = false) {
  // Au début d'une réponse, les morceaux grandissent progressivement (environ 45, 60, 80, 110 caractères…) :
  // chaque morceau est fabriqué pendant que le précédent est lu, donc sans blanc entre eux.
  let max = premier ? 45 : 150;
  const morceaux = [];
  let reste = texte;
  while (reste.length > max) {
    const zone = reste.slice(0, max);
    let coupe = Math.max(zone.lastIndexOf(', '), zone.lastIndexOf('; '), zone.lastIndexOf(' : '));
    if (coupe < 20) coupe = zone.lastIndexOf(' ');
    if (coupe < 20) break;
    morceaux.push(reste.slice(0, coupe + 1).trim());
    reste = reste.slice(coupe + 1).trim();
    max = Math.min(150, Math.round(max * 1.35));
  }
  if (reste) morceaux.push(reste);
  return morceaux;
}

// id = null : préchauffage (jamais annulé). Renvoie un Blob WAV, ou null (la voix de l'appareil prend le relais).
function synthetiser(texte, id) {
  if (syntheses.has(texte)) return syntheses.get(texte);
  const promesse = new Promise((resolve) => {
    if (!piper || piperAbandonne || !travailleur) { resolve(null); return; }
    const cle = ++compteurSynthese;
    attentesSynthese.set(cle, resolve);
    travailleur.postMessage({ type: "synth", cle, id, texte });
    setTimeout(() => { if (attentesSynthese.has(cle)) { attentesSynthese.delete(cle); resolve(null); } }, 15000);
  }).then((resultat) => {
    if (resultat === "annule") { syntheses.delete(texte); return null; }
    if (resultat) echecsSynthese = 0;
    else {
      syntheses.delete(texte);
      if (piper && ++echecsSynthese >= ECHECS_MAX) {
        piperAbandonne = true;
        annoncerVoix("Voix de l’appareil utilisée (la voix originale ne répond pas sur cet appareil).", 8000);
      }
    }
    return resultat;
  });
  syntheses.set(texte, promesse);
  if (syntheses.size > 60) syntheses.delete(syntheses.keys().next().value);
  return promesse;
}

// Prépare à l'avance les phrases affichées pour qu'elles démarrent sans attente.
function prechauffer(segments) {
  if (!piper || piperAbandonne) return;
  segments.forEach((segment, i) => { if (!segment.audio) for (const m of decouper(segment.oral, i === 0)) synthetiser(m, null); });
}

function jouerBlob(blob, surProgression = null) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = volume;
    audioCourant = audio;
    let delier = () => {};
    const fin = (ok) => { delier(); URL.revokeObjectURL(url); resolve(ok); };
    audio.onplaying = () => { delier = lierBouche(audio, surProgression); emettre("etat", { etat: "parle" }); };
    audio.onended = () => fin(true);
    audio.onerror = () => fin(false);
    audio.play().catch(() => fin(false));
  });
}

function avatars() { return [widget, ...avatarsExternes].filter(Boolean); }
function emettre(type, detail = {}) { document.dispatchEvent(new CustomEvent("sokhnaci:evenement", { detail: { type, ...detail } })); }
export function lierAvatarExterne(element) { avatarsExternes.add(element); }
export function preparerVoixOriginale() { demarrerPiperAutomatique(); }
export function delierAvatarExterne(element) { avatarsExternes.delete(element); }
export function definirVolume(valeur) {
  volume = Math.max(0, Math.min(1, Number(valeur)));
  if (audioCourant) audioCourant.volume = volume;
}
export function lireVolume() { return volume; }
function definirParole(actif, geste = "") {
  for (const element of avatars()) {
    element.classList.toggle("speaking", actif);
    element.dataset.geste = actif ? geste : "";
  }
}
// Geste synchronisé avec les mots : `fraction` est la progression (0 à 1) dans la phrase en cours de lecture.
function suivreGeste(fraction) {
  if (!Number.isFinite(fraction)) return;
  const geste = gesteA(planGestes, Math.max(0, Math.min(1, fraction)));
  if (geste === gesteActuel) return;
  gesteActuel = geste;
  for (const element of avatars()) if (element.classList.contains("speaking")) element.dataset.geste = geste;
}
function definirBouche(ouverture) {
  for (const element of avatars()) {
    if (ouverture === null) { element.style.removeProperty("--bouche"); delete element.dataset.sync; } else { element.style.setProperty("--bouche", String(ouverture)); element.dataset.sync = "audio"; }
  }
}

// Synchronisation labiale en temps réel : l'ouverture de la bouche suit l'énergie réelle du son lu.
function lierBouche(audio, surProgression = null) {
  try {
    contexteAudio ||= new (window.AudioContext || window.webkitAudioContext)();
    contexteAudio.resume?.();
    const source = contexteAudio.createMediaElementSource(audio);
    const analyseur = contexteAudio.createAnalyser();
    analyseur.fftSize = 256;
    source.connect(analyseur);
    analyseur.connect(contexteAudio.destination);
    const donnees = new Uint8Array(analyseur.fftSize);
    let actif = true;
    let lisse = 0.3;
    const boucle = () => {
      if (!actif) return;
      analyseur.getByteTimeDomainData(donnees);
      let somme = 0;
      for (const valeur of donnees) { const centre = (valeur - 128) / 128; somme += centre * centre; }
      const energie = Math.sqrt(somme / donnees.length);
      lisse += (Math.min(1.7, 0.3 + energie * 9) - lisse) * 0.45;
      definirBouche(lisse);
      if (audio.duration > 0 && Number.isFinite(audio.duration)) (surProgression || suivreGeste)(audio.currentTime / audio.duration);
      requestAnimationFrame(boucle);
    };
    boucle();
    return () => { actif = false; definirBouche(null); };
  } catch {
    return () => {};
  }
}

// Hors mode TV et hors espace Sokhna Ci AI, la page défile jusqu'à la zone commentée (indicateur, carte, bilan…).
function suivreDansLaPage(index) {
  const libre = suiviPage && !document.body.classList.contains("tv") && !document.body.classList.contains("sna-actif");
  const cible = index === null ? null : segmentsLecture[index]?.cible;
  if (!libre || !cible) { if (libre) effacerMiseEnAvant(); return; }
  mettreEnAvant(document.getElementById("contenu"), cible);
}
function marquerPhrase(index) {
  emettre("phrase", { index });
  if (index !== null && index >= 2 && index % 2 === 0 && widget?.classList.contains("presentatrice")) marcheur?.flaner(30, 1000);
  suivreDansLaPage(index);
  const bulle = widget?.querySelector(".sokhnaci-bubble");
  if (!bulle) return;
  bulle.querySelectorAll(".sok-phrase.actif").forEach((element) => element.classList.remove("actif"));
  const phrase = index === null ? null : bulle.querySelector(`.sok-phrase[data-index="${index}"]`);
  if (!phrase) return;
  phrase.classList.add("actif");
  bulle.scrollTo({ top: Math.max(0, phrase.offsetTop - bulle.clientHeight / 3), behavior: "smooth" });
}

function arreterLecture() {
  lectureId += 1;
  travailleur?.postMessage({ type: "annuler", avant: lectureId }); // les phrases d'une lecture interrompue ne sont plus fabriquées
  window.speechSynthesis?.cancel();
  audioCourant?.pause();
  audioCourant = null;
  if (widget) {
    definirParole(false);
    definirBouche(null);
    marquerPhrase(null);
  }
}

// Un enregistrement réel (web/audio/wo/<nom>.wav ou .mp3) est joué en priorité pour le wolof ;
// à défaut, la voix de synthèse prend le relais.
function essayerAudio(url) {
  if (audiosAbsents.has(url)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.volume = volume;
    audioCourant = audio;
    let delier = () => {};
    audio.onplaying = () => { delier = lierBouche(audio); emettre("etat", { etat: "parle" }); };
    audio.onended = () => { delier(); resolve(true); };
    audio.onerror = () => { delier(); audiosAbsents.add(url); resolve(false); };
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
      parole.volume = volume;
      const securite = setTimeout(resolve, Math.max(3500, segment.oral.length * 95));
      const fin = () => { clearTimeout(securite); resolve(); };
      parole.onend = parole.onerror = fin;
      let debut = 0;
      let frontiere = false;
      let suivi = null;
      const duree = Math.max(1200, segment.oral.length * 72);
      const arreterSuivi = () => clearInterval(suivi);
      parole.onstart = () => {
        for (const element of avatars()) element.classList.add("speaking");
        emettre("etat", { etat: "parle" });
        debut = Date.now();
        // Sans événement de mot (voix distantes), la progression est estimée d'après la longueur du texte.
        suivi = setInterval(() => { if (Date.now() - debut > duree * 2.5) arreterSuivi(); else if (!frontiere) suivreGeste((Date.now() - debut) / duree); }, 120);
      };
      parole.onboundary = (evenement) => { frontiere = true; suivreGeste(evenement.charIndex / Math.max(1, segment.oral.length)); };
      const finOriginale = fin;
      parole.onend = parole.onerror = () => { arreterSuivi(); finOriginale(); };
      window.speechSynthesis.speak(parole);
    } catch {
      resolve();
    }
  });
}

async function lire(segments) {
  arreterLecture();
  const id = lectureId;
  segmentsLecture = segments;
  demarrerPiperAutomatique();
  // La réponse ne doit jamais attendre longtemps : si la voix originale n'est pas encore prête (premier
  // téléchargement), cette réponse est lue avec la voix de l'appareil et la suivante utilisera la voix originale.
  if (!piper && piperPromesse && !piperAbandonne) {
    emettre("etat", { etat: "prepare" });
    await Promise.race([piperPromesse.catch(() => null), delai(2500)]);
    if (id !== lectureId) return;
  }
  // Toutes les phrases (découpées en morceaux) sont demandées d'un coup : le moteur les fabrique dans l'ordre
  // pendant que les précédentes sont lues.
  const morceaux = segments.map((segment, i) => (segment.audio ? null : decouper(segment.oral, i === 0)));
  const originale = piper && !piperAbandonne ? morceaux.map((liste) => liste?.map((m) => synthetiser(m, id)) ?? null) : null;
  for (const [index, segment] of segments.entries()) {
    if (id !== lectureId) return;
    planGestes = planifierGestes(segment.affichage || segment.oral, segment.geste);
    gesteActuel = null;
    const humeur = humeurPhrase(segment.affichage || segment.oral);
    for (const element of avatars()) {
      element.dataset.emotion = humeur || element.dataset.emotionGenerale || element.dataset.emotion || "neutre";
      element.dataset.main = index % 2 ? "gauche" : "droite"; // la main qui rythme la parole alterne d'une phrase à l'autre
    }
    definirParole(true, gesteA(planGestes, 0));
    gesteActuel = gesteA(planGestes, 0);
    emettre("etat", { etat: "prepare" });
    marquerPhrase(index);
    let joue = false;
    if (segment.audio) joue = await jouerAudio(segment.audio);
    if (!joue && originale?.[index]) {
      const liste = morceaux[index];
      const total = liste.reduce((n, m) => n + m.length, 0) || 1;
      let avant = 0;
      joue = true;
      for (const [k, promesse] of originale[index].entries()) {
        const blob = await Promise.race([promesse, delai(9000)]);
        if (id !== lectureId) return;
        const decalage = avant;
        const ok = blob && (await jouerBlob(blob, (f) => suivreGeste((decalage + f * liste[k].length) / total)));
        if (!ok) {
          // Morceau manquant : la voix de l'appareil lit la fin de la phrase, sans rien sauter.
          if (id === lectureId) await jouerVoix({ ...segment, oral: liste.slice(k).join(" ") });
          break;
        }
        avant += liste[k].length;
      }
    }
    if (!joue && id === lectureId) await jouerVoix(segment);
  }
  if (id === lectureId) { definirParole(false); marquerPhrase(null); emettre("etat", { etat: "attente" }); emettre("fin"); }
}

async function attendrePuisParler() {
  if (!piper && !piperAbandonne && !(navigator.webdriver && !window.__sokhnaciPiper) && (await voixDejaTelechargee())) {
    demarrerPiperAutomatique();
    await Promise.race([piperPromesse || Promise.resolve(), delai(5000)]).catch(() => {});
  }
  parler({ suivi: false });
}

export function lireDialogue(dialogue) {
  const segments = dialogue.segments.map((segment) => ({ ...segment, affichage: versAffichage(segment.texte), oral: versOral(segment.texte) }));
  return lire(segments);
}
export { arreterLecture };

function parler({ suivi = true } = {}) {
  suiviPage = suivi;
  if (!voiceEnabled || !segmentsCourants.length) return;
  lire(segmentsCourants);
}

function arreterMouvement() {
  for (const element of avatars()) element.classList.remove("walking", "danse", "listening");
}

function etatTemporaire(classe, duree) {
  const cibles = avatars();
  for (const element of cibles) element.classList.add(classe);
  setTimeout(() => { for (const element of cibles) element.classList.remove(classe); }, duree);
}

// Les déplacements (marche, assise, danse...) se font dans l'espace 3D : la carte les lui confie.
const MOUVEMENTS = new Set(["applaudis", "incline", "reflechis", "viens", "suis", "avance", "recule", "tourne", "demitour", "marche", "rentre", "presente", "danse", "assis", "debout"]);

function executerCommande(commande) {
  const dialogue = phraseAction(commande);
  if (!dialogue) return false;
  switch (commande.action) {
    case "stop":
      arreterLecture();
      arreterMouvement();
      break;
    case "sourire":
      etatTemporaire("grand-sourire", 4500);
      break;
    case "ecoute":
      arreterMouvement();
      etatTemporaire("listening", 6000);
      break;
    case "montre": {
      const element = commande.cible ? document.querySelector(commande.cible.selecteur) : null;
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.classList.add("sokhnaci-mise-en-evidence");
        setTimeout(() => element.classList.remove("sokhnaci-mise-en-evidence"), 3000);
      }
      break;
    }
    default:
      break;
  }
  afficherDialogue(dialogue, null, { speak: voiceEnabled && commande.action !== "stop" });
  return true;
}

function marcher(duree = 2600) {
  if (!widget || widget.classList.contains("collapsed") || widget.classList.contains("listening")) return;
  if (widget.classList.contains("presentatrice")) { marcheur?.flaner(30, 1100); return; }
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
  bubble.replaceChildren(...segmentsCourants.flatMap((segment, index) => {
    const phrase = document.createElement("span");
    phrase.className = "sok-phrase";
    phrase.dataset.index = String(index);
    phrase.textContent = segment.affichage;
    return [phrase, document.createTextNode(" ")];
  }));
  bubble.scrollTop = 0;
  widget.dataset.emotion = dialogue.emotion || "neutre";
  widget.dataset.emotionGenerale = dialogue.emotion || "neutre";
  widget.querySelector(".sokhnaci-svg").setAttribute("data-mood", mood);
  widget.querySelector(".sokhnaci-state").textContent = LIBELLE_HUMEUR[mood];
  if (speak) parler();
}

function render(model, { speak = false } = {}) {
  modeleCourant = model;
  afficherDialogue(creerSituation(model), humeur(model), { speak });
  prechauffer(segmentsCourants);
}

function poserQuestion(texte) {
  if (!modeleCourant) return;
  const entree = interpreterEntree(texte, modeleCourant);
  if (entree.commande && MOUVEMENTS.has(entree.commande.action)) {
    document.dispatchEvent(new CustomEvent("sokhnaci:ouvrir-espace", { detail: { question: texte } }));
    return;
  }
  if (entree.commande && executerCommande(entree.commande)) return;
  if (entree.dialogue?.visuel || entree.dialogue?.action) {
    document.dispatchEvent(new CustomEvent("sokhnaci:ouvrir-espace", { detail: { question: texte } }));
    return;
  }
  marcher(2200);
  afficherDialogue(entree.dialogue, null, { speak: voiceEnabled });
}

function message(texte, emotion = "neutre") {
  afficherDialogue({ emotion, segments: [{ langue: "fr", texte, geste: "inclinaison_ecoute" }] }, null, { speak: voiceEnabled });
}

const CONSEIL_SAISIE = "Vous pouvez aussi taper votre question, ou dicter avec le clavier de votre appareil (sous Windows : touche Windows + H).";
const MESSAGES_MICRO = {
  "not-allowed": "Le micro est bloqué pour ce site. Cliquez sur le cadenas à gauche de l’adresse, autorisez le micro, puis réessayez.",
  "service-not-allowed": "Le navigateur refuse la dictée vocale sur cet appareil. Utilisez Chrome ou Edge à jour.",
  "audio-capture": "Aucun micro n’est détecté. Vérifiez qu’il est branché et choisi dans les paramètres Windows, rubrique Son, entrée.",
  "no-speech": "Je n’ai rien entendu. Parlez un peu plus fort, près du micro, puis réessayez.",
  network: "La reconnaissance vocale a besoin d’Internet. Vérifiez votre connexion, puis réessayez.",
  "language-not-supported": "Le navigateur ne reconnaît pas le français sur cet appareil.",
  aborted: null,
};

async function microDetecte() {
  if (!navigator.mediaDevices?.enumerateDevices) return true;
  try {
    const peripheriques = await navigator.mediaDevices.enumerateDevices();
    return peripheriques.some((peripherique) => peripherique.kind === "audioinput");
  } catch {
    return true;
  }
}

export function reconnaissanceDisponible() { return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition); }
export function messageMicro(code) {
  return `${code in MESSAGES_MICRO ? MESSAGES_MICRO[code] : "Le micro ne répond pas."} ${CONSEIL_SAISIE}`;
}

// Écoute vocale commune au widget et à l'espace Sokhna Ci AI.
export async function demarrerEcoute({ onDebut, onTexte, onFinal, onFin, onErreur }) {
  const Reconnaissance = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Reconnaissance) { onErreur?.("navigateur"); return null; }
  arreterLecture();
  if (!(await microDetecte())) { onErreur?.("audio-capture"); return null; }
  const reconnaissance = new Reconnaissance();
  reconnaissance.lang = "fr-FR";
  reconnaissance.interimResults = true;
  reconnaissance.continuous = false;
  let finale = "";
  let erreur = false;
  reconnaissance.onstart = () => { for (const element of avatars()) element.classList.add("listening"); emettre("etat", { etat: "ecoute" }); onDebut?.(); };
  reconnaissance.onresult = (event) => {
    let texte = "";
    for (const resultat of event.results) texte += resultat[0].transcript;
    onTexte?.(texte);
    if (event.results[event.results.length - 1].isFinal) finale = texte;
  };
  reconnaissance.onerror = (event) => { erreur = true; onErreur?.(event.error); };
  reconnaissance.onend = () => {
    for (const element of avatars()) element.classList.remove("listening");
    emettre("etat", { etat: "attente" });
    if (finale.trim()) onFinal?.(finale);
    onFin?.({ texte: finale, erreur });
  };
  try { reconnaissance.start(); } catch { onErreur?.("demarrage"); return null; }
  return { arreter: () => reconnaissance.stop() };
}

async function ecouterQuestion(bouton) {
  if (!reconnaissanceDisponible()) {
    message(`Ce navigateur ne gère pas la dictée vocale. Utilisez Chrome ou Edge. ${CONSEIL_SAISIE}`);
    return;
  }
  if (ecouteEnCours) { ecouteEnCours.arreter(); return; }
  const champ = widget.querySelector(".sokhnaci-ask input");
  ecouteEnCours = await demarrerEcoute({
    onDebut: () => { bouton.setAttribute("aria-pressed", "true"); widget.querySelector(".sokhnaci-state").textContent = "Je vous écoute…"; },
    onTexte: (texte) => { champ.value = texte; },
    onFinal: (texte) => { champ.value = ""; poserQuestion(texte); },
    onFin: ({ texte, erreur }) => {
      bouton.setAttribute("aria-pressed", "false");
      ecouteEnCours = null;
      if (!texte.trim() && !erreur) message(`Je n’ai rien entendu. ${CONSEIL_SAISIE}`);
    },
    onErreur: (code) => { if (MESSAGES_MICRO[code] !== null) message(messageMicro(code)); },
  });
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
  majPresentatrice();
}

// Active ou retire la présentatrice en pied selon la largeur d'écran et l'état de la carte.
export function majPresentatrice() {
  if (!widget) return;
  const actif = ECRAN_PRESENTATRICE.matches && !widget.classList.contains("collapsed");
  const avant = widget.classList.contains("presentatrice");
  widget.classList.toggle("presentatrice", actif);
  document.body.classList.toggle("avec-presentatrice", actif);
  if (avant === actif) return;
  marcheur?.placer(0);
  if (actif) { marcheur?.placer(70); marcheur?.marcherVers(0, 1300); }
  rattacherAvatarWidget();
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize"))); // cartes et graphiques reprennent la largeur
}

export function initSokhnaci(model) {
  if (widget) { render(model); return; }
  try { voiceEnabled = localStorage.getItem(CLE_VOIX) !== "false"; } catch { voiceEnabled = true; }
  widget = document.createElement("section");
  widget.className = "sokhnaci-widget";
  widget.setAttribute("aria-label", "Sokhnaci, guide vocal du tableau de bord");
  widget.innerHTML = `<div class="sokhnaci-card">
    <div class="sokhnaci-top">
      <div class="sokhnaci-character">${svgMarkup()}</div>
      <div class="sokhnaci-identite"><p class="eyebrow">Assistante virtuelle</p><strong>Sokhna Ci</strong><span class="sokhnaci-state"></span></div>
      <button class="sokhnaci-collapse" type="button" aria-label="Réduire Sokhnaci">−</button>
    </div>
    <div class="sokhnaci-bubble" tabindex="0" role="region" aria-label="Propos de Sokhnaci" aria-live="polite"></div>
    <div class="sokhnaci-actions"><button class="sokhnaci-speak" type="button">▶ Écouter</button><button class="sokhnaci-stop" type="button">■ Arrêter</button><button class="sokhnaci-voice" type="button" aria-pressed="true"></button><button class="sokhnaci-espace" type="button" title="Ouvrir l’espace Sokhna Ci AI : avatar 3D, graphiques, rapports">✦ Espace complet</button></div>
    <div class="sokhnaci-chips" role="group" aria-label="Questions suggérées"><button type="button" data-question="fais une analyse des résultats">Analyse</button><button type="button" data-question="qui est en difficulté">Priorités</button><button type="button" data-question="les meilleurs districts">Meilleurs</button><button type="button" data-question="comment ça évolue">Évolution</button></div>
    <form class="sokhnaci-ask" autocomplete="off"><input type="text" name="question" maxlength="120" placeholder="Posez votre question…" aria-label="Poser une question à Sokhnaci"><button class="sokhnaci-mic" type="button" aria-pressed="false" aria-label="Poser la question à voix haute" title="Parlez en français : le navigateur ne reconnaît pas encore le wolof">🎤</button><button type="submit">Demander</button></form>
    <p class="sokhnaci-voix-statut" role="status"></p>
  </div><button class="sokhnaci-launcher" type="button" aria-label="Ouvrir Sokhnaci" hidden><span class="sokhnaci-mini" aria-hidden="true"></span><span>Sokhnaci</span></button>`;
  document.body.appendChild(widget);
  document.body.insertAdjacentHTML("beforeend", DEFS_WAX);
  // Mouvements naturels permanents : l'avatar change subtilement de posture de temps en temps.
  const posture = () => {
    for (const element of avatars()) {
      element.classList.remove("posture-a", "posture-b");
      if (Math.random() < 0.7) element.classList.add(Math.random() < 0.5 ? "posture-a" : "posture-b");
    }
    setTimeout(posture, 8000 + Math.random() * 7000);
  };
  setTimeout(posture, 6000);
  widget.querySelector(".sokhnaci-collapse").addEventListener("click", replierSokhnaci);
  widget.querySelector(".sokhnaci-launcher").addEventListener("click", () => {
    widget.classList.remove("collapsed");
    widget.querySelector(".sokhnaci-launcher").hidden = true;
    majPresentatrice();
  });
  marcheur = creerMarcheur(widget);
  ECRAN_PRESENTATRICE.addEventListener?.("change", majPresentatrice);
  widget.querySelector(".sokhnaci-speak").addEventListener("click", () => parler());
  const reprendreLaMain = () => { if (suiviPage) { suiviPage = false; effacerMiseEnAvant(); } };
  for (const nom of ["wheel", "touchmove"]) window.addEventListener(nom, reprendreLaMain, { passive: true });
  window.addEventListener("keydown", (evenement) => { if (["PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End", " "].includes(evenement.key) && evenement.target === document.body) reprendreLaMain(); });
  widget.querySelector(".sokhnaci-stop").addEventListener("click", arreterLecture);
  try { localStorage.removeItem(CLE_VOIX_CHOISIE); } catch { /* stockage facultatif */ }
  widget.querySelector(".sokhnaci-espace").addEventListener("click", () => document.dispatchEvent(new CustomEvent("sokhnaci:ouvrir-espace", { detail: { question: "" } })));
  statutVoix = widget.querySelector(".sokhnaci-voix-statut");
  widget.querySelectorAll(".sokhnaci-chips button").forEach((bouton) => bouton.addEventListener("click", () => poserQuestion(bouton.dataset.question)));
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
  const idle = window.requestIdleCallback || ((rappel) => setTimeout(rappel, 800));
  // La voix originale (gros téléchargement) ne démarre qu'une fois la page affichée et au calme,
  // pour ne jamais ralentir le chargement du tableau de bord.
  const apresChargement = () => setTimeout(() => idle(() => demarrerPiperAutomatique(), { timeout: 8000 }), 4000);
  if (document.readyState === "complete") apresChargement(); else window.addEventListener("load", apresChargement, { once: true });
  window.addEventListener("online", () => demarrerPiperAutomatique());
  render(model);
  idle(() => rattacherAvatarWidget(), { timeout: 2500 });
  // Les navigateurs interdisent la parole avant le premier geste de l'utilisateur : on attend ce geste.
  // Sur petit écran, l'assistante démarre réduite pour ne pas masquer le tableau de bord.
  if (window.matchMedia("(max-width: 700px)").matches) replierSokhnaci();
  majPresentatrice();
  const parlerOuverture = () => { if (voiceEnabled && !widget.classList.contains("collapsed")) attendrePuisParler(); };
  if (navigator.userActivation?.hasBeenActive === false) {
    const premierGeste = () => {
      for (const nom of ["pointerdown", "keydown", "touchstart"]) window.removeEventListener(nom, premierGeste, true);
      parlerOuverture();
    };
    for (const nom of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(nom, premierGeste, true);
  } else {
    parlerOuverture();
  }
  return widget;
}

export function mettreAJourSokhnaci(model) {
  if (widget) render(model);
}

function preferencesEspace() {
  try { return JSON.parse(localStorage.getItem("sokhna-ci-ai-preferences-v1") || "{}"); } catch { return {}; }
}

// Avatar 3D en buste dans la carte flottante. Le même rendu 3D se déplace vers l'espace Sokhna Ci AI
// (corps entier) puis revient ici quand on quitte cet onglet ; l'illustration 2D sert de repli.
export async function rattacherAvatarWidget() {
  if (!widget || !avatar3dAutorise()) return;
  const preferences = preferencesEspace();
  const voulu = preferences.avatar3d ?? (window.innerWidth >= 700 && (navigator.hardwareConcurrency || 4) >= 4);
  const zone = widget.querySelector(".sokhnaci-character");
  if (!voulu) { zone.classList.remove("trois-d"); return; }
  try {
    const controleur = await obtenir3D(preferences.tenue || "wax");
    if (!widget.isConnected || document.body.classList.contains("sna-actif")) return;
    controleur.habiller(preferences.tenue || "wax");
    controleur.relier(zone, widget, { cadrage: widget.classList.contains("presentatrice") ? "pied" : "buste" });
    zone.classList.add("trois-d");
  } catch {
    zone.classList.remove("trois-d");
  }
}
