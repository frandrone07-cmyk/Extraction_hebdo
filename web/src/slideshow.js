import { grapheBarres, grapheBarresEmpilees, grapheDoughnut, grapheLigne, couleurStatut } from "./charts.js";
import { afficherDistricts, centrerRegion, detruireCarte, initCarte } from "./map.js";
import { ouvrirFicheDistrict } from "./drawer.js";

const DEFINITIONS = [
  { id: "synth", title: "Synthèse nationale", description: "Les indicateurs clés de l’extraction sélectionnée." },
  { id: "carte", title: "Carte et priorités", description: "Les districts à accompagner en premier." },
  { id: "reg", title: "Résultats par région", description: "Comparaison territoriale des niveaux de complétude." },
  { id: "form", title: "Résultats par formulaire", description: "Formulaires classés selon leur taux moyen." },
  { id: "heat", title: "Carte thermique", description: "Lecture croisée des régions et des formulaires." },
  { id: "top", title: "Top et points de vigilance", description: "Les dix niveaux les plus élevés et les plus faibles." },
  { id: "tabreg", title: "Synthèse région et période", description: "Vue consolidée des territoires et périodes DHIS2." },
  { id: "evo", title: "Évolution hebdomadaire", description: "Tendance nationale et régionale entre les lundis." },
];
const REDUIT = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let model = null;
let onClose = null;
let onRefresh = null;
let selectedSlides = DEFINITIONS;
let current = 0;
let duration = 12000;
let paused = false;
let timer = null;
let progressTimer = null;
let refreshTimer = null;
let wakeLock = null;
let pointerStart = null;
let active = false;
let mapRegionTimer = null;
let mapRegionIndex = 0;
const REGION_DWELL = 2200;

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const labelRegion = (value) => value.replace(/^DRS[_ ]/, "");
const pct = (value) => value === null || value === undefined ? "—" : `${Number(value).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const average = (values) => { const items = values.filter((value) => value !== null && value !== undefined); return items.length ? Math.round(items.reduce((a, b) => a + b, 0) / items.length * 10) / 10 : null; };

function header(index) {
  const slide = selectedSlides[index];
  return `<header class="tv-bar" id="tvbar"><div class="tv-brand"><span class="tv-flag" aria-hidden="true">S</span><span><strong>Complétude DHIS2</strong><small>Ministère de la Santé · Sénégal</small></span></div><div class="tv-heading"><strong id="tv-title">${escapeHtml(slide.title)}</strong><span id="tv-counter">${index + 1} / ${selectedSlides.length}</span></div><div class="tv-dots" id="tv-dots">${selectedSlides.map((item, i) => `<button type="button" class="tv-dot ${i === index ? "on" : ""}" data-slide-index="${i}" aria-label="Afficher : ${escapeHtml(item.title)}" aria-current="${i === index ? "step" : "false"}"></button>`).join("")}</div><div class="tv-controls"><button type="button" id="tv-prev" aria-label="Diapositive précédente" title="← Précédent">←</button><button type="button" id="tv-pause" aria-label="Mettre en pause" title="Espace pour pause">Ⅱ</button><button type="button" id="tv-next" aria-label="Diapositive suivante" title="→ Suivant">→</button><select id="tv-duration" aria-label="Durée de chaque diapositive"><option value="8000">8 s</option><option value="12000" selected>12 s</option><option value="20000">20 s</option><option value="30000">30 s</option></select><button type="button" id="tv-fullscreen" aria-label="Activer le plein écran" title="F pour plein écran">⛶</button><button type="button" id="tv-close" aria-label="Quitter le diaporama" title="Échap pour quitter">×</button></div><div class="tv-progress" aria-hidden="true"><i id="tv-progress-fill"></i></div></header>`;
}

function activeModel() { return model; }
function regionsAvecContours(data) {
  return data.regions.filter((region) => region.districts.some((district) => district.feature));
}
function afficherRegionSuivante(regions) {
  const index = mapRegionIndex % regions.length;
  const region = regions[index];
  const label = document.getElementById("tv-map-region");
  if (label) label.textContent = `Région ${index + 1}/${regions.length} · ${labelRegion(region.nom)}`;
  centrerRegion(region.nom);
  mapRegionIndex = (index + 1) % regions.length;
}
function dureeDiapositive() {
  if (selectedSlides[current]?.id !== "carte") return duration;
  return Math.max(duration, regionsAvecContours(activeModel()).length * REGION_DWELL);
}
function kpisMarkup() {
  const data = activeModel();
  const rate = average(data.districts.map((district) => district.tauxMoyen));
  const critical = data.districts.filter((district) => district.statut === "critique").length;
  return `<div class="tv-kpis"><article><span>Taux moyen</span><strong>${pct(rate)}</strong></article><article><span>Régions</span><strong>${data.regions.length}</strong></article><article><span>Districts analysés</span><strong>${data.districts.length}</strong></article><article><span>Districts critiques</span><strong class="critical">${critical}</strong></article></div>`;
}
function slideMarkup(id) {
  const data = activeModel();
  const titles = {
    synth: `<div class="tv-slide-head"><span class="eyebrow">POINT HEBDOMADAIRE</span><h1>Repères nationaux</h1><p>${escapeHtml(data.semaineLibelle)} · ${escapeHtml(data.selection.periode)}</p></div>${kpisMarkup()}<div class="tv-layout tv-half"><article class="card"><h2>Évolution du taux moyen</h2><div class="chartbox tv-chart"><canvas id="tv-chart-national"></canvas></div></article><article class="card"><h2>Répartition des districts</h2><div class="chartbox tv-chart tv-chart-status"><canvas id="tv-chart-status"></canvas></div></article></div>`,
    carte: `<div class="tv-slide-head"><span class="eyebrow">CARTE & PRIORITÉS</span><h1>Où concentrer l’appui ?</h1><p>${data.districts.filter((district) => district.statut === "critique").length} district(s) sous le seuil de ${data.seuils.critique}%.</p></div><div class="tv-layout tv-map-layout"><article class="card"><p class="tv-map-region" id="tv-map-region" aria-live="polite"></p><div id="tv-map" role="group" aria-label="Carte des districts selon leur statut"></div><div class="map-legend tv-map-legend"><span class="legend-item"><i class="legend-swatch" style="background:var(--critique)"></i>Critique &lt; ${data.seuils.critique}%</span><span class="legend-item"><i class="legend-swatch" style="background:var(--surveiller)"></i>À surveiller</span><span class="legend-item"><i class="legend-swatch" style="background:var(--conforme)"></i>Conforme ≥ ${data.seuils.conforme}%</span></div></article><article class="card"><h2>Priorités de suivi</h2><p class="tv-priority-caption">Dist. classés par taux moyen croissant.</p><div class="tv-priorities">${[...data.districts].filter((district) => district.statut === "critique").sort((a, b) => (a.tauxMoyen ?? 100) - (b.tauxMoyen ?? 100)).slice(0, 8).map((district, index) => `<button type="button" class="tv-priority" data-district="${escapeHtml(district.region)}||${escapeHtml(district.nom)}"><i>${index + 1}</i><span><strong>${escapeHtml(district.nom)}</strong><small>${escapeHtml(labelRegion(district.region))}</small></span><b class="${district.statut}">${pct(district.tauxMoyen)}</b></button>`).join("") || `<p class="empty-state">Aucun district critique pour cette sélection.</p>`}</div></article></div>`,
    reg: `<div class="tv-slide-head"><span class="eyebrow">COMPARAISON TERRITORIALE</span><h1>Taux moyen par région</h1><p>La barre indique le taux moyen des districts affichés.</p></div><article class="card tv-chart-card"><div class="chartbox tv-chart-large"><canvas id="tv-chart-region"></canvas></div></article>`,
    form: `<div class="tv-slide-head"><span class="eyebrow">LECTURE PAR INDICATEUR</span><h1>Résultats par formulaire</h1><p>${data.formulaires.length} formulaire(s) dans le périmètre sélectionné.</p></div><article class="card tv-chart-card"><div class="chartbox tv-chart-large"><canvas id="tv-chart-form"></canvas></div></article>`,
    heat: `<div class="tv-slide-head"><span class="eyebrow">CROISEMENT TERRITORIAL</span><h1>Régions × formulaires</h1><p>Les écarts de couleur suivent les seuils configurés dans DHIS2.</p></div><article class="card"><div class="table-scroll"><table class="heatmap"><thead><tr><th>Région</th>${data.formulaires.map((form) => `<th title="${escapeHtml(form.nom)}">${escapeHtml(form.nom)}</th>`).join("")}</tr></thead><tbody>${data.regions.map((region) => `<tr><th scope="row">${escapeHtml(labelRegion(region.nom))}</th>${data.formulaires.map((form) => { const value = average(region.districts.flatMap((district) => district.formulaires.filter((item) => item.nom === form.nom).map((item) => item.valeur))); const color = value === null ? "inconnu" : value < data.seuils.critique ? "critique" : value < data.seuils.conforme ? "surveiller" : "conforme"; return `<td class="heatmap-cell" style="background:${couleurStatut(color)}">${value ?? "—"}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div></article>`,
    top: `<div class="tv-slide-head"><span class="eyebrow">CLASSEMENTS</span><h1>Résultats marquants</h1><p>Les taux les plus élevés et les districts à accompagner.</p></div><div class="tv-layout tv-half"><article class="card"><div class="card-head"><h2>10 meilleurs résultats</h2><span class="status-chip conforme">Top 10</span></div>${ranking(data, false)}</article><article class="card"><div class="card-head"><h2>10 taux les plus faibles</h2><span class="status-chip critique">À suivre</span></div>${ranking(data, true)}</article></div>`,
    tabreg: `<div class="tv-slide-head"><span class="eyebrow">SYNTHÈSE CROISÉE</span><h1>Région et période</h1><p>Lecture de l’extraction ${escapeHtml(data.semaineCle)} sur ${escapeHtml(data.selection.periode)}.</p></div><div class="tv-layout tv-half"><article class="card"><h2>Synthèse par région</h2><div class="table-scroll"><table><thead><tr><th>Région</th><th>Taux moyen</th><th>Critiques</th></tr></thead><tbody>${data.regions.map((region) => `<tr><td>${escapeHtml(labelRegion(region.nom))}</td><td>${pct(region.tauxMoyen)}</td><td class="cell-critique">${region.nbCritique}</td></tr>`).join("")}</tbody></table></div></article><article class="card"><h2>Taux moyen par période</h2><div class="chartbox tv-chart"><canvas id="tv-chart-period"></canvas></div></article></div>`,
    evo: `<div class="tv-slide-head"><span class="eyebrow">SUIVI DANS LE TEMPS</span><h1>Évolution hebdomadaire par région</h1><p>Comparaison du même indicateur au fil des lundis.</p></div><article class="card tv-chart-card"><div class="chartbox tv-chart-large"><canvas id="tv-chart-evolution"></canvas></div></article>`,
  };
  return `<section class="tv-slide" aria-label="${escapeHtml(DEFINITIONS.find((slide) => slide.id === id)?.title || "Diapositive")}">${titles[id]}</section>`;
}

function ranking(data, weakest) {
  const districts = [...data.districts].filter((district) => district.tauxMoyen !== null).sort((a, b) => weakest ? a.tauxMoyen - b.tauxMoyen : b.tauxMoyen - a.tauxMoyen).slice(0, 10);
  return `<div class="tv-ranking">${districts.map((district, index) => `<button type="button" class="tv-ranking-row" data-district="${escapeHtml(district.region)}||${escapeHtml(district.nom)}"><span class="rank-no">${String(index + 1).padStart(2, "0")}</span><span><strong>${escapeHtml(district.nom)}</strong><small>${escapeHtml(labelRegion(district.region))}</small></span><b class="${district.statut}">${pct(district.tauxMoyen)}</b></button>`).join("")}</div>`;
}

function drawSlide(id) {
  const data = activeModel();
  const weeks = data.evolution.semaines.map((week) => new Date(`${week}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }));
  if (id === "synth") {
    grapheLigne("tv-chart-national", weeks, [{ label: "Taux moyen", data: data.evolution.moyenne_generale }], { filled: true, etiquettes: true });
    grapheDoughnut("tv-chart-status", {
      conforme: data.districts.filter((district) => district.statut === "conforme").length,
      surveiller: data.districts.filter((district) => district.statut === "surveiller").length,
      critique: data.districts.filter((district) => district.statut === "critique").length,
    }, { etiquettes: true });
  } else if (id === "carte") {
    detruireCarte();
    initCarte("tv-map", document.documentElement.dataset.theme);
    afficherDistricts(data.districts, { onClicDistrict: ouvrirFicheDistrict, etiquettes: true, nomsEtiquettes: true, seuils: data.seuils });
    const regions = regionsAvecContours(data);
    if (regions.length) {
      afficherRegionSuivante(regions);
      mapRegionTimer = setInterval(() => {
        if (!paused) afficherRegionSuivante(regions);
      }, REGION_DWELL);
    }
  } else if (id === "reg") {
    grapheBarres("tv-chart-region", data.regions.map((region) => labelRegion(region.nom)), data.regions.map((region) => region.tauxMoyen), { statut: true, seuils: data.seuils, etiquettes: true });
  } else if (id === "form") {
    const forms = [...data.formulaires].sort((a, b) => (a.tauxMoyen ?? 0) - (b.tauxMoyen ?? 0));
    grapheBarres("tv-chart-form", forms.map((form) => form.nom), forms.map((form) => form.tauxMoyen), { horizontal: true, statut: true, seuils: data.seuils, etiquettes: true });
  } else if (id === "tabreg") {
    const periods = new Map();
    for (const district of data.districts) for (const form of district.formulaires) for (const period of form.historiquePeriodes) {
      if (!periods.has(period.periode_code)) periods.set(period.periode_code, { label: period.periode, values: [] });
      periods.get(period.periode_code).values.push(period.valeur);
    }
    const ordered = [...periods.entries()].sort(([a], [b]) => a.localeCompare(b));
    grapheBarres("tv-chart-period", ordered.map(([, item]) => item.label), ordered.map(([, item]) => average(item.values)), { statut: true, seuils: data.seuils, etiquettes: true });
  } else if (id === "evo") {
    grapheLigne("tv-chart-evolution", weeks, data.evolution.par_region.map((series) => ({ label: labelRegion(series.region), data: series.valeurs })), { etiquettes: true });
  }
  document.querySelectorAll("[data-district]").forEach((button) => button.addEventListener("click", () => {
    const district = data.districts.find((item) => `${item.region}||${item.nom}` === button.dataset.district);
    if (district) ouvrirFicheDistrict(district);
  }));
}

function updateProgress() {
  const fill = document.getElementById("tv-progress-fill");
  if (!fill) return;
  const slideDuration = dureeDiapositive();
  fill.style.transition = "none";
  fill.style.width = "0%";
  requestAnimationFrame(() => {
    fill.style.transition = paused || REDUIT ? "none" : `width ${slideDuration}ms linear`;
    fill.style.width = paused ? "0%" : "100%";
  });
}
function schedule() {
  clearTimeout(timer);
  clearInterval(progressTimer);
  updateProgress();
  if (paused) return;
  timer = setTimeout(() => show(current + 1), dureeDiapositive());
}
function show(index) {
  if (!active) return;
  clearInterval(mapRegionTimer);
  mapRegionTimer = null;
  current = (index + selectedSlides.length) % selectedSlides.length;
  const stage = document.getElementById("tv-stage");
  const slide = selectedSlides[current];
  stage.innerHTML = slideMarkup(slide.id);
  document.getElementById("tv-title").textContent = slide.title;
  document.getElementById("tv-counter").textContent = `${current + 1} / ${selectedSlides.length}`;
  document.querySelectorAll(".tv-dot").forEach((dot, i) => {
    dot.classList.toggle("on", i === current);
    dot.setAttribute("aria-current", i === current ? "step" : "false");
  });
  const params = new URLSearchParams(location.hash.slice(1));
  params.set("tv", String(current));
  history.replaceState(null, "", `#${params.toString()}`);
  drawSlide(slide.id);
  schedule();
}
function setPaused(value) {
  paused = value;
  const button = document.getElementById("tv-pause");
  button.textContent = paused ? "▶" : "Ⅱ";
  button.setAttribute("aria-label", paused ? "Reprendre le diaporama" : "Mettre en pause");
  schedule();
}
async function requestWakeLock() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch { /* API refusée ou indisponible */ }
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { /* le navigateur peut refuser le plein écran */ }
}
function cleanupHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  params.delete("tv");
  history.replaceState(null, "", params.size ? `#${params.toString()}` : location.pathname + location.search);
}
function close() {
  if (!active) return;
  active = false;
  clearTimeout(timer);
  clearInterval(progressTimer);
  clearInterval(mapRegionTimer);
  mapRegionTimer = null;
  clearInterval(refreshTimer);
  document.removeEventListener("keydown", onKeydown);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("online", onOnlineChange);
  window.removeEventListener("offline", onOnlineChange);
  document.body.classList.remove("tv");
  document.getElementById("tvbar")?.remove();
  document.getElementById("tv-stage")?.remove();
  detruireCarte();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  cleanupHash();
  onClose?.();
}
function onKeydown(event) {
  if (!active) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === "Escape") { event.preventDefault(); close(); }
  else if (event.key === "ArrowRight") { event.preventDefault(); show(current + 1); }
  else if (event.key === "ArrowLeft") { event.preventDefault(); show(current - 1); }
  else if (event.key === " " || event.code === "Space") { event.preventDefault(); setPaused(!paused); }
  else if (event.key.toLowerCase() === "f") { event.preventDefault(); toggleFullscreen(); }
}
function onVisibilityChange() { if (document.visibilityState === "visible") requestWakeLock(); }
function onOnlineChange() {
  const title = document.getElementById("tv-title");
  if (title) title.dataset.network = navigator.onLine ? "online" : "offline";
}
async function refreshData() {
  if (!onRefresh || !active) return;
  try {
    const updated = await onRefresh();
    if (updated) { model = updated; show(current); }
    onOnlineChange();
  } catch { onOnlineChange(); }
}
function bindControls() {
  document.getElementById("tv-prev").addEventListener("click", () => show(current - 1));
  document.getElementById("tv-next").addEventListener("click", () => show(current + 1));
  document.getElementById("tv-pause").addEventListener("click", () => setPaused(!paused));
  document.getElementById("tv-fullscreen").addEventListener("click", toggleFullscreen);
  document.getElementById("tv-close").addEventListener("click", close);
  document.getElementById("tv-duration").addEventListener("change", (event) => { duration = Number(event.target.value); schedule(); });
  document.getElementById("tv-dots").addEventListener("click", (event) => {
    const button = event.target.closest("[data-slide-index]");
    if (button) show(Number(button.dataset.slideIndex));
  });
  const stage = document.getElementById("tv-stage");
  stage.addEventListener("pointerdown", (event) => { pointerStart = event.clientX; });
  stage.addEventListener("pointerup", (event) => {
    if (pointerStart === null) return;
    const distance = event.clientX - pointerStart;
    pointerStart = null;
    if (Math.abs(distance) > 70) show(current + (distance < 0 ? 1 : -1));
  });
}

export function demarrerDiaporama(currentModel, { initialSlide = 0, refresh, close: onExit } = {}) {
  if (active || !currentModel) return;
  model = currentModel;
  onClose = onExit;
  onRefresh = refresh;
  const requestedScenes = new URLSearchParams(location.search).get("scenes");
  selectedSlides = requestedScenes
    ? requestedScenes.split(",").map((id) => DEFINITIONS.find((slide) => slide.id === id.trim())).filter(Boolean)
    : DEFINITIONS;
  if (!selectedSlides.length) selectedSlides = DEFINITIONS;
  const requestedId = new URLSearchParams(location.hash.slice(1)).get("tv");
  const requestedIndex = Number.isInteger(Number(requestedId)) ? Number(requestedId) : initialSlide;
  current = Math.max(0, Math.min(selectedSlides.length - 1, requestedIndex));
  active = true;
  paused = false;
  document.body.classList.add("tv");
  document.body.insertAdjacentHTML("beforeend", `${header(current)}<main id="tv-stage" aria-live="polite"></main>`);
  bindControls();
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("online", onOnlineChange);
  window.addEventListener("offline", onOnlineChange);
  const params = new URLSearchParams(location.hash.slice(1));
  params.set("tv", String(current));
  history.replaceState(null, "", `#${params.toString()}`);
  requestWakeLock();
  refreshTimer = setInterval(refreshData, 10 * 60 * 1000);
  show(current);
}
