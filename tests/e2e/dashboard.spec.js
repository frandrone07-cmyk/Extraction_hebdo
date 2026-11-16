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
  await expect(page.locator("#contenu")).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
  // Attendre le chargement effectif des polices web (DM Sans/Manrope) avant toute
  // capture ou analyse axe-core : sur un runner CI sans cache, le fallback
  // systeme s'affiche parfois assez longtemps pour fausser la mesure de
  // contraste calculee sur les pixels rendus.
  await page.evaluate(() => document.fonts.ready);
});

test("charge les données, relie les filtres à l’URL et ouvre une fiche district", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Complétude des rapports" })).toBeVisible();
  await expect.poll(() => page.locator("#sel-extraction option").count()).toBeGreaterThanOrEqual(6);

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

test("réinitialise la vue sur F5 tout en conservant les liens de partage directs", async ({ page }) => {
  await page.goto("/#tab=regions&periode=202609");
  await expect(page.getByRole("tab", { name: /Régions et formulaires/ })).toHaveAttribute("aria-selected", "true");
  const dernierePeriode = await page.locator("#sel-periode option").last().getAttribute("value");

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#contenu")).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
  await expect(page.getByRole("tab", { name: /Vue d’ensemble/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#sel-periode")).toHaveValue(dernierePeriode);
  await expect(page.locator("#sel-region")).toHaveValue("");
  await expect(page.locator("body")).not.toHaveClass(/tv/);
  await expect(page).toHaveURL(/#tab=vue$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test("colore les taux des listes selon le statut et les affiche à une décimale", async ({ page }) => {
  const rates = page.locator(".priority-value");
  await expect(rates).not.toHaveCount(0);
  await expect(page.locator(".top-performers .priority-item")).toHaveCount(10);
  await expect(page.locator("#carte-regions")).toBeVisible();
  const regionLabels = await page.locator("#carte-regions .region-rate-label strong").allTextContents();
  const regionRates = await page.locator("#carte-regions .region-rate-label small").allTextContents();
  expect(regionLabels).toHaveLength(14);
  expect(regionRates).toHaveLength(14);
  expect(regionRates.every((rate) => /^\d+,\d%$/.test(rate.trim()))).toBe(true);
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
  await expect(page.locator(".export-link")).toHaveAttribute("href", /Situation_completude_par_region_\d{2}_\d{2}_\d{4}\.xlsx$/);
});

test("affiche l’effectif total au centre du diagramme circulaire", async ({ page }) => {
  const chart = await page.locator("#ch-statuts").evaluate((canvas) => {
    const instance = Chart.getChart(canvas);
    return {
      label: canvas.getAttribute("aria-label"),
      values: instance.data.datasets[0].data,
      plugins: instance.config.plugins.map((plugin) => plugin.id),
    };
  });
  const total = chart.values.reduce((sum, value) => sum + value, 0);
  expect(chart.label).toContain(`${total} districts au total`);
  expect(chart.plugins).toContain("center-label-ch-statuts");
});

test("identifie une région par point et utilise une couleur distincte par région", async ({ page }) => {
  await page.getByRole("tab", { name: /Évolution/ }).click();
  const chart = await page.locator("#ch-evo-regions").evaluate((canvas) => {
    const instance = Chart.getChart(canvas);
    return {
      labels: instance.data.datasets.map((dataset) => dataset.label),
      colors: instance.data.datasets.map((dataset) => dataset.borderColor),
      tooltipMode: instance.options.plugins.tooltip.mode,
      tooltipIntersect: instance.options.plugins.tooltip.intersect,
    };
  });
  expect(chart.labels).toHaveLength(14);
  expect(new Set(chart.colors).size).toBe(14);
  expect(chart.tooltipMode).toBe("nearest");
  expect(chart.tooltipIntersect).toBe(true);
  const point = await page.locator("#ch-evo-regions").evaluate((canvas) => {
    const instance = Chart.getChart(canvas);
    const datasetIndex = instance.data.datasets.findIndex((dataset) => dataset.data.some((value) => value !== null));
    const pointIndex = instance.data.datasets[datasetIndex].data.findIndex((value) => value !== null);
    const position = instance.getDatasetMeta(datasetIndex).data[pointIndex].getProps(["x", "y"], true);
    return { x: position.x, y: position.y, region: instance.data.datasets[datasetIndex].label };
  });
  await page.locator("#ch-evo-regions").scrollIntoViewIfNeeded();
  const bounds = await page.locator("#ch-evo-regions").boundingBox();
  await page.mouse.click(bounds.x + point.x, bounds.y + point.y);
  await expect.poll(() => page.locator("#ch-evo-regions").evaluate((canvas) => (
    Chart.getChart(canvas).tooltip.dataPoints.map((item) => item.dataset.label)
  ))).toEqual([point.region]);
});

test("garde les 14 régions dans l’évolution et zoome les cartes sur la région choisie", async ({ page }) => {
  const regionSelect = page.locator("#sel-region");
  const region = await regionSelect.locator("option").nth(1).getAttribute("value");
  await page.evaluate(() => {
    window.__mapFitBoundsCalls = [];
    const fitBounds = L.Map.prototype.fitBounds;
    L.Map.prototype.fitBounds = function (bounds, options) {
      window.__mapFitBoundsCalls.push({ map: this.getContainer().id, maxZoom: options?.maxZoom });
      return fitBounds.call(this, bounds, options);
    };
  });

  await regionSelect.selectOption(region);
  await expect(page.locator("#carte-regions .region-rate-label strong")).toHaveCount(14);
  const districtLabels = await page.locator("#carte .carte-etiquette-nom span").evaluateAll((labels, selectedRegion) => (
    labels.filter((label) => label.dataset.region === selectedRegion).length
  ), region);
  expect(districtLabels).toBeGreaterThan(0);
  const fitBoundsCalls = await page.evaluate(() => window.__mapFitBoundsCalls);
  expect(fitBoundsCalls).toContainEqual({ map: "carte", maxZoom: 10 });
  expect(fitBoundsCalls).toContainEqual({ map: "carte-regions", maxZoom: 9 });

  await page.getByRole("tab", { name: /Évolution/ }).click();
  const chart = await page.locator("#ch-evo-regions").evaluate((canvas) => {
    const instance = Chart.getChart(canvas);
    return { labels: instance.data.labels, regions: instance.data.datasets.map((dataset) => dataset.label) };
  });
  expect(chart.regions).toHaveLength(14);
  expect(chart.labels.length).toBeGreaterThan(1);
  await expect(page.getByRole("heading", { name: "Évolution par date d’extraction" })).toBeVisible();
});

test("permet le thème et le mode TV au clavier", async ({ page }) => {
  const extraction = (await page.locator("#sous-titre").textContent()).trim();
  const period = (await page.locator("#sel-periode option:checked").textContent()).trim();
  await page.locator("#btn-theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#btn-tv").click();
  await expect(page.locator("body")).toHaveClass(/tv/);
  await expect(page.locator("#tv-extraction")).toContainText(extraction);
  await expect(page.locator("#tv-extraction")).toContainText(period);
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/tv/);
});

test("parle avec le personnage bébé animé", async ({ page }) => {
  const avatar = page.locator(".sokhnaci-svg");
  await expect(avatar).toHaveAttribute("aria-label", "Bébé Sokhnaci, guide du tableau de bord");
  await expect(page.locator(".sokhnaci-bubble")).toContainText("Répartition des 79 districts");
  await expect(page.locator(".sokhnaci-bubble")).toContainText("Action recommandée");
  await page.evaluate(() => {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak = (utterance) => utterance.onstart?.();
  });
  await page.locator(".sokhnaci-speak").click();
  await expect(page.locator(".sokhnaci-widget")).toHaveClass(/speaking/);
  await expect.poll(() => avatar.locator(".baby-arm-left").evaluate((arm) => getComputedStyle(arm).animationName)).toBe("baby-gesture");
  await expect.poll(() => avatar.locator(".baby-mouth-open").evaluate((mouth) => getComputedStyle(mouth).display)).toBe("block");
});

test("rend visibles les cellules manquantes par formulaire dans l’onglet qualité", async ({ page }) => {
  await page.getByRole("tab", { name: /Qualité et méthode/ }).click();
  const rows = page.locator("#table-qualite-formulaires tbody tr[data-empty-count]");
  await expect(rows).toHaveCount(20);
  const missingCounts = await rows.evaluateAll((items) => items.map((item) => Number(item.dataset.emptyCount)));
  expect(missingCounts.some((count) => count > 0)).toBe(true);
  await expect(page.locator("#table-qualite-formulaires details summary").first()).toBeVisible();
  await page.locator("#table-qualite-formulaires details summary").first().click();
  await expect(page.locator("#table-qualite-formulaires .quality-missing-list li").first()).toContainText("·");
});

test("montre toute la carte TV puis visite tous les districts", async ({ page }) => {
  const contours = Number((await page.locator(".map-card .card-aside").first().textContent()).split("/")[0]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.locator("#btn-tv").click();
  await page.locator("#tv-next").click();

  const map = page.locator("#tv-map");
  const regionMap = page.locator("#tv-map-regions");
  const progress = page.locator("#tv-map-progress");
  await expect(map).toBeVisible();
  await expect(regionMap).toBeVisible();
  await expect(progress).toContainText("Vue complète");
  const mapHeight = await map.evaluate((element) => element.getBoundingClientRect().height);
  expect(mapHeight).toBeGreaterThan(500);
  await page.evaluate(() => {
    window.__tvTourHistory = [];
    new MutationObserver(() => window.__tvTourHistory.push(document.getElementById("tv-map-progress").textContent))
      .observe(document.getElementById("tv-map-progress"), { childList: true });
  });
  await page.clock.fastForward(3200);
  await expect(progress).toContainText(/Région 1\/\d+ · .* — District 1\//);
  const firstDistrict = (await progress.getAttribute("data-district")).split("||")[1];
  await expect(page.locator("#tv-map .leaflet-tooltip")).toContainText(firstDistrict);
  await expect(page.locator("#tv-map .carte-etiquette-active")).toContainText(firstDistrict);
  await expect(page.locator("#tv-tour-districts .active")).toContainText(firstDistrict);
  await expect(page.locator("#tv-tour-districts .tv-tour-district")).not.toHaveCount(0);
  await page.clock.runFor(contours * 1800);
  const visited = await page.evaluate(() => window.__tvTourHistory.filter((item) => item.includes("— District ")));
  expect(visited).toHaveLength(contours);
  expect(visited.every((item) => /^Région \d+\/\d+ · .* — District \d+\/\d+ · .+/.test(item))).toBe(true);
  const priorityRates = await page.locator(".tv-priority b").evaluateAll((items) => items.map((item) => ({
    status: item.classList.contains("critique") ? "critique" : "autre",
    decimal: /^\d+,\d%$/.test(item.textContent.trim()),
  })));
  expect(priorityRates.every((item) => item.status === "critique" && item.decimal)).toBe(true);
  await expect(page.locator(".tv-map-details .tv-priority-caption")).toBeVisible();

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
