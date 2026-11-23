// Tests des transformations des filtres globaux (fonctions pures, sans navigateur ni DHIS2).
import { test, expect } from "@playwright/test";
import {
  dimensionOu, dimensionsDesagregation, ecrireFiltresUrl, etatParDefaut, libellePeriode, lireFiltresUrl,
  periodePrecedente, periodesDhis2, resumeFiltres,
} from "../../web/src/filtres-globaux.js";

const AUJOURDHUI = new Date(2026, 10, 23); // 23 novembre 2026

test("filtres : état par défaut = année en cours, 12 mois, mensuel, régions", () => {
  expect(etatParDefaut(AUJOURDHUI)).toEqual({ annees: [2026], mois: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], periodicite: "M", niveau: "region", unites: [], desagregations: {} });
});

test("filtres : aller-retour dans l'adresse en conservant les autres paramètres", () => {
  const etat = { annees: [2025, 2026], mois: [1, 2, 3], periodicite: "T", niveau: "district", unites: ["AbCdEfGhIjK"], desagregations: { CaTeGoRiE01: ["OpTiOn00001", "OpTiOn00002"] } };
  const hash = ecrireFiltresUrl(etat, "#tab=qualite&region=Dakar");
  expect(hash).toContain("tab=qualite");
  expect(hash).toContain("region=Dakar");
  expect(lireFiltresUrl(`#${hash}`, AUJOURDHUI)).toEqual(etat);
});

test("filtres : valeurs invalides de l'adresse ignorées (pas d'injection dans les requêtes)", () => {
  const etat = lireFiltresUrl("#fa=1800,2026,abc&fm=0,5,13&fp=X&fn=planete&fu=court,AbCdEfGhIjK&fd=mauvais:x;CaTeGoRiE01:OpTiOn00001+bad", AUJOURDHUI);
  expect(etat).toEqual({ annees: [2026], mois: [5], periodicite: "M", niveau: "region", unites: ["AbCdEfGhIjK"], desagregations: { CaTeGoRiE01: ["OpTiOn00001"] } });
});

test("filtres : périodes DHIS2 mensuelles, trimestrielles, annuelles, sans période future", () => {
  const base = { annees: [2025, 2026], mois: [10, 11, 12], niveau: "region", unites: [], desagregations: {} };
  expect(periodesDhis2({ ...base, periodicite: "M" }, AUJOURDHUI)).toEqual(["202510", "202511", "202512", "202610", "202611"]);
  expect(periodesDhis2({ ...base, periodicite: "T" }, AUJOURDHUI)).toEqual(["2025Q4", "2026Q4"]);
  expect(periodesDhis2({ ...base, periodicite: "A" }, AUJOURDHUI)).toEqual(["2025", "2026"]);
  expect(periodesDhis2({ ...base, annees: [2027], periodicite: "M" }, AUJOURDHUI)).toEqual([]);
  expect(periodesDhis2({ ...base, mois: [], periodicite: "M" }, AUJOURDHUI)).toEqual([]);
});

test("filtres : libellés et période précédente", () => {
  expect(libellePeriode("202603")).toBe("Mars 2026");
  expect(libellePeriode("2026Q1")).toBe("1er trimestre 2026");
  expect(libellePeriode("2026Q3")).toBe("3e trimestre 2026");
  expect(periodePrecedente("202601")).toBe("202512");
  expect(periodePrecedente("202607")).toBe("202606");
  expect(periodePrecedente("2026Q1")).toBe("2025Q4");
  expect(periodePrecedente("2026")).toBe("2025");
  expect(periodePrecedente("n'importe")).toBeNull();
});

test("filtres : dimensions ou et désagrégations pour /api/analytics", () => {
  const etat = etatParDefaut(AUJOURDHUI);
  expect(dimensionOu(etat, "RaCiNe00001")).toBe("ou:RaCiNe00001;LEVEL-2");
  expect(dimensionOu({ ...etat, niveau: "district" }, "RaCiNe00001")).toBe("ou:RaCiNe00001;LEVEL-3");
  expect(dimensionOu({ ...etat, niveau: "pays" }, "RaCiNe00001")).toBe("ou:RaCiNe00001");
  expect(dimensionOu({ ...etat, unites: ["AbCdEfGhIjK", "ZyXwVuTsRqP"] }, "RaCiNe00001")).toBe("ou:AbCdEfGhIjK;ZyXwVuTsRqP");
  expect(dimensionsDesagregation({ ...etat, desagregations: { CaTeGoRiE01: ["OpTiOn00001", "OpTiOn00002"], Vide0000001: [] } })).toEqual(["CaTeGoRiE01:OpTiOn00001;OpTiOn00002"]);
  expect(resumeFiltres(etat)).toBe("2026 · tous les mois · mensuelle · région (drs)");
});
