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

// Complétude par district, mois par mois et sur l'année. lignes : réponse analytics dx × pe × ou avec, pour chaque
// formulaire, <uid>.ACTUAL_REPORTS et <uid>.EXPECTED_REPORTS. Taux = reçus / attendus × 100, en additionnant les
// formulaires retenus ; annuel = somme des reçus / somme des attendus sur les mois choisis (et non une moyenne de
// taux). DHIS2 n'envoie pas les zéros : attendus sans reçus = 0 reçu. Aucun attendu = « non disponible » (null).
export function tableauDistrictsMensuel(lignes, formulairesUids, districts, mois) {
  const valeurs = new Map();
  for (const l of lignes) valeurs.set(`${l.dx}|${l.pe}|${l.ou}`, Number.isFinite(l.valeur) ? l.valeur : null);
  const v = (f, m, pe, ou) => valeurs.get(`${f}.${m}|${pe}|${ou}`) ?? null;
  const taux = (recus, attendus) => (attendus > 0 ? Math.round((recus / attendus) * 1000) / 10 : null);
  return districts.map((d) => {
    let totalRecus = 0;
    let totalAttendus = 0;
    const parMois = mois.map((pe) => {
      let recus = 0;
      let attendus = 0;
      for (const f of formulairesUids) {
        const a = v(f, "EXPECTED_REPORTS", pe, d.id);
        if (a === null || a === 0) continue;
        attendus += a;
        recus += v(f, "ACTUAL_REPORTS", pe, d.id) ?? 0;
      }
      totalRecus += recus;
      totalAttendus += attendus;
      return taux(recus, attendus);
    });
    return { district: d.nom, districtUid: d.id, region: d.region || "", parMois, annuel: taux(totalRecus, totalAttendus), manquants: totalAttendus - totalRecus };
  }).sort((a, b) => (a.annuel ?? Infinity) - (b.annuel ?? Infinity) || a.district.localeCompare(b.district, "fr"));
}

// ---------------------------------------------------------------- taux moyens et exhaustivité
// Taux moyen = moyenne simple des taux des formulaires (chaque formulaire compte pour un), comme le taux moyen de
// l'extraction hebdomadaire. Complétude = reçus ÷ attendus ; promptitude = reçus à temps ÷ attendus (définition
// DHIS2 « Reporting rate on time ») ; exhaustivité = cases remplies ÷ cases des rapports reçus.
export function tauxMoyens(synthese, exhaustivite = null) {
  const moyenne = (valeurs) => { const v = valeurs.filter((x) => x !== null && x !== undefined && !Number.isNaN(x)); return v.length ? arrondi(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const exh = exhaustivite ? synthese.map((s) => exhaustivite.get(s.formulaireUid)?.taux ?? null) : [];
  return {
    completude: moyenne(synthese.map((s) => s.completude)),
    promptitude: moyenne(synthese.map((s) => s.promptitude)),
    exhaustivite: exhaustivite ? moyenne(exh) : null,
    formulaires: synthese.filter((s) => s.completude !== null && s.completude !== undefined).length,
    formulairesExhaustivite: exh.filter((x) => x !== null).length,
  };
}

// Champs mesurables : nombres et « Oui / Non » (DHIS2 analytics sait les compter). Ne sont pas mesurables :
// les dates et textes (analytics ne les compte pas) et les cases « Oui seulement » (non cochée = « non », réponse
// valable, donc jamais « vide »).
export const TYPES_NUMERIQUES = /^(INTEGER|INTEGER_POSITIVE|INTEGER_NEGATIVE|INTEGER_ZERO_OR_POSITIVE|NUMBER|PERCENTAGE|UNIT_INTERVAL)$/;
export const TYPES_MESURABLES = /^(INTEGER|INTEGER_POSITIVE|INTEGER_NEGATIVE|INTEGER_ZERO_OR_POSITIVE|NUMBER|PERCENTAGE|UNIT_INTERVAL|BOOLEAN)$/;
const RAISON_NON_MESURABLE = { TRUE_ONLY: "case « Oui seulement » : non cochée veut dire « non »", TEXT: "texte : non compté par DHIS2 analytics", LONG_TEXT: "texte : non compté par DHIS2 analytics", DATE: "date : non comptée par DHIS2 analytics", DATETIME: "date : non comptée par DHIS2 analytics" };

// Champs d'un formulaire : chaque élément compte autant de cases que de combinaisons de catégories (celle du
// formulaire si elle remplace celle de l'élément). Renvoie les éléments mesurables, le total de cases et les
// champs écartés avec la raison.
export function casesDuFormulaire(dataSetElements) {
  const tous = dataSetElements || [];
  const mesurables = tous.filter((x) => TYPES_MESURABLES.test(x.dataElement?.valueType || ""));
  const champs = mesurables.map((x) => ({ id: x.dataElement.id, nom: x.dataElement.formName || x.dataElement.displayName || x.dataElement.id, type: x.dataElement.valueType, cases: x.categoryCombo?.categoryOptionCombos || x.dataElement.categoryCombo?.categoryOptionCombos || 1 }));
  return {
    elements: champs.map((c) => c.id),
    cases: champs.reduce((s, c) => s + c.cases, 0),
    champs,
    nonMesurables: tous.filter((x) => !TYPES_MESURABLES.test(x.dataElement?.valueType || "")).map((x) => ({ id: x.dataElement?.id, nom: x.dataElement?.formName || x.dataElement?.displayName || x.dataElement?.id, raison: RAISON_NON_MESURABLE[x.dataElement?.valueType] || `type ${x.dataElement?.valueType} non compté` })),
  };
}

// Exhaustivité champ par champ : `comptes` = Map(élément → Map(structure → valeurs saisies)). Seules comptent les
// structures qui ont envoyé le formulaire, avec un plafond (rapports × cases) par structure et par champ.
export function exhaustiviteParChamp(rapportsParStructure, comptes, champs) {
  const rapportsTotal = [...rapportsParStructure.values()].filter((n) => n > 0).reduce((a, b) => a + b, 0);
  return champs.map((c) => {
    const parStructure = comptes.get(c.id) || new Map();
    let valeurs = 0;
    for (const [structure, rapports] of rapportsParStructure) if (rapports > 0) valeurs += Math.min(parStructure.get(structure) || 0, rapports * c.cases);
    const attendues = rapportsTotal * c.cases;
    return { ...c, valeurs, attendues, taux: attendues ? arrondi((valeurs / attendues) * 100) : null };
  }).sort((a, b) => (a.taux ?? -1) - (b.taux ?? -1) || a.nom.localeCompare(b.nom, "fr"));
}

// Regroupe les champs par section du formulaire (DHIS2 « sections ») ; les champs hors section vont dans « Autres
// champs ». Formulaire sans section : une seule partie, « Formulaire entier ».
export function exhaustiviteParSection(sections, parChamp) {
  const parId = new Map(parChamp.map((c) => [c.id, c]));
  const vus = new Set();
  const parties = (sections || []).map((s) => {
    const champs = (s.dataElements || []).map((d) => parId.get(d.id)).filter(Boolean);
    champs.forEach((c) => vus.add(c.id));
    return { nom: s.displayName || s.name, champs };
  }).filter((p) => p.champs.length);
  const reste = parChamp.filter((c) => !vus.has(c.id));
  if (reste.length) parties.push({ nom: parties.length ? "Autres champs" : "Formulaire entier", champs: reste });
  return parties.map((p) => {
    const valeurs = p.champs.reduce((s, c) => s + c.valeurs, 0);
    const attendues = p.champs.reduce((s, c) => s + c.attendues, 0);
    return { nom: p.nom, champs: p.champs.length, jamais: p.champs.filter((c) => c.valeurs === 0).length, valeurs, attendues, taux: attendues ? arrondi((valeurs / attendues) * 100) : null };
  });
}

// Exhaustivité d'un formulaire : seules comptent les structures qui ont envoyé ce formulaire (des éléments de
// données servent aussi dans d'autres formulaires) ; une structure ne peut pas dépasser 100 %.
export function exhaustiviteFormulaire(rapportsParStructure, valeursParStructure, cases) {
  let valeurs = 0;
  let attendues = 0;
  for (const [structure, rapports] of rapportsParStructure) {
    if (!(rapports > 0) || !cases) continue;
    attendues += rapports * cases;
    valeurs += Math.min(valeursParStructure.get(structure) || 0, rapports * cases);
  }
  return { valeurs, casesAttendues: attendues, taux: attendues ? arrondi((valeurs / attendues) * 100) : null };
}

// Niveau des structures de santé (« Formation sanitaire ») ; à défaut, le niveau le plus fin.
export function niveauStructures(niveaux) {
  const nomme = (niveaux || []).find((n) => /formation sanitaire|structure|etablissement|établissement|facility/i.test(n.displayName || n.name || ""));
  return nomme ? nomme.level : Math.max(...(niveaux || []).map((n) => n.level));
}
