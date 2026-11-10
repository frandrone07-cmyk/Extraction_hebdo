// Wrappers Chart.js 4.4.1 (chargé en CDN, voir index.html). Palette reprise
// des couleurs de statut (styles.css) pour rester cohérent partout.

const COULEURS = {
  critique: "#c0392b",
  surveiller: "#b8860b",
  conforme: "#1e8449",
  inconnu: "#95a5a6",
  primaire: "#1F4E78",
  secondaire: "#6fb1ea",
};

const instances = new Map();

function detruire(id) {
  if (instances.has(id)) {
    instances.get(id).destroy();
    instances.delete(id);
  }
}

function disponible() {
  return typeof Chart !== "undefined";
}

export function grapheBarres(id, labels, valeurs, { horizontal = false, couleurParValeur = null } = {}) {
  if (!disponible()) return;
  detruire(id);
  const ctx = document.getElementById(id);
  if (!ctx) return;
  const couleurs = couleurParValeur ? valeurs.map(couleurParValeur) : COULEURS.primaire;
  instances.set(
    id,
    new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ data: valeurs, backgroundColor: couleurs, borderRadius: 4 }] },
      options: {
        indexAxis: horizontal ? "y" : "x",
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, max: horizontal ? 100 : undefined }, y: { beginAtZero: true, max: !horizontal ? 100 : undefined } },
        responsive: true,
        maintainAspectRatio: false,
      },
    })
  );
}

export function grapheLigne(id, labels, series) {
  if (!disponible()) return;
  detruire(id);
  const ctx = document.getElementById(id);
  if (!ctx) return;
  const palette = [COULEURS.primaire, COULEURS.secondaire, COULEURS.conforme, COULEURS.surveiller, COULEURS.critique];
  instances.set(
    id,
    new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: series.map((s, i) => ({
          label: s.label,
          data: s.data,
          borderColor: palette[i % palette.length],
          backgroundColor: "transparent",
          tension: 0.25,
          spanGaps: true,
        })),
      },
      options: {
        plugins: { legend: { display: series.length > 1 } },
        scales: { y: { beginAtZero: true, max: 100 } },
        responsive: true,
        maintainAspectRatio: false,
      },
    })
  );
}

export function grapheBarresEmpilees(id, labels, series) {
  if (!disponible()) return;
  detruire(id);
  const ctx = document.getElementById(id);
  if (!ctx) return;
  instances.set(
    id,
    new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: series.map((s) => ({ label: s.label, data: s.data, backgroundColor: s.couleur })),
      },
      options: {
        plugins: { legend: { position: "bottom" } },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
        responsive: true,
        maintainAspectRatio: false,
      },
    })
  );
}

export function grapheDoughnut(id, repartition) {
  if (!disponible()) return;
  detruire(id);
  const ctx = document.getElementById(id);
  if (!ctx) return;
  instances.set(
    id,
    new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Conforme", "À surveiller", "Critique"],
        datasets: [{
          data: [repartition.conforme, repartition.surveiller, repartition.critique],
          backgroundColor: [COULEURS.conforme, COULEURS.surveiller, COULEURS.critique],
        }],
      },
      options: { plugins: { legend: { position: "bottom" } }, responsive: true, maintainAspectRatio: false },
    })
  );
}

export function couleurStatut(statut) {
  return COULEURS[statut] || COULEURS.inconnu;
}
