import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test, expect } from "@playwright/test";

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
  await page.evaluate(() => document.fonts.ready);
});

async function ouvrirEspace(page) {
  await page.getByRole("tab", { name: "Sokhna Ci AI" }).click();
  await expect(page.locator("#sna")).toBeVisible();
}
async function poserEspace(page, question) {
  await page.locator("#sna-question").fill(question);
  await page.locator("#sna-question").press("Enter");
}

test("l'onglet Sokhna Ci AI vient en dernière position, après Qualité et méthode", async ({ page }) => {
  const noms = (await page.locator('[role="tab"][data-tab]').allInnerTexts()).map((texte) => texte.replace(/^\S\s+/, "").trim());
  expect(noms.at(-1)).toBe("Sokhna Ci AI");
  expect(noms.at(-2)).toBe("Qualité et méthode");
});

test("le modèle de données se construit vite (index par district, plus de balayage quadratique)", async ({ page }) => {
  const duree = await page.evaluate(async () => {
    const { chargerDonnees, construireModele } = await import("/src/data.js");
    const donnees = await chargerDonnees();
    const semaine = donnees.latest.semaine_cle;
    const debut = performance.now();
    for (let i = 0; i < 3; i += 1) construireModele(donnees.snapshot, semaine, "none", { region: "", periode: "*", formulaire: "" }, donnees.evolution, donnees.geo, donnees.geoRegions);
    return (performance.now() - debut) / 3;
  });
  expect(duree).toBeLessThan(600);
});

test("les gestes suivent le contenu de la phrase et se placent au bon moment", async ({ page }) => {
  const resultat = await page.evaluate(async () => {
    const { planifierGestes, gesteA } = await import("/src/sokhnaci-gestes.js");
    const salut = planifierGestes("Bonjour ! Voici la situation : 34,8 % de taux moyen, c’est critique.");
    const question = planifierGestes("Y a-t-il des éclaircissements à apporter, ou des questions à poser ?");
    const neutre = planifierGestes("Les lignes sont triées par ordre alphabétique.", "geste_rassurant");
    const script = planifierGestes("Phrase sans mot clé particulier.", "salut_main");
    return {
      salut: salut.map((e) => e.geste),
      debutSalut: gesteA(salut, 0.0),
      ordre: salut.every((e, i) => i === 0 || e.debut >= salut[i - 1].debut),
      chevauche: salut.some((e, i) => i > 0 && e.debut < salut[i - 1].fin - 1e-9),
      question: question.map((e) => e.geste),
      neutre,
      script: script.map((e) => e.geste),
    };
  });
  expect(resultat.salut[0]).toBe("salut_main");
  expect(resultat.salut).toContain("pointer_ecran");
  expect(resultat.salut).toContain("geste_rassurant");
  expect(resultat.debutSalut).toBe("salut_main");
  expect(resultat.ordre).toBe(true);
  expect(resultat.chevauche).toBe(false);
  expect(resultat.question).toContain("inclinaison_ecoute");
  expect(resultat.neutre).toEqual([]); // un geste de script trop générique n'est pas imposé sans raison
  expect(resultat.script).toEqual(["salut_main"]);
});

test("avatar 3D : la main et la tête marquent les mots appuyés et la boucle résiste aux images en retard", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => { window.__sokhnaci3d = true; });
  await page.reload();
  await expect(page.locator("#contenu")).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
  await ouvrirEspace(page);
  await expect(page.locator(".sna-scene.trois-d")).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => { const a = document.getElementById("sna-acteur"); a.classList.add("speaking"); a.dataset.geste = ""; a.dataset.sync = "audio"; a.style.setProperty("--bouche", "1.6"); });
  await expect.poll(() => page.evaluate(() => window.__sna3d.etat().os.rightLowerArm[1]), { timeout: 8000 }).toBeLessThan(-0.35);
  await page.evaluate(() => { const a = document.getElementById("sna-acteur"); a.classList.remove("speaking"); a.dataset.sync = ""; });
  // Une page lente ne doit jamais faire diverger les rotations (valeurs finies et raisonnables).
  await page.evaluate(() => new Promise((fini) => { const fin = performance.now() + 400; while (performance.now() < fin) { /* bloque le fil principal */ } fini(); }));
  await page.waitForTimeout(600);
  const os = await page.evaluate(() => window.__sna3d.etat().os);
  for (const valeurs of Object.values(os)) for (const v of valeurs) { expect(Number.isFinite(v)).toBe(true); expect(Math.abs(v)).toBeLessThan(4); }
});

test("service d'IA : une seule nouvelle tentative, réponses en cache et coupe-circuit après des échecs répétés", async ({ page }) => {
  await page.addInitScript(() => { window.__SOKHNACI_ASSISTANT_URL__ = "https://assistant.test/api"; });
  let appels = 0;
  let mode = "erreur-puis-ok";
  await page.route("https://assistant.test/**", async (route) => {
    const entetes = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: entetes });
    appels += 1;
    if (mode === "erreur" || (mode === "erreur-puis-ok" && appels === 1)) return route.fulfill({ status: 500, headers: entetes, body: "{}" });
    const { faits } = JSON.parse(route.request().postData());
    return route.fulfill({ status: 200, contentType: "application/json", headers: entetes, body: JSON.stringify({ texte: `Selon l’extraction du ${faits.extraction_dhis2}, tout est suivi chaque semaine.` }) });
  });
  await page.reload();
  await expect(page.locator("#contenu")).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
  await ouvrirEspace(page);
  const reponses = page.locator("#sna-historique .sna-assistante");
  const derniere = () => reponses.last();
  const poserEtAttendre = async (question) => {
    const avantMessages = await reponses.count();
    await poserEspace(page, question);
    await expect(reponses).toHaveCount(avantMessages + 1, { timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector("#sna-historique .sna-assistante:last-child") !== null);
  };
  await poserEtAttendre("blabla zorglub");
  await expect(derniere()).toContainText("Selon l’extraction du");
  expect(appels).toBe(2); // un échec, puis une seule nouvelle tentative réussie
  await poserEtAttendre("blabla zorglub");
  await expect(derniere()).toContainText("Selon l’extraction du");
  expect(appels).toBe(2); // même question : réponse en cache, aucun nouvel appel
  mode = "erreur";
  await poserEtAttendre("gloubi boulga un");
  await expect(derniere()).toContainText("Je n’ai pas bien saisi");
  expect(appels).toBe(4); // deux essais (initial + nouvelle tentative)
  await poserEtAttendre("gloubi boulga deux");
  await expect(derniere()).toContainText("Je n’ai pas bien saisi");
  expect(appels).toBe(6);
  await poserEtAttendre("gloubi boulga trois");
  await expect(derniere()).toContainText("Je n’ai pas bien saisi");
  expect(appels).toBe(6); // coupe-circuit : le service n'est plus interrogé pendant quelques minutes
});

test("mode TV : sans autorisation (automatisation) l'assistante est absente et le diaporama garde son rythme", async ({ page }) => {
  await page.locator("#btn-tv").click();
  await expect(page.locator("body")).toHaveClass(/tv/);
  await expect(page.locator(".tv-sna")).toHaveCount(0);
});

test("mode TV : Sokhna Ci commente la situation, retient la diapositive, répond aux questions et demande s'il y en a", async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => { window.__sokhnaciTV = true; });
  await page.reload();
  await expect(page.locator("#contenu")).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
  await page.locator("#btn-tv").click();
  const carte = page.locator(".tv-sna");
  await expect(carte).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/tv-avec-sna/);
  await expect(carte.locator(".tv-sna-soustitre")).toContainText("Voici la situation au", { timeout: 15_000 });
  await expect(carte.locator(".tv-sna-etat")).toHaveText("Je présente…");
  await expect(page.locator("#tv-progress-fill")).toHaveCSS("width", "0px"); // la diapositive est retenue pendant que Sokhna Ci parle
  await expect(page.locator("#tv-counter")).toHaveText("1 / 8");
  // Question au clavier : touche Q, puis réponse issue des données.
  await page.locator("#tv-stage").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("q");
  await expect(carte.locator("input")).toBeFocused();
  await carte.locator("input").fill("quelle région est la plus en retard ?");
  await carte.locator("input").press("Enter");
  await expect(carte.locator(".tv-sna-soustitre")).toContainText("%", { timeout: 20_000 }); // la réponse chiffrée remplace le commentaire
  await expect(page.locator("#tv-counter")).toHaveText("1 / 8");
  // À la fin du cycle, elle demande s'il y a des éclaircissements ou des questions, puis écoute.
  await page.locator("#tv-dots [data-slide-index]").last().click();
  await expect(carte.locator(".tv-sna-soustitre")).toContainText("éclaircissements", { timeout: 60_000 });
  await expect(carte.locator(".tv-sna-etat")).toHaveText("Je vous écoute…", { timeout: 30_000 });
  await expect(page.locator("#tv-counter")).toHaveText("8 / 8");
  // Quitter le mode TV retire l'assistante.
  await page.locator("#tv-close").click();
  await expect(page.locator(".tv-sna")).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveClass(/tv-avec-sna/);
});
