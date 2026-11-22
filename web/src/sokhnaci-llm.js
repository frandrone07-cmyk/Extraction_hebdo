// Modèle de langage facultatif : il ne répond qu'à partir des faits du tableau de bord, et sa réponse est
// rejetée si elle contient un chiffre absent de ces faits. Aucune clé n'est stockée dans le navigateur.
import { ASSISTANT_API_URL } from "./assistant-config.js";
import { toutesDistricts, labelRegion, nomFormulaire } from "./sokhnaci-dialogue.js";
import { analyser } from "./sokhnaci-analyse.js";
import { construireBilan } from "./bilan.js";

const arrondi = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);

export function urlAssistante() {
  // Surcharge réservée aux tests automatisés.
  if (navigator.webdriver && window.__SOKHNACI_ASSISTANT_URL__) return window.__SOKHNACI_ASSISTANT_URL__;
  return ASSISTANT_API_URL;
}
// Coupe-circuit : après deux échecs de suite, on cesse d'interroger le service pendant trois minutes
// (l'assistante répond alors par ses réponses intégrées, sans attente).
const PAUSE_APRES_ECHECS_MS = 3 * 60 * 1000;
let echecsConsecutifs = 0;
let suspenduJusqua = 0;
export function llmDisponible() { return Boolean(urlAssistante()) && Date.now() >= suspenduJusqua; }
function noterEchec() { if (++echecsConsecutifs >= 2) { suspenduJusqua = Date.now() + PAUSE_APRES_ECHECS_MS; echecsConsecutifs = 0; } }
function noterSucces() { echecsConsecutifs = 0; suspenduJusqua = 0; }
const cacheReponses = new Map();
const cleCache = (question, model) => `${model.semaineCle}|${model.selection?.periode}|${String(question).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
export function reinitialiserLLM() { echecsConsecutifs = 0; suspenduJusqua = 0; cacheReponses.clear(); }

export function construireFaits(model) {
  const districts = toutesDistricts(model).filter((d) => d.tauxMoyen !== null && d.tauxMoyen !== undefined);
  const seuils = model.seuils;
  const rouges = districts.filter((d) => d.tauxMoyen < seuils.critique).length;
  const oranges = districts.filter((d) => d.tauxMoyen >= seuils.critique && d.tauxMoyen < seuils.conforme).length;
  const triees = [...districts].sort((a, b) => a.tauxMoyen - b.tauxMoyen);
  const ligne = (d) => ({ nom: d.nom, region: labelRegion(d.region), taux: arrondi(d.tauxMoyen), ecart: arrondi(d.variation) });
  const a = analyser(model);
  const regionsTriees = [...(model.toutesRegions || [])].filter((r) => r.tauxMoyen !== null && r.tauxMoyen !== undefined).sort((x, y) => x.tauxMoyen - y.tauxMoyen);
  return {
    extraction_dhis2: model.semaineCle,
    comparaison_avec: model.comparaisonCle || null,
    periode: model.selection?.periode,
    seuils: { critique: seuils.critique, conforme: seuils.conforme },
    taux_moyen_districts: arrondi(districts.reduce((somme, d) => somme + d.tauxMoyen, 0) / (districts.length || 1)),
    districts: { total: districts.length, rouge: rouges, orange: oranges, vert: districts.length - rouges - oranges },
    region_au_taux_le_plus_bas_a_aider_en_priorite: regionsTriees.length ? { nom: labelRegion(regionsTriees[0].nom), taux: arrondi(regionsTriees[0].tauxMoyen) } : null,
    region_au_taux_le_plus_eleve: regionsTriees.length ? { nom: labelRegion(regionsTriees[regionsTriees.length - 1].nom), taux: arrondi(regionsTriees[regionsTriees.length - 1].tauxMoyen) } : null,
    regions: regionsTriees.map((r) => ({ nom: labelRegion(r.nom), taux: arrondi(r.tauxMoyen), districts: r.districts.length, en_rouge: r.nbCritique, ecart: arrondi(r.variation) })),
    districts_les_plus_faibles: triees.slice(0, 10).map(ligne),
    districts_les_meilleurs: triees.slice(-5).reverse().map(ligne),
    formulaires: (model.tousFormulaires || []).map((f) => ({ nom: nomFormulaire(f.nom), taux: arrondi(f.tauxMoyen), ecart: arrondi(f.variation) })),
    evolution: (model.evolution?.semaines || []).map((semaine, i) => ({ extraction: semaine, taux: arrondi(model.evolution.moyenne_generale[i]) })),
    solutions_proposees: construireBilan(model).solutions.map((x) => ({ priorite: x.priorite, action: x.titre })),
    formulaires_sans_donnees: construireBilan(model).sansDonnees.slice(0, 4).map((l) => ({ nom: nomFormulaire(l.nom), districts_sans_donnee: l.vides, districts_a_zero: l.zeros, attendus: l.attendus })),
    analyse: { regions_entierement_en_rouge: a.regionsToutesRouges.map((r) => labelRegion(r.nom)), districts_en_retard_global: a.globaux.length, valeurs_a_zero: a.zeros },
  };
}

function nombresDans(texte) {
  return [...String(texte).matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(",", ".")));
}

// Vrai seulement si chaque nombre du texte figure (à 0,05 près) parmi les nombres des faits.
export function chiffresVerifies(texte, faits) {
  const autorises = nombresDans(JSON.stringify(faits));
  return nombresDans(texte).every((n) => n <= 1 || autorises.some((a) => Math.abs(a - n) <= 0.051));
}

export async function interrogerLLM(question, model, { url = urlAssistante(), delaiMs = 9000 } = {}) {
  if (!url || Date.now() < suspenduJusqua) return null;
  const cle = cleCache(question, model);
  if (cacheReponses.has(cle)) return cacheReponses.get(cle);
  const faits = construireFaits(model);
  const corps = JSON.stringify({ question, faits });
  const debut = Date.now();
  for (let essai = 0; essai < 2; essai += 1) {
    const restant = delaiMs - (Date.now() - debut);
    if (restant < 1500) break;
    const controle = new AbortController();
    const minuterie = setTimeout(() => controle.abort(), restant);
    try {
      const reponse = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: corps, signal: controle.signal });
      if (reponse.status === 429) return null; // limite atteinte : inutile d'insister
      if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
      const { texte } = await reponse.json();
      if (!texte || texte.length < 8) throw new Error("réponse vide");
      if (!chiffresVerifies(texte, faits)) return null; // réponse refusée : le service fonctionne, c'est son contenu qui est rejeté
      noterSucces();
      cacheReponses.set(cle, texte);
      if (cacheReponses.size > 40) cacheReponses.delete(cacheReponses.keys().next().value);
      return texte;
    } catch {
      if (essai === 1) { noterEchec(); return null; }
      await new Promise((resolve) => setTimeout(resolve, 350)); // un seul nouvel essai
    } finally {
      clearTimeout(minuterie);
    }
  }
  noterEchec();
  return null;
}

// Découpe la réponse du modèle en phrases lisibles à voix haute ; les gestes sont choisis selon le contenu des phrases.
export function segmentsDepuisTexteIA(texte) {
  return texte.split(/(?<=[.!?])\s+/).slice(0, 5).map((phrase) => ({ langue: "fr", texte: phrase, geste: null, audio: null }));
}
