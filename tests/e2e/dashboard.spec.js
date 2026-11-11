import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const require = createRequire(import.meta.url);
const leafletCss = await readFile(require.resolve("leaflet/dist/leaflet.css"));
const leafletJs = await readFile(require.resolve("leaflet/dist/leaflet.js"));
const chartJs = await readFile(resolve(dirname(require.resolve("chart.js")), "chart.umd.js"));
const chartDataLabelsJs = await readFile(require.resolve("chartjs-plugin-datalabels/dist/chartjs-plugin-datalabels.min.js"));

test.beforeEach(async ({ page }) => {
  await page.route("https://cdnjs.cloudflare.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/leaflet.css")) return route.fulfill({ status: 200, contentType: "text/css", body: leafletCss });
    if (url.pathname.endsWith("/leaflet.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: leafletJs });
    if (url.pathname.endsWith("/chart.umd.min.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: chartJs });
    if (url.pathname.endsWith("/chartjs-plugin-datalabels.min.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: chartDataLabelsJs });
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

test("colore les taux des listes selon le statut et les affiche à une décimale", async ({ page }) => {
  const rates = page.locator(".priority-value");
  await expect(rates).not.toHaveCount(0);
  const invalidRates = await rates.evaluateAll((items) => items.flatMap((item) => {
    const status = ["critique", "surveiller", "conforme"].find((name) => item.classList.contains(name));
    const probe = document.createElement("span");
    probe.className = `status-chip ${status}`;
    document.body.append(probe);
    const expectedColor = getComputedStyle(probe).color;
    probe.remove();
    return status && /^\d+,\d%$/.test(item.textContent.trim()) && getComputedStyle(item).color === expectedColor
      ? []
      : [{ status, text: item.textContent.trim(), color: getComputedStyle(item).color, expectedColor }];
  }));
  expect(invalidRates).toEqual([]);
});

test("permet le thème et le mode TV au clavier", async ({ page }) => {
  await page.locator("#btn-theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#btn-tv").click();
  await expect(page.locator("body")).toHaveClass(/tv/);
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/tv/);
});

test("agrandit la carte TV et fait défiler les régions", async ({ page }) => {
  await page.locator("#btn-tv").click();
  await page.locator("#tv-next").click();

  const map = page.locator("#tv-map");
  const region = page.locator("#tv-map-region");
  await expect(map).toBeVisible();
  const firstRegion = await region.textContent();
  const mapHeight = await map.evaluate((element) => element.getBoundingClientRect().height);
  expect(mapHeight).toBeGreaterThan(500);
  await expect.poll(() => region.textContent(), { timeout: 8000 }).not.toBe(firstRegion);
  await expect.poll(() => page.locator(".tv-slide .carte-etiquette-nom").count(), { timeout: 4000 }).toBeGreaterThan(0);
  const mismatchedLabels = await page.locator(".tv-slide .carte-etiquette-nom").evaluateAll((labels) => labels.flatMap((label) => {
    const text = label.querySelector("small")?.textContent?.replace("%", "").replace(",", ".");
    const rate = Number(text);
    const paletteIndex = rate < 70 ? 0 : rate < 90 ? 1 : 2;
    const expectedColor = getComputedStyle(document.querySelectorAll(".tv-map-legend .legend-swatch")[paletteIndex]).backgroundColor;
    const actualColor = label.querySelector("span").style.backgroundColor;
    return actualColor !== expectedColor
      ? [{ rate, actualColor, expectedColor }]
      : [];
  }));
  expect(mismatchedLabels).toEqual([]);
  const priorityRates = await page.locator(".tv-priority b").evaluateAll((items) => items.map((item) => ({
    status: item.classList.contains("critique") ? "critique" : "autre",
    decimal: /^\d+,\d%$/.test(item.textContent.trim()),
  })));
  expect(priorityRates.every((item) => item.status === "critique" && item.decimal)).toBe(true);
  await expect(page.locator(".tv-priority-caption")).toBeVisible();

  await page.locator('.tv-dot[data-slide-index="5"]').click();
  await expect(page.locator(".tv-ranking-row")).toHaveCount(20);
  const invalidRankingRates = await page.locator(".tv-ranking-row b").evaluateAll((items) => items.flatMap((item) => {
    const status = ["critique", "surveiller", "conforme"].find((name) => item.classList.contains(name));
    const probe = document.createElement("span");
    probe.className = `status-chip ${status}`;
    document.body.append(probe);
    const expectedColor = getComputedStyle(probe).color;
    probe.remove();
    return status && /^\d+,\d%$/.test(item.textContent.trim()) && getComputedStyle(item).color === expectedColor
      ? []
      : [{ status, text: item.textContent.trim(), color: getComputedStyle(item).color, expectedColor }];
  }));
  expect(invalidRankingRates).toEqual([]);
});

test("ne présente pas de violations axe-core WCAG A/AA sur la vue et le tableau", async ({ page }) => {
  const axe = () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  const landing = await axe().analyze();
  expect(landing.violations, JSON.stringify(landing.violations, null, 2)).toEqual([]);

  await page.getByRole("tab", { name: /Districts/ }).click();
  const districts = await axe().analyze();
  expect(districts.violations, JSON.stringify(districts.violations, null, 2)).toEqual([]);
});
