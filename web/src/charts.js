// Chart.js wrappers partageant la palette et les seuils visuels du dashboard.
const INSTANCES = new Map();
const CSS = {
  critique: "--critique", surveiller: "--surveiller", conforme: "--conforme",
  inconnu: "--inconnu", primaire: "--primary", secondaire: "--navy-soft",
};

// Texte lisible sur une couleur de fond : sombre sur les fonds clairs (ex. jaune « à surveiller »), blanc sinon.
export function texteSur(fond) {
  const hex = String(fond || "").trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "#fff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#231c00" : "#fff";
}
function couleurEtiquette(contexte) {
  const fond = contexte.dataset?.backgroundColor;
  return texteSur(Array.isArray(fond) ? fond[contexte.dataIndex] : fond);
}
function color(name) {
  const variable = CSS[name] || name;
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || "#087f5b";
}
function detruire(id) {
  if (!INSTANCES.has(id)) return;
  INSTANCES.get(id).destroy();
  INSTANCES.delete(id);
}
// Détruit les graphiques dont la zone va disparaître (changement de diapositive) : sans cela, Chart.js continue
// d'animer un graphique retiré de la page et le module d'étiquettes échoue (« _labels »).
export function detruireGraphiques(filtre = () => true) {
  for (const id of [...INSTANCES.keys()]) if (filtre(id)) { try { detruire(id); } catch { INSTANCES.delete(id); } }
}
// Le module d'étiquettes est enregistré AVANT le premier graphique (désactivé par défaut) : enregistré plus tard,
// il ne serait pas initialisé sur les graphiques déjà créés et planterait en les redessinant (« _labels »).
function disponible() {
  if (typeof Chart === "undefined") return false;
  enregistrerDatalabels();
  return true;
}
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
        callbacks: { label: (context) => `${context.dataset.label ? `${context.dataset.label} : ` : ""}${valeurSurvolee(context)}%` },
      },
      datalabels: { display: false },
    },
  };
}
// Valeur de la barre ou du point survolé : sur un graphique horizontal, la valeur est sur l'axe x (l'axe y ne
// donne que le rang de la barre, d'où un « 0 % » erroné auparavant).
function valeurSurvolee(context) {
  const v = context.chart?.options?.indexAxis === "y" ? context.parsed.x : context.parsed.y;
  return v ?? context.raw;
}
// Ligne de cible en pointillés (verticale sur un graphique horizontal), avec son libellé.
function pluginCible(id, cible, horizontal, libelle) {
  return {
    id: `cible-${id}`,
    afterDatasetsDraw(chart) {
      const echelle = chart.scales[horizontal ? "x" : "y"];
      const zone = chart.chartArea;
      if (!echelle || !zone) return;
      const pos = echelle.getPixelForValue(cible);
      const { ctx } = chart;
      ctx.save();
      ctx.strokeStyle = color("--text");
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      if (horizontal) { ctx.moveTo(pos, zone.top); ctx.lineTo(pos, zone.bottom); } else { ctx.moveTo(zone.left, pos); ctx.lineTo(zone.right, pos); }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color("--text");
      ctx.font = '700 10px "DM Sans", sans-serif';
      ctx.textAlign = horizontal ? "center" : "right";
      ctx.fillText(libelle, horizontal ? pos : zone.right, horizontal ? zone.top - 6 : pos - 5);
      ctx.restore();
    },
  };
}
function formaterValeur(v, pourcent, unite = "") {
  if (v === null || v === undefined) return "Donnée non disponible";
  return `${pourcent ? v : Number(v).toLocaleString("fr-FR")}${pourcent ? "%" : unite ? ` ${unite}` : ""}`;
}
function valueColor(value, thresholds) {
  if (value === null || value === undefined) return color("inconnu");
  if (value < thresholds.critique) return color("critique");
  if (value < thresholds.conforme) return color("surveiller");
  return color("conforme");
}

export function grapheBarres(id, labels, values, { horizontal = false, couleurParValeur = null, statut = false, seuils = { critique: 70, conforme: 90 }, onSelect = null, etiquettes = false, pourcent = true, cible = null, libelleCible = "Cible", nomValeur = "" } = {}) {
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
  const suffixe = pourcent ? "%" : "";
  options.plugins.datalabels = datalabelsOptions(etiquettes, (value) => (value === null || value === undefined ? "" : `${pourcent ? value : value.toLocaleString("fr-FR")}${suffixe}`));
  options.plugins.datalabels.anchor = horizontal ? "end" : "end";
  options.plugins.datalabels.align = horizontal ? "end" : "end";
  // Valeurs qui ne sont pas des pourcentages (indicateurs FARS) : échelle libre, sans « % ».
  options.plugins.tooltip.callbacks.label = (context) => ` ${nomValeur ? `${nomValeur} : ` : ""}${formaterValeur(valeurSurvolee(context), pourcent)}`;
  if (!pourcent) options.scales = { [horizontal ? "x" : "y"]: { ...axisOptions(), beginAtZero: true, ...(cible !== null ? { suggestedMax: cible * 1.08 } : {}) }, [horizontal ? "y" : "x"]: { ...axisOptions(), grid: { display: false } } };
  else options.scales = horizontal
    ? { x: { ...axisOptions(), beginAtZero: true, max: 100, ticks: { ...axisOptions().ticks, callback: (value) => `${value}%` } }, y: { ...axisOptions(), grid: { display: false } } }
    : { x: { ...axisOptions(), grid: { display: false } }, y: { ...axisOptions(), beginAtZero: true, max: 100, ticks: { ...axisOptions().ticks, callback: (value) => `${value}%` } } };
  INSTANCES.set(id, new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: barColors, borderRadius: 5, borderSkipped: false, maxBarThickness: horizontal ? 18 : 32 }] },
    plugins: cible !== null && cible !== undefined ? [pluginCible(id, cible, horizontal, libelleCible)] : [],
    options: {
      ...(cible !== null && cible !== undefined ? { layout: { padding: { top: 18, right: 28 } } } : {}),
      ...options,
      onClick: onSelect ? (_event, elements) => {
        if (elements.length) onSelect(labels[elements[0].index]);
      } : undefined,
    },
  }));
}

export function grapheLigne(id, labels, series, { filled = false, percent = true, etiquettes = false, pointOnlyTooltip = false, cible = null, libelleCible = "Cible" } = {}) {
  if (!disponible()) return;
  detruire(id);
  const canvas = document.getElementById(id);
  if (!canvas) return;
  // Couleurs bien distinctes (pas de vert « cible atteinte » ni de rouge « loin » qui feraient croire à un statut).
  const basePalette = [color("primaire"), "#e48644", "#7b71d1", color("secondaire"), "#c2185b", "#4ba7ad", "#8d6e00", "#5c6bc0"];
  const palette = series.length > basePalette.length
    ? series.map((_, index) => `hsl(${Math.round((index * 360) / series.length)} 68% 42%)`)
    : basePalette;
  const options = commonOptions();
  if (pointOnlyTooltip) {
    options.interaction = { mode: "nearest", intersect: true };
    options.plugins.tooltip.mode = "nearest";
    options.plugins.tooltip.intersect = true;
  }
  options.plugins.legend.display = series.length > 1;
  if (!percent) options.plugins.tooltip.callbacks.label = (context) => ` ${context.dataset.label ? `${context.dataset.label} : ` : ""}${formaterValeur(valeurSurvolee(context), false)}`;
  if (cible !== null && cible !== undefined) options.layout = { padding: { top: 18, right: 8 } };
  // Une seule serie : etiquette possible sans surcharger le graphe. Avec
  // plusieurs series (ex. evolution par region), les etiquettes se
  // chevaucheraient trop pour rester lisibles - on les desactive alors.
  options.plugins.datalabels = datalabelsOptions(etiquettes && series.length === 1, (value) => (value === null || value === undefined ? "" : `${value}%`));
  options.plugins.datalabels.align = "top";
  options.plugins.datalabels.anchor = "end";
  options.scales = {
    x: { ...axisOptions(), grid: { display: false } },
    y: { ...axisOptions(), beginAtZero: true, max: percent ? 100 : undefined, ...(cible !== null && cible !== undefined && !percent ? { suggestedMax: cible * 1.1 } : {}), ticks: { ...axisOptions().ticks, callback: (value) => percent ? `${value}%` : value } },
  };
  INSTANCES.set(id, new Chart(canvas, {
    type: "line",
    plugins: cible !== null && cible !== undefined ? [pluginCible(id, cible, false, libelleCible)] : [],
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
        pointRadius: labels.length > 14 ? 0 : pointOnlyTooltip ? 4 : 3,
        pointHoverRadius: pointOnlyTooltip ? 7 : 5,
        pointBackgroundColor: color("--surface"),
        pointBorderWidth: 2,
      })),
    },
    options,
  }));
}

// Barres groupées (une couleur par série, ex. un mois) pour comparer des unités période par période.
export function grapheBarresGroupees(id, labels, series, { horizontal = true, pourcent = false, cible = null, libelleCible = "Cible" } = {}) {
  if (!disponible()) return;
  detruire(id);
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const base = [color("primaire"), color("secondaire"), "#7b71d1", "#e48644", "#4ba7ad", "#c2185b"];
  const palette = series.length > base.length ? series.map((_, i) => `hsl(${Math.round((i * 360) / series.length)} 62% 45%)`) : base;
  const options = commonOptions();
  options.indexAxis = horizontal ? "y" : "x";
  options.plugins.legend.display = true;
  options.plugins.legend.position = "top";
  options.plugins.tooltip.callbacks.label = (context) => ` ${context.dataset.label} : ${formaterValeur(valeurSurvolee(context), pourcent)}`;
  const axeValeur = { ...axisOptions(), beginAtZero: true, ...(pourcent ? { max: 100 } : {}), ...(cible !== null ? { suggestedMax: cible * 1.08 } : {}) };
  options.scales = { [horizontal ? "x" : "y"]: axeValeur, [horizontal ? "y" : "x"]: { ...axisOptions(), grid: { display: false } } };
  if (cible !== null && cible !== undefined) options.layout = { padding: { top: 18, right: 28 } };
  INSTANCES.set(id, new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: series.map((s, i) => ({ label: s.label, data: s.data, backgroundColor: palette[i % palette.length], borderRadius: 3, borderSkipped: false, maxBarThickness: 12, categoryPercentage: 0.82, barPercentage: 0.92 })) },
    plugins: cible !== null && cible !== undefined ? [pluginCible(id, cible, horizontal, libelleCible)] : [],
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
  if (etiquettes) options.plugins.datalabels.color = couleurEtiquette;
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
  if (etiquettes) options.plugins.datalabels.color = couleurEtiquette;
  const total = distribution.total ?? distribution.conforme + distribution.surveiller + distribution.critique + (distribution.inconnu || 0);
  const centerLabel = {
    id: `center-label-${id}`,
    afterDraw(chart) {
      const area = chart.chartArea;
      if (!area) return;
      const { ctx } = chart;
      const x = (area.left + area.right) / 2;
      const y = (area.top + area.bottom) / 2;
      const size = Math.min(26, Math.max(16, area.width * 0.18));
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = color("--text");
      ctx.font = `700 ${size}px Manrope, sans-serif`;
      ctx.fillText(String(total), x, y - size * 0.25);
      ctx.fillStyle = color("--muted");
      ctx.font = `600 ${Math.max(9, size * 0.38)}px "DM Sans", sans-serif`;
      ctx.fillText("districts", x, y + size * 0.55);
      ctx.restore();
    },
  };
  INSTANCES.set(id, new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Conforme", "À surveiller", "Critique", "Sans taux"],
      datasets: [{ data: [distribution.conforme, distribution.surveiller, distribution.critique, distribution.inconnu || 0], backgroundColor: [color("conforme"), color("surveiller"), color("critique"), color("inconnu")], borderWidth: 0, hoverOffset: 5, spacing: 3 }],
    },
    plugins: [centerLabel],
    options,
  }));
}

export function couleurStatut(statut) { return color(statut); }
