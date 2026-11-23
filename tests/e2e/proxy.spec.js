// Tests du serveur intermédiaire DHIS2 (Cloudflare Worker), sans navigateur : les réponses de DHIS2 sont
// SIMULÉES ici uniquement, pour vérifier la lecture seule, la sécurité, le cache et la configuration.
import { pbkdf2Sync } from "node:crypto";
import { test, expect } from "@playwright/test";
import proxy, { routeAutorisee, validerConfig } from "../../dhis2-proxy/index.js";

const ORIGINE = "https://frandrone07-cmyk.github.io";
const SEL = "sel-de-test";
const PIN = "4321";
const HASH = pbkdf2Sync(PIN, SEL, 100000, 32, "sha256").toString("hex");

function environnement(extra = {}) {
  const stockage = new Map();
  return {
    ALLOWED_ORIGIN: `${ORIGINE},http://127.0.0.1:4173`,
    DHIS2_URL: "https://dhis2.test/dhis",
    DHIS2_USER: "lecteur",
    DHIS2_PASS: "secret",
    PIN_SALT: SEL,
    PIN_HASH: HASH,
    CONFIG: { get: async (cle) => stockage.get(cle) ?? null, put: async (cle, valeur) => { stockage.set(cle, valeur); } },
    ...extra,
  };
}

let appels = [];
test.beforeEach(() => {
  appels = [];
  globalThis.fetch = async (url, options = {}) => {
    appels.push({ url: String(url), options });
    if (String(url).includes("/api/system/info")) return new Response(JSON.stringify({ version: "2.40.4", serverDate: "2026-11-23T10:00:00" }));
    if (String(url).includes("/api/analytics")) return new Response(JSON.stringify({ headers: [], rows: [["a", "202610", "95.0"]] }));
    if (String(url).includes("/api/dataAnalysis/validationRules")) return new Response(JSON.stringify([]));
    return new Response(JSON.stringify({ ok: true }));
  };
});

const requete = (chemin, options = {}) => new Request(`https://dhis2-proxy.test/${chemin}`, { ...options, headers: { Origin: ORIGINE, ...(options.headers || {}) } });

test("proxy : seules les routes de lecture (et deux analyses) sont autorisées", () => {
  expect(routeAutorisee("analytics", "GET")).toBe(true);
  expect(routeAutorisee("dataSets.json", "GET")).toBe(true);
  expect(routeAutorisee("indicators/AbCdEfGhIjK", "GET")).toBe(true);
  expect(routeAutorisee("dataAnalysis/validationRules", "POST")).toBe(true);
  expect(routeAutorisee("dataValueSets", "POST")).toBe(false); // écriture de données : interdite
  expect(routeAutorisee("dataValues", "GET")).toBe(false);
  expect(routeAutorisee("users", "GET")).toBe(false); // hors du périmètre
  expect(routeAutorisee("analytics", "DELETE")).toBe(false);
});

test("proxy : relaie une lecture avec les identifiants côté serveur et la date de mise à jour", async () => {
  const reponse = await proxy.fetch(requete("api/analytics?dimension=dx:abc"), environnement(), null);
  expect(reponse.status).toBe(200);
  expect(reponse.headers.get("Access-Control-Allow-Origin")).toBe(ORIGINE);
  expect(reponse.headers.get("X-Mis-A-Jour")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(appels[0].url).toBe("https://dhis2.test/dhis/api/analytics?dimension=dx%3Aabc");
  expect(appels[0].options.headers.Authorization).toBe(`Basic ${Buffer.from("lecteur:secret").toString("base64")}`);
  expect(await reponse.json()).toEqual({ headers: [], rows: [["a", "202610", "95.0"]] });
});

test("proxy : refuse les écritures, les origines inconnues et signale une connexion non configurée", async () => {
  expect((await proxy.fetch(requete("api/dataValueSets", { method: "POST", body: "{}" }), environnement(), null)).status).toBe(403);
  const inconnue = new Request("https://dhis2-proxy.test/api/analytics", { headers: { Origin: "https://pirate.example" } });
  expect((await proxy.fetch(inconnue, environnement(), null)).status).toBe(403);
  const sansSecrets = await proxy.fetch(requete("api/analytics"), environnement({ DHIS2_PASS: "" }), null);
  expect(sansSecrets.status).toBe(503);
  expect((await sansSecrets.json()).erreur).toContain("non configurée");
  expect(appels).toHaveLength(0); // rien n'a été envoyé à DHIS2
});

test("proxy : l'analyse de validation ne peut rien enregistrer dans DHIS2 (persist forcé à false)", async () => {
  await proxy.fetch(requete("api/dataAnalysis/validationRules", { method: "POST", body: JSON.stringify({ ou: "abc", persist: true }) }), environnement(), null);
  expect(JSON.parse(appels[0].options.body)).toMatchObject({ ou: "abc", persist: false, notification: false });
});

test("proxy : état du service et version de DHIS2 lue via /api/system/info", async () => {
  const sante = await (await proxy.fetch(requete("sante"), environnement(), null)).json();
  expect(sante).toMatchObject({ configure: true, joignable: true, version: "2.40.4", lienDhis2: "https://dhis2.test/dhis" });
  const nonConfigure = await (await proxy.fetch(requete("sante"), environnement({ DHIS2_URL: "" }), null)).json();
  expect(nonConfigure.configure).toBe(false);
});

test("proxy : la configuration se lit librement mais ne s'écrit qu'avec le code PIN, et elle est validée", async () => {
  const env = environnement();
  const config = { formulaires: [{ uid: "AbCdEfGhIjK", nom: "Paludisme", ordre: 0 }, { uid: "mauvais", nom: "x" }], fars: { indicateurs: [{ uid: "ZyXwVuTsRqP", nom: "CPN4", programme: "Santé de la mère" }], cibles: { ZyXwVuTsRqP: 80 } } };
  const refus = await proxy.fetch(requete("config", { method: "PUT", body: JSON.stringify(config), headers: { "X-Pin": "0000" } }), env, null);
  expect(refus.status).toBe(401);
  const accepte = await proxy.fetch(requete("config", { method: "PUT", body: JSON.stringify(config), headers: { "X-Pin": PIN } }), env, null);
  expect(accepte.status).toBe(200);
  const lue = await (await proxy.fetch(requete("config"), env, null)).json();
  expect(lue.formulaires).toEqual([{ uid: "AbCdEfGhIjK", nom: "Paludisme", ordre: 0 }]); // l'UID invalide est écarté
  expect(lue.fars.cibles).toEqual({ ZyXwVuTsRqP: 80 });
  expect(validerConfig(null)).toBeNull();
});
