import { TRIGGER_API_URL } from "./trigger-config.js";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function initTrigger() {
  const button = document.getElementById("btn-lancer-extraction");
  const dialog = document.getElementById("trigger-dialog");
  if (!TRIGGER_API_URL) return;
  button.hidden = false;
  const form = document.getElementById("trigger-form");
  const status = document.getElementById("trigger-status");
  const submit = document.getElementById("trigger-submit");
  const pinInput = document.getElementById("trigger-pin");
  const result = document.getElementById("trigger-result");
  const runLink = document.getElementById("trigger-run-link");
  const close = () => { if (dialog.open) dialog.close(); };
  button.addEventListener("click", () => { status.textContent = ""; result.hidden = true; dialog.showModal(); pinInput.focus(); });
  document.getElementById("trigger-close").addEventListener("click", close);
  document.getElementById("trigger-cancel").addEventListener("click", close);
  document.getElementById("trigger-refresh").addEventListener("click", () => location.reload());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    pinInput.disabled = true;
    status.textContent = "Vérification du code et lancement de l’extraction…";
    result.hidden = true;
    try {
      const response = await fetch(`${TRIGGER_API_URL.replace(/\/$/, "")}/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinInput.value, months: Number(document.getElementById("trigger-months").value) }),
      });
      pinInput.value = "";
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || (response.status === 429 ? "Trop de tentatives. Réessayez dans une minute." : "Le code PIN n’a pas été accepté ou le service est indisponible."));
      status.textContent = "Extraction lancée. Suivi de son état en cours…";
      if (payload.run_url) runLink.href = payload.run_url;
      if (payload.run_id || payload.request_id) await suivreExecution(payload.run_id || payload.request_id, Boolean(payload.request_id && !payload.run_id), status, result, runLink);
      else { status.textContent = "Demande transmise. Ouvrez GitHub pour suivre l’exécution."; result.hidden = false; }
    } catch (error) {
      pinInput.value = "";
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
      pinInput.disabled = false;
    }
  });
}

async function suivreExecution(runId, isRequestId, status, result, runLink) {
  for (let attempt = 0; attempt < 72; attempt += 1) {
    await wait(5000);
    try {
      const key = isRequestId ? "request_id" : "run_id";
      const response = await fetch(`${TRIGGER_API_URL.replace(/\/$/, "")}/status?${key}=${encodeURIComponent(runId)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "État de l’exécution indisponible.");
      if (data.html_url) runLink.href = data.html_url;
      if (data.status === "completed") {
        status.textContent = data.conclusion === "success"
          ? "Extraction terminée. Le site se met à jour ; actualisez pour charger les nouveaux résultats."
          : `L’extraction s’est terminée avec le statut « ${data.conclusion || "inconnu"} ». Consultez les journaux GitHub.`;
        result.hidden = false;
        return;
      }
      status.textContent = `Extraction en cours (${data.status || "en attente"})…`;
    } catch {
      status.textContent = "Connexion interrompue. Nouvelle tentative de vérification…";
    }
  }
  status.textContent = "L’extraction continue. Vous pouvez suivre son état sur GitHub.";
  result.hidden = false;
}
