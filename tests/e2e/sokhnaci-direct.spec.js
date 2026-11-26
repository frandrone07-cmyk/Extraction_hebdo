// Réponses de Sokhna Ci sur la qualité des données et les indicateurs FARS (fonctions pures, données SIMULÉES ici).
import { test, expect } from "@playwright/test";
import { estQuestionTempsReel, indicateurCite, reponseFars, reponseQualite, sujet } from "../../web/src/sokhnaci-direct.js";

const texte = (r) => r.segments.map((s) => s.texte).join(" ");
const FARS = {
  periodes: ["202601", "202602", "202603", "202604", "202605", "202606"],
  misAJour: "2026-11-26T09:05:00",
  tableau: [
    { id: "a", uid: "IsyZ7w8Qco2", programme: "SRMNIA_Nut", nom: "Taux de couverture en CPN1", cible: 63, sens: "haut", valeur: 78, ecart: 15, numerateur: 153365, denominateur: 395718, statut: "conforme", variation: { sens: "hausse", ecart: 25 } },
    { id: "b", uid: "dX5qyax6WpF", programme: "PEV", nom: "Couverture RR 1", cible: 90, sens: "haut", valeur: 80, ecart: -10, statut: "surveiller", variation: { sens: null } },
    { id: "c", uid: "KmyYP1t3GKG", programme: "Tuberculose", nom: "Taux de décès", cible: 2, sens: "bas", valeur: 3, ecart: 1, statut: "critique", trimestriel: true, variation: { sens: null } },
    { id: "d", uid: null, programme: "MNT", nom: "Nombre de centres de réadaptation cardiaque mis en place dans les EPS", cible: 1, sens: "haut", valeur: null, ecart: null, statut: "inconnu" },
  ],
};

test("Sokhna Ci : reconnaît les questions qualité / FARS sans détourner celles sur la complétude", () => {
  expect(estQuestionTempsReel("situation des indicateurs FARS")).toBe(true);
  expect(estQuestionTempsReel("combien de violations des règles de validation ?")).toBe(true);
  expect(estQuestionTempsReel("quelle est la promptitude ?")).toBe(true);
  expect(estQuestionTempsReel("où en est la couverture RR 1 par rapport à la cible ?")).toBe(true);
  expect(estQuestionTempsReel("quels districts sont en retard ?")).toBe(false);
  expect(estQuestionTempsReel("la complétude de Dakar")).toBe(false);
  expect(sujet("analyse la qualité des données")).toBe("qualite");
  expect(sujet("indicateurs FARS loin de la cible")).toBe("fars");
  expect(indicateurCite("et la couverture RR 1 ?", FARS.tableau).nom).toBe("Couverture RR 1");
  expect(indicateurCite("situation générale", FARS.tableau)).toBeNull();
});

test("Sokhna Ci : bilan FARS (cibles atteintes, retards, sans donnée) avec tableau du canevas", () => {
  const r = reponseFars("situation des indicateurs FARS", FARS);
  expect(texte(r)).toContain("1 indicateur a atteint la cible, 1 est proche et 1 est loin de la cible");
  expect(texte(r)).toContain("« Taux de décès » à 3 pour une cible au plus 2");
  expect(texte(r)).toContain("1 indicateur n’a pas de donnée DHIS2");
  expect(r.visuel.type).toBe("table");
  expect(r.visuel.lignes).toHaveLength(4);
  expect(r.sources.join(" ")).toContain("Janvier 2026 à Juin 2026");
});

test("Sokhna Ci : détail d'un indicateur et indicateur sans donnée (jamais de chiffre inventé)", () => {
  const cpn = texte(reponseFars("donne moi la CPN1", FARS));
  expect(cpn).toContain("réalisation 78");
  expect(cpn).toContain("cible 63");
  expect(cpn).toMatch(/153\s365 sur 395\s718/);
  const vide = texte(reponseFars("centres de réadaptation cardiaque", FARS));
  expect(vide).toContain("n’est pas disponible");
  expect(vide).toContain("pas encore associé");
});

test("Sokhna Ci : analyse de la qualité (complétude, promptitude, plus faibles, meilleures, formulaire en retard, violations)", () => {
  const lignes = [["DRS_Dakar", 100, 95, 90], ["DRS_Kolda", 100, 50, 20], ["DRS_Matam", 100, 70, 60], ["DRS_Thies", 100, 99, 99]].map(([unite, attendus, recus, aTemps]) => ({ unite, formulaire: "Paludisme", attendus, recus, aTemps }));
  const donnees = { periodes: ["202610"], misAJour: "2026-11-26T09:05:00", lignes, synthese: [{ formulaire: "Paludisme", attendus: 400, recus: 314, aTemps: 269, promptitude: 67.3 }], violations: 12,
    violationsDetail: { total: 12, parRegle: [{ nom: "Cas confirmés ≤ cas testés", nombre: 7 }], parRegion: [{ nom: "DRS_Kolda", nombre: 9 }], parDistrict: [{ nom: "Vélingara", nombre: 5 }] } };
  const q = texte(reponseQualite("analyse la qualité des données", donnees));
  expect(q).toContain("complétude 78,5 %");
  expect(q).toContain("promptitude 67,3 %");
  expect(q).toContain("86 rapports manquants sur 400");
  expect(q).toContain("Les plus faibles : Kolda (50 %)");
  expect(q).toContain("Les meilleures : Thies (99 %) et Dakar (95 %)");
  expect(q).toContain("12 violations");
  const v = reponseQualite("combien de violations des règles de validation ?", donnees);
  expect(texte(v)).toContain("« Cas confirmés ≤ cas testés » (7 fois)");
  expect(texte(v)).toContain("Kolda (9)");
  expect(texte(reponseQualite("règles de validation", { ...donnees, violationsDetail: null }))).toContain("se lance automatiquement");
});
