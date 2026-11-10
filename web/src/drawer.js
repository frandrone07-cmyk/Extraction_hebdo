// Fiche détaillée d'un district : tiroir latéral avec KPI et heatmap
// formulaires × périodes (toutes les périodes de la semaine courante,
// pas seulement la plus récente — contrairement aux tableaux de synthèse).

import { couleurStatut } from "./charts.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function ouvrirFicheDistrict(district) {
  const panneau = document.getElementById("drawer");
  const contenu = document.getElementById("drawer-contenu");
  if (!panneau || !contenu) return;

  const periodesVues = new Set();
  for (const f of district.formulaires) {
    for (const p of f.historiquePeriodes) periodesVues.add(p.periode_code);
  }
  const periodesTriees = [...periodesVues].sort();
  const libellePeriode = (code) => {
    for (const f of district.formulaires) {
      const p = f.historiquePeriodes.find((x) => x.periode_code === code);
      if (p) return p.periode;
    }
    return code;
  };

  const lignesHeatmap = district.formulaires
    .map((f) => {
      const cellules = periodesTriees
        .map((code) => {
          const p = f.historiquePeriodes.find((x) => x.periode_code === code);
          const valeur = p ? p.valeur : null;
          const statut = p ? p.statut : "inconnu";
          return `<td class="heatmap-cell" style="background:${couleurStatut(statut)}">${valeur ?? "—"}</td>`;
        })
        .join("");
      return `<tr><th scope="row">${escapeHtml(f.nom)}</th>${cellules}</tr>`;
    })
    .join("");

  contenu.innerHTML = `
    <h2>${escapeHtml(district.nom)}</h2>
    <p class="note">${escapeHtml(district.region.replace(/^DRS_/, ""))}${district.uid ? ` — UID ${escapeHtml(district.uid)}` : ""}</p>
    <div class="grid grid-kpi" style="margin:12px 0">
      <div class="card kpi"><h3>Taux moyen (dernière période)</h3><div class="valeur">${district.tauxMoyen ?? "—"}%</div></div>
      <div class="card kpi"><h3>Statut</h3><div class="valeur cell-${district.statut}">${district.statut}</div></div>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Formulaire</th>${periodesTriees.map((c) => `<th>${escapeHtml(libellePeriode(c))}</th>`).join("")}</tr></thead>
        <tbody>${lignesHeatmap}</tbody>
      </table>
    </div>
  `;

  const overlay = document.getElementById("drawer-overlay");
  panneau.hidden = false;
  overlay.hidden = false;
  requestAnimationFrame(() => {
    panneau.classList.add("ouvert");
    overlay.classList.add("ouvert");
  });
  document.getElementById("btn-fermer-drawer").focus();
}

export function fermerFicheDistrict() {
  const panneau = document.getElementById("drawer");
  const overlay = document.getElementById("drawer-overlay");
  if (!panneau) return;
  panneau.classList.remove("ouvert");
  overlay.classList.remove("ouvert");
  setTimeout(() => {
    panneau.hidden = true;
    overlay.hidden = true;
  }, 200);
}

export function initDrawer() {
  document.getElementById("btn-fermer-drawer").addEventListener("click", fermerFicheDistrict);
  document.getElementById("drawer-overlay").addEventListener("click", fermerFicheDistrict);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") fermerFicheDistrict();
  });
}
