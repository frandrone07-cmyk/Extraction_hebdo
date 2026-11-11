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
  expect(await page.locator(".map-card #carte").evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(500);
});

test("permet le thème et le mode TV au clavier", async ({ page }) => {
  await page.locator("#btn-theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#btn-tv").click();
  await expect(page.locator("body")).toHaveClass(/tv/);
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/tv/);
});

test("parle avec le personnage bébé animé", async ({ page }) => {
  const avatar = page.locator(".sokhnaci-svg");
  await expect(avatar).toHaveAttribute("aria-label", "Bébé Sokhnaci, guide du tableau de bord");
  await page.evaluate(() => {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak = (utterance) => utterance.onstart?.();
  });
  await page.locator(".sokhnaci-speak").click();
  await expect(page.locator(".sokhnaci-widget")).toHaveClass(/speaking/);
  await expect.poll(() => avatar.locator(".baby-arm-left").evaluate((arm) => getComputedStyle(arm).animationName)).toBe("baby-gesture");
  await expect.poll(() => avatar.locator(".baby-mouth-open").evaluate((mouth) => getComputedStyle(mouth).display)).toBe("block");
});

test("montre toute la carte TV puis visite tous les districts", async ({ page }) => {
  const contours = Number((await page.locator(".map-card .card-aside").textContent()).split("/")[0]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.locator("#btn-tv").click();
  await page.locator("#tv-next").click();

  const map = page.locator("#tv-map");
  const progress = page.locator("#tv-map-progress");
  await expect(map).toBeVisible();
  await expect(progress).toContainText("Vue complète");
  const mapHeight = await map.evaluate((element) => element.getBoundingClientRect().height);
  expect(mapHeight).toBeGreaterThan(500);
  await page.evaluate(() => {
    window.__tvTourHistory = [];
    new MutationObserver(() => window.__tvTourHistory.push(document.getElementById("tv-map-progress").textContent))
      .observe(document.getElementById("tv-map-progress"), { childList: true });
  });
  await page.clock.fastForward(3200);
  await expect(progress).toHaveText(new RegExp(`^District 1/${contours} ·`));
  const firstDistrict = (await progress.textContent()).split(" · ")[1].split(" — ")[0];
  await expect(page.locator("#tv-map .leaflet-tooltip")).toContainText(firstDistrict);
  await page.clock.runFor(contours * 1800);
  const visited = await page.evaluate(() => window.__tvTourHistory.filter((item) => item.startsWith("District ")));
  expect(visited).toHaveLength(contours);
  expect(visited.map((item) => Number(item.match(/^District (\d+)\//)[1]))).toEqual(Array.from({ length: contours }, (_, index) => index + 1));
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
