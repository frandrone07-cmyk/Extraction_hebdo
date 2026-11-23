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

// Messages clairs selon la réponse de DHIS2 (aucun secret n'y figure, seulement le nom du serveur).
function nomServeur(env) { try { return new URL(String(env.DHIS2_URL).trim()).host; } catch { return "adresse DHIS2_URL invalide"; } }
// Le texte de l'erreur n'est jamais recopié tel quel : il peut contenir la valeur d'un secret (ex. adresse mal saisie).
function messageErreur(env, erreur) {
  const hote = nomServeur(env);
  if (hote === "adresse DHIS2_URL invalide") return "Le secret DHIS2_URL ne contient pas une adresse web valide (attendu : https://senegal.dhis2.org/dhis). Ressaisissez-le avec « npx wrangler secret put DHIS2_URL ».";
  return `DHIS2 (${hote}) est injoignable depuis le serveur intermédiaire${erreur?.name ? ` (${String(erreur.name).slice(0, 40)})` : ""}.`;
}
function diagnostic(statut) {
  if (statut === 401) return "DHIS2 refuse l’identifiant ou le mot de passe (401) : vérifiez DHIS2_USER et DHIS2_PASS.";
  if (statut === 403) return "Le compte DHIS2 n’a pas le droit de lire ces données (403).";
  if (statut >= 300 && statut < 400) return `DHIS2 redirige la requête (${statut}) : identifiants refusés ou adresse DHIS2_URL incomplète (ex. https://senegal.dhis2.org/dhis).`;
  if (statut === 404) return "Adresse DHIS2 introuvable (404) : vérifiez DHIS2_URL.";
  return `DHIS2 a répondu ${statut}.`;
}

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

// Identifiants DHIS2 synchronisés depuis les secrets GitHub (les mêmes que l'extraction de complétude) par le
// workflow « Configurer le proxy DHIS2 ». Stockés dans KV (privé au compte Cloudflare) ; ils priment sur les
// secrets saisis à la main. Mémorisés une minute pour éviter une lecture KV à chaque requête.
const memoIdentifiants = new WeakMap(); // par espace KV
async function avecIdentifiants(env) {
  if (!env.CONFIG) return env;
  let memo = memoIdentifiants.get(env.CONFIG);
  if (!memo || Date.now() > memo.jusqua) {
    let valeur = null;
    try { valeur = JSON.parse((await env.CONFIG.get("identifiants")) || "null"); } catch { valeur = null; }
    memo = { valeur, jusqua: Date.now() + 60000 };
    memoIdentifiants.set(env.CONFIG, memo);
  }
  const id = memo.valeur;
  return id?.user && id?.pass ? { ...env, DHIS2_USER: id.user, DHIS2_PASS: id.pass, ...(id.url ? { DHIS2_URL: id.url } : {}) } : env;
}
async function egal(a, b) {
  const h = async (t) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(t))));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}
// PUT /identifiants (appel serveur à serveur depuis GitHub Actions, sans origine navigateur) : clé SYNC_KEY exigée.
export async function recevoirIdentifiants(requete, env) {
  const repondre = (corps, statut) => new Response(JSON.stringify(corps), { status: statut, headers: { "Content-Type": "application/json" } });
  const cle = requete.headers.get("X-Cle-Synchro") || "";
  if (!env.SYNC_KEY || !env.CONFIG || !cle || !(await egal(cle.trim(), String(env.SYNC_KEY).trim()))) return repondre({ erreur: "clé de synchronisation refusée" }, 401);
  let corps;
  try { corps = JSON.parse((await requete.text()).slice(0, 2000)); } catch { return repondre({ erreur: "corps invalide" }, 400); }
  const user = typeof corps?.user === "string" ? corps.user.trim() : "";
  const pass = typeof corps?.pass === "string" ? corps.pass : "";
  const url = typeof corps?.url === "string" && /^https:\/\/[^\s]+$/.test(corps.url.trim()) ? corps.url.trim() : null;
  if (!user || !pass) return repondre({ erreur: "identifiants manquants" }, 400);
  await env.CONFIG.put("identifiants", JSON.stringify({ user, pass, url, date: new Date().toISOString() }));
  memoIdentifiants.delete(env.CONFIG);
  return repondre({ ok: true }, 200);
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
  // Adresse tolérante : espaces ou guillemets saisis par erreur autour de DHIS2_URL sont retirés.
  const base = String(env.DHIS2_URL).trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  const url = `${base}/api/${chemin}${recherche}`;
  const duree = /^analytics/.test(chemin) ? 600 : 300;
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cleCache = new Request(`https://cache.dhis2-proxy/${chemin}${recherche}`);
  const actualiser = new URL(requete.url).searchParams.get("actualiser") === "1";
  if (cache && !actualiser) {
    const enCache = await cache.match(cleCache);
    if (enCache) return { corps: await enCache.text(), statut: 200, date: enCache.headers.get("X-Mis-A-Jour"), cache: "HIT" };
  }
  const options = { redirect: "manual", headers: { Authorization: enteteAuth(env), Accept: "application/json" } };
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
  async fetch(requete, envBrut, contexte) {
    if (new URL(requete.url).pathname === "/identifiants" && requete.method === "PUT") return recevoirIdentifiants(requete, envBrut);
    const env = await avecIdentifiants(envBrut);
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
        if (r.statut !== 200) return json({ configure: true, joignable: false, message: diagnostic(r.statut) }, 200, origine);
        let info;
        try { info = JSON.parse(r.corps); } catch {
          return json({ configure: true, joignable: false, message: "DHIS2 a renvoyé une page web au lieu de données : vérifiez l’adresse DHIS2_URL (elle doit finir par /dhis si l’API est sous /dhis/api)." }, 200, origine);
        }
        // Adresse publique de DHIS2 (pour les liens « ouvrir dans DHIS2 » ; DHIS2_PUBLIC_URL si elle diffère de DHIS2_URL).
        const lienDhis2 = String(env.DHIS2_PUBLIC_URL || env.DHIS2_URL).replace(/\/+$/, "");
        return json({ configure: true, joignable: true, version: info.version, dateServeur: info.serverDate, lienDhis2 }, 200, origine);
      } catch (erreur) {
        console.error("sante", nomServeur(env), erreur?.name);
        return json({ configure: true, joignable: false, message: messageErreur(env, erreur) }, 200, origine);
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
        if (r.statut >= 300) return json({ erreur: diagnostic(r.statut), detail: r.corps.slice(0, 300) }, 502, origine);
        return new Response(r.corps, {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Mis-A-Jour": r.date || new Date().toISOString(), "X-Cache": r.cache, ...entetesCors(origine) },
        });
      } catch (erreur) {
        console.error("api", nomServeur(env), erreur?.name);
        return json({ erreur: messageErreur(env, erreur) }, 502, origine);
      }
    }
    return json({ erreur: "introuvable" }, 404, origine);
  },
};
