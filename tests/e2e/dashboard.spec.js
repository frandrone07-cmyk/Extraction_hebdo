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

// Filtres à cases à cocher : ouvre la liste, ne garde que les valeurs demandées (toutes si liste vide), applique.
async function choisir(page, id, valeurs) {
  await page.locator(`#${id} .mc-bouton`).click();
  await page.locator(`#${id} [data-mc="${valeurs.length ? "rien" : "tout"}"]`).click();
  for (const valeur of valeurs) await page.locator(`#${id} .mc-liste input[value="${valeur}"]`).check();
  await page.locator(`#${id} [data-mc="appliquer"]`).click();
}
const valeurFiltre = (page, id) => page.locator(`#${id}`).evaluate((element) => element.value);

test("charge les données, relie les filtres à l’URL et ouvre une fiche district", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Complétude des rapports" })).toBeVisible();
  await expect.poll(() => page.locator("#sel-extraction option").count()).toBeGreaterThanOrEqual(6);

  const region = await page.locator("#sel-region .mc-liste input").first().getAttribute("value");
  await choisir(page, "sel-region", [region]);
  await expect(page).toHaveURL(/region=/);
  await choisir(page, "sel-region", []);

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
  const dernierePeriode = await page.locator("#sel-periode .mc-liste input").last().getAttribute("value");

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#contenu")).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
  await expect(page.getByRole("tab", { name: /Vue d’ensemble/ })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => valeurFiltre(page, "sel-periode")).toBe(dernierePeriode);
  await expect.poll(() => valeurFiltre(page, "sel-region")).toBe("");
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
  const region = await page.locator("#sel-region .mc-liste input").first().getAttribute("value");
  await page.evaluate(() => {
    window.__mapFitBoundsCalls = [];
    const fitBounds = L.Map.prototype.fitBounds;
    L.Map.prototype.fitBounds = function (bounds, options) {
      window.__mapFitBoundsCalls.push({ map: this.getContainer().id, maxZoom: options?.maxZoom });
      return fitBounds.call(this, bounds, options);
    };
  });

  await choisir(page, "sel-region", [region]);
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
  const period = (await page.locator("#sel-periode .mc-bouton").textContent()).trim();
  await page.locator("#btn-theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#btn-tv").click();
  await expect(page.locator("body")).toHaveClass(/tv/);
  await expect(page.locator("#tv-extraction")).toContainText(extraction);
  await expect(page.locator("#tv-extraction")).toContainText(period);
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/tv/);
});

test("parle avec Sokhnaci animée", async ({ page }) => {
  const avatar = page.locator(".sokhnaci-svg");
  await expect(avatar).toHaveAttribute("aria-label", "Sokhnaci, guide du tableau de bord");
  await expect(page.locator(".sokhnaci-bubble")).toContainText("Salaamalekum");
  await expect(page.locator(".sokhnaci-bubble")).toContainText(/Sokhna Ci/);
  await expect(page.locator(".sokhnaci-bubble")).toContainText(/\d+,\d %/);
  await page.locator(".sokhnaci-ask input").fill("Comment va Dakar Centre ?");
  await page.locator(".sokhnaci-ask input").press("Enter");
  await expect(page.locator(".sokhnaci-bubble")).toContainText("Dakar Centre affiche");
  await page.locator(".sokhnaci-ask input").fill("Quel est le traitement du paludisme");
  await page.locator(".sokhnaci-ask input").press("Enter");
  await expect(page.locator(".sokhnaci-bubble")).toContainText("complétude des rapports");
  await page.evaluate(() => {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak = (utterance) => utterance.onstart?.();
  });
  await page.locator(".sokhnaci-speak").click();
  await expect(page.locator(".sokhnaci-widget")).toHaveClass(/speaking/);
  await expect(page.locator(".sokhnaci-widget")).toHaveAttribute("data-geste", /\w+/);
  await expect.poll(() => avatar.locator(".baby-arm-left, .baby-arm-right").evaluateAll((bras) => bras.some((arm) => getComputedStyle(arm).animationName !== "none"))).toBe(true);
  await expect(page.locator(".sokhnaci-svg .sok-leg-l")).toHaveCount(1);
  await expect.poll(() => avatar.locator(".baby-mouth-open").evaluate((mouth) => getComputedStyle(mouth).display)).toBe("block");
});

test("rend visibles les cellules manquantes par formulaire dans l’onglet qualité", async ({ page }) => {
  await page.getByRole("tab", { name: /Qualité des données/ }).click();
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
  await expect(page.locator("#tv-map .carte-etiquette")).toHaveCount(1);
  await expect(page.locator("#tv-map .leaflet-tooltip")).toHaveCount(0);
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

test("Sokhnaci comprend les noms approximatifs, les questions vagues et la suite de la conversation", async ({ page }) => {
  const poser = async (question) => {
    await page.locator(".sokhnaci-ask input").fill(question);
    await page.locator(".sokhnaci-ask input").press("Enter");
  };
  const bulle = page.locator(".sokhnaci-bubble");
  await poser("situation de Kolta");
  await expect(bulle).toContainText("Je pense que vous parlez de Kolda");
  await poser("et le detail");
  await expect(bulle).toContainText("districts à relancer");
  await poser("qui est en difficulté ?");
  await expect(bulle).toContainText("les plus en retard");
  await poser("blabla");
  await expect(bulle).toContainText("Parlez-vous d’une région, d’un district ou d’un formulaire ?");
  await poser("");
  await expect(bulle).toContainText("Pardon, pouvez-vous répéter ?");
});

test("le bouton micro explique clairement le problème quand la dictée vocale est impossible", async ({ page }) => {
  await page.evaluate(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
  await page.locator(".sokhnaci-mic").click();
  await expect(page.locator(".sokhnaci-bubble")).toContainText("Chrome ou Edge");
  await expect(page.locator(".sokhnaci-bubble")).toContainText("touche Windows + H");
});

test("Sokhnaci interprète les résultats : analyse territoriale, structure du retard et dynamique", async ({ page }) => {
  const bulle = page.locator(".sokhnaci-bubble");
  const poser = async (question) => {
    await page.locator(".sokhnaci-ask input").fill(question);
    await page.locator(".sokhnaci-ask input").press("Enter");
  };
  for (const question of ["fais une analyse des résultats", "pourquoi les taux sont si bas ?", "qu'est-ce qui ne va pas", "fè une analize des resultas"]) {
    await poser(question);
    await expect(bulle).toContainText("Voulez-vous que je détaille un de ces points ?");
  }
  await poser("qui est en difficulté");
  await expect(bulle).toContainText("les plus en retard");
});

test("la voix originale est automatique : pas de choix manuel, l'ancien choix mémorisé est effacé", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("completude-sokhnaci-voix-nom", "Microsoft Julie - French (France)"));
  await page.reload();
  await expect(page.locator("#contenu")).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
  await expect(page.locator(".sokhnaci-voix-choix, .sokhnaci-reglages")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("completude-sokhnaci-voix-nom"))).toBeNull();
  await page.locator(".sokhnaci-ask input").fill("les meilleurs districts");
  await page.locator(".sokhnaci-ask input").press("Enter");
  await expect(page.locator(".sokhnaci-bubble")).toContainText("les meilleurs districts");
  await expect(page.locator(".sokhnaci-voix-statut")).toBeHidden();
});

test("ordres donnés à la carte flottante : les déplacements s'exécutent dans l'espace 3D, le reste sur place", async ({ page }) => {
  const poser = async (question) => {
    await page.locator(".sokhnaci-ask input").fill(question);
    await page.locator(".sokhnaci-ask input").press("Enter");
  };
  await poser("souris");
  await expect(page.locator(".sokhnaci-widget")).toHaveClass(/grand-sourire/);
  await expect(page.locator(".sokhnaci-bubble")).toContainText("Avec plaisir");
  await poser("comment ça marche");
  await expect(page.locator(".sokhnaci-bubble")).toContainText("Demandez-moi");

  await poser("viens ici");
  await expect(page.locator("#sna")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Sokhna Ci AI/ })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => page.locator("#sna-acteur").evaluate((e) => Number(e.style.getPropertyValue("--echelle")))).toBeGreaterThan(1.1);
  await expect(page.locator(".sokhnaci-acteur")).toHaveCount(0);
});

test("interface de Sokhnaci : phrase lue surlignée, bouton arrêter, réduite par défaut sur mobile", async ({ page }) => {
  await page.evaluate(() => {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak = (utterance) => utterance.onstart?.();
  });
  await page.locator(".sokhnaci-speak").click();
  await expect(page.locator(".sokhnaci-bubble .sok-phrase.actif")).toHaveCount(1);
  await expect(page.locator(".sokhnaci-widget")).toHaveClass(/speaking/);
  await page.locator(".sokhnaci-stop").click();
  await expect(page.locator(".sokhnaci-bubble .sok-phrase.actif")).toHaveCount(0);
  await expect(page.locator(".sokhnaci-widget")).not.toHaveClass(/speaking/);

  await page.setViewportSize({ width: 390, height: 780 });
  await page.reload();
  await expect(page.locator("#contenu")).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
  await expect(page.locator(".sokhnaci-widget")).toHaveClass(/collapsed/);
  await page.locator(".sokhnaci-launcher").click();
  await expect(page.locator(".sokhnaci-card")).toBeVisible();
});

async function ouvrirEspace(page) {
  await page.getByRole("tab", { name: /Sokhna Ci AI/ }).click();
  await expect(page.locator("#sna")).toBeVisible();
  await expect(page.locator(".sokhnaci-widget")).toBeHidden();
}
async function poserEspace(page, question) {
  await page.locator("#sna-question").fill(question);
  await page.locator("#sna-question").press("Enter");
}

test("espace Sokhna Ci AI : conversation, visualisations, comparaison, recherche, définition et sources", async ({ page }) => {
  await ouvrirEspace(page);
  const historique = page.locator("#sna-historique");
  await expect(historique).toContainText("Bonjour, je suis Sokhna Ci");
  await expect(page.locator(".sna-point").first()).toBeVisible();

  await poserEspace(page, "fais un graphique des régions");
  await expect(historique.locator(".sna-assistante").last().locator(".sna-graphe canvas")).toHaveCount(1);
  await expect(historique.locator(".sna-assistante").last().locator(".sna-sources summary")).toContainText("Sources utilisées");

  await poserEspace(page, "compare Kolda et Thiès");
  await expect(historique.locator(".sna-assistante").last()).toContainText("devance");
  await expect(historique.locator(".sna-assistante").last().locator("table")).toContainText("Kolda");

  await poserEspace(page, "statistiques");
  await expect(historique.locator(".sna-assistante").last().locator("table")).toContainText("Médiane");

  await poserEspace(page, "cherche paludisme");
  await expect(historique.locator(".sna-assistante").last().locator("tbody tr")).toHaveCount(3);

  await poserEspace(page, "c'est quoi un seuil critique");
  await expect(historique.locator(".sna-assistante").last()).toContainText("70");
  await page.locator('[data-niveau="expert"]').click();
  await poserEspace(page, "c'est quoi un seuil critique");
  await expect(historique.locator(".sna-assistante").last()).toContainText("configurables");

  await poserEspace(page, "fais une analyse territoriale");
  await expect(historique.locator(".sna-assistante").last().locator(".sna-graphe canvas")).toHaveCount(1);
});

test("espace Sokhna Ci AI : l'avatar obéit aux ordres dans sa scène, change de tenue et peut être masqué", async ({ page }) => {
  await ouvrirEspace(page);
  const acteur = page.locator("#sna-acteur");
  await expect(acteur.locator(".sokhnaci-svg")).toHaveCount(1);

  await poserEspace(page, "viens ici");
  await expect.poll(() => acteur.evaluate((e) => Number(e.style.getPropertyValue("--echelle")))).toBeGreaterThan(1.1);
  await poserEspace(page, "marche");
  await expect(acteur).toHaveClass(/walking/, { timeout: 8000 });
  await poserEspace(page, "arrête-toi");
  await expect(acteur).not.toHaveClass(/walking/, { timeout: 8000 });
  await poserEspace(page, "assieds-toi");
  await expect(acteur).toHaveClass(/assise/);
  await poserEspace(page, "lève-toi");
  await expect(acteur).not.toHaveClass(/assise/);
  await poserEspace(page, "danse");
  await expect(acteur).toHaveClass(/danse/);
  await poserEspace(page, "présente les résultats");
  await expect(page.locator("#sna-historique .sna-assistante").last()).toContainText("Salaamalekum");

  await page.locator("#sna-tenue").selectOption("bazin");
  await expect(page.locator("html")).toHaveAttribute("data-tenue", "bazin");
  await page.locator("#sna-avatar-bascule").click();
  await expect(page.locator("#sna")).toHaveClass(/sans-avatar/);
  await expect(page.locator(".sna-scene")).toBeHidden();
  await poserEspace(page, "les meilleurs districts");
  await expect(page.locator("#sna-historique .sna-assistante").last()).toContainText("meilleurs");
});

test("espace Sokhna Ci AI : rapports Word, PDF et Excel, export de la conversation, conversation remise à zéro au rechargement", async ({ page }) => {
  await ouvrirEspace(page);
  const [word] = await Promise.all([page.waitForEvent("download"), page.locator('[data-rapport="word"]').click()]);
  expect(word.suggestedFilename()).toMatch(/^Rapport_completude_.*\.doc$/);
  const [excel] = await Promise.all([page.waitForEvent("download"), page.locator('[data-rapport="excel"]').click()]);
  expect(excel.suggestedFilename()).toMatch(/^Rapport_completude_.*\.(xlsx|csv)$/);
  await expect(page.locator("#sna-note-rapport")).not.toHaveText("");

  await poserEspace(page, "statistiques");
  const [conversation] = await Promise.all([page.waitForEvent("download"), page.locator("#sna-exporter-conv").click()]);
  expect(conversation.suggestedFilename()).toMatch(/^Conversation_Sokhna_Ci_.*\.md$/);

  await page.reload();
  await expect(page.locator("#contenu")).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
  await ouvrirEspace(page);
  // Après un rechargement (F5 / Ctrl+F5), la conversation repart à zéro.
  await expect(page.locator("#sna-historique .sna-utilisateur")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("sokhna-ci-ai-historique-v1"))).toBeNull();
  await poserEspace(page, "statistiques");
  await page.getByRole("tab", { name: /Vue d’ensemble/ }).click();
  await ouvrirEspace(page);
  await expect(page.locator("#sna-historique")).toContainText("statistiques"); // conservée en changeant d'onglet
  await page.locator("#sna-nouvelle").click();
  await expect(page.locator("#sna-historique .sna-utilisateur")).toHaveCount(0);
});

test("espace Sokhna Ci AI : fichiers joints analysés localement et images signalées comme non interprétées", async ({ page }) => {
  await ouvrirEspace(page);
  await page.setInputFiles("#sna-fichier", { name: "test.csv", mimeType: "text/csv", buffer: Buffer.from("district;taux\nA;10\nB;30\nC;50\n") });
  await expect(page.locator("#sna-historique")).toContainText("J’ai lu « test.csv » : 3 lignes et 2 colonnes");
  await expect(page.locator("#sna-historique .sna-assistante").last().locator("table")).toContainText("30");
  await poserEspace(page, "cherche B dans le fichier");
  await expect(page.locator("#sna-historique .sna-assistante").last()).toContainText("1 ligne");
  await page.setInputFiles("#sna-image", { name: "photo.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgo=", "base64") });
  await expect(page.locator("#sna-historique")).toContainText("ne sais pas encore interpréter les images");
});

test("espace Sokhna Ci AI : accessibilité WCAG, responsive et mode sombre", async ({ page }) => {
  const axe = () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  await ouvrirEspace(page);
  await poserEspace(page, "fais un graphique des régions");
  await expect(page.locator(".sna-graphe canvas")).toHaveCount(1);
  const v1 = (await axe().analyze()).violations;
  expect(v1.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  await page.locator("#btn-theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.waitForTimeout(700);
  const v2 = (await axe().analyze()).violations;
  expect(v2.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  await page.addStyleTag({ content: "* { font-family: Verdana, sans-serif !important; }" });
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(500);
  const debordement = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(debordement).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 320, height: 780 });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 820, height: 1000 });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test("modèle de langage facultatif : réponse acceptée si les chiffres sont vérifiés, rejetée sinon", async ({ page }) => {
  await page.addInitScript(() => { window.__SOKHNACI_ASSISTANT_URL__ = "https://assistant.test/api"; });
  let mode = "vrai";
  await page.route("https://assistant.test/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" } });
    const { faits } = JSON.parse(route.request().postData());
    const texte = mode === "vrai"
      ? `Selon l’extraction du ${faits.extraction_dhis2}, le taux moyen des districts est de ${String(faits.taux_moyen_districts).replace(".", ",")} %. Cela reste en dessous du seuil de ${faits.seuils.conforme} %.`
      : "Le taux moyen est de 99,9 % selon mes calculs.";
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ texte }) });
  });
  await page.reload();
  await expect(page.locator("#contenu")).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
  await ouvrirEspace(page);
  await poserEspace(page, "blabla zorglub");
  const derniere = page.locator("#sna-historique .sna-assistante").last();
  await expect(derniere).toContainText("Selon l’extraction du");
  await expect(derniere.locator(".sna-sources")).toContainText("modèle de langage", { useInnerText: false });
  mode = "faux";
  await poserEspace(page, "gloubi boulga");
  await expect(page.locator("#sna-historique .sna-assistante").last()).toContainText("Je n’ai pas bien saisi");
  await expect(page.locator("#sna-historique")).not.toContainText("99,9");
});

test("espace Sokhna Ci AI : cartes de compétences et ouverture depuis la carte flottante", async ({ page }) => {
  await page.locator(".sokhnaci-ask input").fill("fais un graphique des régions");
  await page.locator(".sokhnaci-ask input").press("Enter");
  await expect(page.locator("#sna")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Sokhna Ci AI/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#sna-historique .sna-assistante").last().locator(".sna-graphe canvas")).toHaveCount(1);

  await page.locator(".sna-competence", { hasText: "Historique" }).click();
  await expect(page.locator("#sna-historique .sna-assistante").last().locator("table")).toContainText("16 novembre 2026");
  await page.locator(".sna-competence", { hasText: "Comparaisons" }).click();
  await expect(page.locator("#sna-suggestions button").first()).toContainText("compare");
  await page.locator("#sna-suggestions button").first().click();
  await expect(page.locator("#sna-historique .sna-assistante").last()).toContainText("devance");
});

test("avatar 3D libre (CC0) : chargement, ordres, gestes, bouche synchronisée, tenues et repli en 2D", async ({ page }) => {
  test.setTimeout(180_000);
  // La lecture d'accueil ne doit pas animer l'avatar pendant qu'on teste un geste précis.
  await page.addInitScript(() => { window.__sokhnaci3d = true; window.speechSynthesis.speak = (u) => setTimeout(() => u.onend?.(), 0); });
  await page.reload();
  await expect(page.locator("#contenu")).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
  await ouvrirEspace(page);
  await expect(page.locator(".sna-scene.trois-d")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("canvas.sna-canvas-3d")).toHaveCount(1);
  const pixels = await page.evaluate(() => window.__sna3d.lirePixels());
  expect(pixels.opaques).toBeGreaterThan(800);

  await poserEspace(page, "viens ici");
  await expect.poll(() => page.evaluate(() => window.__sna3d.etat().echelle), { timeout: 15_000 }).toBeGreaterThan(1.05);

  await page.evaluate(() => { const a = document.getElementById("sna-acteur"); a.classList.add("speaking"); a.dataset.geste = "salut_main"; a.dataset.emotion = "souriante"; a.dataset.sync = "audio"; a.style.setProperty("--bouche", "1.4"); });
  await expect.poll(() => page.evaluate(() => window.__sna3d.etat().os.rightUpperArm[2]), { timeout: 8000 }).toBeGreaterThan(0.3);
  await expect.poll(() => page.evaluate(() => window.__sna3d.etat().aa), { timeout: 8000 }).toBeGreaterThan(0.4);
  await expect.poll(() => page.evaluate(() => window.__sna3d.etat().happy), { timeout: 8000 }).toBeGreaterThan(0.3);

  await page.evaluate(() => { const a = document.getElementById("sna-acteur"); a.classList.remove("speaking"); a.dataset.sync = ""; a.classList.add("assise"); });
  await expect.poll(() => page.evaluate(() => window.__sna3d.etat().assis), { timeout: 8000 }).toBeGreaterThan(0.5);
  await page.evaluate(() => document.getElementById("sna-acteur").classList.remove("assise"));

  await page.locator("#sna-tenue").selectOption("ankara");
  await expect(page.locator("html")).toHaveAttribute("data-tenue", "ankara");
  expect((await page.evaluate(() => window.__sna3d.lirePixels())).opaques).toBeGreaterThan(800);

  await page.locator("#sna-3d-bascule").click();
  await expect(page.locator(".sna-scene")).not.toHaveClass(/trois-d/);
  await expect(page.locator("canvas.sna-canvas-3d")).toHaveCount(0);
  await expect(page.locator("#sna-acteur .sokhnaci-svg")).toBeVisible();
  await page.locator("#sna-3d-bascule").click();
  await expect(page.locator(".sna-scene.trois-d")).toBeVisible({ timeout: 60_000 });
});

test("sans autorisation 3D (automatisation, économie de données), l'illustration 2D reste affichée", async ({ page }) => {
  await ouvrirEspace(page);
  await expect(page.locator(".sna-scene")).not.toHaveClass(/trois-d/);
  await expect(page.locator("canvas.sna-canvas-3d")).toHaveCount(0);
  await expect(page.locator("#sna-3d-bascule")).toBeHidden();
  await expect(page.locator("#sna-acteur .sokhnaci-svg")).toBeVisible();
});

test("avatar 3D en buste dans la carte flottante, qui voyage vers l'espace puis revient", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => { window.__sokhnaci3d = true; });
  await page.reload();
  await expect(page.locator("#contenu")).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
  await expect(page.locator(".sokhnaci-character.trois-d canvas.sna-canvas-3d")).toHaveCount(1, { timeout: 120_000 });
  await expect(page.locator(".sokhnaci-character .sokhnaci-svg")).toBeHidden();
  expect((await page.evaluate(() => window.__sna3d.lirePixels())).opaques).toBeGreaterThan(300);

  await page.locator(".sokhnaci-espace").click();
  await expect(page.locator("#sna .sna-scene.trois-d canvas.sna-canvas-3d")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator("canvas.sna-canvas-3d")).toHaveCount(1);

  await page.getByRole("tab", { name: /Vue d’ensemble/ }).click();
  await expect(page.locator(".sokhnaci-character.trois-d canvas.sna-canvas-3d")).toHaveCount(1, { timeout: 30_000 });
});

test("compare plusieurs régions et plusieurs mois cochés, conservés dans le lien", async ({ page }) => {
  const regions = await page.locator("#sel-region .mc-liste input").evaluateAll((cases) => cases.slice(0, 2).map((c) => c.value));
  await choisir(page, "sel-region", regions);
  await expect(page.locator("#sel-region .mc-bouton")).toContainText(regions[0].replace(/^DRS[_ ]/, ""));
  await expect.poll(() => valeurFiltre(page, "sel-region")).toBe(regions.join("|"));
  await page.getByRole("tab", { name: /Districts/ }).click();
  const regionsAffichees = await page.locator("#table-districts tbody tr").evaluateAll((lignes) => [...new Set(lignes.map((l) => l.dataset.region))]);
  expect(regionsAffichees.sort()).toEqual([...regions].sort());
  const mois = await page.locator("#sel-periode .mc-liste input").evaluateAll((cases) => cases.slice(-2).map((c) => c.value));
  await choisir(page, "sel-periode", mois);
  await expect(page).toHaveURL(new RegExp(`periode=${mois[0]}`));
  await expect(page.locator("#sel-periode .mc-bouton")).not.toHaveText("Toutes les périodes");
});
