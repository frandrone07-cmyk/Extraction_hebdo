// Modèle de langage facultatif : il ne répond qu'à partir des faits du tableau de bord, et sa réponse est
// rejetée si elle contient un chiffre absent de ces faits. Aucune clé n'est stockée dans le navigateur.
import { ASSISTANT_API_URL } from "./assistant-config.js";
import { toutesDistricts, labelRegion, nomFormulaire } from "./sokhnaci-dialogue.js";
import { analyser } from "./sokhnaci-analyse.js";

const arrondi = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);

export function urlAssistante() {
  // Surcharge réservée aux tests automatisés.
  if (navigator.webdriver && window.__SOKHNACI_ASSISTANT_URL__) return window.__SOKHNACI_ASSISTANT_URL__;
  return ASSISTANT_API_URL;
}
export function llmDisponible() { return Boolean(urlAssistante()); }

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

export async function interrogerLLM(question, model, { url = urlAssistante(), delaiMs = 12000 } = {}) {
  if (!url) return null;
  const faits = construireFaits(model);
  const controle = new AbortController();
  const minuterie = setTimeout(() => controle.abort(), delaiMs);
  try {
    const reponse = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, faits }), signal: controle.signal });
    if (!reponse.ok) return null;
    const { texte } = await reponse.json();
    if (!texte || texte.length < 8) return null;
    if (!chiffresVerifies(texte, faits)) return null;
    return texte;
  } catch {
    return null;
  } finally {
    clearTimeout(minuterie);
  }
}
