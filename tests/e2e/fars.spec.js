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
  expect(statutCible(1.8, 2, "bas")).toBe("conforme"); // cible maximale (ex. taux de décès)
  expect(statutCible(2.4, 2, "bas")).toBe("surveiller");
  expect(statutCible(3, 2, "bas")).toBe("critique");
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
      if (dims.includes("LEVEL-3")) return json({ headers: [{ name: "dx" }, { name: "ou" }, { name: "value" }], rows: [] });
      if (dims.includes("LEVEL-2") && dims.includes("pe:")) return json({ headers: [{ name: "dx" }, { name: "ou" }, { name: "pe" }, { name: "value" }], rows: [["InDiCaTeUr1", "ReGiOn00001", "202609", "81"], ["InDiCaTeUr1", "ReGiOn00001", "202610", "83"], ["InDiCaTeUr1", "ReGiOn00002", "202609", "50"]] });
      if (dims.includes("LEVEL-2")) return json({ headers: [{ name: "dx" }, { name: "ou" }, { name: "value" }, { name: "numerator" }, { name: "denominator" }], rows: [["InDiCaTeUr1", "ReGiOn00001", "82", "82", "100"], ["InDiCaTeUr1", "ReGiOn00002", "55", "55", "100"]], metaData: { items: { ReGiOn00001: { name: "Dakar" }, ReGiOn00002: { name: "Kolda" } } } });
      if (dims.includes("pe:")) return json({ headers: [{ name: "dx" }, { name: "pe" }, { name: "value" }, { name: "numerator" }, { name: "denominator" }], rows: [["InDiCaTeUr1", "202609", "70", "70", "100"], ["InDiCaTeUr1", "202610", "75.3", "753", "1000"]] });
      // Réalisation agrégée sur toute la période (périodes en filtre).
      return json({ headers: [{ name: "dx" }, { name: "value" }, { name: "numerator" }, { name: "denominator" }], rows: [["InDiCaTeUr1", "74", "301", "400"]] });
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

const LISTE = [
  { id: "InDiCaTeUr1", uid: "InDiCaTeUr1", nom: "Taux de couverture en CPN1", programme: "SRMNIA_Nut", cible: 80, sens: "haut" },
  { id: "a-associer-1", uid: null, nom: "Espace ado-jeune", programme: "SRMNIA_Nut", cible: 41.6, sens: "haut" },
];

test("FARS : situation des indicateurs (cible, réalisation, écart, statut), comparaison, désagrégation, retrait", async ({ page }) => {
  await simulerProxy(page, { formulaires: [], fars: { indicateurs: [], cibles: {} } });
  await page.addInitScript((liste) => { if (!sessionStorage.getItem("init")) { localStorage.setItem("suivi-fars-v1", JSON.stringify(liste)); sessionStorage.setItem("init", "1"); } }, LISTE);
  await page.goto("/#tab=fars&fa=2026&fm=9,10");
  const live = page.locator("#fars-live");
  await expect(live.locator(".live-maj")).toContainText("Mis à jour le", { timeout: 20_000 });
  const ligne = live.locator("#fa-tableau tbody tr").first();
  await expect(ligne).toContainText("SRMNIA_Nut");
  await expect(ligne).toContainText("Taux de couverture en CPN1");
  await expect(ligne).toContainText("74"); // réalisation sur toute la période (septembre + octobre)
  await expect(ligne).toContainText("-6"); // écart à la cible
  await expect(ligne).toContainText("301");
  await expect(ligne).toContainText("400");
  await expect(ligne).toContainText("▲");
  await expect(ligne).toContainText("Proche de la cible");
  const aAssocier = live.locator("#fa-tableau tbody tr").nth(1);
  await expect(aAssocier).toContainText("à associer");
  await expect(aAssocier.getByRole("button", { name: "Associer" })).toBeVisible();
  const comparaison = live.locator("#fa-comparaison");
  await expect(comparaison).toContainText("Kolda");
  // Lecture expliquée : régions classées, cible, nombre d'unités qui l'atteignent, plus haute et plus basse.
  await expect(comparaison.locator(".fa-comp-lecture")).toContainText("1 régions sur 2");
  await expect(comparaison.locator(".fa-comp-lecture")).toContainText("Plus haute : Dakar (82)");
  await expect(comparaison.locator(".fa-legende")).toContainText("Cible 80");
  // Mois par mois : barres groupées (2 mois) et tableau coloré selon la cible ; une case sans donnée reste vide.
  await live.getByRole("button", { name: "Mois par mois" }).click();
  await expect(live.getByRole("button", { name: "Mois par mois" })).toHaveAttribute("aria-pressed", "true");
  const chaud = comparaison.locator("table.fa-table-chaude");
  await expect(chaud.locator("tbody tr").first()).toContainText("Dakar");
  await expect(chaud.locator("tbody tr").first().locator("td.conforme")).toHaveCount(3);
  await expect(chaud.locator("tbody tr").nth(1).locator("td.nd")).toHaveCount(1);
  await expect(comparaison.locator("canvas#fa-barres")).toBeVisible();
  // Comparer les districts : nouvelle requête au niveau district (aucun district dans le DHIS2 simulé).
  await live.locator('[data-fa="comparer-par"]').selectOption("district");
  await expect(comparaison).toContainText("Donnée non disponible");
  await expect(live.locator("#fa-desagregation")).toContainText("Moins de 15 ans");
  // Retirer un indicateur du suivi (confirmation acceptée) : la ligne disparaît et le choix est gardé.
  page.once("dialog", (d) => d.accept());
  await aAssocier.getByRole("button", { name: /Retirer/ }).click();
  await expect(live.locator("#fa-tableau tbody tr")).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("suivi-fars-v1")).length)).toBe(1);
  await expect(live.getByRole("button", { name: /Rétablir la liste par défaut/ })).toBeVisible();
});

test("FARS : par défaut, les indicateurs du canevas par programme, sans chiffre inventé", async ({ page }) => {
  await simulerProxy(page, { formulaires: [], fars: { indicateurs: [], cibles: {} } });
  await page.goto("/#tab=fars&fa=2026&fm=9,10");
  const tableau = page.locator("#fa-tableau");
  await expect(tableau).toContainText("Couverture RR 1", { timeout: 20_000 });
  for (const programme of ["SRMNIA_Nut", "Paludisme", "Tuberculose", "PEV", "Santé com.", "MNT", "MTN"]) await expect(tableau.locator("th.fa-programme", { hasText: programme })).toHaveCount(1);
  await expect(tableau).toContainText("Donnée non disponible"); // valeurs absentes du DHIS2 simulé : jamais de faux chiffre
  await expect(page.getByRole("button", { name: /Ajouter un indicateur/ })).toBeVisible();
});

test("Sokhna Ci analyse les indicateurs FARS en direct et montre le tableau du canevas", async ({ page }) => {
  await simulerProxy(page, { formulaires: [], fars: { indicateurs: [], cibles: {} } });
  await page.addInitScript((liste) => { localStorage.setItem("suivi-fars-v1", JSON.stringify(liste)); }, LISTE);
  await page.goto("/#fa=2026&fm=9,10");
  await expect(page.locator("#contenu")).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
  await page.getByRole("tab", { name: "Sokhna Ci AI" }).click();
  await page.locator("#sna-question").fill("situation des indicateurs FARS");
  await page.locator("#sna-question").press("Enter");
  const reponse = page.locator("#sna").getByText(/indicateurs FARS suivis, sur Septembre 2026 à Octobre 2026/);
  await expect(reponse).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#sna .sna-tableau").last()).toContainText("Taux de couverture en CPN1");
  await expect(page.locator("#sna .sna-tableau").last()).toContainText("proche de la cible");
});

test("FARS : chiffres clés, lecture de Sokhna Ci, filtre par statut et clic sur une ligne pour l'analyser", async ({ page }) => {
  await simulerProxy(page, { formulaires: [], fars: { indicateurs: [], cibles: {} } });
  await page.addInitScript((liste) => {
    localStorage.setItem("suivi-fars-v1", JSON.stringify(liste));
    window.__commentaires = [];
    document.addEventListener("sokhnaci:commenter", (e) => window.__commentaires.push(e.detail));
  }, LISTE);
  await page.goto("/#tab=fars&fa=2026&fm=9,10");
  const live = page.locator("#fars-live");
  await expect(live.locator(".lv-kpis")).toContainText("Proches de la cible", { timeout: 20_000 });
  await expect(live.locator(".lv-kpis")).toContainText("Sans donnée");
  // Commentaire vocal envoyé à Sokhna Ci une seule fois ; plus de carte « Lecture de Sokhna Ci » sur la page.
  await expect(live.locator(".lv-lecture")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__commentaires.length)).toBe(1);
  // Filtre « Sans donnée » : seule la ligne à associer reste visible, la cellule Programme suit.
  await live.locator('[data-filtre-statut="nd"]').click();
  await expect(live.locator("#fa-tableau tbody tr:visible")).toHaveCount(1);
  await expect(live.locator("#fa-tableau tbody tr:visible")).toContainText("Espace ado-jeune");
  await expect(live.locator("#fa-tableau tbody tr:visible th.fa-programme")).toHaveCount(1);
  await live.locator('[data-filtre-statut="tous"]').click();
  await expect(live.locator("#fa-tableau tbody tr:visible")).toHaveCount(2);
  // Recherche
  await live.locator('[data-recherche="fars"]').fill("cpn1");
  await expect(live.locator("#fa-tableau tbody tr:visible")).toHaveCount(1);
  await live.locator('[data-recherche="fars"]').fill("");
  // Mini-courbe de tendance et clic sur une ligne : l'analyse détaillée suit.
  await expect(live.locator("#fa-tableau .lv-spark")).toHaveCount(1);
  await live.locator("#fa-tableau tr[data-focus]").first().click();
  await expect(live.locator("#fa-tableau tr.fa-ligne-active")).toHaveCount(1);
});
