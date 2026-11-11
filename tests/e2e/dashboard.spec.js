import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const require = createRequire(import.meta.url);
const leafletCss = await readFile(require.resolve("leaflet/dist/leaflet.css"));
const leafletJs = await readFile(require.resolve("leaflet/dist/leaflet.js"));
const chartJs = await readFile(resolve(dirname(require.resolve("chart.js")), "chart.umd.js"));

test.beforeEach(async ({ page }) => {
  await page.route("https://cdnjs.cloudflare.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/leaflet.css")) return route.fulfill({ status: 200, contentType: "text/css", body: leafletCss });
    if (url.pathname.endsWith("/leaflet.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: leafletJs });
    if (url.pathname.endsWith("/chart.umd.min.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: chartJs });
    return route.abort();
  });
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("#contenu")).toHaveAttribute("aria-busy", "false");
  // Attendre le chargement effectif des polices web (DM Sans/Manrope) avant toute
  // capture ou analyse axe-core : sur un runner CI sans cache, le fallback
  // systeme s'affiche parfois assez longtemps pour fausser la mesure de
  // contraste calculee sur les pixels rendus.
  await page.evaluate(() => document.fonts.ready);
});

test("charge les données, relie les filtres à l’URL et ouvre une fiche district", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Complétude des rapports" })).toBeVisible();
  await expect(page.locator("#sel-extraction option")).toHaveCount(6);

  const region = await page.locator("#sel-region option").nth(1).getAttribute("value");
  await page.locator("#sel-region").selectOption(region);
  await expect(page).toHaveURL(/region=/);
  await page.locator("#sel-region").selectOption("");

  await page.getByRole("tab", { name: /Districts/ }).click();
  await expect(page.locator("#table-districts tbody tr")).toHaveCount(79);
  await page.locator("#table-districts [data-district-index]").first().click();
  await expect(page.locator("#drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#drawer")).toBeHidden();
});

test("permet le thème et le mode TV au clavier", async ({ page }) => {
  await page.locator("#btn-theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#btn-tv").click();
  await expect(page.locator("body")).toHaveClass(/tv/);
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/tv/);
});

test("ne présente pas de violations axe-core WCAG A/AA sur la vue et le tableau", async ({ page }) => {
  const axe = () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  const landing = await axe().analyze();
  expect(landing.violations, JSON.stringify(landing.violations, null, 2)).toEqual([]);

  await page.getByRole("tab", { name: /Districts/ }).click();
  const districts = await axe().analyze();
  expect(districts.violations, JSON.stringify(districts.violations, null, 2)).toEqual([]);
});
