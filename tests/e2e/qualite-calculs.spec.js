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
