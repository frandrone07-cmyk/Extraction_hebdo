// Chart.js wrappers partageant la palette et les seuils visuels du dashboard.
const INSTANCES = new Map();
const CSS = {
  critique: "--critique", surveiller: "--surveiller", conforme: "--conforme",
  inconnu: "--inconnu", primaire: "--primary", secondaire: "--navy-soft",
};

function color(name) {
  const variable = CSS[name] || name;
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || "#087f5b";
}
function detruire(id) {
  if (!INSTANCES.has(id)) return;
  INSTANCES.get(id).destroy();
  INSTANCES.delete(id);
}
function disponible() { return typeof Chart !== "undefined"; }
let datalabelsEnregistre = false;
function enregistrerDatalabels() {
  if (datalabelsEnregistre || typeof ChartDataLabels === "undefined") return;
  Chart.register(ChartDataLabels);
  datalabelsEnregistre = true;
}
// Desactive par defaut (plugin enregistre globalement) : seul le mode TV
// active l'affichage des etiquettes de pourcentage directement sur les
// graphiques, pour rester lisible sans survol possible sur un ecran.
function datalabelsOptions(actif, formatter) {
  if (!actif) return { display: false };
  enregistrerDatalabels();
  return {
    display: true,
    color: color("--text"),
    font: { family: "Manrope", size: 11, weight: "700" },
    formatter: formatter || ((value) => (value === null || value === undefined ? "" : `${value}%`)),
  };
}
function axisOptions() {
  const muted = color("--muted");
  const border = color("--border");
  return {
    ticks: { color: muted, font: { family: "DM Sans", size: 10 } },
    grid: { color: border, drawTicks: false },
    border: { display: false },
  };
}
function commonOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450 },
    interaction: { intersect: false, mode: "index" },
    plugins: {
      legend: { labels: { color: color("--muted"), usePointStyle: true, pointStyle: "circle", boxWidth: 8, boxHeight: 8, padding: 14, font: { family: "DM Sans", size: 10 } } },
      tooltip: {
        backgroundColor: color("--navy"),
        titleFont: { family: "DM Sans", weight: "700", size: 11 },
        bodyFont: { family: "DM Sans", size: 10 },
        padding: 10,
        cornerRadius: 9,
        displayColors: true,
        callbacks: { label: (context) => `${context.dataset.label ? `${context.dataset.label} : ` : ""}${context.parsed.y ?? context.parsed.x ?? context.raw}%` },
      },
      datalabels: { display: false },
    },
  };
}
function valueColor(value, thresholds) {
  if (value === null || value === undefined) return color("inconnu");
  if (value < thresholds.critique) return color("critique");
  if (value < thresholds.conforme) return color("surveiller");
  return color("conforme");
}

export function grapheBarres(id, labels, values, { horizontal = false, couleurParValeur = null, statut = false, seuils = { critique: 70, conforme: 90 }, onSelect = null, etiquettes = false } = {}) {
  if (!disponible()) return;
  detruire(id);
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const options = commonOptions();
  const barColors = couleurParValeur
    ? values.map((value) => couleurParValeur(value))
    : statut ? values.map((value) => valueColor(value, seuils)) : color("primaire");
  options.indexAxis = horizontal ? "y" : "x";
  options.plugins.legend.display = false;
  options.plugins.datalabels = datalabelsOptions(etiquettes, (value) => (value === null || value === undefined ? "" : `${value}%`));
  options.plugins.datalabels.anchor = horizontal ? "end" : "end";
  options.plugins.datalabels.align = horizontal ? "end" : "end";
  options.scales = horizontal
    ? { x: { ...axisOptions(), beginAtZero: true, max: 100, ticks: { ...axisOptions().ticks, callback: (value) => `${value}%` } }, y: { ...axisOptions(), grid: { display: false } } }
    : { x: { ...axisOptions(), grid: { display: false } }, y: { ...axisOptions(), beginAtZero: true, max: 100, ticks: { ...axisOptions().ticks, callback: (value) => `${value}%` } } };
  INSTANCES.set(id, new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: barColors, borderRadius: 5, borderSkipped: false, maxBarThickness: horizontal ? 18 : 32 }] },
    options: {
      ...options,
      onClick: onSelect ? (_event, elements) => {
        if (elements.length) onSelect(labels[elements[0].index]);
      } : undefined,
    },
  }));
}

export function grapheLigne(id, labels, series, { filled = false, percent = true, etiquettes = false } = {}) {
  if (!disponible()) return;
  detruire(id);
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const palette = [color("primaire"), color("secondaire"), color("conforme"), color("surveiller"), color("critique"), "#7b71d1", "#e48644", "#4ba7ad"];
  const options = commonOptions();
  options.plugins.legend.display = series.length > 1;
  // Une seule serie : etiquette possible sans surcharger le graphe. Avec
  // plusieurs series (ex. evolution par region), les etiquettes se
  // chevaucheraient trop pour rester lisibles - on les desactive alors.
  options.plugins.datalabels = datalabelsOptions(etiquettes && series.length === 1, (value) => (value === null || value === undefined ? "" : `${value}%`));
  options.plugins.datalabels.align = "top";
  options.plugins.datalabels.anchor = "end";
  options.scales = {
    x: { ...axisOptions(), grid: { display: false } },
    y: { ...axisOptions(), beginAtZero: true, max: percent ? 100 : undefined, ticks: { ...axisOptions().ticks, callback: (value) => percent ? `${value}%` : value } },
  };
  INSTANCES.set(id, new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: series.map((item, index) => ({
        label: item.label,
        data: item.data,
        borderColor: palette[index % palette.length],
        backgroundColor: palette[index % palette.length],
        fill: filled && index === 0 ? { target: "origin", above: "rgba(8,127,91,.08)" } : false,
        tension: .32,
        spanGaps: false,
        borderWidth: 2.2,
        pointRadius: labels.length > 14 ? 0 : 3,
        pointHoverRadius: 5,
        pointBackgroundColor: color("--surface"),
        pointBorderWidth: 2,
      })),
    },
    options,
  }));
}

export function grapheBarresEmpilees(id, labels, series, { etiquettes = false } = {}) {
  if (!disponible()) return;
  detruire(id);
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const options = commonOptions();
  options.plugins.legend.position = "bottom";
  options.plugins.tooltip.callbacks.label = (context) => ` ${context.dataset.label} : ${context.raw}`;
  options.plugins.datalabels = datalabelsOptions(etiquettes, (value) => (value ? String(value) : ""));
  if (etiquettes) options.plugins.datalabels.color = "#fff";
  options.scales = {
    x: { ...axisOptions(), stacked: true, grid: { display: false } },
    y: { ...axisOptions(), stacked: true, beginAtZero: true },
  };
  INSTANCES.set(id, new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: series.map((item) => ({ label: item.label, data: item.data, backgroundColor: item.couleur, borderRadius: 4, borderSkipped: false, maxBarThickness: 28 })) },
    options,
  }));
}

export function grapheDoughnut(id, distribution, { etiquettes = false } = {}) {
  if (!disponible()) return;
  detruire(id);
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const options = commonOptions();
  options.cutout = "72%";
  options.plugins.legend.position = "bottom";
  options.plugins.tooltip.callbacks.label = (context) => ` ${context.label} : ${context.raw}`;
  options.plugins.datalabels = datalabelsOptions(etiquettes, (value) => (value ? String(value) : ""));
  if (etiquettes) options.plugins.datalabels.color = "#fff";
  INSTANCES.set(id, new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Conforme", "À surveiller", "Critique"],
      datasets: [{ data: [distribution.conforme, distribution.surveiller, distribution.critique], backgroundColor: [color("conforme"), color("surveiller"), color("critique")], borderWidth: 0, hoverOffset: 5, spacing: 3 }],
    },
    options,
  }));
}

export function couleurStatut(statut) { return color(statut); }
