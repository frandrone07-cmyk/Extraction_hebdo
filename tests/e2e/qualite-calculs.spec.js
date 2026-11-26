// Tests des calculs de la page « Qualité des données ». Les réponses DHIS2 sont SIMULÉES ici uniquement.
import { test, expect } from "@playwright/test";
import {
  bornesPeriodes, compterViolations, dimensionMetriques, lienSaisieDhis2, plusEnRetard, syntheseParFormulaire,
  tableauCompletude, unitesSansRapport, valeursNegatives, versionAuMoins,
} from "../../web/src/qualite-calculs.js";
import { nettoyerFormulaires } from "../../web/src/formulaires-config.js";

const F = [{ uid: "FoRmUlAiRe1", nom: "Paludisme" }];
const U = [{ id: "ReGiOn00001", nom: "Dakar" }, { id: "ReGiOn00002", nom: "Kolda" }, { id: "ReGiOn00003", nom: "Matam" }];
const ligne = (m, ou, valeur) => ({ dx: `FoRmUlAiRe1.${m}`, ou, valeur });

test("qualité : dimension dx avec les cinq métriques de rapportage par formulaire", () => {
  expect(dimensionMetriques(F)).toBe("dx:FoRmUlAiRe1.EXPECTED_REPORTS;FoRmUlAiRe1.ACTUAL_REPORTS;FoRmUlAiRe1.ACTUAL_REPORTS_ON_TIME;FoRmUlAiRe1.REPORTING_RATE;FoRmUlAiRe1.REPORTING_RATE_ON_TIME");
});

test("qualité : attendus, reçus, à temps, taux et manquants ; rien n'est inventé", () => {
  const lignes = tableauCompletude([
    ligne("EXPECTED_REPORTS", "ReGiOn00001", 100), ligne("ACTUAL_REPORTS", "ReGiOn00001", 92), ligne("ACTUAL_REPORTS_ON_TIME", "ReGiOn00001", 80),
    ligne("REPORTING_RATE", "ReGiOn00001", 92), ligne("REPORTING_RATE_ON_TIME", "ReGiOn00001", 80),
    ligne("EXPECTED_REPORTS", "ReGiOn00002", 40), // aucun rapport reçu : DHIS2 n'envoie pas de ligne « reçus »
  ], F, U);
  expect(lignes[0]).toMatchObject({ unite: "Dakar", attendus: 100, recus: 92, aTemps: 80, completude: 92, promptitude: 80, manquants: 8 });
  expect(lignes[1]).toMatchObject({ unite: "Kolda", attendus: 40, recus: 0, aTemps: 0, completude: 0, promptitude: 0, manquants: 40 });
  // Matam : aucune donnée DHIS2 → tout reste « non disponible » (null), pas de zéro inventé.
  expect(lignes[2]).toMatchObject({ unite: "Matam", attendus: null, recus: null, aTemps: null, completude: null, promptitude: null, manquants: null });
  expect(unitesSansRapport(lignes).map((l) => l.unite)).toEqual(["Kolda"]);
  expect(plusEnRetard(lignes).map((l) => l.unite)).toEqual(["Kolda", "Dakar"]);
  expect(syntheseParFormulaire(lignes)[0]).toMatchObject({ attendus: 140, recus: 92, aTemps: 80, completude: 65.7, promptitude: 57.1, manquants: 48 });
});

test("qualité : bornes de dates des périodes (mois, trimestres, années)", () => {
  expect(bornesPeriodes(["202602", "202601"])).toEqual({ debut: "2026-01-01", fin: "2026-02-28" });
  expect(bornesPeriodes(["2025Q4", "2026Q1"])).toEqual({ debut: "2025-10-01", fin: "2026-03-31" });
  expect(bornesPeriodes(["2024"])).toEqual({ debut: "2024-01-01", fin: "2024-12-31" });
  expect(bornesPeriodes([])).toBeNull();
});

test("qualité : violations comptées par règle, région et district grâce au chemin de l'unité", () => {
  const c = compterViolations([
    { validationRuleDescription: "Cas confirmés ≤ cas testés", organisationUnitPath: "/PaYs0000001/ReGiOn00001/DiStRiCt001/StRuCtUrE01" },
    { validationRuleDescription: "Cas confirmés ≤ cas testés", organisationUnitPath: "/PaYs0000001/ReGiOn00001/DiStRiCt001" },
    { validationRuleDescription: "Décès ≤ hospitalisations", organisationUnitPath: "/PaYs0000001/ReGiOn00002" },
  ], [{ id: "ReGiOn00001", nom: "Dakar" }, { id: "ReGiOn00002", nom: "Kolda" }], [{ id: "DiStRiCt001", nom: "Pikine" }]);
  expect(c.total).toBe(3);
  expect(c.parRegle).toEqual([{ nom: "Cas confirmés ≤ cas testés", nombre: 2 }, { nom: "Décès ≤ hospitalisations", nombre: 1 }]);
  expect(c.parRegion).toEqual([{ nom: "Dakar", nombre: 2 }, { nom: "Kolda", nombre: 1 }]);
  expect(c.parDistrict).toEqual([{ nom: "Pikine", nombre: 2 }]);
});

test("qualité : liens vers la saisie DHIS2 selon la version", () => {
  expect(versionAuMoins("2.40.4", "2.39")).toBe(true);
  expect(versionAuMoins("2.38.1", "2.39")).toBe(false);
  expect(versionAuMoins("2.36", "2.36")).toBe(true);
  expect(lienSaisieDhis2("https://dhis2.test", "2.40.4", { ou: "AbC", pe: "202603", ds: "DeF" }))
    .toBe("https://dhis2.test/dhis-web-aggregate-data-entry/index.html#/?dataSetId=DeF&orgUnitId=AbC&periodId=202603");
  expect(lienSaisieDhis2("https://dhis2.test", "2.38", { ou: "AbC" })).toBe("https://dhis2.test/dhis-web-dataentry/index.action");
  expect(lienSaisieDhis2("", "2.40", {})).toBeNull();
});

test("qualité : valeurs négatives et nettoyage de la liste des formulaires suivis", () => {
  expect(valeursNegatives([{ valeur: 3 }, { valeur: -2 }, { valeur: NaN }])).toEqual([{ valeur: -2 }]);
  expect(nettoyerFormulaires([{ uid: "FoRmUlAiRe1", nom: "  Paludisme " }, { uid: "court", nom: "x" }, { uid: "FoRmUlAiRe2", nom: "" }]))
    .toEqual([{ uid: "FoRmUlAiRe1", nom: "Paludisme", ordre: 0 }, { uid: "FoRmUlAiRe2", nom: "FoRmUlAiRe2", ordre: 1 }]);
});

test("Sokhna Ci : résumé calculé (moyennes, 3 plus faibles, 2 meilleures, retards, violations), sans tableau brut", async () => {
  const { resumePourSokhnaci } = await import("../../web/src/resume-live.js");
  expect(resumePourSokhnaci(null, null)).toBeNull();
  const lignes = ["Dakar:100:95:90", "Kolda:100:50:20", "Matam:100:70:60", "Thiès:100:99:99"].map((x) => {
    const [unite, attendus, recus, aTemps] = x.split(":");
    return { unite, formulaire: "Paludisme", formulaireUid: "FoRmUlAiRe1", attendus: +attendus, recus: +recus, aTemps: +aTemps };
  });
  const r = resumePourSokhnaci({
    lignes, etat: { annees: [2026], mois: [10], periodicite: "M", niveau: "region", unites: [], desagregations: {} }, misAJour: "2026-11-23T09:05:00",
    synthese: [{ formulaire: "Paludisme", attendus: 400, recus: 314, aTemps: 269, promptitude: 67.3 }], violations: 4,
  }, { programme: "Mère", misAJour: "2026-11-23T09:05:00", tableau: [
    { nom: "CPN4", valeur: 60, cible: 80, periode: "202610", variation: { ecart: 2 } },
    { nom: "Accouchements assistés", valeur: 78, cible: 80, periode: "202610", variation: { ecart: -1 } },
  ] });
  expect(r.qualite_des_donnees).toMatchObject({
    mise_a_jour: "Mis à jour le 23/11/2026 à 09:05", completude_moyenne: 78.5, promptitude_moyenne: 67.3, rapports_manquants: 86,
    unites_les_plus_faibles: [{ nom: "Kolda", completude: 50 }, { nom: "Matam", completude: 70 }, { nom: "Dakar", completude: 95 }],
    unites_les_meilleures: [{ nom: "Thiès", completude: 99 }, { nom: "Dakar", completude: 95 }],
    formulaire_le_plus_en_retard: { nom: "Paludisme", promptitude: 67.3 }, violations_regles_de_validation: 4,
  });
  expect(r.indicateurs_fars.indicateur_le_plus_en_retard).toMatchObject({ nom: "CPN4", valeur: 60, cible: 80 });
});

test("qualité : complétude par district mois par mois et annuelle (reçus / attendus additionnés)", async () => {
  const { tableauDistrictsMensuel } = await import("../../web/src/qualite-calculs.js");
  const l = (f, m, pe, ou, valeur) => ({ dx: `${f}.${m}`, pe, ou, valeur });
  const lignes = [
    l("FoRmUlAiRe1", "EXPECTED_REPORTS", "202601", "DiStRiCt001", 10), l("FoRmUlAiRe1", "ACTUAL_REPORTS", "202601", "DiStRiCt001", 9),
    l("FoRmUlAiRe2", "EXPECTED_REPORTS", "202601", "DiStRiCt001", 10), l("FoRmUlAiRe2", "ACTUAL_REPORTS", "202601", "DiStRiCt001", 5),
    l("FoRmUlAiRe1", "EXPECTED_REPORTS", "202602", "DiStRiCt001", 10), // aucun reçu en février
    l("FoRmUlAiRe1", "EXPECTED_REPORTS", "202601", "DiStRiCt002", 4), l("FoRmUlAiRe1", "ACTUAL_REPORTS", "202601", "DiStRiCt002", 4),
  ];
  const t = tableauDistrictsMensuel(lignes, ["FoRmUlAiRe1", "FoRmUlAiRe2"], [{ id: "DiStRiCt001", nom: "Pikine", region: "Dakar" }, { id: "DiStRiCt002", nom: "Kolda", region: "Kolda" }, { id: "DiStRiCt003", nom: "Vide" }], ["202601", "202602"]);
  expect(t[0]).toMatchObject({ district: "Pikine", parMois: [70, 0], annuel: 46.7, manquants: 16 });
  expect(t[1]).toMatchObject({ district: "Kolda", parMois: [100, null], annuel: 100, manquants: 0 });
  expect(t[2]).toMatchObject({ district: "Vide", parMois: [null, null], annuel: null }); // rien d'attendu : non disponible, pas 0
});

test("qualité : taux moyens (moyenne simple des formulaires), cases d'un formulaire, exhaustivité, niveau des structures", async () => {
  const { casesDuFormulaire, exhaustiviteFormulaire, niveauStructures, tauxMoyens } = await import("../../web/src/qualite-calculs.js");
  // Chaque formulaire compte pour un : (50 + 100) / 2 = 75, et non (50 + 10) / (100 + 10).
  const synthese = [{ formulaireUid: "A", completude: 50, promptitude: 20 }, { formulaireUid: "B", completude: 100, promptitude: 90 }, { formulaireUid: "C", completude: null, promptitude: null }];
  expect(tauxMoyens(synthese)).toMatchObject({ completude: 75, promptitude: 55, exhaustivite: null, formulaires: 2 });
  expect(tauxMoyens(synthese, new Map([["A", { taux: 30 }], ["B", { taux: 61 }]])).exhaustivite).toBe(45.5);
  // Les cases texte ne comptent pas ; la combinaison de catégories du formulaire l'emporte sur celle de l'élément.
  expect(casesDuFormulaire([
    { dataElement: { id: "d1", valueType: "INTEGER_ZERO_OR_POSITIVE", categoryCombo: { categoryOptionCombos: 4 } } },
    { categoryCombo: { categoryOptionCombos: 2 }, dataElement: { id: "d2", valueType: "NUMBER", categoryCombo: { categoryOptionCombos: 6 } } },
    { dataElement: { id: "d3", valueType: "TEXT", categoryCombo: { categoryOptionCombos: 1 } } },
  ])).toMatchObject({ elements: ["d1", "d2"], cases: 6, nonMesurables: [{ id: "d3" }] });
  // Les champs « Oui / Non » comptent ; les cases « Oui seulement » et les dates sont écartées avec la raison.
  const oui = casesDuFormulaire([{ dataElement: { id: "b1", valueType: "BOOLEAN" } }, { dataElement: { id: "t1", valueType: "TRUE_ONLY" } }, { dataElement: { id: "dt", valueType: "DATE" } }]);
  expect(oui.elements).toEqual(["b1"]);
  expect(oui.nonMesurables.map((c) => c.raison).join(" ")).toMatch(/Oui seulement.*date/);
  // Seules les structures qui ont envoyé le formulaire comptent ; plafond de 100 % par structure.
  const r = exhaustiviteFormulaire(new Map([["s1", 2], ["s2", 1], ["s3", 0]]), new Map([["s1", 30], ["s2", 3], ["autre", 99]]), 10);
  expect(r).toEqual({ valeurs: 23, casesAttendues: 30, taux: 76.7 });
  expect(exhaustiviteFormulaire(new Map(), new Map(), 10).taux).toBeNull();
  expect(niveauStructures([{ level: 1, displayName: "National" }, { level: 4, displayName: "Formation sanitaire" }, { level: 6, displayName: "Level 6" }])).toBe(4);
  expect(niveauStructures([{ level: 1, displayName: "A" }, { level: 3, displayName: "B" }])).toBe(3);
});

test("qualité : exhaustivité par champ et par partie du formulaire", async () => {
  const { exhaustiviteParChamp, exhaustiviteParSection } = await import("../../web/src/qualite-calculs.js");
  const rapports = new Map([["s1", 2], ["s2", 1], ["s3", 0]]);
  const comptes = new Map([["a", new Map([["s1", 4], ["s2", 9], ["autre", 50]])], ["b", new Map([["s1", 1]])]]);
  const champs = exhaustiviteParChamp(rapports, comptes, [{ id: "a", nom: "Consultations", cases: 2 }, { id: "b", nom: "Décès", cases: 1 }, { id: "c", nom: "Ruptures", cases: 1 }]);
  // a : s1 4 (plafond 4) + s2 9 → plafonné à 2 = 6 / 6 ; b : 1 / 3 ; c : 0 / 3 (jamais rempli) en premier.
  expect(champs.map((c) => [c.id, c.valeurs, c.attendues, c.taux])).toEqual([["c", 0, 3, 0], ["b", 1, 3, 33.3], ["a", 6, 6, 100]]);
  const parties = exhaustiviteParSection([{ displayName: "Consultation", dataElements: [{ id: "a" }, { id: "b" }] }], champs);
  expect(parties).toEqual([
    { nom: "Consultation", champs: 2, jamais: 0, valeurs: 7, attendues: 9, taux: 77.8 },
    { nom: "Autres champs", champs: 1, jamais: 1, valeurs: 0, attendues: 3, taux: 0 },
  ]);
  expect(exhaustiviteParSection([], champs)[0].nom).toBe("Formulaire entier");
});
