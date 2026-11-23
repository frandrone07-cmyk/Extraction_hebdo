// Calculs de la page « Qualité des données » à partir des réponses DHIS2 (fonctions pures, testées).
// Règle : aucune valeur n'est inventée. Une valeur absente reste `null` et s'affiche « Donnée non disponible ».

// Métriques de rapportage DHIS2 demandées pour chaque formulaire (dx = <uid du formulaire>.<MÉTRIQUE>).
export const METRIQUES = ["EXPECTED_REPORTS", "ACTUAL_REPORTS", "ACTUAL_REPORTS_ON_TIME", "REPORTING_RATE", "REPORTING_RATE_ON_TIME"];

export function dimensionMetriques(formulaires) {
  return `dx:${formulaires.flatMap((f) => METRIQUES.map((m) => `${f.uid}.${m}`)).join(";")}`;
}

const arrondi = (v) => Math.round(v * 10) / 10;

// lignes : [{ dx: "uid.METRIQUE", ou, valeur }] (agrégées sur les périodes choisies, pe en filtre).
// Résultat : une ligne par formulaire × unité.
// - attendus / reçus / à temps : valeurs DHIS2 ; si DHIS2 renvoie des rapports attendus mais aucune ligne
//   « reçus », c'est que zéro rapport a été reçu (DHIS2 n'envoie pas les zéros) : reçus = 0.
// - complétude / promptitude : taux DHIS2 ; à défaut, calculés à partir des effectifs quand ils existent.
// - manquants = attendus − reçus.
export function tableauCompletude(lignes, formulaires, unites) {
  const valeurs = new Map();
  for (const l of lignes) valeurs.set(`${l.dx}|${l.ou}`, Number.isFinite(l.valeur) ? l.valeur : null);
  const lire = (f, m, u) => (valeurs.has(`${f}.${m}|${u}`) ? valeurs.get(`${f}.${m}|${u}`) : null);
  const resultat = [];
  for (const f of formulaires) for (const u of unites) {
    const attendus = lire(f.uid, "EXPECTED_REPORTS", u.id);
    const aucunAttendu = attendus === null || attendus === 0;
    const recus = lire(f.uid, "ACTUAL_REPORTS", u.id) ?? (aucunAttendu ? null : 0);
    const aTemps = lire(f.uid, "ACTUAL_REPORTS_ON_TIME", u.id) ?? (aucunAttendu ? null : 0);
    const taux = (dhis2, n) => (dhis2 !== null ? arrondi(dhis2) : !aucunAttendu && n !== null ? arrondi((n / attendus) * 100) : null);
    resultat.push({
      formulaire: f.nom, formulaireUid: f.uid, unite: u.nom, uniteUid: u.id,
      attendus, recus, aTemps,
      completude: taux(lire(f.uid, "REPORTING_RATE", u.id), recus),
      promptitude: taux(lire(f.uid, "REPORTING_RATE_ON_TIME", u.id), aTemps),
      manquants: attendus !== null && recus !== null ? Math.max(0, attendus - recus) : null,
    });
  }
  return resultat;
}

// Unités les plus en retard : promptitude la plus faible, puis le plus de rapports manquants.
export function plusEnRetard(lignes, n = 10) {
  return lignes.filter((l) => l.promptitude !== null && l.attendus > 0)
    .sort((a, b) => a.promptitude - b.promptitude || (b.manquants ?? 0) - (a.manquants ?? 0) || a.unite.localeCompare(b.unite, "fr"))
    .slice(0, n);
}

export function unitesSansRapport(lignes) {
  return lignes.filter((l) => l.attendus > 0 && l.recus === 0);
}

// Synthèse par formulaire (toutes unités affichées) : sommes des effectifs, taux recalculés sur les sommes.
export function syntheseParFormulaire(lignes) {
  const groupes = new Map();
  for (const l of lignes) {
    const g = groupes.get(l.formulaireUid) || { formulaire: l.formulaire, formulaireUid: l.formulaireUid, attendus: null, recus: null, aTemps: null };
    if (l.attendus !== null) g.attendus = (g.attendus ?? 0) + l.attendus;
    if (l.recus !== null) g.recus = (g.recus ?? 0) + l.recus;
    if (l.aTemps !== null) g.aTemps = (g.aTemps ?? 0) + l.aTemps;
    groupes.set(l.formulaireUid, g);
  }
  return [...groupes.values()].map((g) => ({
    ...g,
    completude: g.attendus && g.recus !== null ? arrondi((g.recus / g.attendus) * 100) : null,
    promptitude: g.attendus && g.aTemps !== null ? arrondi((g.aTemps / g.attendus) * 100) : null,
    manquants: g.attendus !== null && g.recus !== null ? Math.max(0, g.attendus - g.recus) : null,
  }));
}

// Première et dernière date couvertes par des périodes DHIS2 (mois 202603, trimestre 2026Q1, année 2026).
export function bornesPeriodes(periodes) {
  const bornes = periodes.map((id) => {
    const s = String(id);
    const a = Number(s.slice(0, 4));
    let debut = 1;
    let fin = 12;
    if (/^\d{6}$/.test(s)) { debut = fin = Number(s.slice(4)); }
    else if (/^\d{4}Q[1-4]$/.test(s)) { const t = Number(s.slice(5)); debut = 3 * t - 2; fin = 3 * t; }
    const dernierJour = new Date(Date.UTC(a, fin, 0)).getUTCDate();
    return [`${a}-${String(debut).padStart(2, "0")}-01`, `${a}-${String(fin).padStart(2, "0")}-${String(dernierJour).padStart(2, "0")}`];
  });
  if (!bornes.length) return null;
  return { debut: bornes.map((b) => b[0]).sort()[0], fin: bornes.map((b) => b[1]).sort().at(-1) };
}

// Compteurs des violations de règles de validation : par règle, par région, par district.
// resultats : réponse de POST /api/dataAnalysis/validationRules (organisationUnitPath = /pays/région/district/…).
export function compterViolations(resultats, regions, districts) {
  const nomRegion = new Map(regions.map((r) => [r.id, r.nom]));
  const nomDistrict = new Map(districts.map((d) => [d.id, d.nom]));
  const parRegle = new Map();
  const parRegion = new Map();
  const parDistrict = new Map();
  const ajouter = (carte, cle) => { if (cle) carte.set(cle, (carte.get(cle) || 0) + 1); };
  for (const r of resultats || []) {
    ajouter(parRegle, r.validationRuleDescription || r.validationRuleId);
    const chemin = String(r.organisationUnitPath || "").split("/").filter(Boolean);
    ajouter(parRegion, nomRegion.get(chemin.find((id) => nomRegion.has(id))));
    ajouter(parDistrict, nomDistrict.get(chemin.find((id) => nomDistrict.has(id))));
  }
  const trier = (carte) => [...carte].map(([nom, nombre]) => ({ nom, nombre })).sort((a, b) => b.nombre - a.nombre || a.nom.localeCompare(b.nom, "fr"));
  return { total: (resultats || []).length, parRegle: trier(parRegle), parRegion: trier(parRegion), parDistrict: trier(parDistrict) };
}

// Comparaison de versions DHIS2 (« 2.40.4 » ≥ « 2.39 »).
export function versionAuMoins(version, minimum) {
  const a = String(version || "").split(".").map(Number);
  const b = String(minimum).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

// Lien vers la saisie DHIS2 d'une valeur à corriger (ouvert dans un nouvel onglet).
// DÉPEND DE LA VERSION DE DHIS2 : depuis 2.39, application « Aggregate Data Entry » qui accepte l'unité, la
// période et le formulaire dans l'adresse ; avant, l'ancienne application de saisie (sans lien direct).
export function lienSaisieDhis2(lienDhis2, version, { ou = "", pe = "", ds = "" } = {}) {
  if (!lienDhis2) return null;
  if (versionAuMoins(version, "2.39")) {
    const p = new URLSearchParams();
    if (ds) p.set("dataSetId", ds);
    if (ou) p.set("orgUnitId", ou);
    if (pe) p.set("periodId", pe);
    return `${lienDhis2}/dhis-web-aggregate-data-entry/index.html#/?${p}`;
  }
  return `${lienDhis2}/dhis-web-dataentry/index.action`;
}

// Valeurs négatives dans une réponse analytics (dx × ou × pe au niveau des structures).
export function valeursNegatives(lignes) {
  return lignes.filter((l) => Number.isFinite(l.valeur) && l.valeur < 0);
}
