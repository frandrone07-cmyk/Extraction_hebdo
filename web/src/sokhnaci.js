import { creerSituation, repondre, versAffichage, versOral } from "./sokhnaci-dialogue.js";
import { detecterCommande, phraseAction } from "./sokhnaci-actions.js";

const CLE_VOIX = "completude-sokhnaci-voice";
const CLE_VOIX_CHOISIE = "completude-sokhnaci-voix-nom";
const MODULES_PIPER = ["https://esm.sh/@diffusionstudio/vits-web@1.0.3", "https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm"];
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
let voixChoisie = null;
let piper = null;
let piperPromesse = null;
let piperEnCache = false;
let piperAbandonne = false;
let echecsSynthese = 0;
let statutVoix = null;
let acteur = null;
let pointeur = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let contexteAudio = null;
const VITESSE_MARCHE = 120;
let fileSynthese = Promise.resolve();
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

const DEFS_WAX = `<svg class="sokhnaci-defs" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute"><defs><pattern id="sok-wax" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#f2a31b"/><circle cx="4" cy="4" r="3.3" fill="#17365d"/><circle cx="4" cy="4" r="1.3" fill="#f6e3b0"/><path d="M12 8l3 3-3 3-3-3z" fill="#c2362b"/><circle cx="12" cy="2" r="1.1" fill="#1b7f4f"/><circle cx="2" cy="13" r="1.1" fill="#1b7f4f"/></pattern></defs></svg>`;

function svgMarkup(decoratif = false) {
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
  const manuelle = voixChoisie && voix.find((v) => v.name === voixChoisie);
  if (manuelle) return { voix: manuelle, feminine: true };
  const classees = voix.map((v) => ({ voix: v, note: noteVoix(v) })).sort((x, y) => y.note - x.note);
  const meilleure = classees[0];
  return meilleure ? { voix: meilleure.voix, feminine: FEMININES.test(meilleure.voix.name) && !MASCULINES.test(meilleure.voix.name) } : { voix: null, feminine: false };
}

// Voix originale : modèle Piper « siwis » (voix féminine française) exécuté dans le navigateur.
// Tout est automatique : préchargement en arrière-plan, cache persistant (téléchargement une seule fois),
// nouvelles tentatives, hébergeur de secours, et retour à la voix de l'appareil au moindre problème.
function annoncerVoix(texte, duree = 0) {
  if (!statutVoix) return;
  statutVoix.textContent = texte;
  if (duree) setTimeout(() => { if (statutVoix.textContent === texte) statutVoix.textContent = ""; }, duree);
}

async function importerMoteur() {
  let derniere = null;
  for (const adresse of MODULES_PIPER) {
    try { return await import(/* @vite-ignore */ adresse); } catch (erreur) { derniere = erreur; }
  }
  throw derniere;
}

function chargerPiper() {
  if (piperPromesse) return piperPromesse;
  piperPromesse = (async () => {
    const moteur = await importerMoteur();
    try { await navigator.storage?.persist?.(); } catch { /* facultatif */ }
    let dejaLa = false;
    try { dejaLa = (await moteur.stored?.())?.includes(VOIX_PIPER) ?? false; } catch { /* facultatif */ }
    if (!dejaLa) annoncerVoix("Je prépare ma voix originale (téléchargement unique)…");
    await moteur.predict({ text: "Bonjour.", voiceId: VOIX_PIPER }, (avancement) => {
      if (!dejaLa && avancement?.total) annoncerVoix(`Je prépare ma voix originale : ${Math.round((100 * avancement.loaded) / avancement.total)} %`);
    });
    piper = moteur;
    piperEnCache = true;
    echecsSynthese = 0;
    annoncerVoix("Ma voix originale est prête.", 4000);
    return moteur;
  })().catch((erreur) => {
    piperPromesse = null;
    piper = null;
    throw erreur;
  });
  return piperPromesse;
}

// Démarrage automatique, avec nouvelles tentatives espacées et reprise quand la connexion revient.
function demarrerPiperAutomatique(tentative = 0) {
  if (piperAbandonne || piper || voixChoisie) return;
  if (navigator.connection?.saveData) return;
  if (navigator.webdriver && !window.__sokhnaciPiper) return; // tests automatisés : pas de téléchargement
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

// Les phrases sont fabriquées une à une, dans l'ordre, pendant que la précédente est lue.
// id = null : préchauffage (jamais périmé).
function synthetiser(texte, id) {
  if (syntheses.has(texte)) return syntheses.get(texte);
  const promesse = fileSynthese
    .then(async () => {
      if ((id !== null && id !== lectureId) || !piper || piperAbandonne) return null;
      return Promise.race([piper.predict({ text: texte, voiceId: VOIX_PIPER }), delai(15000)]);
    })
    .catch(() => null)
    .then((blob) => {
      if (id !== null && id !== lectureId) { syntheses.delete(texte); return blob; }
      if (blob) echecsSynthese = 0;
      else {
        syntheses.delete(texte);
        if (piper && ++echecsSynthese >= ECHECS_MAX) {
          piperAbandonne = true;
          annoncerVoix("Voix de l’appareil utilisée (la voix originale est trop lente sur cet appareil).", 8000);
        }
      }
      return blob;
    });
  fileSynthese = promesse;
  syntheses.set(texte, promesse);
  if (syntheses.size > 40) syntheses.delete(syntheses.keys().next().value);
  return promesse;
}

// Prépare à l'avance la phrase affichée pour qu'elle démarre sans attente.
function prechauffer(segments) {
  if (!piper || piperAbandonne) return;
  for (const segment of segments) if (!segment.audio) synthetiser(segment.oral, null);
}

function jouerBlob(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioCourant = audio;
    let delier = () => {};
    const fin = (ok) => { delier(); URL.revokeObjectURL(url); resolve(ok); };
    audio.onplaying = () => { delier = lierBouche(audio); };
    audio.onended = () => fin(true);
    audio.onerror = () => fin(false);
    audio.play().catch(() => fin(false));
  });
}

function avatars() { return acteur ? [widget, acteur.el] : [widget]; }
function definirParole(actif, geste = "") {
  for (const element of avatars()) {
    element.classList.toggle("speaking", actif);
    element.dataset.geste = actif ? geste : "";
  }
}
function definirBouche(ouverture) {
  for (const element of avatars()) {
    if (ouverture === null) { element.style.removeProperty("--bouche"); delete element.dataset.sync; } else { element.style.setProperty("--bouche", String(ouverture)); element.dataset.sync = "audio"; }
  }
}

// Synchronisation labiale en temps réel : l'ouverture de la bouche suit l'énergie réelle du son lu.
function lierBouche(audio) {
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
      requestAnimationFrame(boucle);
    };
    boucle();
    return () => { actif = false; definirBouche(null); };
  } catch {
    return () => {};
  }
}

function arreterLecture() {
  lectureId += 1;
  window.speechSynthesis?.cancel();
  audioCourant?.pause();
  audioCourant = null;
  if (widget) {
    definirParole(false);
    definirBouche(null);
  }
}

// Un enregistrement réel (web/audio/wo/<nom>.wav ou .mp3) est joué en priorité pour le wolof ;
// à défaut, la voix de synthèse prend le relais.
function essayerAudio(url) {
  if (audiosAbsents.has(url)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audioCourant = audio;
    let delier = () => {};
    audio.onplaying = () => { delier = lierBouche(audio); };
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
      const securite = setTimeout(resolve, Math.max(3500, segment.oral.length * 95));
      const fin = () => { clearTimeout(securite); resolve(); };
      parole.onend = parole.onerror = fin;
      parole.onstart = () => { for (const element of avatars()) element.classList.add("speaking"); };
      window.speechSynthesis.speak(parole);
    } catch {
      resolve();
    }
  });
}

async function lire(segments) {
  arreterLecture();
  const id = lectureId;
  const originale = piper && !piperAbandonne && !voixChoisie ? segments.map((segment) => (segment.audio ? null : synthetiser(segment.oral, id))) : null;
  for (const [index, segment] of segments.entries()) {
    if (id !== lectureId) return;
    definirParole(true, segment.geste || "");
    let joue = false;
    if (segment.audio) joue = await jouerAudio(segment.audio);
    if (!joue && originale?.[index]) {
      const blob = await originale[index];
      if (blob && id === lectureId) joue = await jouerBlob(blob);
    }
    if (!joue && id === lectureId) await jouerVoix(segment);
  }
  if (id === lectureId) definirParole(false);
}

async function attendrePuisParler() {
  if (!piper && !piperEnCache && !piperAbandonne && !voixChoisie && !(navigator.webdriver && !window.__sokhnaciPiper)) {
    let enCache = false;
    try { enCache = (await (await importerMoteur()).stored?.())?.includes(VOIX_PIPER) ?? false; } catch { /* repli */ }
    if (enCache) {
      demarrerPiperAutomatique();
      await Promise.race([piperPromesse || Promise.resolve(), delai(10000)]).catch(() => {});
    }
  }
  parler();
}

function parler() {
  if (!voiceEnabled || !segmentsCourants.length) return;
  lire(segmentsCourants);
}

function sortirActeur() {
  if (acteur) return;
  const zone = widget.querySelector(".sokhnaci-character").getBoundingClientRect();
  const element = document.createElement("div");
  element.className = "sokhnaci-acteur";
  element.setAttribute("aria-hidden", "true");
  element.innerHTML = `<div class="sokhnaci-acteur-sens">${svgMarkup(true)}</div>`;
  element.querySelector(".sokhnaci-svg").setAttribute("data-mood", widget.querySelector(".sokhnaci-svg").getAttribute("data-mood") || "attentif");
  document.body.appendChild(element);
  const x = Math.max(0, zone.left - 10);
  acteur = { el: element, x, cible: x, mode: "arret", sens: -1, dernier: performance.now() };
  widget.classList.add("acteur-dehors");
  for (const classe of ["speaking"]) if (widget.classList.contains(classe)) element.classList.add(classe);
  element.dataset.geste = widget.dataset.geste || "";
  element.style.transform = `translate3d(${x}px, 0, 0)`;
  element.style.setProperty("--sens", String(acteur.sens));
  requestAnimationFrame(boucleActeur);
}

function rentrerActeur() {
  if (!acteur) return;
  acteur.el.remove();
  acteur = null;
  widget.classList.remove("acteur-dehors");
}

function boucleActeur(maintenant) {
  if (!acteur) return;
  const dt = Math.min(0.1, (maintenant - acteur.dernier) / 1000);
  acteur.dernier = maintenant;
  const largeurActeur = 150;
  if (acteur.mode === "suit") {
    const distance = 110;
    acteur.cible = pointeur.x - largeurActeur / 2 + (acteur.x + largeurActeur / 2 > pointeur.x ? distance : -distance);
  }
  acteur.cible = Math.max(0, Math.min(window.innerWidth - largeurActeur, acteur.cible));
  const ecart = acteur.cible - acteur.x;
  const enMarche = Math.abs(ecart) > 3 && !acteur.el.classList.contains("assise");
  if (enMarche) {
    acteur.sens = ecart > 0 ? 1 : -1;
    acteur.x += Math.sign(ecart) * Math.min(Math.abs(ecart), VITESSE_MARCHE * dt);
    acteur.el.style.setProperty("--sens", String(acteur.sens));
  } else if (acteur.mode === "va") {
    acteur.mode = "arret";
  }
  acteur.el.classList.toggle("walking", enMarche);
  acteur.el.style.transform = `translate3d(${acteur.x}px, 0, 0)`;
  requestAnimationFrame(boucleActeur);
}

function arreterMouvement() {
  if (acteur) { acteur.mode = "arret"; acteur.cible = acteur.x; }
  for (const element of avatars()) element.classList.remove("walking", "danse", "listening");
}

function etatTemporaire(classe, duree) {
  const cibles = avatars();
  for (const element of cibles) element.classList.add(classe);
  setTimeout(() => { for (const element of cibles) element.classList.remove(classe); }, duree);
}

function allerVers(x) {
  sortirActeur();
  acteur.mode = "va";
  acteur.cible = x;
}

function executerCommande(commande) {
  const dialogue = phraseAction(commande);
  if (!dialogue) return false;
  const maintenant = acteur ? acteur.x : widget.getBoundingClientRect().left;
  switch (commande.action) {
    case "stop":
      arreterLecture();
      arreterMouvement();
      break;
    case "rentre":
      arreterMouvement();
      rentrerActeur();
      break;
    case "viens":
      for (const element of avatars()) element.classList.remove("assise");
      allerVers(pointeur.x - 75);
      break;
    case "suis":
      sortirActeur();
      for (const element of avatars()) element.classList.remove("assise");
      acteur.mode = "suit";
      break;
    case "avance":
      allerVers(maintenant + (acteur?.sens ?? -1) * 220);
      break;
    case "recule":
      allerVers(maintenant - (acteur?.sens ?? -1) * 160);
      break;
    case "tourne":
      sortirActeur();
      acteur.sens = commande.direction ?? acteur.sens;
      acteur.cible = acteur.x + acteur.sens * 180;
      acteur.mode = "va";
      break;
    case "demitour":
      sortirActeur();
      acteur.sens = -acteur.sens;
      acteur.el.style.setProperty("--sens", String(acteur.sens));
      break;
    case "assis":
      arreterMouvement();
      for (const element of avatars()) element.classList.add("assise");
      break;
    case "debout":
      for (const element of avatars()) element.classList.remove("assise");
      break;
    case "danse":
      arreterMouvement();
      for (const element of avatars()) element.classList.remove("assise");
      etatTemporaire("danse", 7000);
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
        const zone = element.getBoundingClientRect();
        if (acteur) allerVers(Math.max(0, zone.left + zone.width / 2 - 75));
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
  prechauffer(segmentsCourants);
}

function poserQuestion(texte) {
  if (!modeleCourant) return;
  const commande = detecterCommande(texte);
  if (commande && executerCommande(commande)) return;
  marcher(2200);
  afficherDialogue(repondre(texte, modeleCourant), null, { speak: voiceEnabled });
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

async function ecouterQuestion(bouton) {
  const Reconnaissance = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Reconnaissance) {
    message(`Ce navigateur ne gère pas la dictée vocale. Utilisez Chrome ou Edge. ${CONSEIL_SAISIE}`);
    return;
  }
  if (ecouteEnCours) { ecouteEnCours.stop(); return; }
  arreterLecture();
  if (!(await microDetecte())) {
    message(`${MESSAGES_MICRO["audio-capture"]} ${CONSEIL_SAISIE}`);
    return;
  }
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
    const conseil = event.error in MESSAGES_MICRO ? MESSAGES_MICRO[event.error] : "Le micro ne répond pas.";
    if (conseil) message(`${conseil} ${CONSEIL_SAISIE}`);
  };
  reconnaissance.onend = () => {
    widget.classList.remove("listening");
    bouton.setAttribute("aria-pressed", "false");
    ecouteEnCours = null;
    if (finale.trim()) { champ.value = ""; poserQuestion(finale); }
    else if (!erreur) message(`Je n’ai rien entendu. ${CONSEIL_SAISIE}`);
  };
  ecouteEnCours = reconnaissance;
  try { reconnaissance.start(); } catch { ecouteEnCours = null; message(`Le micro n’a pas pu démarrer. ${CONSEIL_SAISIE}`); }
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
  widget = document.createElement("section");
  widget.className = "sokhnaci-widget";
  widget.setAttribute("aria-label", "Sokhnaci, guide vocal du tableau de bord");
  widget.innerHTML = `<div class="sokhnaci-card"><div class="sokhnaci-top"><div><p class="eyebrow">VOTRE GUIDE</p><strong>Sokhnaci</strong><span class="sokhnaci-state"></span></div><button class="sokhnaci-collapse" type="button" aria-label="Réduire Sokhnaci">−</button></div><div class="sokhnaci-content"><div class="sokhnaci-character">${svgMarkup()}</div><p class="sokhnaci-bubble" tabindex="0"></p><div class="sokhnaci-actions"><button class="sokhnaci-speak" type="button">▶ Écouter le résumé</button><button class="sokhnaci-voice" type="button" aria-pressed="true"></button></div><div class="sokhnaci-chips" role="group" aria-label="Questions suggérées"><button type="button" data-question="fais une analyse des résultats">Analyse</button><button type="button" data-question="qui est en difficulté">Priorités</button><button type="button" data-question="les meilleurs districts">Meilleurs</button><button type="button" data-question="comment ça évolue">Évolution</button></div><form class="sokhnaci-ask" autocomplete="off"><input type="text" name="question" maxlength="120" placeholder="Posez votre question…" aria-label="Poser une question à Sokhnaci"><button class="sokhnaci-mic" type="button" aria-pressed="false" aria-label="Poser la question à voix haute" title="Parlez en français : le navigateur ne reconnaît pas encore le wolof">🎤</button><button type="submit">Demander</button></form><p class="sokhnaci-voix-statut" role="status"></p><label class="sokhnaci-voix-choix">Voix française <select aria-label="Choisir la voix française de Sokhnaci"><option value="">Automatique (voix originale)</option></select></label></div></div><button class="sokhnaci-launcher" type="button" aria-label="Ouvrir le résumé Sokhnaci" hidden><span class="sokhnaci-mini" aria-hidden="true"></span><span>Sokhnaci</span></button>`;
  document.body.appendChild(widget);
  document.body.insertAdjacentHTML("beforeend", DEFS_WAX);
  window.addEventListener("pointermove", (event) => { pointeur = { x: event.clientX, y: event.clientY }; }, { passive: true });
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
  });
  widget.querySelector(".sokhnaci-speak").addEventListener("click", parler);
  try { voixChoisie = localStorage.getItem(CLE_VOIX_CHOISIE) || null; } catch { voixChoisie = null; }
  const choix = widget.querySelector(".sokhnaci-voix-choix select");
  voixDisponibles.then((voix) => {
    for (const v of voix.filter((x) => /^fr/i.test(x.lang))) choix.add(new Option(`${v.name} (${v.lang})`, v.name));
    if (voixChoisie) choix.value = voixChoisie;
    if (!choix.value) choix.value = "";
    if (choix.options.length <= 1) choix.closest("label").hidden = true;
  });
  choix.addEventListener("change", () => {
    voixChoisie = choix.value || null;
    try { if (voixChoisie) localStorage.setItem(CLE_VOIX_CHOISIE, voixChoisie); else localStorage.removeItem(CLE_VOIX_CHOISIE); } catch { /* stockage facultatif */ }
    if (voixChoisie) message("Voilà, c’est ma nouvelle voix. Vous l’entendez bien ?");
    else demarrerPiperAutomatique();
  });
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
  idle(() => demarrerPiperAutomatique(), { timeout: 3000 });
  window.addEventListener("online", () => demarrerPiperAutomatique());
  render(model);
  // Les navigateurs interdisent la parole avant le premier geste de l'utilisateur : on attend ce geste.
  const parlerOuverture = () => { if (voiceEnabled) attendrePuisParler(); };
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
