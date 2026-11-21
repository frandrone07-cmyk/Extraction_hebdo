// Espace « Sokhna Ci AI » : avatar en scène, conversation (historique, sources, visualisations),
// barre de commandes, points d'attention, compétences et rapports. Les données restent dans le navigateur.
import { arreterLecture, definirVolume, demarrerEcoute, lierAvatarExterne, lireDialogue, lireVolume, messageMicro, reconnaissanceDisponible, svgMarkup } from "./sokhnaci.js";
import { creerSituation, versAffichage } from "./sokhnaci-dialogue.js";
import { phraseAction } from "./sokhnaci-actions.js";
import { interpreterEntree } from "./sokhnaci-cerveau.js";
import { definirNiveauExplication, lireNiveauExplication, pointsAttention, sourcesPour } from "./sokhnaci-competences.js";
import { chargerBibliothequeTableur, imprimerPdf, telechargerConversation, telechargerExcel, telechargerWord } from "./sokhnaci-rapport.js";
import { grapheBarres, grapheDoughnut, grapheLigne } from "./charts.js";
import { interrogerLLM, llmDisponible } from "./sokhnaci-llm.js";
import { avatar3dAutorise, lire3D, obtenir3D } from "./sokhnaci-3d.js";

const CLE_HISTORIQUE = "sokhna-ci-ai-historique-v1";
const CLE_PREFERENCES = "sokhna-ci-ai-preferences-v1";
const CLE_SALUT = "sokhna-ci-ai-salut-session";
const MAX_MESSAGES = 40;
const TENUES = [
  { id: "wax", libelle: "Wax" },
  { id: "ankara", libelle: "Ankara" },
  { id: "bazin", libelle: "Grand boubou en bazin riche" },
  { id: "pro", libelle: "Tenue professionnelle" },
];
const ICONES = {
  micro: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  envoi: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-5 16-3-7z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4zM16 9a4 4 0 0 1 0 6"/></svg>',
  etincelle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></svg>',
};

const echapper = (texte) => String(texte ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dateCourte = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const heure = (t) => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dakar" });

const etat = {
  model: null,
  messages: [],
  preferences: { avatarActif: true, tenue: "wax", niveau: "simple", volume: 1, avatar3d: null },
  chargement3d: false,
  continu: false,
  ecoute: null,
  echecsEcoute: 0,
  fichier: null,
  lecture: null,
  chargement: false,
  indicateur: "attente",
  ecouteEnCours: false,
};
const scene = { x: 0, cible: 0, echelle: 1, echelleCible: 1, sens: 1, mode: "arret", attente: 0, dernier: 0, boucle: false, pointeurX: null };
let ecouteursInstalles = false;

// ------------------------------------------------------------------ stockage local
function charger() {
  try { etat.messages = JSON.parse(localStorage.getItem(CLE_HISTORIQUE) || "[]"); } catch { etat.messages = []; }
  try { Object.assign(etat.preferences, JSON.parse(localStorage.getItem(CLE_PREFERENCES) || "{}")); } catch { /* préférences par défaut */ }
  definirNiveauExplication(etat.preferences.niveau);
  definirVolume(etat.preferences.volume);
  document.documentElement.dataset.tenue = etat.preferences.tenue;
  if (etat.preferences.avatar3d === null || etat.preferences.avatar3d === undefined) etat.preferences.avatar3d = window.innerWidth >= 700 && (navigator.hardwareConcurrency || 4) >= 4;
}
function sauvegarder() {
  try {
    localStorage.setItem(CLE_HISTORIQUE, JSON.stringify(etat.messages.slice(-MAX_MESSAGES).map(({ imageUrl, ...reste }) => reste)));
    localStorage.setItem(CLE_PREFERENCES, JSON.stringify(etat.preferences));
  } catch { /* stockage indisponible : la conversation reste en mémoire */ }
}

// ------------------------------------------------------------------ gabarit
export function renderEspace() {
  return `<div class="page-stack sna" id="sna">
    <header class="sna-hero">
      <div>
        <p class="eyebrow">${ICONES.etincelle} Assistante virtuelle</p>
        <h2>Sokhna Ci <span class="sna-ai">AI</span></h2>
        <p class="sna-lede">Parlez-moi ou écrivez-moi : j’analyse, je compare, je visualise et je rédige vos rapports à partir des données DHIS2. Tout reste dans votre navigateur.</p>
      </div>
      <div class="sna-niveau" role="group" aria-label="Niveau d’explication">
        <span>Explications</span>
        <button type="button" data-niveau="simple">Simples</button>
        <button type="button" data-niveau="expert">Expert</button>
      </div>
    </header>
    <div class="sna-grille">
      <section class="sna-carte sna-avatar-zone" aria-label="Avatar de Sokhna Ci">
        <div class="sna-scene" data-etat="attente">
          <div class="sna-halo" aria-hidden="true"></div>
          <div class="sna-sol" aria-hidden="true"></div>
          <div class="sna-ombre" aria-hidden="true"></div>
          <div class="sna-acteur" id="sna-acteur"></div>
          <p class="sna-badge" role="status" id="sna-badge">Disponible</p>
        </div>
        <ul class="sna-indicateurs" aria-label="État de l’assistante">
          <li data-indicateur="ecoute">Écoute</li><li data-indicateur="reflechit">Réflexion</li><li data-indicateur="parle">Parole</li><li data-indicateur="chargement">Chargement</li>
        </ul>
        <div class="sna-controles">
          <button type="button" id="sna-avatar-bascule" aria-pressed="true">Avatar activé</button>
          <button type="button" id="sna-3d-bascule" aria-pressed="false" title="Passer de l’avatar 3D à l’illustration 2D">Avatar 3D</button>
          <label>Tenue <select id="sna-tenue" aria-label="Tenue de Sokhna Ci">${TENUES.map((t) => `<option value="${t.id}">${t.libelle}</option>`).join("")}</select></label>
          <label class="sna-volume">${ICONES.volume}<span class="sna-sr">Volume</span><input id="sna-volume" type="range" min="0" max="100" step="5" aria-label="Volume de la voix"></label>
          <button type="button" id="sna-micro" class="sna-bouton-micro" aria-pressed="false">${ICONES.micro} Micro</button>
          <button type="button" id="sna-continu" aria-pressed="false" title="Le micro se réactive après chaque réponse, jusqu’à ce que vous l’arrêtiez">Conversation continue</button>
          <button type="button" id="sna-interrompre">${ICONES.stop} Interrompre</button>
        </div>
      </section>
      <section class="sna-carte sna-conversation" aria-label="Conversation avec Sokhna Ci">
        <div class="sna-historique" id="sna-historique" role="log" aria-live="polite" tabindex="0"></div>
        <div class="sna-suggestions" id="sna-suggestions" aria-label="Questions suggérées"></div>
        <form class="sna-barre" id="sna-barre" autocomplete="off">
          <div class="sna-barre-ligne">
            <button type="button" class="sna-icone" id="sna-plus" aria-haspopup="true" aria-expanded="false" aria-label="Plus d’actions">${ICONES.plus}</button>
            <input type="text" id="sna-question" name="question" maxlength="240" placeholder="Posez une question, demandez une analyse, un graphique ou un rapport…" aria-label="Votre question">
            <button type="button" class="sna-icone sna-bouton-micro" id="sna-micro2" aria-label="Poser la question à voix haute" aria-pressed="false">${ICONES.micro}</button>
            <button type="submit" class="sna-envoyer">${ICONES.envoi}<span>Envoyer</span></button>
          </div>
          <div class="sna-menu" id="sna-menu" hidden>
            <button type="button" data-q="fais une analyse des résultats">Demander une analyse</button>
            <button type="button" data-q="cherche ">Lancer une recherche</button>
            <button type="button" data-q="fais un graphique des régions">Demander une visualisation</button>
            <label class="sna-fichier">Envoyer un fichier (CSV, Excel)<input type="file" id="sna-fichier" accept=".csv,.tsv,.txt,.json,.xlsx,.xls"></label>
            <label class="sna-fichier">Ajouter une image<input type="file" id="sna-image" accept="image/*"></label>
          </div>
        </form>
        <div class="sna-outils">
          <button type="button" id="sna-nouvelle">Nouvelle conversation</button>
          <button type="button" id="sna-exporter-conv">Exporter la conversation</button>
          <span id="sna-confidentialite">Conversation enregistrée uniquement sur cet appareil.</span>
        </div>
      </section>
    </div>
    <section class="sna-section" aria-labelledby="sna-t-points"><h3 id="sna-t-points">Points d’attention</h3><div class="sna-points" id="sna-points"></div></section>
    <section class="sna-section" aria-labelledby="sna-t-comp"><h3 id="sna-t-comp">Compétences</h3><div class="sna-competences" id="sna-competences"></div></section>
    <section class="sna-section" id="sna-rapports" aria-labelledby="sna-t-rap"><h3 id="sna-t-rap">Rapports</h3>
      <div class="sna-rapports"><p>Rapport complet (synthèse, analyse, priorités, régions, formulaires, évolution, sources).</p>
        <div><button type="button" data-rapport="word">Word</button><button type="button" data-rapport="pdf">PDF</button><button type="button" data-rapport="excel">Excel</button></div>
        <p class="sna-note" id="sna-note-rapport" role="status"></p></div>
    </section>
  </div>`;
}

const COMPETENCES = [
  { titre: "Analyse", texte: "Tendances, anomalies, retard global ou ciblé.", q: "fais une analyse des résultats" },
  { titre: "Priorités", texte: "Districts à accompagner en premier.", q: "fais un graphique des districts à accompagner" },
  { titre: "Meilleurs districts", texte: "Classement et félicitations.", q: "fais un tableau des meilleurs districts" },
  { titre: "Évolution", texte: "Courbe par extraction et par mois.", q: "fais une courbe d'évolution" },
  { titre: "Statistiques", texte: "Moyenne, médiane, quartiles, dispersion.", q: "statistiques" },
  { titre: "Comparaisons", texte: "Régions, districts ou mois côte à côte.", q: "__comparer__" },
  { titre: "Rapports", texte: "Word, PDF et Excel en un clic.", q: "__rapports__" },
  { titre: "Historique", texte: "Évolution du taux à chaque extraction.", q: "__historique__" },
];

// ------------------------------------------------------------------ initialisation
export function apresRenduEspace(modele, theme) {
  etat.model = modele;
  if (!etat.charge) { charger(); etat.charge = true; }
  scene.x = 0; scene.cible = 0; scene.echelle = 1; scene.echelleCible = 1; scene.mode = "arret";
  const racine = document.getElementById("sna");
  if (!racine) return;
  racine.querySelector("#sna-acteur").innerHTML = svgMarkup(true);
  const acteur = racine.querySelector("#sna-acteur");
  lierAvatarExterne(acteur);
  acteur.dataset.sens = "1";

  appliquerPreferences(racine);
  activer3D(racine);
  racine.querySelector("#sna-points").innerHTML = pointsAttention(modele).map((p, i) => `<article class="sna-point sna-${p.gravite}"><h4>${echapper(versAffichage(p.titre))}</h4><p>${echapper(versAffichage(p.detail))}</p><button type="button" data-q="${echapper(p.question)}">Détailler</button></article>`).join("") || '<p class="sna-vide">Rien d’anormal à signaler pour cette sélection.</p>';
  racine.querySelector("#sna-competences").innerHTML = COMPETENCES.map((c) => `<button type="button" class="sna-competence" data-q="${echapper(c.q)}"><strong>${c.titre}</strong><span>${c.texte}</span></button>`).join("");
  racine.querySelector("#sna-volume").value = String(Math.round(etat.preferences.volume * 100));
  racine.querySelector("#sna-tenue").value = etat.preferences.tenue;
  const micro = reconnaissanceDisponible();
  racine.querySelectorAll(".sna-bouton-micro, #sna-continu").forEach((bouton) => { if (!micro) { bouton.title = "Dictée vocale indisponible sur ce navigateur : utilisez Chrome ou Edge"; } });

  liaisons(racine);
  installerEcouteursGlobaux();
  if (!etat.messages.length) message_accueil();
  dessinerHistorique();
  dessinerSuggestions();
  definirIndicateur(etat.indicateur === "parle" ? "attente" : etat.indicateur);
  requestAnimationFrame(boucleScene);
  salutationInitiale();
}

function appliquerPreferences(racine) {
  const actif = etat.preferences.avatarActif;
  racine.classList.toggle("sans-avatar", !actif);
  const bascule = racine.querySelector("#sna-avatar-bascule");
  bascule.setAttribute("aria-pressed", String(actif));
  bascule.textContent = actif ? "Avatar activé" : "Avatar désactivé";
  racine.querySelectorAll("[data-niveau]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.niveau === etat.preferences.niveau)));
  const bouton3d = racine.querySelector("#sna-3d-bascule");
  bouton3d.setAttribute("aria-pressed", String(Boolean(etat.preferences.avatar3d)));
  bouton3d.textContent = etat.preferences.avatar3d ? "Avatar 3D" : "Avatar 2D";
  bouton3d.hidden = !avatar3dAutorise();
}

// Avatar 3D : chargé en arrière-plan ; l'illustration 2D reste affichée pendant le chargement et en cas d'échec.
async function activer3D(racine) {
  const scene = racine.querySelector(".sna-scene");
  const acteur = racine.querySelector("#sna-acteur");
  if (!etat.preferences.avatar3d || !avatar3dAutorise()) {
    scene.classList.remove("trois-d");
    lire3D()?.arreter();
    lire3D()?.canvas.remove();
    return;
  }
  etat.chargement3d = true;
  majIndicateurs();
  try {
    const controleur = await obtenir3D(etat.preferences.tenue);
    if (!racine.isConnected || !etat.preferences.avatar3d) return;
    controleur.habiller(etat.preferences.tenue);
    controleur.relier(scene, acteur, { cadrage: "plein" });
    scene.classList.add("trois-d");
  } catch {
    scene.classList.remove("trois-d");
  } finally {
    etat.chargement3d = false;
    majIndicateurs();
  }
}

function message_accueil() {
  const situation = creerSituation(etat.model);
  const points = pointsAttention(etat.model).slice(0, 3);
  const phrases = [
    "Bonjour, je suis Sokhna Ci. Je peux analyser vos résultats, les comparer, les visualiser et rédiger un rapport.",
    points.length ? `Voici ce qui mérite votre attention : ${points.map((p) => versAffichage(p.titre)).join(" ; ")}.` : "Aucune anomalie majeure à signaler pour cette sélection.",
    "Que voulez-vous savoir ?",
  ];
  etat.messages.push({ role: "assistante", t: Date.now(), phrases, segments: phrases.map((texte, i) => ({ langue: "fr", texte, geste: i === 0 ? "salut_main" : i === 2 ? "inclinaison_ecoute" : "pointer_ecran", audio: null })), sources: sourcesPour(etat.model), suggestions: ["fais une analyse des résultats", "fais un graphique des régions", "les meilleurs districts", "statistiques"], salutation: true });
  void situation;
}

// ------------------------------------------------------------------ liaisons
function liaisons(racine) {
  racine.querySelector("#sna-barre").addEventListener("submit", (evenement) => {
    evenement.preventDefault();
    const champ = racine.querySelector("#sna-question");
    const texte = champ.value.trim();
    champ.value = "";
    if (texte) envoyer(texte);
  });
  racine.addEventListener("click", (evenement) => {
    const cible = evenement.target.closest("[data-q], [data-niveau], [data-rapport]");
    if (!cible) return;
    if (cible.dataset.niveau) {
      etat.preferences.niveau = cible.dataset.niveau;
      definirNiveauExplication(cible.dataset.niveau);
      sauvegarder();
      appliquerPreferences(racine);
      return;
    }
    if (cible.dataset.rapport) { produireRapport(cible.dataset.rapport); return; }
    const question = cible.dataset.q;
    if (question === "__comparer__") return proposerComparaisons();
    if (question === "__rapports__") { racine.querySelector("#sna-rapports").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    if (question === "__historique__") return afficherHistoriqueExtractions();
    if (question.endsWith(" ")) { const champ = racine.querySelector("#sna-question"); champ.value = question; champ.focus(); fermerMenu(racine); return; }
    fermerMenu(racine);
    envoyer(question);
  });
  racine.querySelector("#sna-plus").addEventListener("click", () => {
    const menu = racine.querySelector("#sna-menu");
    const ouvert = menu.hidden;
    menu.hidden = !ouvert;
    racine.querySelector("#sna-plus").setAttribute("aria-expanded", String(ouvert));
  });
  racine.querySelector("#sna-avatar-bascule").addEventListener("click", () => {
    etat.preferences.avatarActif = !etat.preferences.avatarActif;
    sauvegarder();
    appliquerPreferences(racine);
  });
  racine.querySelector("#sna-3d-bascule").addEventListener("click", () => {
    etat.preferences.avatar3d = !etat.preferences.avatar3d;
    sauvegarder();
    appliquerPreferences(racine);
    activer3D(racine);
  });
  racine.querySelector("#sna-tenue").addEventListener("change", (evenement) => {
    etat.preferences.tenue = evenement.target.value;
    lire3D()?.habiller(etat.preferences.tenue);
    document.documentElement.dataset.tenue = etat.preferences.tenue;
    sauvegarder();
  });
  racine.querySelector("#sna-volume").addEventListener("input", (evenement) => {
    etat.preferences.volume = Number(evenement.target.value) / 100;
    definirVolume(etat.preferences.volume);
    sauvegarder();
  });
  racine.querySelector("#sna-interrompre").addEventListener("click", interrompre);
  racine.querySelector("#sna-micro").addEventListener("click", () => basculerEcoute());
  racine.querySelector("#sna-micro2").addEventListener("click", () => basculerEcoute());
  racine.querySelector("#sna-continu").addEventListener("click", (evenement) => {
    etat.continu = !etat.continu;
    evenement.currentTarget.setAttribute("aria-pressed", String(etat.continu));
    racine.classList.toggle("conversation-continue", etat.continu);
    if (etat.continu) { etat.echecsEcoute = 0; basculerEcoute(true); } else { arreterEcoute(); }
  });
  racine.querySelector("#sna-nouvelle").addEventListener("click", () => {
    interrompre();
    etat.messages = [];
    etat.fichier = null;
    sauvegarder();
    message_accueil();
    dessinerHistorique();
    dessinerSuggestions();
  });
  racine.querySelector("#sna-exporter-conv").addEventListener("click", () => telechargerConversation(etat.messages.map((m) => ({ role: m.role === "utilisateur" ? "utilisateur" : "assistante", texte: m.role === "utilisateur" ? m.texte : m.phrases.join(" "), sources: (m.sources || []).map(versAffichage) })), etat.model));
  racine.querySelector("#sna-fichier").addEventListener("change", (evenement) => { const fichier = evenement.target.files?.[0]; if (fichier) traiterFichier(fichier); evenement.target.value = ""; fermerMenu(racine); });
  racine.querySelector("#sna-image").addEventListener("change", (evenement) => { const fichier = evenement.target.files?.[0]; if (fichier) traiterImage(fichier); evenement.target.value = ""; fermerMenu(racine); });
  racine.querySelector("#sna-historique").addEventListener("click", (evenement) => {
    const bouton = evenement.target.closest("[data-action]");
    if (!bouton) return;
    const index = Number(bouton.closest("[data-index]")?.dataset.index);
    const msg = etat.messages[index];
    if (bouton.dataset.action === "reecouter" && msg?.segments) { demarrerLecture(index, { segments: msg.segments }); }
    if (bouton.dataset.action === "copier" && msg) navigator.clipboard?.writeText(msg.phrases.join(" ")).catch(() => {});
    if (bouton.dataset.action === "csv" && msg?.visuel) exporterVisuelCsv(msg.visuel);
    if (bouton.dataset.q) envoyer(bouton.dataset.q);
  });
  racine.querySelector("#sna-suggestions").addEventListener("click", (evenement) => {
    const bouton = evenement.target.closest("[data-q]");
    if (bouton) envoyer(bouton.dataset.q);
  });
}
function fermerMenu(racine) {
  const menu = racine.querySelector("#sna-menu");
  if (menu) menu.hidden = true;
  racine.querySelector("#sna-plus")?.setAttribute("aria-expanded", "false");
}

function installerEcouteursGlobaux() {
  if (ecouteursInstalles) return;
  ecouteursInstalles = true;
  document.addEventListener("sokhnaci:evenement", (evenement) => {
    const { type, index, etat: nouvelEtat, texte } = evenement.detail;
    if (!document.getElementById("sna")) return;
    if (type === "etat") definirIndicateur(nouvelEtat === "prepare" ? "reflechit" : nouvelEtat);
    if (type === "phrase") surlignerPhrase(index);
    if (type === "voix") { etat.chargement = /pr[ée]pare/i.test(texte || "") && !/pr[êe]te/i.test(texte || ""); majIndicateurs(); }
    if (type === "fin") continuerSiBesoin();
  });
  window.addEventListener("pointermove", (evenement) => { scene.pointeurX = evenement.clientX; }, { passive: true });
  document.addEventListener("keydown", (evenement) => { if (evenement.key === "Escape" && document.getElementById("sna")) interrompre(); });
}

// ------------------------------------------------------------------ état et indicateurs
function definirIndicateur(valeur) {
  etat.indicateur = valeur;
  majIndicateurs();
}
const LIBELLES = { attente: "Disponible", ecoute: "Je vous écoute…", reflechit: "Je réfléchis…", parle: "Je parle", chargement: "Chargement…" };
function majIndicateurs() {
  const racine = document.getElementById("sna");
  if (!racine) return;
  const enChargement = etat.chargement || etat.chargement3d;
  const actif = enChargement && etat.indicateur === "attente" ? "chargement" : etat.indicateur;
  racine.querySelectorAll("[data-indicateur]").forEach((li) => li.classList.toggle("actif", li.dataset.indicateur === actif || (li.dataset.indicateur === "chargement" && enChargement)));
  racine.querySelector(".sna-scene").dataset.etat = actif;
  const badge = racine.querySelector("#sna-badge");
  if (badge) badge.textContent = LIBELLES[actif] || "Disponible";
  racine.querySelectorAll(".sna-bouton-micro").forEach((b) => b.setAttribute("aria-pressed", String(etat.ecouteEnCours)));
}

// ------------------------------------------------------------------ conversation
function ajouter(msg) {
  etat.messages.push({ t: Date.now(), ...msg });
  if (etat.messages.length > MAX_MESSAGES) etat.messages.splice(0, etat.messages.length - MAX_MESSAGES);
  sauvegarder();
  dessinerHistorique();
  dessinerSuggestions();
}

async function envoyer(question) {
  if (!etat.model) return;
  arreterEcoute({ silencieux: true });
  ajouter({ role: "utilisateur", texte: question });
  definirIndicateur("reflechit");
  if (etat.fichier && /\b(fichier|document|tableau joint|ce fichier|le fichier)\b/i.test(question)) {
    repondreFichier(question);
    return;
  }
  const entree = interpreterEntree(question, etat.model);
  if (entree.commande) {
    executerCommandeScene(entree.commande);
    if (entree.commande.action === "presente") {
      repondre({ ...creerSituation(etat.model), sources: sourcesPour(etat.model), suggestions: ["fais une analyse des résultats", "fais un graphique des régions", "statistiques"] });
      return;
    }
    const dialogue = phraseAction(entree.commande);
    if (dialogue) repondre({ ...dialogue, sources: [], suggestions: ["fais le point", "analyse territoriale", "fais un graphique des régions"] });
    return;
  }
  let dialogue = entree.dialogue;
  if (dialogue.incomprise && llmDisponible()) {
    const texteIA = await interrogerLLM(question, etat.model);
    if (texteIA) {
      const gestes = ["pointer_ecran", "hochement_tete", "geste_ouvert", "compter_doigts"];
      dialogue = {
        emotion: "encourageante",
        segments: texteIA.split(/(?<=[.!?])\s+/).slice(0, 5).map((texte, i) => ({ langue: "fr", texte, geste: gestes[i % gestes.length], audio: null })),
        sources: sourcesPour(etat.model, ["Reformulé par un modèle de langage, limité aux faits du tableau de bord", "Tous les chiffres ont été vérifiés automatiquement"]),
        suggestions: ["fais une analyse des résultats", "fais un graphique des régions"],
      };
    }
  }
  repondre(dialogue);
}

function repondre(dialogue) {
  const acteur = document.getElementById("sna-acteur");
  if (acteur) acteur.dataset.emotion = dialogue.emotion || "neutre";
  const phrases = dialogue.segments.map((s) => versAffichage(s.texte));
  ajouter({ role: "assistante", phrases, segments: dialogue.segments.map(({ langue, texte, geste, audio }) => ({ langue, texte, geste, audio })), sources: dialogue.sources || [], visuel: dialogue.visuel || null, suggestions: dialogue.suggestions || [], emotion: dialogue.emotion });
  const index = etat.messages.length - 1;
  if (dialogue.action?.type === "rapport") {
    if (dialogue.action.format) produireRapport(dialogue.action.format);
    else document.getElementById("sna-rapports")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  demarrerLecture(index, dialogue);
}

function demarrerLecture(index, dialogue) {
  etat.lecture = { index };
  surlignerPhrase(null);
  const racine = document.getElementById("sna");
  if (racine && !etat.preferences.avatarActif) { /* la voix continue sans avatar */ }
  Promise.resolve(lireDialogue(dialogue)).finally(() => { if (etat.indicateur === "reflechit") definirIndicateur("attente"); });
}

function interrompre() {
  arreterLecture();
  arreterEcoute({ silencieux: true });
  etat.continu = false;
  const bouton = document.getElementById("sna-continu");
  bouton?.setAttribute("aria-pressed", "false");
  document.getElementById("sna")?.classList.remove("conversation-continue");
  arreterScene();
  definirIndicateur("attente");
}

function surlignerPhrase(index) {
  const racine = document.getElementById("sna-historique");
  if (!racine) return;
  racine.querySelectorAll(".sok-phrase.actif").forEach((e) => e.classList.remove("actif"));
  if (index === null || index === undefined || !etat.lecture) return;
  const phrase = racine.querySelector(`[data-index="${etat.lecture.index}"] .sok-phrase[data-i="${index}"]`);
  phrase?.classList.add("actif");
  phrase?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// ------------------------------------------------------------------ rendu de l'historique
function dessinerHistorique() {
  const conteneur = document.getElementById("sna-historique");
  if (!conteneur) return;
  conteneur.replaceChildren(...etat.messages.map((msg, index) => noeudMessage(msg, index)));
  etat.messages.forEach((msg, index) => { if (msg.visuel) dessinerVisuel(conteneur.querySelector(`[data-index="${index}"] .sna-visuel`), msg.visuel, `sna-ch-${msg.t}-${index}`); });
  conteneur.scrollTop = conteneur.scrollHeight;
}

function noeudMessage(msg, index) {
  const element = document.createElement("article");
  element.dataset.index = String(index);
  element.className = `sna-message sna-${msg.role === "utilisateur" ? "utilisateur" : "assistante"}`;
  if (msg.role === "utilisateur") {
    element.innerHTML = `<p>${echapper(msg.texte)}</p><time>${heure(msg.t)}</time>`;
    return element;
  }
  const sources = (msg.sources || []).length ? `<details class="sna-sources"><summary>Sources utilisées</summary><ul>${msg.sources.map((s) => `<li>${echapper(versAffichage(s))}</li>`).join("")}</ul></details>` : "";
  element.innerHTML = `<div class="sna-entete-msg"><span class="sna-pastille" aria-hidden="true">S</span><strong>Sokhna Ci</strong><time>${heure(msg.t)}</time></div>
    <div class="sna-texte">${(msg.phrases || []).map((p, i) => `<span class="sok-phrase" data-i="${i}">${echapper(p)}</span>`).join(" ")}</div>
    <div class="sna-visuel"></div>${sources}
    <div class="sna-actions-msg">${msg.segments ? '<button type="button" data-action="reecouter">Réécouter</button>' : ""}<button type="button" data-action="copier">Copier</button>${msg.visuel ? '<button type="button" data-action="csv">Exporter (CSV)</button>' : ""}</div>`;
  return element;
}

function dessinerSuggestions() {
  const conteneur = document.getElementById("sna-suggestions");
  if (!conteneur) return;
  const derniere = [...etat.messages].reverse().find((m) => m.role !== "utilisateur");
  const suggestions = derniere?.suggestions?.length ? derniere.suggestions : ["fais une analyse des résultats", "fais un graphique des régions", "statistiques"];
  conteneur.innerHTML = suggestions.slice(0, 4).map((s) => `<button type="button" data-q="${echapper(s)}">${echapper(s)}</button>`).join("");
}

function tableauHtml(visuel) {
  return `<div class="sna-tableau"><table><thead><tr>${visuel.colonnes.map((c) => `<th scope="col">${echapper(c)}</th>`).join("")}</tr></thead><tbody>${visuel.lignes.map((ligne) => `<tr>${ligne.map((cellule) => `<td>${echapper(cellule)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function dessinerVisuel(conteneur, visuel, id) {
  if (!conteneur) return;
  const seuils = etat.model.seuils;
  conteneur.innerHTML = `<h4>${echapper(visuel.titre || "")}</h4>`;
  const ajouterGraphe = (suffixe) => {
    const boite = document.createElement("div");
    boite.className = "sna-graphe";
    boite.innerHTML = `<canvas id="${id}-${suffixe}" role="img" aria-label="${echapper(visuel.titre || "graphique")}"></canvas>`;
    conteneur.append(boite);
    return `${id}-${suffixe}`;
  };
  const disponible = typeof Chart !== "undefined";
  if (visuel.type === "table") {
    conteneur.insertAdjacentHTML("beforeend", tableauHtml(visuel));
    if (visuel.barres && disponible) grapheBarres(ajouterGraphe("b"), visuel.barres.labels, visuel.barres.valeurs, { statut: true, seuils });
    if (visuel.doughnut && disponible) grapheDoughnut(ajouterGraphe("d"), { conforme: visuel.doughnut.valeurs[0], surveiller: visuel.doughnut.valeurs[1], critique: visuel.doughnut.valeurs[2] });
    return;
  }
  if (!disponible) {
    conteneur.insertAdjacentHTML("beforeend", tableauHtml(visuelEnTableau(visuel)));
    return;
  }
  if (visuel.type === "bar") grapheBarres(ajouterGraphe("b"), visuel.labels, visuel.valeurs, { statut: true, seuils, horizontal: Boolean(visuel.horizontal) });
  if (visuel.type === "line") grapheLigne(ajouterGraphe("l"), visuel.labels.map((l) => (/^\d{4}-\d{2}-\d{2}$/.test(l) ? dateCourte(l) : l)), visuel.series, { percent: true });
  if (visuel.type === "doughnut") grapheDoughnut(ajouterGraphe("d"), { conforme: visuel.valeurs[0], surveiller: visuel.valeurs[1], critique: visuel.valeurs[2] });
}

function visuelEnTableau(visuel) {
  if (visuel.type === "line") return { colonnes: ["Extraction", ...visuel.series.map((s) => s.label)], lignes: visuel.labels.map((l, i) => [l, ...visuel.series.map((s) => (s.data[i] === null || s.data[i] === undefined ? "—" : `${s.data[i]} %`))]) };
  return { colonnes: ["Élément", "Valeur"], lignes: visuel.labels.map((l, i) => [l, `${visuel.valeurs[i]}${visuel.type === "bar" ? " %" : ""}`]) };
}

function exporterVisuelCsv(visuel) {
  const t = visuel.type === "table" ? visuel : visuelEnTableau(visuel);
  const csv = [t.colonnes.join(";"), ...t.lignes.map((l) => l.join(";"))].join("\n");
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  lien.download = `${(visuel.titre || "resultat").replace(/[^a-z0-9]+/gi, "_")}.csv`;
  document.body.append(lien);
  lien.click();
  lien.remove();
}

// ------------------------------------------------------------------ micro et conversation continue
async function basculerEcoute(forcer = false) {
  if (etat.ecoute && !forcer) { arreterEcoute(); return; }
  if (etat.ecoute) return;
  if (!reconnaissanceDisponible()) { informer(messageMicro("navigateur")); etat.continu = false; document.getElementById("sna-continu")?.setAttribute("aria-pressed", "false"); return; }
  const champ = document.getElementById("sna-question");
  etat.ecouteEnCours = true;
  etat.ecoute = await demarrerEcoute({
    onDebut: majIndicateurs,
    onTexte: (texte) => { if (champ) champ.value = texte; },
    onFinal: (texte) => { if (champ) champ.value = ""; etat.echecsEcoute = 0; envoyer(texte); },
    onFin: ({ texte, erreur }) => {
      etat.ecoute = null;
      etat.ecouteEnCours = false;
      majIndicateurs();
      if (!texte.trim() && !erreur && etat.continu) {
        etat.echecsEcoute += 1;
        if (etat.echecsEcoute >= 3) { etat.continu = false; document.getElementById("sna-continu")?.setAttribute("aria-pressed", "false"); document.getElementById("sna")?.classList.remove("conversation-continue"); informer("Je n’ai rien entendu depuis un moment : j’arrête d’écouter. Réactivez le micro quand vous voulez."); }
        else setTimeout(() => { if (etat.continu) basculerEcoute(true); }, 500);
      }
    },
    onErreur: (code) => {
      etat.ecouteEnCours = false;
      if (code === "no-speech") return;
      etat.continu = false;
      document.getElementById("sna-continu")?.setAttribute("aria-pressed", "false");
      document.getElementById("sna")?.classList.remove("conversation-continue");
      if (code !== "aborted") informer(messageMicro(code));
    },
  });
  if (!etat.ecoute) { etat.ecouteEnCours = false; majIndicateurs(); }
}
function arreterEcoute({ silencieux = false } = {}) {
  etat.ecoute?.arreter();
  etat.ecoute = null;
  etat.ecouteEnCours = false;
  if (!silencieux) majIndicateurs();
}
function continuerSiBesoin() {
  if (etat.continu && !etat.ecoute && document.getElementById("sna")) setTimeout(() => { if (etat.continu && !etat.ecoute) basculerEcoute(true); }, 400);
}
function informer(texte) {
  ajouter({ role: "assistante", phrases: [texte], sources: [], suggestions: [] });
}

// ------------------------------------------------------------------ rapports
async function produireRapport(format) {
  const note = document.getElementById("sna-note-rapport");
  const model = etat.model;
  if (note) note.textContent = "Préparation du rapport…";
  try {
    if (format === "word") { telechargerWord(model); if (note) note.textContent = "Rapport Word téléchargé."; }
    else if (format === "pdf") { imprimerPdf(model); if (note) note.textContent = "Choisissez « Enregistrer au format PDF » dans la fenêtre d’impression."; }
    else {
      const resultat = await telechargerExcel(model);
      if (note) note.textContent = resultat === "xlsx" ? "Rapport Excel téléchargé." : "Excel indisponible : un fichier CSV a été téléchargé à la place.";
    }
  } catch {
    if (note) note.textContent = "Le rapport n’a pas pu être généré.";
  }
}

function proposerComparaisons() {
  const regions = [...(etat.model.toutesRegions || [])].filter((r) => r.tauxMoyen !== null && r.tauxMoyen !== undefined).sort((a, b) => b.tauxMoyen - a.tauxMoyen);
  const nom = (r) => r.nom.replace(/^DRS[_ ]/, "");
  const suggestions = regions.length >= 2 ? [`compare ${nom(regions[0])} et ${nom(regions.at(-1))}`, `compare ${nom(regions[0])}, ${nom(regions[1])} et ${nom(regions.at(-1))}`] : [];
  const mois = (etat.model.evolution?.parPeriode || []).slice(-2).map((p) => p.periode.split(" ")[0].toLowerCase());
  if (mois.length === 2) suggestions.push(`compare ${mois[0]} et ${mois[1]}`);
  ajouter({ role: "assistante", phrases: ["Que voulez-vous comparer ? Des régions, des districts ou des mois. Voici des idées :"], sources: [], suggestions });
}

function afficherHistoriqueExtractions() {
  const e = etat.model.evolution;
  const lignes = (e.semaines || []).map((semaine, i) => [new Date(`${semaine}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }), e.moyenne_generale[i] === null || e.moyenne_generale[i] === undefined ? "—" : `${e.moyenne_generale[i]} %`]).reverse();
  repondre({ emotion: "neutre", segments: [{ langue: "fr", texte: `Voici l’historique des ${lignes.length} extractions suivies, de la plus récente à la plus ancienne.`, geste: "pointer_ecran", audio: null }], visuel: { type: "table", titre: "Historique des extractions", colonnes: ["Extraction", "Taux moyen (mois comparables)"], lignes }, sources: sourcesPour(etat.model, ["Historique des extractions hebdomadaires (une par lundi)"]), suggestions: ["fais une courbe d'évolution"] });
}

// ------------------------------------------------------------------ fichiers et images
function analyserTableau(lignes) {
  const colonnes = lignes[0].map((c, i) => String(c || `Colonne ${i + 1}`));
  const donnees = lignes.slice(1).filter((l) => l.some((c) => String(c ?? "").trim() !== ""));
  const numeriques = colonnes.map((colonne, i) => {
    const valeurs = donnees.map((l) => String(l[i] ?? "").trim()).filter((v) => v !== "" && Number.isFinite(Number(v.replace(",", "."))));
    return valeurs.length >= Math.max(1, donnees.length * 0.6) ? { colonne, valeurs: valeurs.map((v) => Number(v.replace(",", "."))) } : null;
  }).filter(Boolean);
  return { colonnes, donnees, numeriques };
}

function lireCsv(texte) {
  const separateur = [";", "\t", ","].map((s) => [s, (texte.split("\n")[0] || "").split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  return texte.replace(/\r/g, "").split("\n").filter((ligne) => ligne.trim()).map((ligne) => {
    const cellules = [];
    let courant = "";
    let guillemets = false;
    for (const caractere of ligne) {
      if (caractere === '"') guillemets = !guillemets;
      else if (caractere === separateur && !guillemets) { cellules.push(courant); courant = ""; } else courant += caractere;
    }
    cellules.push(courant);
    return cellules;
  });
}

async function traiterFichier(fichier) {
  if (fichier.size > 5 * 1024 * 1024) { informer("Ce fichier dépasse 5 Mo : choisissez un fichier plus léger."); return; }
  ajouter({ role: "utilisateur", texte: `Fichier joint : ${fichier.name}` });
  try {
    let lignes;
    if (/\.(xlsx|xls)$/i.test(fichier.name)) {
      await chargerBibliothequeTableur();
      const classeur = window.XLSX.read(await fichier.arrayBuffer(), { type: "array" });
      lignes = window.XLSX.utils.sheet_to_json(classeur.Sheets[classeur.SheetNames[0]], { header: 1, defval: "" });
    } else if (/\.json$/i.test(fichier.name)) {
      const json = JSON.parse(await fichier.text());
      const tableau = Array.isArray(json) ? json : Object.values(json).find(Array.isArray) || [];
      const cles = [...new Set(tableau.flatMap((o) => Object.keys(o || {})))];
      lignes = [cles, ...tableau.map((o) => cles.map((c) => o?.[c] ?? ""))];
    } else {
      lignes = lireCsv(await fichier.text());
    }
    if (!lignes?.length) throw new Error("vide");
    const { colonnes, donnees, numeriques } = analyserTableau(lignes);
    etat.fichier = { nom: fichier.name, colonnes, donnees };
    const stats = numeriques.slice(0, 8).map(({ colonne, valeurs }) => [colonne, String(valeurs.length), String(Math.min(...valeurs)), String(Math.max(...valeurs)), String(Math.round((valeurs.reduce((a, b) => a + b, 0) / valeurs.length) * 100) / 100)]);
    repondre({
      emotion: "encourageante",
      segments: [{ langue: "fr", texte: `J’ai lu « ${fichier.name} » : ${donnees.length} lignes et ${colonnes.length} colonnes. Le fichier reste sur votre appareil, rien n’est envoyé.`, geste: "pointer_ecran", audio: null },
        { langue: "fr", texte: numeriques.length ? `${numeriques.length} colonnes sont numériques. Vous pouvez me demander de les résumer ou de chercher un mot dans le fichier.` : "Vous pouvez me demander de chercher un mot dans le fichier.", geste: "hochement_tete", audio: null }],
      visuel: stats.length ? { type: "table", titre: `Colonnes numériques de ${fichier.name}`, colonnes: ["Colonne", "Valeurs", "Min", "Max", "Moyenne"], lignes: stats } : { type: "table", titre: `Aperçu de ${fichier.name}`, colonnes: colonnes.slice(0, 6), lignes: donnees.slice(0, 5).map((l) => l.slice(0, 6).map(String)) },
      sources: [`Fichier fourni : ${fichier.name} (analysé localement)`], suggestions: ["résume le fichier", "cherche dans le fichier "],
    });
  } catch {
    informer("Je n’ai pas réussi à lire ce fichier. Utilisez un CSV ou un Excel avec une première ligne d’en-têtes.");
  }
}

function repondreFichier(question) {
  const fichier = etat.fichier;
  const q = question.toLowerCase();
  const recherche = q.match(/cherche(?:r)?\s+(?:dans le fichier\s+)?(.+)/);
  if (recherche && recherche[1].trim() && !/^dans le fichier$/.test(recherche[1].trim())) {
    const mot = recherche[1].replace(/dans le fichier/g, "").trim();
    const trouvees = fichier.donnees.filter((l) => l.some((c) => String(c).toLowerCase().includes(mot)));
    repondre({ emotion: "neutre", segments: [{ langue: "fr", texte: trouvees.length ? `J’ai trouvé ${trouvees.length} ligne${trouvees.length > 1 ? "s" : ""} contenant « ${mot} » dans ${fichier.nom}.` : `Aucune ligne ne contient « ${mot} » dans ${fichier.nom}.`, geste: "pointer_ecran", audio: null }], visuel: trouvees.length ? { type: "table", titre: `Résultats dans ${fichier.nom}`, colonnes: fichier.colonnes.slice(0, 6), lignes: trouvees.slice(0, 10).map((l) => l.slice(0, 6).map(String)) } : null, sources: [`Fichier fourni : ${fichier.nom} (analysé localement)`], suggestions: [] });
    return;
  }
  const { numeriques } = analyserTableau([fichier.colonnes, ...fichier.donnees]);
  repondre({ emotion: "encourageante", segments: [{ langue: "fr", texte: `${fichier.nom} contient ${fichier.donnees.length} lignes et ${fichier.colonnes.length} colonnes, dont ${numeriques.length} numériques.`, geste: "pointer_ecran", audio: null }], visuel: { type: "table", titre: `Aperçu de ${fichier.nom}`, colonnes: fichier.colonnes.slice(0, 6), lignes: fichier.donnees.slice(0, 5).map((l) => l.slice(0, 6).map(String)) }, sources: [`Fichier fourni : ${fichier.nom} (analysé localement)`], suggestions: ["cherche dans le fichier "] });
}

function traiterImage(fichier) {
  ajouter({ role: "utilisateur", texte: `Image jointe : ${fichier.name}` });
  repondre({ emotion: "neutre", segments: [{ langue: "fr", texte: "Je vois que vous avez ajouté une image, mais je ne sais pas encore interpréter les images. Décrivez-moi ce qu’elle montre et je vous aiderai à partir des données.", geste: "geste_rassurant", audio: null }], sources: [], suggestions: ["fais une analyse des résultats"] });
}

// ------------------------------------------------------------------ scène : l'avatar évolue dans son espace
function arreterScene() { scene.mode = "arret"; scene.cible = scene.x; scene.echelleCible = Math.max(0.8, Math.min(1.35, scene.echelle)); }

function executerCommandeScene(commande) {
  const racine = document.getElementById("sna");
  const acteur = racine?.querySelector("#sna-acteur");
  if (!acteur) return;
  if (!etat.preferences.avatarActif) { etat.preferences.avatarActif = true; sauvegarder(); appliquerPreferences(racine); }
  const classes = ["assise", "danse", "grand-sourire"];
  const retirer = (...noms) => noms.forEach((n) => acteur.classList.remove(n));
  const temporaire = (nom, duree) => { acteur.classList.add(nom); setTimeout(() => acteur.classList.remove(nom), duree); };
  const largeur = racine.querySelector(".sna-scene").clientWidth;
  const limite = Math.max(40, largeur / 2 - 110);
  switch (commande.action) {
    case "viens": retirer(...classes); scene.mode = "va"; scene.cible = 0; scene.echelleCible = 1.32; break;
    case "suis": retirer(...classes); scene.mode = "suit"; break;
    case "stop": arreterLecture(); arreterScene(); acteur.classList.remove("danse"); break;
    case "rentre": retirer(...classes); scene.mode = "va"; scene.cible = 0; scene.echelleCible = 1; break;
    case "avance": scene.echelleCible = Math.min(1.4, scene.echelleCible + 0.14); break;
    case "recule": scene.echelleCible = Math.max(0.8, scene.echelleCible - 0.14); break;
    case "marche": retirer(...classes); scene.mode = "patrouille"; scene.attente = 0; break;
    case "tourne": scene.sens = commande.direction ?? scene.sens; scene.mode = "va"; scene.cible = Math.max(-limite, Math.min(limite, scene.x + scene.sens * 120)); break;
    case "demitour": scene.sens *= -1; break;
    case "assis": scene.mode = "arret"; scene.cible = scene.x; acteur.classList.add("assise"); break;
    case "debout": retirer("assise"); break;
    case "danse": scene.mode = "arret"; scene.cible = scene.x; retirer("assise"); temporaire("danse", 7000); break;
    case "sourire": temporaire("grand-sourire", 4500); break;
    case "ecoute": scene.mode = "arret"; scene.cible = scene.x; scene.echelleCible = 1.2; temporaire("listening", 6000); break;
    case "presente": presenterResultats(); break;
    case "montre": presenterResultats(); break;
    default: break;
  }
  acteur.dataset.sens = String(scene.sens);
}

function presenterResultats() {
  const points = [...document.querySelectorAll("#sna-points .sna-point")];
  points.forEach((p, i) => setTimeout(() => { p.classList.add("sna-mise-en-avant"); setTimeout(() => p.classList.remove("sna-mise-en-avant"), 2600); }, 700 + i * 2800));
  document.getElementById("sna-points")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function boucleScene(maintenant) {
  const racine = document.getElementById("sna");
  const acteur = racine?.querySelector("#sna-acteur");
  if (!racine || !acteur) { scene.boucle = false; return; }
  const dt = Math.min(0.1, ((maintenant || 0) - (scene.dernier || maintenant || 0)) / 1000);
  scene.dernier = maintenant || 0;
  const largeur = racine.querySelector(".sna-scene").clientWidth;
  const limite = Math.max(40, largeur / 2 - 110);
  if (scene.mode === "suit" && scene.pointeurX !== null) {
    const zone = racine.querySelector(".sna-scene").getBoundingClientRect();
    scene.cible = Math.max(-limite, Math.min(limite, scene.pointeurX - (zone.left + zone.width / 2)));
  }
  if (scene.mode === "patrouille" && Math.abs(scene.cible - scene.x) < 4) {
    scene.attente -= dt;
    if (scene.attente <= 0) { scene.cible = (Math.random() * 2 - 1) * limite; scene.attente = 1 + Math.random() * 1.5; scene.echelleCible = 0.95 + Math.random() * 0.25; }
  }
  const ecart = scene.cible - scene.x;
  const marche = Math.abs(ecart) > 3 && !acteur.classList.contains("assise");
  if (marche) {
    scene.sens = ecart > 0 ? 1 : -1;
    scene.x += Math.sign(ecart) * Math.min(Math.abs(ecart), 130 * dt);
  } else if (scene.mode === "va") scene.mode = "arret";
  scene.echelle += (scene.echelleCible - scene.echelle) * Math.min(1, dt * 2.5);
  acteur.classList.toggle("walking", marche || Math.abs(scene.echelleCible - scene.echelle) > 0.02);
  acteur.style.setProperty("--x", `${scene.x}px`);
  acteur.style.setProperty("--echelle", scene.echelle.toFixed(3));
  acteur.style.setProperty("--sens", String(scene.sens));
  racine.querySelector(".sna-ombre")?.style.setProperty("--echelle", scene.echelle.toFixed(3));
  racine.querySelector(".sna-ombre")?.style.setProperty("--x", `${scene.x}px`);
  requestAnimationFrame(boucleScene);
}

// ------------------------------------------------------------------ appel depuis l'extérieur (carte flottante)
export function poserDansEspace(question) {
  if (!question) return;
  if (document.getElementById("sna") && etat.model) envoyer(question);
}

export function salutationInitiale() {
  try {
    if (sessionStorage.getItem(CLE_SALUT)) return;
    sessionStorage.setItem(CLE_SALUT, "1");
  } catch { /* session indisponible */ }
  if (navigator.userActivation?.hasBeenActive === false) return;
  const premiere = etat.messages.findLast?.((m) => m.salutation);
  if (premiere && lireVolume() > 0) { etat.lecture = { index: etat.messages.indexOf(premiere) }; Promise.resolve(lireDialogue({ segments: premiere.segments })); }
}
