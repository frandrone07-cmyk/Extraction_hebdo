// Indicateurs FARS : calculs (fonctions pures) et page dans le navigateur avec un serveur intermédiaire SIMULÉ
// (réponses DHIS2 fictives utilisées uniquement dans ce test).
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { categoriesDisponibles, elementsDeLExpression, programmes, statutCible, tableauIndicateurs, variation } from "../../web/src/fars-calculs.js";
import { nettoyerIndicateurs } from "../../web/src/fars-config.js";
import { periodePrecedente } from "../../web/src/filtres-globaux.js";

test("FARS : éléments de données d'une expression et catégories communes", () => {
  expect(elementsDeLExpression("#{DeElement01.CoCombo0001} + #{DeElement02}", "#{DeElement01.*}*100")).toEqual(["DeElement01", "DeElement02"]);
  const age = { id: "CaTAge00001", displayName: "Âge", categoryOptions: [{ id: "OpT00000001", displayName: "< 5 ans" }] };
  const sexe = { id: "CaTSexe0001", displayName: "Sexe", categoryOptions: [] };
  const def = { id: "CaTDefault1", displayName: "default", categoryOptions: [] };
  expect(categoriesDisponibles([{ categoryCombo: { categories: [age, sexe] } }, { categoryCombo: { categories: [age] } }]))
    .toEqual([{ id: "CaTAge00001", nom: "Âge", options: [{ id: "OpT00000001", nom: "< 5 ans" }] }]);
  expect(categoriesDisponibles([{ categoryCombo: { categories: [def] } }])).toEqual([]);
});

test("FARS : cible, variation, tableau multi-indicateurs sans valeur inventée", () => {
  expect(statutCible(80, 80)).toBe("conforme");
  expect(statutCible(65, 80)).toBe("surveiller");
  expect(statutCible(50, 80)).toBe("critique");
  expect(statutCible(50, null)).toBe("inconnu");
  expect(variation(72.5, 70)).toEqual({ ecart: 2.5, sens: "hausse", fleche: "▲" });
  expect(variation(70, null).sens).toBeNull();
  const t = tableauIndicateurs([
    { dx: "InDiCaTeUr1", pe: "202609", valeur: 70, numerator: "70", denominator: "100" },
    { dx: "InDiCaTeUr1", pe: "202610", valeur: 75.25, numerator: "301", denominator: "400" },
  ], [{ uid: "InDiCaTeUr1", nom: "CPN4", programme: "Mère" }, { uid: "InDiCaTeUr2", nom: "Vide", programme: "Mère" }], ["202610", "202611"], { InDiCaTeUr1: 80 }, periodePrecedente);
  expect(t[0]).toMatchObject({ periode: "202610", valeur: 75.25, numerateur: 301, denominateur: 400, valeurPrecedente: 70, cible: 80, statut: "surveiller", serie: [75.25, null] });
  expect(t[0].variation.sens).toBe("hausse");
  expect(t[1]).toMatchObject({ periode: null, valeur: null, numerateur: null, statut: "inconnu", serie: [null, null] });
  expect(programmes([{ programme: "B" }, { programme: "A" }, { programme: "B" }, {}])).toEqual(["B", "A", "Sans programme"]);
  expect(nettoyerIndicateurs([{ uid: "InDiCaTeUr1", nom: "CPN4", programme: "", cible: "80,5" }, { uid: "InDiCaTeUr1", nom: "doublon" }, { uid: "x" }]))
    .toEqual({ indicateurs: [{ uid: "InDiCaTeUr1", nom: "CPN4", programme: "Autres" }], cibles: { InDiCaTeUr1: 80.5 } });
});

const require = createRequire(import.meta.url);
const chartJs = await readFile(resolve(dirname(require.resolve("chart.js")), "chart.umd.js"));
const leafletJs = await readFile(require.resolve("leaflet/dist/leaflet.js"));
const PROXY = "https://proxy.simule.test";

async function simulerProxy(page, config) {
  await page.addInitScript((url) => { window.__PROXY_URL__ = url; }, PROXY);
  await page.route(`${PROXY}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (corps) => route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "X-Mis-A-Jour", "X-Mis-A-Jour": "2026-11-23T09:05:00Z" }, body: JSON.stringify(corps) });
    if (url.pathname === "/sante") return json({ configure: true, joignable: true, version: "2.40.4", lienDhis2: "https://dhis2.simule.test" });
    if (url.pathname === "/config") return json(config);
    if (url.pathname === "/api/organisationUnits.json") return json({ organisationUnits: url.searchParams.get("level") === "1" ? [{ id: "PaYs0000001", displayName: "Sénégal" }] : url.searchParams.get("level") === "2" ? [{ id: "ReGiOn00001", displayName: "Dakar" }, { id: "ReGiOn00002", displayName: "Kolda" }] : [] });
    if (url.pathname === "/api/dataSets.json") return json({ dataSets: [] });
    if (url.pathname === "/api/indicators.json") return json({ indicators: [{ id: "InDiCaTeUr1", numerator: "#{DeElement01}", denominator: "#{DeElement02}" }] });
    if (url.pathname === "/api/dataElements.json") return json({ dataElements: [{ id: "DeElement01", categoryCombo: { categories: [{ id: "CaTAge00001", displayName: "Âge", categoryOptions: [{ id: "OpT00000001", displayName: "Moins de 15 ans" }, { id: "OpT00000002", displayName: "15 ans et plus" }] }] } }, { id: "DeElement02", categoryCombo: { categories: [{ id: "CaTAge00001", displayName: "Âge", categoryOptions: [] }] } }] });
    if (url.pathname === "/api/analytics.json") {
      const dims = url.searchParams.getAll("dimension").join("|");
      if (dims.includes("CaTAge00001")) return json({ headers: [{ name: "dx" }, { name: "CaTAge00001" }, { name: "value" }], rows: [["InDiCaTeUr1", "OpT00000001", "40"], ["InDiCaTeUr1", "OpT00000002", "88"]] });
      if (dims.includes("LEVEL-2")) return json({ headers: [{ name: "dx" }, { name: "ou" }, { name: "value" }, { name: "numerator" }, { name: "denominator" }], rows: [["InDiCaTeUr1", "ReGiOn00001", "82", "82", "100"], ["InDiCaTeUr1", "ReGiOn00002", "55", "55", "100"]], metaData: { items: { ReGiOn00001: { name: "Dakar" }, ReGiOn00002: { name: "Kolda" } } } });
      if (dims.includes("pe:")) return json({ headers: [{ name: "dx" }, { name: "pe" }, { name: "value" }, { name: "numerator" }, { name: "denominator" }], rows: [["InDiCaTeUr1", "202609", "70", "70", "100"], ["InDiCaTeUr1", "202610", "75.3", "753", "1000"]] });
      return json({ rows: [] });
    }
    return route.fulfill({ status: 404, body: "{}" });
  });
  await page.route("https://cdnjs.cloudflare.com/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith("/chart.umd.min.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: chartJs });
    if (p.endsWith("/leaflet.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: leafletJs });
    return route.abort();
  });
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
}

test("FARS : onglet avant Sokhna Ci, tableau avec numérateur, dénominateur, variation, cible, comparaison et désagrégation", async ({ page }) => {
  await simulerProxy(page, { formulaires: [], fars: { groupe: null, indicateurs: [{ uid: "InDiCaTeUr1", nom: "CPN4", programme: "Santé de la mère" }], cibles: { InDiCaTeUr1: 80 } } });
  await page.goto("/#tab=fars&fa=2026&fm=9,10");
  const live = page.locator("#fars-live");
  await expect(live.locator(".live-maj")).toContainText("Mis à jour le", { timeout: 20_000 });
  const ligne = live.locator("#fa-tableau tbody tr").first();
  await expect(ligne).toContainText("CPN4");
  await expect(ligne).toContainText("Octobre 2026");
  await expect(ligne).toContainText("753");
  await expect(ligne).toContainText(/1\s000/); // séparateur de milliers français (espace insécable)
  await expect(ligne).toContainText("▲");
  await expect(ligne).toContainText("Proche de la cible");
  await expect(live.locator("#fa-comparaison")).toContainText("Kolda");
  await expect(live.locator("#fa-desagregation")).toContainText("Moins de 15 ans");
  await expect(live.locator('select[data-fa="programme"]')).toHaveValue("Santé de la mère");
});

test("FARS : sans indicateur configuré, la page invite à les choisir (aucun chiffre inventé)", async ({ page }) => {
  await simulerProxy(page, { formulaires: [], fars: { groupe: null, indicateurs: [], cibles: {} } });
  await page.goto("/#tab=fars");
  await expect(page.locator("#fars-live")).toContainText("Aucun indicateur FARS n’est encore configuré", { timeout: 20_000 });
  await expect(page.locator("#fars-live table")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Configurer les indicateurs FARS/ })).toBeVisible();
});
