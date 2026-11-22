// Sokhna Ci en mode TV : elle commente la situation de chaque diapositive, puis demande s'il y a des
// éclaircissements à apporter ou des questions à poser, et reste attentive (clavier, micro, mot « Sokhna »).
// Aucun chiffre n'est inventé : tout vient du modèle de données affiché à l'écran.
import { arreterLecture, delierAvatarExterne, demarrerEcoute, lierAvatarExterne, lireDialogue, messageMicro, preparerVoixOriginale, reconnaissanceDisponible, svgMarkup } from "./sokhnaci.js";
import { avatar3dAutorise, obtenir3D } from "./sokhnaci-3d.js";
import { D, E, T, emotionPour, labelRegion, liste, niveau, nomFormulaire, periodeTexte, segment, versAffichage } from "./sokhnaci-dialogue.js";
import { interpreterEntree } from "./sokhnaci-cerveau.js";
import { construireBilan, texteBilan } from "./bilan.js";
import { interrogerLLM, llmDisponible, segmentsDepuisTexteIA } from "./sokhnaci-llm.js";

const CLE_ATTENTIVE = "sokhna-ci-tv-attentive";
const CLE_VOIX = "sokhna-ci-tv-voix";
const CLE_PREFERENCES = "sokhna-ci-ai-preferences-v1";
const MOT_REVEIL = /\b(sokhna\s?ci|sokhnaci|sokhna|sokna|socna)\b/i;
const ESPACE_PAGE = "tv-avec-sna";
const PAGE_PRESENTATRICE = "tv-presentateur";
const REDUIT = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Sur grand écran, Sokhna Ci est une présentatrice en pied dans une colonne à droite des diapositives.
const grandEcran = () => window.matchMedia("(min-width: 1100px)").matches;

const moyenne = (valeurs) => { const v = valeurs.filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const un = (x) => Math.round(x * 10) / 10;
const pluriel = (n, singulier, plur) => (n > 1 ? plur : singulier);
const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sansAccent = (texte) => String(texte ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const lireStockage = (cle, defaut) => { try { const v = localStorage.getItem(cle); return v === null ? defaut : v; } catch { return defaut; } };
const ecrireStockage = (cle, valeur) => { try { localStorage.setItem(cle, valeur); } catch { /* stockage facultatif */ } };

export function assistanteTVAutorisee() {
  return !navigator.webdriver || Boolean(window.__sokhnaciTV);
}

// ---------------------------------------------------------------- commentaire de chaque diapositive
export function commentaire(id, model, { premiere = false } = {}) {
  const seuils = model.seuils;
  const districts = (model.districts || []).filter((d) => d.tauxMoyen !== null && d.tauxMoyen !== undefined);
  const regions = [...(model.toutesRegions || [])].filter((r) => r.tauxMoyen !== null && r.tauxMoyen !== undefined).sort((a, b) => a.tauxMoyen - b.tauxMoyen);
  const taux = moyenne(districts.map((d) => d.tauxMoyen));
  const critiques = districts.filter((d) => d.statut === "critique").sort((a, b) => a.tauxMoyen - b.tauxMoyen);
  const citer = (liste_) => liste(liste_.map((d) => `${d.nom}, à ${T(un(d.tauxMoyen))}`));
  const segments = [];
  if (premiere) segments.push(segment("Salaamalekum !", "salut_main", "wo", "salaamalekum"));
  if (!districts.length) {
    return { emotion: "neutre", segments: [...segments, segment("Je n’ai aucune donnée à commenter pour cette sélection.", "geste_ouvert")] };
  }
  let emotion = emotionPour(taux, seuils);
  if (id === "synth") {
    segments.push(segment(`Voici la situation au ${D(model.semaineCle)}, pour ${periodeTexte(model)}.`, "pointer_ecran"));
    segments.push(segment(`Le taux moyen national est de ${T(un(taux))}, ${niveau(taux, seuils)}.`));
    const comparable = moyenne(districts.map((d) => d.tauxComparable));
    const precedent = moyenne(districts.map((d) => d.tauxPrecedent));
    if (comparable !== null && precedent !== null) {
      const ecart = un(comparable - precedent);
      segments.push(segment(Math.abs(ecart) < seuils.baisse ? "Par rapport à l’extraction précédente, la situation est stable." : ecart > 0 ? `C’est ${P_(ecart)} de mieux que l’extraction précédente.` : `C’est ${P_(ecart)} de moins que l’extraction précédente.`));
    }
    segments.push(segment(`${E(critiques.length)} ${pluriel(critiques.length, "district est", "districts sont")} sous le seuil critique de ${T(seuils.critique)}, sur ${E(districts.length)} analysés.`));
  } else if (id === "carte") {
    emotion = critiques.length ? "preoccupee" : "felicitations";
    segments.push(segment(critiques.length
      ? `Sur la carte, ${E(critiques.length)} ${pluriel(critiques.length, "district est", "districts sont")} en rouge. Les plus en retard : ${citer(critiques.slice(0, 3))}.`
      : "Sur la carte, aucun district n’est sous le seuil critique. Bravo à toutes les équipes !", critiques.length ? "geste_rassurant" : "pouce_leve"));
    if (critiques.length) segments.push(segment("Ce sont les équipes à accompagner en premier."));
  } else if (id === "reg") {
    const pire = regions[0];
    const meilleure = regions.at(-1);
    segments.push(segment(`Par région, la mieux placée est ${labelRegion(meilleure.nom)}, à ${T(un(meilleure.tauxMoyen))}.`, "pouce_leve"));
    segments.push(segment(`La plus en retard est ${labelRegion(pire.nom)}, à ${T(un(pire.tauxMoyen))}.`, "geste_rassurant"));
    const rouges = regions.filter((r) => r.tauxMoyen < seuils.critique).length;
    segments.push(segment(`${E(rouges)} ${pluriel(rouges, "région est", "régions sont")} sous le seuil critique, sur ${E(regions.length)}.`));
  } else if (id === "form") {
    const formulaires = [...(model.tousFormulaires || [])].filter((f) => f.tauxMoyen !== null && f.tauxMoyen !== undefined).sort((a, b) => a.tauxMoyen - b.tauxMoyen);
    if (formulaires.length) {
      segments.push(segment(`Côté formulaires, le plus en retard est ${nomFormulaire(formulaires[0].nom)}, à ${T(un(formulaires[0].tauxMoyen))}.`, "geste_rassurant"));
      segments.push(segment(`Le mieux rempli est ${nomFormulaire(formulaires.at(-1).nom)}, à ${T(un(formulaires.at(-1).tauxMoyen))}.`, "pouce_leve"));
    } else segments.push(segment("Aucun formulaire n’a de résultat pour cette sélection.", "geste_ouvert"));
  } else if (id === "heat") {
    segments.push(segment("La carte thermique croise les régions et les formulaires.", "pointer_ecran"));
    segments.push(segment("Chaque case rouge est un rapport à relancer en priorité."));
    const plusTouchee = [...(model.toutesRegions || [])].sort((a, b) => b.nbCritique - a.nbCritique)[0];
    if (plusTouchee?.nbCritique) segments.push(segment(`${labelRegion(plusTouchee.nom)} compte le plus de districts critiques : ${E(plusTouchee.nbCritique)}.`));
  } else if (id === "top") {
    const tries = [...districts].sort((a, b) => b.tauxMoyen - a.tauxMoyen);
    segments.push(segment(`Les meilleurs résultats : ${citer(tries.slice(0, 3))}.`, "pouce_leve"));
    segments.push(segment(`Les plus faibles : ${citer(tries.slice(-3).reverse())}.`, "geste_rassurant"));
  } else if (id === "tabreg") {
    const rouges = regions.filter((r) => r.tauxMoyen < seuils.critique).length;
    segments.push(segment(`Cette synthèse détaille chaque région et chaque période DHIS2 de l’extraction du ${D(model.semaineCle)}.`, "pointer_ecran"));
    segments.push(segment(`${E(rouges)} ${pluriel(rouges, "région est", "régions sont")} en rouge.`));
  } else if (id === "bilan") {
    const bilan = construireBilan(model);
    emotion = bilan.taux !== null && bilan.taux < seuils.critique ? "preoccupee" : "encourageante";
    for (const phrase of texteBilan(bilan)) segments.push(segment(phrase));
  } else if (id === "evo") {
    const valeurs = model.evolution?.moyenne_generale || [];
    const semaines = model.evolution?.semaines || [];
    if (valeurs.length >= 2 && valeurs.at(-1) !== null && valeurs.at(-2) !== null) {
      const avant = valeurs.at(-2);
      const apres = valeurs.at(-1);
      emotion = apres > avant ? "souriante" : apres < avant ? "preoccupee" : "neutre";
      segments.push(segment(`Depuis l’extraction du ${D(semaines.at(-2))}, le taux moyen est passé de ${T(un(avant))} à ${T(un(apres))}.`, "pointer_ecran"));
      segments.push(segment(apres > avant ? "La tendance est à l’amélioration." : apres < avant ? "Attention, la tendance est à la baisse." : "La situation est stable."));
    } else segments.push(segment("Une seule extraction est disponible pour le moment, je ne peux pas encore parler d’évolution.", "geste_ouvert"));
  }
  return { emotion, segments };
}
const P_ = (x) => `«P:${Math.abs(x)}»`;

const PHRASES_FIN = [
  segment("Voilà pour la situation.", "geste_ouvert"),
  segment("Y a-t-il des éclaircissements à apporter, ou des questions à poser ?", "inclinaison_ecoute"),
];

// ---------------------------------------------------------------- assistante
export function creerAssistanteTV() {
  const etat = {
    actif: false, jeton: 0, modele: null, controle: null, parle: false, fenetre: false, silenceJusqua: 0,
    segments: [], dernierTexte: "", attentive: lireStockage(CLE_ATTENTIVE, "0") === "1", voix: lireStockage(CLE_VOIX, "1") !== "0",
    passive: null, ecouteActive: null,
  };
  let carte = null;
  let acteur = null;
  let sousTitre = null;
  let libelleEtat = null;
  let presentatrice = false;
  let positionX = 0;
  let animationMarche = 0;

  // Déplacement de la présentatrice : elle marche (jambes, balancement) vers une position puis se remet de face.
  function marcherVers(cible, duree = 1100) {
    if (!acteur || !presentatrice) return Promise.resolve();
    cancelAnimationFrame(animationMarche);
    if (REDUIT()) { positionX = cible; acteur.style.setProperty("--x", `${cible}px`); return Promise.resolve(); }
    const depart = positionX;
    if (Math.abs(cible - depart) < 4) return Promise.resolve();
    const debut = performance.now();
    acteur.style.setProperty("--sens", cible < depart ? "-1" : "1");
    acteur.classList.add("walking");
    return new Promise((resolve) => {
      const pas = (maintenant) => {
        const k = Math.min(1, (maintenant - debut) / duree);
        const lisse = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
        positionX = depart + (cible - depart) * lisse;
        acteur?.style.setProperty("--x", `${positionX.toFixed(1)}px`);
        if (k < 1 && acteur) animationMarche = requestAnimationFrame(pas);
        else { acteur?.classList.remove("walking"); resolve(); }
      };
      animationMarche = requestAnimationFrame(pas);
    });
  }
  // Pendant l'exposé, elle fait quelques pas d'une phrase à l'autre, sans quitter sa zone.
  function pasPendantExpose(index) {
    if (!presentatrice || index < 1 || index % 2) return;
    let cible = positionX;
    for (let essai = 0; essai < 5 && Math.abs(cible - positionX) < 25; essai += 1) cible = Math.round((Math.random() * 2 - 1) * 30);
    marcherVers(cible, 1000);
  }

  const voixPossible = () => etat.voix && navigator.userActivation?.hasBeenActive !== false && !(navigator.webdriver && !window.__sokhnaciPiper);
  const dire = (texte) => { if (sousTitre) sousTitre.textContent = texte; };
  const marquer = (texte) => { if (libelleEtat) libelleEtat.textContent = texte; if (carte) carte.dataset.etat = texte ? "actif" : ""; };

  function construireCarte() {
    carte = document.createElement("aside");
    presentatrice = grandEcran();
    carte.className = `tv-sna${presentatrice ? " presentateur" : ""}`;
    carte.setAttribute("aria-label", "Sokhna Ci, assistante du mode TV");
    const micro = reconnaissanceDisponible();
    carte.innerHTML = `<div class="tv-sna-scene"><div class="sna-acteur tv-sna-acteur" aria-hidden="true">${svgMarkup(true)}</div></div>
      <div class="tv-sna-corps">
        <div class="tv-sna-tete"><strong>Sokhna Ci</strong><span class="tv-sna-etat" role="status"></span></div>
        <p class="tv-sna-soustitre" aria-live="polite"></p>
        <form class="tv-sna-form" autocomplete="off">
          <input type="text" name="question" maxlength="140" placeholder="Une question ? (touche Q)" aria-label="Poser une question à Sokhna Ci">
          ${micro ? '<button type="button" class="tv-sna-micro" aria-label="Poser la question à voix haute" title="Parler">🎤</button>' : ""}
          <button type="submit" aria-label="Envoyer la question">→</button>
          <button type="button" class="tv-sna-voix" aria-pressed="true" title="Activer ou couper la voix de Sokhna Ci"></button>
          ${micro ? '<button type="button" class="tv-sna-attentive" aria-pressed="false" title="Quand c’est activé, Sokhna Ci écoute en continu : dites « Sokhna » puis votre question"></button>' : ""}
        </form>
      </div>`;
    document.body.appendChild(carte);
    document.body.classList.add(ESPACE_PAGE);
    document.body.classList.toggle(PAGE_PRESENTATRICE, presentatrice);
    acteur = carte.querySelector(".tv-sna-acteur");
    acteur.classList.toggle("presentatrice", presentatrice);
    acteur.style.setProperty("--x", "0px");
    acteur.style.setProperty("--echelle", "1");
    acteur.style.setProperty("--sens", "1");
    sousTitre = carte.querySelector(".tv-sna-soustitre");
    libelleEtat = carte.querySelector(".tv-sna-etat");
    lierAvatarExterne(acteur);
    majBoutons();
    carte.querySelector(".tv-sna-form").addEventListener("submit", (evenement) => {
      evenement.preventDefault();
      const champ = evenement.currentTarget.elements.question;
      const texte = champ.value.trim();
      champ.value = "";
      if (texte) poserQuestion(texte);
    });
    carte.querySelector(".tv-sna-micro")?.addEventListener("click", ecouterUneFois);
    carte.querySelector(".tv-sna-voix").addEventListener("click", () => {
      etat.voix = !etat.voix;
      ecrireStockage(CLE_VOIX, etat.voix ? "1" : "0");
      if (!etat.voix) arreterLecture();
      majBoutons();
    });
    carte.querySelector(".tv-sna-attentive")?.addEventListener("click", () => {
      etat.attentive = !etat.attentive;
      ecrireStockage(CLE_ATTENTIVE, etat.attentive ? "1" : "0");
      majBoutons();
      if (etat.attentive) demarrerEcoutePassive(); else arreterEcoutePassive();
    });
  }
  function majBoutons() {
    const voix = carte?.querySelector(".tv-sna-voix");
    if (voix) { voix.textContent = etat.voix ? "🔊" : "🔇"; voix.setAttribute("aria-pressed", String(etat.voix)); voix.setAttribute("aria-label", etat.voix ? "Voix activée, cliquer pour couper" : "Voix coupée, cliquer pour activer"); }
    const attentive = carte?.querySelector(".tv-sna-attentive");
    if (attentive) { attentive.textContent = etat.attentive ? "👂 Attentive" : "👂"; attentive.setAttribute("aria-pressed", String(etat.attentive)); attentive.setAttribute("aria-label", etat.attentive ? "Écoute continue activée : dites Sokhna puis votre question" : "Activer l’écoute continue"); }
  }
  function attitudeAttentive(oui) {
    if (!acteur) return;
    acteur.classList.toggle("listening", Boolean(oui) && !etat.parle);
  }

  async function brancher3D() {
    if (!avatar3dAutorise()) return;
    let tenue = "wax";
    try { tenue = JSON.parse(localStorage.getItem(CLE_PREFERENCES) || "{}").tenue || "wax"; } catch { /* préférences par défaut */ }
    let voulu = true;
    try { const p = JSON.parse(localStorage.getItem(CLE_PREFERENCES) || "{}"); if (p.avatar3d === false) voulu = false; } catch { /* défaut */ }
    if (!voulu) return;
    try {
      const controleur = await obtenir3D(tenue);
      if (!etat.actif || !carte) return;
      const zone = carte.querySelector(".tv-sna-scene");
      controleur.habiller(tenue);
      controleur.relier(zone, acteur, { cadrage: presentatrice ? "pied" : "buste" });
      zone.classList.add("trois-d");
    } catch { /* l'illustration 2D reste affichée */ }
  }

  // ---------- parole
  function surEvenement(evenement) {
    const detail = evenement.detail || {};
    if (detail.type === "phrase" && detail.index !== null && etat.parle && etat.segments[detail.index]) {
      dire(etat.segments[detail.index].affichage);
      pasPendantExpose(detail.index);
    }
  }
  async function narrer(dialogue, jeton) {
    etat.segments = dialogue.segments.map((s) => ({ ...s, affichage: versAffichage(s.texte) }));
    etat.dernierTexte = etat.segments.map((s) => s.affichage).join(" ");
    etat.parle = true;
    attitudeAttentive(false);
    marquer("Je présente…");
    if (acteur) acteur.dataset.emotion = dialogue.emotion || "neutre";
    try {
      if (voixPossible()) {
        await lireDialogue({ segments: dialogue.segments });
      } else {
        for (const s of etat.segments) {
          if (jeton !== etat.jeton) break;
          dire(s.affichage);
          acteur?.classList.add("speaking");
          await attendre(Math.max(1800, s.affichage.length * 62));
          acteur?.classList.remove("speaking");
        }
      }
    } finally {
      if (jeton === etat.jeton) { etat.parle = false; etat.silenceJusqua = Date.now() + 1500; acteur?.classList.remove("speaking"); }
    }
    return jeton === etat.jeton;
  }

  // ---------- fenêtre de questions : le diaporama attend un peu, Sokhna Ci écoute
  async function fenetreQuestions(jeton, duree, indice) {
    etat.fenetre = true;
    etat.controle?.retenir("question");
    marquer("Je vous écoute…");
    dire(indice || (etat.attentive ? "Je vous écoute : dites « Sokhna » puis votre question." : "Posez-moi votre question avec la touche Q ou le micro."));
    attitudeAttentive(true);
    const fin = Date.now() + duree;
    while (Date.now() < fin && jeton === etat.jeton && etat.actif) await attendre(250);
    etat.fenetre = false;
    if (jeton === etat.jeton) {
      attitudeAttentive(etat.attentive);
      marquer(etat.attentive ? "Attentive" : "");
      etat.controle?.relacher("question", 3000);
    }
  }

  // ---------- questions
  async function construireReponse(question) {
    const entree = interpreterEntree(question, etat.modele);
    if (entree.commande) {
      return { emotion: "souriante", segments: [segment("Ici, je présente la situation. Posez-moi plutôt une question sur les résultats.", "geste_ouvert")] };
    }
    let dialogue = entree.dialogue;
    if (dialogue.incomprise && llmDisponible()) {
      const texteIA = await interrogerLLM(question, etat.modele);
      if (texteIA) dialogue = { emotion: "encourageante", segments: segmentsDepuisTexteIA(texteIA) };
    }
    const segments = dialogue.segments.slice(0, 4);
    if (dialogue.visuel || dialogue.action) segments.push(segment("Pour le graphique ou le rapport complet, ouvrez l’espace Sokhna Ci AI.", "geste_ouvert"));
    return { emotion: dialogue.emotion || "neutre", segments };
  }
  async function poserQuestion(question) {
    if (!etat.actif || !etat.modele) return;
    const jeton = ++etat.jeton;
    etat.fenetre = false;
    etat.controle?.retenir("question");
    arreterLecture();
    arreterEcouteActive();
    marquer("Je réfléchis…");
    dire(`« ${question} »`);
    let dialogue;
    try { dialogue = await construireReponse(question); } catch { dialogue = { emotion: "neutre", segments: [segment("Je n’ai pas réussi à répondre. Pouvez-vous reformuler ?", "geste_ouvert")] }; }
    if (jeton !== etat.jeton) return;
    const complet = await narrer(dialogue, jeton);
    if (complet) await fenetreQuestions(jeton, 12000, "D’autres questions ? Je vous écoute.");
  }

  // ---------- micro : une question à la fois
  function arreterEcouteActive() { try { etat.ecouteActive?.arreter(); } catch { /* déjà arrêtée */ } etat.ecouteActive = null; }
  async function ecouterUneFois() {
    if (!etat.actif) return;
    if (etat.ecouteActive) { arreterEcouteActive(); return; }
    const jeton = ++etat.jeton;
    arreterLecture();
    arreterEcoutePassive();
    etat.controle?.retenir("question");
    let final = "";
    etat.ecouteActive = await demarrerEcoute({
      onDebut: () => { marquer("Je vous écoute…"); dire("Je vous écoute…"); },
      onTexte: (texte) => dire(`« ${texte} »`),
      onFinal: (texte) => { final = texte; },
      onFin: ({ erreur }) => {
        etat.ecouteActive = null;
        if (jeton !== etat.jeton) return;
        if (final.trim()) { poserQuestion(final.trim()); return; }
        if (!erreur) dire("Je n’ai rien entendu. Vous pouvez aussi taper votre question (touche Q).");
        marquer("");
        etat.controle?.relacher("question", 5000);
        if (etat.attentive) demarrerEcoutePassive();
      },
      onErreur: (code) => { if (code !== "aborted") dire(messageMicro(code)); },
    });
    if (!etat.ecouteActive) { marquer(""); etat.controle?.relacher("question", 5000); if (etat.attentive) demarrerEcoutePassive(); }
  }

  // ---------- écoute continue (facultative) : réagit au mot « Sokhna »
  function ressembleAMaParole(texte) {
    const mots = sansAccent(texte).split(/[^a-z0-9]+/).filter((m) => m.length > 2);
    if (!mots.length) return false;
    const connus = new Set(sansAccent(etat.dernierTexte).split(/[^a-z0-9]+/).filter((m) => m.length > 2));
    return mots.filter((m) => connus.has(m)).length / mots.length > 0.6;
  }
  function parolEntendue(texte) {
    if (etat.parle || Date.now() < etat.silenceJusqua || ressembleAMaParole(texte)) return;
    const reveil = MOT_REVEIL.test(texte);
    if (!reveil && !etat.fenetre) return;
    const question = texte.replace(new RegExp(MOT_REVEIL.source, "ig"), "").replace(/^[\s,.:;!?-]+/, "").trim();
    if (question.length < 3) {
      const jeton = ++etat.jeton;
      arreterLecture();
      narrer({ emotion: "souriante", segments: [segment("Oui, je vous écoute.", "hochement_tete")] }, jeton).then((fini) => { if (fini) fenetreQuestions(jeton, 15000); });
      return;
    }
    poserQuestion(question);
  }
  function demarrerEcoutePassive() {
    const Reconnaissance = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Reconnaissance || !etat.actif || !etat.attentive || etat.passive || etat.ecouteActive) return;
    const reconnaissance = new Reconnaissance();
    reconnaissance.lang = "fr-FR";
    reconnaissance.continuous = true;
    reconnaissance.interimResults = false;
    reconnaissance.onresult = (evenement) => {
      for (let i = evenement.resultIndex; i < evenement.results.length; i += 1) {
        if (evenement.results[i].isFinal) parolEntendue(evenement.results[i][0].transcript.trim());
      }
    };
    reconnaissance.onerror = (evenement) => {
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(evenement.error)) {
        etat.attentive = false;
        ecrireStockage(CLE_ATTENTIVE, "0");
        majBoutons();
        dire(messageMicro(evenement.error));
      }
    };
    reconnaissance.onend = () => {
      etat.passive = null;
      if (etat.actif && etat.attentive && !etat.ecouteActive) setTimeout(demarrerEcoutePassive, 700);
    };
    try { reconnaissance.start(); etat.passive = reconnaissance; attitudeAttentive(true); marquer("Attentive"); } catch { etat.passive = null; }
  }
  function arreterEcoutePassive() {
    const r = etat.passive;
    etat.passive = null;
    try { r?.abort(); } catch { /* déjà arrêtée */ }
    attitudeAttentive(false);
  }

  // ---------- interface appelée par le diaporama
  return {
    demarrer(modele, controle) {
      if (etat.actif) return;
      etat.actif = true;
      etat.modele = modele;
      etat.controle = controle;
      construireCarte();
      document.addEventListener("sokhnaci:evenement", surEvenement);
      preparerVoixOriginale();
      brancher3D();
      if (etat.attentive) demarrerEcoutePassive();
      if (navigator.userActivation?.hasBeenActive === false && etat.voix) {
        dire("Cliquez n’importe où pour activer ma voix. Je commente en sous-titres en attendant.");
      }
    },
    mettreAJour(modele) { etat.modele = modele; },
    async surDiapositive(slide, modele, index, total) {
      if (!etat.actif) return;
      etat.modele = modele;
      const jeton = ++etat.jeton;
      etat.fenetre = false;
      arreterLecture();
      arreterEcouteActive();
      // À chaque diapositive, la présentatrice entre en marchant depuis le bord, puis prend la parole.
      if (presentatrice) {
        positionX = 70;
        acteur?.style.setProperty("--x", "70px");
        await marcherVers(0, 1300);
      } else await attendre(500); // laisse la navigation se stabiliser avant de parler
      if (jeton !== etat.jeton || !etat.actif) return;
      const dialogue = commentaire(slide.id, modele, { premiere: index === 0 });
      const derniere = index === total - 1;
      if (derniere) dialogue.segments.push(...PHRASES_FIN);
      const complet = await narrer(dialogue, jeton);
      if (!complet) return;
      marquer(etat.attentive ? "Attentive" : "");
      attitudeAttentive(etat.attentive);
      if (derniere) await fenetreQuestions(jeton, 20000);
    },
    ouvrirQuestion() {
      if (!etat.actif) return;
      carte?.querySelector(".tv-sna-form input")?.focus();
      etat.controle?.retenir("question");
      dire("Tapez votre question, ou utilisez le micro.");
      const jeton = ++etat.jeton;
      arreterLecture();
      fenetreQuestions(jeton, 25000, "Tapez votre question, ou utilisez le micro 🎤.");
    },
    arreter() {
      if (!etat.actif) return;
      etat.actif = false;
      etat.jeton += 1;
      arreterEcoutePassive();
      arreterEcouteActive();
      arreterLecture();
      document.removeEventListener("sokhnaci:evenement", surEvenement);
      if (acteur) delierAvatarExterne(acteur);
      carte?.remove();
      document.body.classList.remove(ESPACE_PAGE, PAGE_PRESENTATRICE);
      cancelAnimationFrame(animationMarche);
      carte = acteur = sousTitre = libelleEtat = null;
    },
  };
}
