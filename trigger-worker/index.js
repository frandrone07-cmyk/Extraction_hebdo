const API_VERSION = "2026-03-10";

function json(body, status, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function sameOrigin(request, env) {
  const origin = request.headers.get("Origin");
  return origin === env.ALLOWED_ORIGIN ? origin : null;
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function constantTimeEquals(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

async function verifyPin(pin, env) {
  if (typeof pin !== "string" || pin.length < 4 || pin.length > 32 || !env.PIN_SALT || !env.PIN_HASH) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const digestBytes = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: encoder.encode(env.PIN_SALT),
    iterations: 310000,
    hash: "SHA-256",
  }, key, 256);
  const digest = bytesToHex(digestBytes);
  return constantTimeEquals(digest, env.PIN_HASH.toLowerCase());
}

function githubHeaders(env) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "senegal-dhis2-completude-trigger",
  };
}

async function lancerExtraction(request, env, origin) {
  const address = request.headers.get("CF-Connecting-IP") || "unknown";
  const limit = await env.TRIGGER_RATE_LIMIT.limit({ key: address });
  if (!limit.success) return json({ message: "Trop de tentatives. Réessayez dans une minute." }, 429, origin);

  let body;
  try { body = await request.json(); } catch { return json({ message: "Requête invalide." }, 400, origin); }
  if (!await verifyPin(body.pin, env)) return json({ message: "Code PIN incorrect." }, 401, origin);

  const months = Number(body.months || 3);
  if (!Number.isInteger(months) || months < 1 || months > 12) return json({ message: "Le nombre de mois doit être compris entre 1 et 12." }, 400, origin);

  const requestId = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { ...githubHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: env.GITHUB_REF,
        inputs: { mois: String(months), request_id: requestId },
      }),
    });
  } catch {
    return json({ message: "GitHub Actions n’est pas joignable pour le moment." }, 502, origin);
  }

  if (response.status === 204) return json({ accepted: true, request_id: requestId }, 202, origin);
  if (!response.ok) return json({ message: `GitHub a refusé le lancement (HTTP ${response.status}).` }, 502, origin);
  const payload = await response.json().catch(() => ({}));
  return json({
    accepted: true,
    request_id: requestId,
    run_id: payload.workflow_run_id || payload.id || null,
    run_url: payload.html_url || payload.run_url || null,
  }, 202, origin);
}

async function lireStatut(request, env, origin) {
  const params = new URL(request.url).searchParams;
  const runId = params.get("run_id") || "";
  const requestId = params.get("request_id") || "";
  if (runId && !/^\d{1,20}$/.test(runId)) return json({ message: "Identifiant d’exécution invalide." }, 400, origin);
  if (!runId && !/^[a-f0-9]{12}$/.test(requestId)) return json({ message: "Identifiant de demande invalide." }, 400, origin);
  const url = runId
    ? `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/runs/${runId}`
    : `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/runs?event=workflow_dispatch&branch=${encodeURIComponent(env.GITHUB_REF)}&per_page=20`;
  let response;
  try { response = await fetch(url, { headers: githubHeaders(env) }); }
  catch { return json({ message: "État GitHub momentanément indisponible." }, 502, origin); }
  if (!response.ok) return json({ message: "État de l’exécution indisponible." }, response.status === 404 ? 404 : 502, origin);
  const payload = await response.json();
  const run = runId ? payload : (payload.workflow_runs || []).find((item) => (item.display_title || item.name || "").includes(requestId));
  if (!run) return json({ status: "queued", conclusion: null, html_url: `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}` }, 200, origin);
  return json({
    id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    html_url: run.html_url,
    updated_at: run.updated_at,
  }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = sameOrigin(request, env);
    if (!origin) return json({ message: "Origine non autorisée." }, 403, null);
    if (request.method === "OPTIONS") return json(null, 204, origin);
    const path = new URL(request.url).pathname;
    if (path === "/trigger" && request.method === "POST") return lancerExtraction(request, env, origin);
    if (path === "/status" && request.method === "GET") return lireStatut(request, env, origin);
    return json({ message: "Route inconnue." }, 404, origin);
  },
};
