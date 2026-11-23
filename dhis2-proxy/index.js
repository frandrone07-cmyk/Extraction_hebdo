// Serveur intermédiaire DHIS2 (Cloudflare Worker), en LECTURE SEULE.
//
// - Les identifiants DHIS2 (DHIS2_URL, DHIS2_USER, DHIS2_PASS) sont des secrets Cloudflare saisis par
//   l'administrateur (`npx wrangler secret put …`) ; ils ne sont ni dans le dépôt ni dans le navigateur.
//   En local, `wrangler dev` les lit dans le fichier `.dev.vars` (équivalent du `.env`, ignoré par git).
// - Seules des routes de lecture sont relayées. Deux routes d'ANALYSE utilisent POST côté DHIS2
//   (dataAnalysis/validationRules, dataAnalysis/outlier) : elles calculent sans rien enregistrer
//   (« persist » est forcé à false). Aucune autre écriture n'est possible.
// - Réponses mises en cache 10 min (analytics) ou 5 min (métadonnées), avec la date de mise à jour.
// - Configuration du tableau de bord (formulaires suivis, indicateurs FARS, cibles) dans Cloudflare KV,
//   modifiable uniquement avec le code PIN d'administration (PIN_HASH / PIN_SALT, secrets).

const MAX_CORPS = 20000;

// Routes DHIS2 autorisées en lecture (GET). DÉPEND DE LA VERSION DE DHIS2 : `outlierDetection` existe à partir
// de 2.36 ; les versions plus anciennes utilisent `dataAnalysis/outlier` (POST). `validationResults` (lecture
// des résultats enregistrés) existe depuis 2.29.
const LECTURE = [
  /^system\/info(\.json)?$/,
  /^analytics(\.json)?$/,
  /^analytics\/dataValueSet(\.json)?$/,
  /^(dataSets|indicators|indicatorGroups|indicatorTypes|dataElements|dataElementGroups|categoryCombos|categoryOptionCombos|categories|categoryOptions|organisationUnits|organisationUnitLevels|organisationUnitGroups|validationRules|validationRuleGroups|validationResults|programs|periodTypes)(\/[A-Za-z0-9]{11})?(\.json)?$/,
  /^outlierDetection(\.json)?$/,
];
// Analyses autorisées en POST (aucune écriture dans DHIS2).
const ANALYSES = [/^dataAnalysis\/validationRules(\.json)?$/, /^dataAnalysis\/outlier(\.json)?$/];

const CONFIG_PAR_DEFAUT = { formulaires: [], fars: { groupe: null, indicateurs: [], cibles: {} } };

function entetesCors(origine) {
  return origine
    ? {
      "Access-Control-Allow-Origin": origine,
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Pin",
      "Access-Control-Expose-Headers": "X-Mis-A-Jour, X-Cache",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    }
    : { Vary: "Origin" };
}

function json(corps, statut, origine, extra = {}) {
  return new Response(statut === 204 ? null : JSON.stringify(corps), {
    status: statut,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...entetesCors(origine), ...extra },
  });
}

function origineAutorisee(requete, env) {
  const origine = requete.headers.get("Origin");
  const autorisees = String(env.ALLOWED_ORIGIN || "").split(",").map((o) => o.trim()).filter(Boolean);
  return origine && autorisees.includes(origine) ? origine : null;
}

function configure(env) {
  return Boolean(env.DHIS2_URL && env.DHIS2_USER && env.DHIS2_PASS);
}

function enteteAuth(env) {
  return `Basic ${btoa(`${env.DHIS2_USER}:${env.DHIS2_PASS}`)}`;
}

function egaliteConstante(a, b) {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i += 1) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}

export async function verifierPin(pin, env) {
  if (typeof pin !== "string" || pin.length < 4 || pin.length > 32 || !env.PIN_SALT || !env.PIN_HASH) return false;
  const encodeur = new TextEncoder();
  const cle = await crypto.subtle.importKey("raw", encodeur.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encodeur.encode(env.PIN_SALT), iterations: 100000, hash: "SHA-256" }, cle, 256);
  const hex = [...new Uint8Array(bits)].map((v) => v.toString(16).padStart(2, "0")).join("");
  return egaliteConstante(hex, String(env.PIN_HASH).toLowerCase());
}

export function routeAutorisee(chemin, methode) {
  if (methode === "GET") return LECTURE.some((motif) => motif.test(chemin));
  if (methode === "POST") return ANALYSES.some((motif) => motif.test(chemin));
  return false;
}

// Valide la configuration envoyée par l'interface (aucun champ inattendu, tailles bornées).
export function validerConfig(config) {
  if (!config || typeof config !== "object") return null;
  const uid = (v) => typeof v === "string" && /^[A-Za-z0-9]{11}$/.test(v);
  const texte = (v, max = 120) => (typeof v === "string" ? v.slice(0, max) : "");
  const formulaires = Array.isArray(config.formulaires) ? config.formulaires.filter((f) => f && uid(f.uid)).slice(0, 80)
    .map((f, i) => ({ uid: f.uid, nom: texte(f.nom), ordre: Number.isFinite(f.ordre) ? f.ordre : i })) : [];
  const fars = config.fars && typeof config.fars === "object" ? config.fars : {};
  const indicateurs = Array.isArray(fars.indicateurs) ? fars.indicateurs.filter((x) => x && uid(x.uid)).slice(0, 200)
    .map((x) => ({ uid: x.uid, nom: texte(x.nom), programme: texte(x.programme, 60) || "Autres" })) : [];
  const cibles = {};
  for (const [cle, valeur] of Object.entries(fars.cibles || {})) if (uid(cle) && Number.isFinite(Number(valeur))) cibles[cle] = Number(valeur);
  return { formulaires, fars: { groupe: fars.groupe ? texte(fars.groupe) : null, indicateurs, cibles } };
}

async function lireConfig(env) {
  if (!env.CONFIG) return CONFIG_PAR_DEFAUT;
  try { return { ...CONFIG_PAR_DEFAUT, ...(JSON.parse((await env.CONFIG.get("config")) || "{}")) }; } catch { return CONFIG_PAR_DEFAUT; }
}

// Appel DHIS2 avec cache (Cache API de Cloudflare). La date de mise à jour voyage dans X-Mis-A-Jour.
async function appelerDhis2(requete, env, chemin, recherche, contexte) {
  const url = `${String(env.DHIS2_URL).replace(/\/+$/, "")}/api/${chemin}${recherche}`;
  const duree = /^analytics/.test(chemin) ? 600 : 300;
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cleCache = new Request(`https://cache.dhis2-proxy/${chemin}${recherche}`);
  const actualiser = new URL(requete.url).searchParams.get("actualiser") === "1";
  if (cache && !actualiser) {
    const enCache = await cache.match(cleCache);
    if (enCache) return { corps: await enCache.text(), statut: 200, date: enCache.headers.get("X-Mis-A-Jour"), cache: "HIT" };
  }
  const options = { headers: { Authorization: enteteAuth(env), Accept: "application/json" } };
  if (requete.method === "POST") {
    let corps = {};
    try { corps = JSON.parse((await requete.text()).slice(0, MAX_CORPS) || "{}"); } catch { corps = {}; }
    corps.persist = false; // analyse seulement : rien n'est enregistré dans DHIS2
    corps.notification = false;
    options.method = "POST";
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(corps);
  }
  const reponse = await fetch(url, options);
  const corps = await reponse.text();
  const date = new Date().toISOString();
  if (cache && reponse.ok && requete.method === "GET") {
    const aMettre = new Response(corps, { headers: { "Content-Type": "application/json", "Cache-Control": `s-maxage=${duree}`, "X-Mis-A-Jour": date } });
    const mise = cache.put(cleCache, aMettre);
    if (contexte?.waitUntil) contexte.waitUntil(mise); else await mise;
  }
  return { corps, statut: reponse.status, date, cache: "MISS" };
}

export default {
  async fetch(requete, env, contexte) {
    const origine = origineAutorisee(requete, env);
    if (requete.method === "OPTIONS") return json(null, 204, origine);
    if (!origine) return json({ erreur: "origine non autorisée" }, 403, null);
    if (env.PROXY_RATE_LIMIT) {
      const { success } = await env.PROXY_RATE_LIMIT.limit({ key: requete.headers.get("CF-Connecting-IP") || "inconnu" });
      if (!success) return json({ erreur: "trop de requêtes, réessayez dans une minute" }, 429, origine);
    }
    const url = new URL(requete.url);
    const chemin = url.pathname.replace(/^\/+/, "");

    // État du service : configuré ou non, et version de DHIS2 (lue via /api/system/info).
    if (chemin === "sante" && requete.method === "GET") {
      if (!configure(env)) return json({ configure: false, message: "Connexion DHIS2 non configurée (secrets DHIS2_URL, DHIS2_USER, DHIS2_PASS)." }, 200, origine);
      try {
        const r = await appelerDhis2(new Request(`${url.origin}/api/system/info`), env, "system/info", "?fields=version,revision,serverDate", contexte);
        if (r.statut !== 200) return json({ configure: true, joignable: false, message: `DHIS2 a répondu ${r.statut}.` }, 200, origine);
        const info = JSON.parse(r.corps);
        return json({ configure: true, joignable: true, version: info.version, dateServeur: info.serverDate }, 200, origine);
      } catch {
        return json({ configure: true, joignable: false, message: "DHIS2 est injoignable pour le moment." }, 200, origine);
      }
    }

    // Configuration du tableau de bord (formulaires suivis, indicateurs FARS, cibles) : lecture libre, écriture avec PIN.
    if (chemin === "config") {
      if (requete.method === "GET") return json(await lireConfig(env), 200, origine);
      if (requete.method === "PUT") {
        if (!(await verifierPin(requete.headers.get("X-Pin") || "", env))) return json({ erreur: "code PIN incorrect" }, 401, origine);
        if (!env.CONFIG) return json({ erreur: "stockage de configuration absent" }, 500, origine);
        let corps;
        try { corps = JSON.parse((await requete.text()).slice(0, MAX_CORPS)); } catch { return json({ erreur: "JSON invalide" }, 400, origine); }
        const config = validerConfig(corps);
        if (!config) return json({ erreur: "configuration invalide" }, 400, origine);
        await env.CONFIG.put("config", JSON.stringify(config));
        return json(config, 200, origine);
      }
      return json({ erreur: "méthode non autorisée" }, 405, origine);
    }

    // Relais DHIS2 en lecture seule.
    if (chemin.startsWith("api/")) {
      const cheminDhis2 = chemin.slice(4);
      if (!routeAutorisee(cheminDhis2, requete.method)) return json({ erreur: "route DHIS2 non autorisée (lecture seule)" }, 403, origine);
      if (!configure(env)) return json({ erreur: "Connexion DHIS2 non configurée." }, 503, origine);
      const recherche = new URLSearchParams(url.search);
      recherche.delete("actualiser");
      const chaine = recherche.toString() ? `?${recherche}` : "";
      try {
        const r = await appelerDhis2(requete, env, cheminDhis2, chaine, contexte);
        if (r.statut === 401 || r.statut === 403) return json({ erreur: "DHIS2 refuse l'accès (identifiants ou droits)." }, 502, origine);
        if (r.statut >= 400) return json({ erreur: `DHIS2 a répondu ${r.statut}.`, detail: r.corps.slice(0, 300) }, 502, origine);
        return new Response(r.corps, {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Mis-A-Jour": r.date || new Date().toISOString(), "X-Cache": r.cache, ...entetesCors(origine) },
        });
      } catch {
        return json({ erreur: "DHIS2 est injoignable pour le moment." }, 502, origine);
      }
    }
    return json({ erreur: "introuvable" }, 404, origine);
  },
};
