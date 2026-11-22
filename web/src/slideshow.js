import { detruireGraphiques, grapheBarres, grapheBarresEmpilees, grapheDoughnut, grapheLigne, couleurStatut } from "./charts.js";
import { afficherDistricts, afficherVueComplete, centrerDistrict, detruireCarte, initCarte } from "./map.js";
import { afficherRegions, detruireCarteRegions, initCarteRegions, mettreEnEvidenceRegion } from "./region-map.js";
import { ouvrirFicheDistrict } from "./drawer.js";
import { construireBilan } from "./bilan.js";
import { nomFormulaire, versAffichage } from "./sokhnaci-dialogue.js";

const DEFINITIONS = [
  { id: "synth", title: "Synthèse nationale", description: "Les indicateurs clés de l’extraction sélectionnée." },
  { id: "carte", title: "Carte et priorités", description: "Les districts à accompagner en premier." },
  { id: "reg", title: "Résultats par région", description: "Comparaison territoriale des niveaux de complétude." },
  { id: "form", title: "Résultats par formulaire", description: "Formulaires classés selon leur taux moyen." },
  { id: "heat", title: "Carte thermique", description: "Lecture croisée des régions et des formulaires." },
  { id: "top", title: "Top et points de vigilance", description: "Les dix niveaux les plus élevés et les plus faibles." },
  { id: "tabreg", title: "Synthèse région et période", description: "Vue consolidée des territoires et périodes DHIS2." },
  { id: "evo", title: "Évolution par date d’extraction", description: "Tendance nationale et régionale entre les extractions." },
  { id: "bilan", title: "Situation globale et solutions", description: "Bilan, formulaires sans données et actions proposées." },
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
let clockTimer = null;
let wakeLock = null;
let pointerStart = null;
let active = false;
let mapTourTimer = null;
let mapTourIndex = 0;
let assistante = null;
let debutDiapositive = 0;
const retenues = new Set(); // motifs qui retiennent la diapositive (Sokhna Ci parle ou répond à une question)
const MAP_OVERVIEW_DURATION = 3200;
const DISTRICT_DWELL = 1800;

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const labelRegion = (value) => value.replace(/^DRS[_ ]/, "");
const pct = (value) => value === null || value === undefined ? "—" : `${Number(value).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const average = (values) => { const items = values.filter((value) => value !== null && value !== undefined); return items.length ? Math.round(items.reduce((a, b) => a + b, 0) / items.length * 10) / 10 : null; };

function header(index) {
  const data = activeModel();
  const slide = selectedSlides[index];
  return `<header class="tv-bar" id="tvbar"><div class="tv-brand"><span class="tv-flag" aria-hidden="true">S</span><span><strong>Complétude DHIS2</strong><small>Ministère de la Santé · Sénégal</small></span></div><div class="tv-heading"><strong id="tv-title">${escapeHtml(slide.title)}</strong><span id="tv-counter">${index + 1} / ${selectedSlides.length}</span><small class="tv-extraction" id="tv-extraction">Situation de l’extraction du ${escapeHtml(data.semaineLibelle)} · Période DHIS2 : ${escapeHtml(data.selection.periode)}</small></div><div class="tv-dots" id="tv-dots">${selectedSlides.map((item, i) => `<button type="button" class="tv-dot ${i === index ? "on" : ""}" data-slide-index="${i}" aria-label="Afficher : ${escapeHtml(item.title)}" aria-current="${i === index ? "step" : "false"}"></button>`).join("")}</div><div class="tv-controls"><time class="tv-clock" id="tv-clock" aria-label="Heure actuelle"></time><button type="button" id="tv-prev" aria-label="Diapositive précédente" title="← Précédent">←</button><button type="button" id="tv-pause" aria-label="Mettre en pause" title="Espace pour pause">Ⅱ</button><button type="button" id="tv-next" aria-label="Diapositive suivante" title="→ Suivant">→</button><select id="tv-duration" aria-label="Durée de chaque diapositive"><option value="8000">8 s</option><option value="12000" selected>12 s</option><option value="20000">20 s</option><option value="30000">30 s</option></select><button type="button" id="tv-fullscreen" aria-label="Activer le plein écran" title="F pour plein écran">⛶</button><button type="button" id="tv-close" aria-label="Quitter le diaporama" title="Échap pour quitter">×</button></div><div class="tv-progress" aria-hidden="true"><i id="tv-progress-fill"></i></div></header>`;
}

function majHorloge() {
  const element = document.getElementById("tv-clock");
  if (!element) return;
  const maintenant = new Date();
  const options = { timeZone: "Africa/Dakar" };
  const heure = maintenant.toLocaleTimeString("fr-FR", { ...options, hour: "2-digit", minute: "2-digit" });
  const date = maintenant.toLocaleDateString("fr-FR", { ...options, weekday: "long", day: "numeric", month: "long" });
  element.innerHTML = `<strong>${heure}</strong><small>${escapeHtml(date)}</small>`;
  element.dateTime = maintenant.toISOString();
}
function activeModel() { return model; }
function districtsAvecContours(data) {
  return data.districts.filter((district) => district.feature)
    .sort((a, b) => a.region.localeCompare(b.region, "fr") || a.nom.localeCompare(b.nom, "fr"));
}
function afficherDistrictsRegion(data, region, districtActif) {
  const titre = document.getElementById("tv-tour-region-title");
  const liste = document.getElementById("tv-tour-districts");
  if (!titre || !liste) return;
  const districts = data.districts.filter((district) => district.region === region)
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  titre.textContent = region
    ? `Districts de ${labelRegion(region)} · ${districts.length}`
    : "Districts de la région visitée";
  liste.innerHTML = districts.length
    ? districts.map((district) => `<div class="tv-tour-district${district.nom === districtActif ? " active" : ""}"><span>${escapeHtml(district.nom)}</span><strong class="${district.statut}">${pct(district.tauxMoyen)}</strong></div>`).join("")
    : `<p class="empty-state">La visite régionale commence après la vue complète.</p>`;
}
function afficherDistrictSuivant(districts) {
  if (mapTourIndex >= districts.length) {
    clearInterval(mapTourTimer);
    mapTourTimer = null;
    return;
  }
  const index = mapTourIndex;
  const district = districts[index];
  const label = document.getElementById("tv-map-progress");
  const regions = [...new Set(districts.map((item) => item.region))];
  const districtsRegion = districts.filter((item) => item.region === district.region);
  const districtIndex = districtsRegion.indexOf(district);
  if (label) {
    label.textContent = `Région ${regions.indexOf(district.region) + 1}/${regions.length} · ${labelRegion(district.region)} — District ${districtIndex + 1}/${districtsRegion.length} · ${district.nom}`;
    label.dataset.district = `${district.region}||${district.nom}`;
  }
  afficherDistrictsRegion(activeModel(), district.region, district.nom);
  mettreEnEvidenceRegion(district.region);
  centrerDistrict(district.region, district.nom);
  mapTourIndex += 1;
}
function dureeDiapositive() {
  if (selectedSlides[current]?.id !== "carte") return duration;
  return Math.max(duration, MAP_OVERVIEW_DURATION + (districtsAvecContours(activeModel()).length + 1) * DISTRICT_DWELL);
}
function demarrerTourDistricts(districts) {
  afficherDistrictSuivant(districts);
  mapTourTimer = setInterval(() => {
    if (!paused) afficherDistrictSuivant(districts);
  }, DISTRICT_DWELL);
}
function kpisMarkup() {
  const data = activeModel();
  const rate = average(data.districts.map((district) => district.tauxMoyen));
  const critical = data.districts.filter((district) => district.statut === "critique").length;
  return `<div class="tv-kpis"><article><span>Taux moyen</span><strong>${pct(rate)}</strong></article><article><span>Régions</span><strong>${data.toutesRegions.length}</strong></article><article><span>Districts analysés</span><strong>${data.districts.length}</strong></article><article><span>Districts critiques</span><strong class="critical">${critical}</strong></article></div>`;
}
function slideMarkup(id) {
  const data = activeModel();
  const titles = {
    synth: `<div class="tv-slide-head"><span class="eyebrow">POINT HEBDOMADAIRE</span><h1>Repères nationaux</h1><p>${escapeHtml(data.semaineLibelle)} · ${escapeHtml(data.selection.periode)}</p></div>${kpisMarkup()}<div class="tv-layout tv-half"><article class="card"><h2>Évolution du taux moyen</h2><div class="chartbox tv-chart"><canvas id="tv-chart-national"></canvas></div></article><article class="card"><h2>Répartition des districts</h2><div class="chartbox tv-chart tv-chart-status"><canvas id="tv-chart-status"></canvas></div></article></div>`,
    carte: `<div class="tv-slide-head"><span class="eyebrow">CARTE & PRIORITÉS</span><h1>Où concentrer l’appui ?</h1><p>${data.districts.filter((district) => district.statut === "critique").length} district(s) sous le seuil de ${data.seuils.critique}%.</p></div>
      <div class="tv-layout tv-map-layout">
        <article class="card"><p class="tv-map-region" id="tv-map-progress" aria-live="polite">Vue complète · ${districtsAvecContours(data).length} districts à parcourir</p><div id="tv-map" role="group" aria-label="Carte des districts selon leur statut"></div><div class="map-legend tv-map-legend"><span class="legend-item"><i class="legend-swatch" style="background:var(--critique)"></i>Critique &lt; ${data.seuils.critique}%</span><span class="legend-item"><i class="legend-swatch" style="background:var(--surveiller)"></i>À surveiller</span><span class="legend-item"><i class="legend-swatch" style="background:var(--conforme)"></i>Conforme ≥ ${data.seuils.conforme}%</span></div></article>
        <article class="card"><h2>Carte des régions</h2><p class="tv-priority-caption">Taux moyen régional · les couleurs suivent les seuils.</p><div id="tv-map-regions" role="group" aria-label="Carte des régions selon leur taux moyen"></div><div class="map-legend tv-map-legend"><span class="legend-item"><i class="legend-swatch" style="background:var(--critique)"></i>Critique</span><span class="legend-item"><i class="legend-swatch" style="background:var(--surveiller)"></i>À surveiller</span><span class="legend-item"><i class="legend-swatch" style="background:var(--conforme)"></i>Conforme</span></div></article>
      </div>
      <div class="tv-layout tv-map-details">
        <article class="card"><h2 id="tv-tour-region-title">Districts de la région visitée</h2><div class="tv-tour-districts" id="tv-tour-districts"><p class="empty-state">La visite régionale commence après la vue complète.</p></div></article>
        <article class="card"><h2>Priorités de suivi</h2><p class="tv-priority-caption">Districts en critique.</p><div class="tv-priorities">${[...data.districts].filter((district) => district.statut === "critique").sort((a, b) => (a.tauxMoyen ?? 100) - (b.tauxMoyen ?? 100)).slice(0, 8).map((district, index) => `<button type="button" class="tv-priority" data-district="${escapeHtml(district.region)}||${escapeHtml(district.nom)}"><i>${index + 1}</i><span><strong>${escapeHtml(district.nom)}</strong><small>${escapeHtml(labelRegion(district.region))}</small></span><b class="${district.statut}">${pct(district.tauxMoyen)}</b></button>`).join("") || `<p class="empty-state">Aucun district critique pour cette sélection.</p>`}</div></article>
      </div>`,
    reg: `<div class="tv-slide-head"><span class="eyebrow">COMPARAISON TERRITORIALE</span><h1>Taux moyen par région</h1><p>Les 14 régions restent visibles, quelle que soit la sélection.</p></div><article class="card tv-chart-card"><div class="chartbox tv-chart-large"><canvas id="tv-chart-region"></canvas></div></article>`,
    form: `<div class="tv-slide-head"><span class="eyebrow">LECTURE PAR INDICATEUR</span><h1>Résultats par formulaire</h1><p>${data.formulaires.length} formulaire(s) dans le périmètre sélectionné.</p></div><article class="card tv-chart-card"><div class="chartbox tv-chart-large"><canvas id="tv-chart-form"></canvas></div></article>`,
    heat: `<div class="tv-slide-head"><span class="eyebrow">CROISEMENT TERRITORIAL</span><h1>Régions × formulaires</h1><p>Les écarts de couleur suivent les seuils configurés dans DHIS2.</p></div><article class="card"><div class="table-scroll"><table class="heatmap"><thead><tr><th>Région</th>${data.tousFormulaires.map((form) => `<th title="${escapeHtml(form.nom)}">${escapeHtml(form.nom)}</th>`).join("")}</tr></thead><tbody>${data.toutesRegions.map((region) => `<tr><th scope="row">${escapeHtml(labelRegion(region.nom))}</th>${data.tousFormulaires.map((form) => { const value = average(region.districts.flatMap((district) => district.formulaires.filter((item) => item.nom === form.nom).map((item) => item.valeur))); const color = value === null ? "inconnu" : value < data.seuils.critique ? "critique" : value < data.seuils.conforme ? "surveiller" : "conforme"; return `<td class="heatmap-cell" style="background:${couleurStatut(color)}">${value ?? "—"}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div></article>`,
    top: `<div class="tv-slide-head"><span class="eyebrow">CLASSEMENTS</span><h1>Résultats marquants</h1><p>Les taux les plus élevés et les districts à accompagner.</p></div><div class="tv-layout tv-half"><article class="card"><div class="card-head"><h2>10 meilleurs résultats</h2><span class="status-chip conforme">Top 10</span></div>${ranking(data, false)}</article><article class="card"><div class="card-head"><h2>10 taux les plus faibles</h2><span class="status-chip critique">À suivre</span></div>${ranking(data, true)}</article></div>`,
    tabreg: `<div class="tv-slide-head"><span class="eyebrow">SYNTHÈSE CROISÉE</span><h1>Région et période</h1><p>Lecture de l’extraction ${escapeHtml(data.semaineCle)} sur ${escapeHtml(data.selection.periode)}.</p></div><div class="tv-layout tv-half"><article class="card"><h2>Synthèse par région</h2><div class="table-scroll"><table><thead><tr><th>Région</th><th>Taux moyen</th><th>Critiques</th></tr></thead><tbody>${data.toutesRegions.map((region) => `<tr><td>${escapeHtml(labelRegion(region.nom))}</td><td>${pct(region.tauxMoyen)}</td><td class="cell-critique">${region.nbCritique}</td></tr>`).join("")}</tbody></table></div></article><article class="card"><h2>Taux moyen par période</h2><div class="chartbox tv-chart"><canvas id="tv-chart-period"></canvas></div></article></div>`,
    bilan: bilanMarkup(data),
    evo: `<div class="tv-slide-head"><span class="eyebrow">SUIVI DANS LE TEMPS</span><h1>Évolution par date d’extraction</h1><p>Comparaison des 14 régions au fil des extractions hebdomadaires.</p></div><article class="card tv-chart-card"><div class="chartbox tv-chart-large"><canvas id="tv-chart-evolution"></canvas></div></article>`,
  };
  return `<section class="tv-slide" aria-label="${escapeHtml(DEFINITIONS.find((slide) => slide.id === id)?.title || "Diapositive")}">${titles[id]}</section>`;
}

// Dernière diapositive : bilan global, formulaires sans données et solutions proposées.
function bilanMarkup(data) {
  const b = construireBilan(data);
  const aff = (texte) => escapeHtml(versAffichage(texte));
  const statut = b.taux === null ? "inconnu" : b.taux < b.seuils.critique ? "critique" : b.taux < b.seuils.conforme ? "surveiller" : "conforme";
  const libelleStatut = { critique: "Critique", surveiller: "À surveiller", conforme: "Conforme", inconnu: "Sans taux" }[statut];
  const rayon = 54;
  const circonference = 2 * Math.PI * rayon;
  const rempli = circonference * Math.max(0, Math.min(100, b.taux ?? 0)) / 100;
  const delta = b.ecart === null ? "" : `<span class="bilan-delta ${b.ecart >= 0 ? "hausse" : "baisse"}">${b.ecart >= 0 ? "▲" : "▼"} ${escapeHtml(Math.abs(b.ecart).toLocaleString("fr-FR"))} pt</span>`;
  const total = Math.max(1, b.effectifs.total);
  const part = (n) => `${(n / total) * 100}%`;
  const PRIORITES = { "Immédiat": "immediat", "Cette semaine": "semaine", "Ce mois": "mois" };
  const manquants = b.sansDonnees.length
    ? b.sansDonnees.map((l, i) => `<li style="--i:${i}"><div class="bilan-ligne"><strong title="${escapeHtml(l.nom)}">${escapeHtml(nomFormulaire(l.nom))}</strong><b>${escapeHtml(l.part.toLocaleString("fr-FR"))} %</b></div><div class="bilan-jauge" aria-hidden="true"><i style="width:${Math.min(100, l.part)}%"></i></div><small>${l.vides} district${l.vides > 1 ? "s" : ""} sans donnée · ${l.zeros} à zéro · ${l.attendus} attendus</small></li>`).join("")
    : `<li class="bilan-vide">Tous les formulaires ont des données pour cette sélection.</li>`;
  const solutions = b.solutions.map((s, i) => `<li class="bilan-solution" style="--i:${i}"><span class="bilan-icone" aria-hidden="true">${s.icone}</span><div><span class="bilan-pill ${PRIORITES[s.priorite] || "mois"}">${escapeHtml(s.priorite)}</span><strong>${aff(s.titre)}</strong><p>${aff(s.detail)}</p></div></li>`).join("");
  return `<div class="tv-bilan">
    <header class="bilan-tete"><div><span class="eyebrow">BILAN DE LA SEMAINE</span><h1>Situation globale et solutions</h1></div><p>Extraction du ${escapeHtml(data.semaineLibelle)} · ${escapeHtml(data.selection.periode)}</p></header>
    <div class="bilan-grille">
      <article class="bilan-carte bilan-hero" style="--i:0">
        <h2>Situation globale</h2>
        <div class="bilan-anneau ${statut}">
          <svg viewBox="0 0 140 140" role="img" aria-label="Taux moyen national : ${escapeHtml(pct(b.taux))}">
            <defs><linearGradient id="bilan-degrade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="arret-a"/><stop offset="1" class="arret-b"/></linearGradient></defs>
            <circle cx="70" cy="70" r="${rayon}" class="anneau-fond"/>
            <circle cx="70" cy="70" r="${rayon}" class="anneau-valeur" stroke-dasharray="${rempli.toFixed(1)} ${circonference.toFixed(1)}" transform="rotate(-90 70 70)"/>
          </svg>
          <div class="bilan-anneau-texte"><strong>${escapeHtml(pct(b.taux))}</strong><span>taux moyen</span>${delta}</div>
        </div>
        <span class="bilan-statut ${statut}">${libelleStatut}</span>
        <div class="bilan-barre" role="img" aria-label="${b.effectifs.rouges} districts critiques, ${b.effectifs.oranges} à surveiller, ${b.effectifs.verts} conformes">
          <i class="critique" style="width:${part(b.effectifs.rouges)}"></i><i class="surveiller" style="width:${part(b.effectifs.oranges)}"></i><i class="conforme" style="width:${part(b.effectifs.verts)}"></i>
        </div>
        <ul class="bilan-legende"><li><i class="critique"></i>${b.effectifs.rouges} critique${b.effectifs.rouges > 1 ? "s" : ""}</li><li><i class="surveiller"></i>${b.effectifs.oranges} à surveiller</li><li><i class="conforme"></i>${b.effectifs.verts} conforme${b.effectifs.verts > 1 ? "s" : ""}</li></ul>
        <div class="bilan-regions">
          ${b.regionPire ? `<div><span>Plus en retard</span><strong>${escapeHtml(labelRegion(b.regionPire.nom))}</strong><b class="critique">${escapeHtml(pct(b.regionPire.tauxMoyen))}</b></div>` : ""}
          ${b.regionMeilleure ? `<div><span>Mieux placée</span><strong>${escapeHtml(labelRegion(b.regionMeilleure.nom))}</strong><b class="conforme">${escapeHtml(pct(b.regionMeilleure.tauxMoyen))}</b></div>` : ""}
        </div>
      </article>
      <article class="bilan-carte bilan-manquants" style="--i:1">
        <h2>Formulaires sans données</h2>
        <p class="bilan-sous">${b.totalManquants} cellule${b.totalManquants > 1 ? "s" : ""} district × formulaire vide${b.totalManquants > 1 ? "s" : ""} ou à zéro, sur ${b.totalCellules}.</p>
        <ol>${manquants}</ol>
      </article>
      <article class="bilan-carte bilan-solutions" style="--i:2">
        <h2>Solutions proposées</h2>
        <ol>${solutions}</ol>
      </article>
    </div>
  </div>`;
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
    afficherDistricts(data.districts, { onClicDistrict: ouvrirFicheDistrict, etiquettes: true, nomsEtiquettes: true, activeSeule: true, seuils: data.seuils });
    detruireCarteRegions();
    initCarteRegions("tv-map-regions", document.documentElement.dataset.theme);
    afficherRegions(data.toutesRegions, data.seuils, data.selection.regionCode);
    const districts = districtsAvecContours(data);
    if (districts.length) {
      mapTourIndex = 0;
      afficherVueComplete();
      afficherDistrictsRegion(data, null, null);
      const commencer = () => demarrerTourDistricts(districts);
      mapTourTimer = setTimeout(() => {
        if (paused) {
          mapTourTimer = setInterval(() => {
            if (!paused) {
              clearInterval(mapTourTimer);
              commencer();
            }
          }, 250);
        } else {
          commencer();
        }
      }, MAP_OVERVIEW_DURATION);
    }
  } else if (id === "reg") {
    grapheBarres("tv-chart-region", data.toutesRegions.map((region) => labelRegion(region.nom)), data.toutesRegions.map((region) => region.tauxMoyen), { statut: true, seuils: data.seuils, etiquettes: true });
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
    grapheLigne("tv-chart-evolution", weeks, data.evolution.par_region.map((series) => ({ label: labelRegion(series.region), data: series.valeurs })), { pointOnlyTooltip: true });
  }
  document.querySelectorAll("[data-district]").forEach((button) => button.addEventListener("click", () => {
    const district = data.districts.find((item) => `${item.region}||${item.nom}` === button.dataset.district);
    if (district) ouvrirFicheDistrict(district);
  }));
}

function updateProgress(slideDuration = dureeDiapositive()) {
  const fill = document.getElementById("tv-progress-fill");
  if (!fill) return;
  const arret = paused || retenues.size > 0;
  fill.style.transition = "none";
  fill.style.width = "0%";
  requestAnimationFrame(() => {
    fill.style.transition = arret || REDUIT ? "none" : `width ${slideDuration}ms linear`;
    fill.style.width = arret ? "0%" : "100%";
  });
}
function schedule(duree = dureeDiapositive()) {
  clearTimeout(timer);
  clearInterval(progressTimer);
  updateProgress(duree);
  if (paused || retenues.size) return;
  timer = setTimeout(() => show(current + 1), duree);
}
// Tant que Sokhna Ci parle ou répond, la diapositive reste affichée ; ensuite elle attend encore un court instant.
function retenir(motif) {
  if (!active) return;
  retenues.add(motif);
  clearTimeout(timer);
  updateProgress();
}
function relacher(motif, pause = 3500) {
  if (!active || !retenues.delete(motif) || retenues.size || paused) return;
  const restant = dureeDiapositive() - (Date.now() - debutDiapositive);
  schedule(Math.max(pause, restant));
}
const controleAssistante = { retenir, relacher };
function show(index, { silencieux = false } = {}) {
  if (!active) return;
  clearTimeout(mapTourTimer);
  clearInterval(mapTourTimer);
  mapTourTimer = null;
  current = (index + selectedSlides.length) % selectedSlides.length;
  const indexAffiche = current;
  const stage = document.getElementById("tv-stage");
  const slide = selectedSlides[current];
  detruireGraphiques((id) => id.startsWith("tv-"));
  stage.innerHTML = slideMarkup(slide.id);
  document.getElementById("tv-title").textContent = slide.title;
  document.getElementById("tv-counter").textContent = `${current + 1} / ${selectedSlides.length}`;
  document.getElementById("tv-extraction").textContent = `Situation de l’extraction du ${model.semaineLibelle} · Période DHIS2 : ${model.selection.periode}`;
  document.querySelectorAll(".tv-dot").forEach((dot, i) => {
    dot.classList.toggle("on", i === current);
    dot.setAttribute("aria-current", i === current ? "step" : "false");
  });
  const params = new URLSearchParams(location.hash.slice(1));
  params.set("tv", String(current));
  history.replaceState(null, "", `#${params.toString()}`);
  drawSlide(slide.id);
  retenues.clear();
  debutDiapositive = Date.now();
  if (assistante && !silencieux) {
    retenir("narration");
    Promise.resolve(assistante.surDiapositive(slide, model, current, selectedSlides.length))
      .catch(() => {})
      .finally(() => { if (current === indexAffiche) relacher("narration", 3500); });
  }
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
  clearTimeout(mapTourTimer);
  clearInterval(mapTourTimer);
  mapTourTimer = null;
  clearInterval(refreshTimer);
  clearInterval(clockTimer);
  retenues.clear();
  assistante?.arreter();
  assistante = null;
  document.removeEventListener("keydown", onKeydown);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("online", onOnlineChange);
  window.removeEventListener("offline", onOnlineChange);
  document.body.classList.remove("tv");
  document.getElementById("tvbar")?.remove();
  document.getElementById("tv-stage")?.remove();
  detruireCarte();
  detruireCarteRegions();
  detruireGraphiques((id) => id.startsWith("tv-"));
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
  else if (event.key.toLowerCase() === "q" && assistante) { event.preventDefault(); assistante.ouvrirQuestion(); }
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
    if (updated) { model = updated; assistante?.mettreAJour(model); show(current, { silencieux: true }); }
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

export function demarrerDiaporama(currentModel, { initialSlide = 0, refresh, close: onExit, assistante: assistanteTV = null } = {}) {
  if (active || !currentModel) return;
  model = currentModel;
  onClose = onExit;
  onRefresh = refresh;
  assistante = assistanteTV;
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
  majHorloge();
  clockTimer = setInterval(majHorloge, 15 * 1000);
  assistante?.demarrer(model, controleAssistante);
  show(current);
}
