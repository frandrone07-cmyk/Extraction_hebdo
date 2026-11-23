// Page « Qualité des données » dans le navigateur, avec un serveur intermédiaire SIMULÉ (réponses DHIS2 fictives
// utilisées uniquement dans ce test) : affichage, filtres conservés dans l'adresse, erreurs claires.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const chartJs = await readFile(resolve(dirname(require.resolve("chart.js")), "chart.umd.js"));
const leafletJs = await readFile(require.resolve("leaflet/dist/leaflet.js"));
const PROXY = "https://proxy.simule.test";
const FORM = "FoRmUlAiRe1";

const UNITES = {
  1: [{ id: "PaYs0000001", displayName: "Sénégal" }],
  2: [{ id: "ReGiOn00001", displayName: "Dakar", parent: { id: "PaYs0000001" } }, { id: "ReGiOn00002", displayName: "Kolda", parent: { id: "PaYs0000001" } }],
  3: [{ id: "DiStRiCt001", displayName: "Pikine", parent: { id: "ReGiOn00001" } }],
};

async function simulerProxy(page, { configure = true } = {}) {
  await page.addInitScript(([url, form]) => {
    window.__PROXY_URL__ = url;
    if (!localStorage.getItem("suivi-formulaires-v1")) localStorage.setItem("suivi-formulaires-v1", JSON.stringify([{ uid: form, nom: "Paludisme", ordre: 0 }]));
  }, [PROXY, FORM]);
  await page.route(`${PROXY}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (corps, statut = 200) => route.fulfill({ status: statut, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "X-Mis-A-Jour", "X-Mis-A-Jour": "2026-11-23T09:05:00Z" }, body: JSON.stringify(corps) });
    if (url.pathname === "/sante") return json(configure ? { configure: true, joignable: true, version: "2.40.4", lienDhis2: "https://dhis2.simule.test" } : { configure: false, message: "Connexion DHIS2 non configurée." });
    if (url.pathname === "/config") return json({ formulaires: [{ uid: FORM, nom: "Paludisme", ordre: 0 }], fars: { indicateurs: [], cibles: {} } });
    if (url.pathname === "/api/organisationUnits.json") return json({ organisationUnits: UNITES[url.searchParams.get("level")] });
    if (url.pathname === "/api/dataSets.json") return json({ dataSets: [{ id: FORM, displayName: "Paludisme", periodType: "Monthly" }] });
    if (url.pathname === "/api/analytics.json") {
      if (url.searchParams.getAll("dimension").some((d) => d.includes("LAST_10_YEARS"))) return json({ rows: [[`${FORM}.ACTUAL_REPORTS`, "2025", "10"], [`${FORM}.ACTUAL_REPORTS`, "2026", "12"]] });
      // Qualité par district, mois par mois (dx × pe × ou).
      if (url.searchParams.getAll("dimension").some((d) => d.startsWith("pe:")) && url.searchParams.getAll("dimension").some((d) => d.includes("LEVEL-3"))) {
        return json({ headers: [{ name: "dx" }, { name: "pe" }, { name: "ou" }, { name: "value" }], rows: [
          [`${FORM}.EXPECTED_REPORTS`, "202610", "DiStRiCt001", "20"], [`${FORM}.ACTUAL_REPORTS`, "202610", "DiStRiCt001", "12"],
          [`${FORM}.EXPECTED_REPORTS`, "202609", "DiStRiCt001", "20"], [`${FORM}.ACTUAL_REPORTS`, "202609", "DiStRiCt001", "20"]] });
      }
      return json({
        headers: [{ name: "dx" }, { name: "ou" }, { name: "value" }],
        rows: [[`${FORM}.EXPECTED_REPORTS`, "ReGiOn00001", "100"], [`${FORM}.ACTUAL_REPORTS`, "ReGiOn00001", "95"], [`${FORM}.ACTUAL_REPORTS_ON_TIME`, "ReGiOn00001", "60"],
          [`${FORM}.REPORTING_RATE`, "ReGiOn00001", "95"], [`${FORM}.REPORTING_RATE_ON_TIME`, "ReGiOn00001", "60"], [`${FORM}.EXPECTED_REPORTS`, "ReGiOn00002", "30"]],
      });
    }
    if (url.pathname === "/api/dataAnalysis/validationRules") {
      return json([{ validationRuleDescription: "Cas confirmés ≤ cas testés", organisationUnitId: "DiStRiCt001", organisationUnitDisplayName: "Pikine", organisationUnitPath: "/PaYs0000001/ReGiOn00001/DiStRiCt001", periodId: "202610", periodDisplayName: "Octobre 2026", leftSideValue: 12, operator: "<=", rightSideValue: 10, importance: "MEDIUM" }]);
    }
    return json({ erreur: "route non simulée" }, 404);
  });
  await page.route("https://cdnjs.cloudflare.com/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith("/chart.umd.min.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: chartJs });
    if (p.endsWith("/leaflet.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: leafletJs });
    return route.abort();
  });
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
}

test("qualité des données : complétude DHIS2 affichée avec date de mise à jour, liens et contrôle de validation", async ({ page }) => {
  await simulerProxy(page);
  await page.goto("/#tab=qualite");
  const live = page.locator("#qualite-live");
  await expect(live.locator(".live-maj").first()).toContainText(/Mis à jour le \d{2}\/\d{2}\/2026 à \d{2}:\d{2}/, { timeout: 20_000 });
  await expect(page.getByRole("tab", { name: /Qualité des données/ })).toHaveAttribute("aria-selected", "true");
  const synthese = live.locator("#ql-synthese tbody tr").first();
  await expect(synthese).toContainText("Paludisme");
  await expect(synthese).toContainText("130"); // 100 + 30 attendus
  await expect(live.locator("#ql-detail")).toContainText("Dakar");
  // Qualité par district, mensuelle et annuelle : Pikine 100 % en septembre, 60 % en octobre, 80 % sur l'année.
  const districts = live.locator("#ql-table-districts");
  await expect(districts).toContainText("Pikine", { timeout: 20_000 });
  await expect(districts.locator("tbody tr").first()).toContainText("60");
  await expect(districts.locator("tbody tr").first()).toContainText("80,0 %");
  // Kolda : 30 rapports attendus, aucun reçu → listé parmi les unités sans rapport, avec un lien vers DHIS2.
  const sansRapport = live.locator(".card", { hasText: "Unités sans aucun rapport" });
  await expect(sansRapport).toContainText("Kolda");
  await expect(sansRapport.locator('a[target="_blank"]').first()).toHaveAttribute("href", /dhis-web-aggregate-data-entry.*orgUnitId=ReGiOn00002/);
  // Contrôle des règles de validation (analyse en lecture seule).
  await live.getByRole("button", { name: "Lancer le contrôle" }).click();
  await expect(live.locator("#ql-validation-corps")).toContainText("1 violation");
  await expect(live.locator("#ql-validation-corps")).toContainText("Pikine");
});

test("qualité des données : les filtres globaux sont enregistrés dans l'adresse et conservés d'un onglet à l'autre", async ({ page }) => {
  await simulerProxy(page);
  await page.goto("/#tab=qualite");
  const live = page.locator("#qualite-live");
  await expect(live.locator(".filtres-globaux")).toBeVisible({ timeout: 20_000 });
  await live.getByRole("button", { name: "Tout désélectionner" }).click();
  await expect(live.locator("#ql-corps")).toContainText("Aucune période sélectionnée");
  await live.locator('input[name="fg-mois"][value="3"]').check();
  await expect.poll(() => page.evaluate(() => location.hash)).toContain("fm=3");
  await page.getByRole("tab", { name: /Évolution/ }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toContain("fm=3");
  await page.getByRole("tab", { name: /Qualité des données/ }).click();
  await expect(page.locator('#qualite-live input[name="fg-mois"][value="3"]')).toBeChecked({ timeout: 20_000 });
  await expect(page.locator('#qualite-live input[name="fg-mois"][value="4"]')).not.toBeChecked();
});

test("qualité des données : connexion non configurée → message clair, aucun chiffre affiché", async ({ page }) => {
  await simulerProxy(page, { configure: false });
  await page.goto("/#tab=qualite");
  const erreur = page.locator("#qualite-live .live-erreur");
  await expect(erreur).toContainText("pas encore configurée", { timeout: 20_000 });
  await expect(page.locator("#qualite-live table")).toHaveCount(0);
});
