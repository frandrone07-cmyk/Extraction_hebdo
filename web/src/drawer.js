import { couleurStatut } from "./charts.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}
function pct(value) { return value === null || value === undefined ? "—" : `${Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}%`; }
let previousFocus = null;

export function ouvrirFicheDistrict(district) {
  const panel = document.getElementById("drawer");
  const content = document.getElementById("drawer-contenu");
  const overlay = document.getElementById("drawer-overlay");
  if (!panel || !content || !overlay) return;
  previousFocus = document.activeElement;
  const periods = new Map();
  for (const form of district.formulaires) for (const period of form.historiquePeriodes) periods.set(period.periode_code, period.periode);
  const periodCodes = [...periods.keys()].sort();
  const rows = district.formulaires.map((form) => {
    const values = periodCodes.map((code) => {
      const point = form.historiquePeriodes.find((item) => item.periode_code === code);
      const value = point?.valeur ?? null;
      const background = couleurStatut(point?.statut || "inconnu");
      return `<td class="heatmap-cell" style="background:${background}" title="${escapeHtml(form.nom)} · ${escapeHtml(periods.get(code))}">${value === null ? "—" : Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}</td>`;
    }).join("");
    const variation = form.variation === null ? "—" : `${form.variation > 0 ? "+" : ""}${form.variation.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} pt`;
    return `<tr><th scope="row">${escapeHtml(form.nom)}</th>${values}<td>${variation}</td></tr>`;
  }).join("");
  const previous = district.tauxPrecedent === null ? "—" : pct(district.tauxPrecedent);
  content.innerHTML = `
    <h2 id="drawer-titre">${escapeHtml(district.nom)}</h2>
    <p class="drawer-subtitle">${escapeHtml(district.region.replace(/^DRS[_ ]/, ""))}${district.uid ? ` · UID ${escapeHtml(district.uid)}` : ""}</p>
    <div class="drawer-kpis">
      <div class="drawer-kpi"><span>Taux moyen</span><strong>${pct(district.tauxMoyen)}</strong></div>
      <div class="drawer-kpi"><span>Extraction comparée</span><strong>${previous}</strong></div>
      <div class="drawer-kpi"><span>Écart</span><strong>${district.variation === null ? "—" : `${district.variation > 0 ? "+" : ""}${district.variation.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} pt`}</strong></div>
    </div>
    <p class="note">Détail par formulaire et période DHIS2. Les cellules sans valeur sont affichées par un tiret.</p>
    <div class="table-scroll"><table class="heatmap"><thead><tr><th>Formulaire</th>${periodCodes.map((code) => `<th>${escapeHtml(periods.get(code))}</th>`).join("")}<th>Écart formulaire</th></tr></thead><tbody>${rows}</tbody></table></div>
  `;
  panel.hidden = false;
  overlay.hidden = false;
  requestAnimationFrame(() => { panel.classList.add("ouvert"); overlay.classList.add("ouvert"); });
  document.getElementById("btn-fermer-drawer").focus();
}

export function fermerFicheDistrict() {
  const panel = document.getElementById("drawer");
  const overlay = document.getElementById("drawer-overlay");
  if (!panel || panel.hidden) return;
  panel.classList.remove("ouvert");
  overlay.classList.remove("ouvert");
  setTimeout(() => { panel.hidden = true; overlay.hidden = true; previousFocus?.focus?.(); }, 260);
}

export function initDrawer() {
  document.getElementById("btn-fermer-drawer").addEventListener("click", fermerFicheDistrict);
  document.getElementById("drawer-overlay").addEventListener("click", fermerFicheDistrict);
  document.addEventListener("keydown", (event) => {
    const panel = document.getElementById("drawer");
    if (!panel || panel.hidden) return;
    if (event.key === "Escape") { fermerFicheDistrict(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...panel.querySelectorAll("button, a[href], select, input, [tabindex]:not([tabindex='-1'])")].filter((element) => !element.disabled);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
}
