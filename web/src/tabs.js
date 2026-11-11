import { grapheBarres, grapheBarresEmpilees, grapheDoughnut, grapheLigne, couleurStatut } from "./charts.js";
import { afficherDistricts, detruireCarte, initCarte } from "./map.js";
import { ouvrirFicheDistrict } from "./drawer.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function libelleRegion(value) { return value.replace(/^DRS[_ ]/, ""); }
function pct(value) { return value === null || value === undefined ? "—" : `${Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}%`; }
function moyenne(values) {
  const items = values.filter((value) => value !== null && value !== undefined);
  return items.length ? Math.round(items.reduce((a, b) => a + b, 0) / items.length * 10) / 10 : null;
}
function puce(statut) { return `<span class="statut-puce statut-${statut}" aria-hidden="true"></span>`; }
function delta(value) {
  if (value === null || value === undefined) return `<span class="variation flat">—</span>`;
  const state = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const sign = value > 0 ? "+" : "";
  const glyph = value > 0 ? "↑" : value < 0 ? "↓" : "→";
  return `<span class="variation ${state}">${glyph} ${sign}${Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} pt</span>`;
}
function enteteSection(titre, description, contexte = "") {
  return `<div class="section-intro"><div><p class="eyebrow">SUIVI DE LA COMPLÉTUDE</p><h2>${titre}</h2><p>${description}</p></div>${contexte ? `<div class="section-context">${contexte}</div>` : ""}</div>`;
}
function kpi(titre, valeur, icone, note, classe = "", variation = null) {
  const deltaTexte = variation === null ? "" : delta(variation);
  return `<article class="card kpi-card ${classe}"><div class="kpi-top"><span class="kpi-label">${titre}</span><span class="kpi-icon" aria-hidden="true">${icone}</span></div><div class="kpi-value">${valeur}</div><div class="kpi-foot">${deltaTexte}${note ? `<span>${note}</span>` : ""}</div></article>`;
}
function moyenneRegion(regions) { return moyenne(regions.flatMap((region) => region.districts.map((district) => district.tauxMoyen))); }
function formaterDate(value) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "—";
}
function choisirFiltre(type, value) {
  window.dispatchEvent(new CustomEvent("completude:filter", { detail: { [type]: value } }));
}
function chartDataPourPeriodes(modele) {
  const parCode = new Map();
  for (const district of modele.districts) for (const formulaire of district.formulaires) {
    for (const periode of formulaire.historiquePeriodes) {
      if (!parCode.has(periode.periode_code)) parCode.set(periode.periode_code, { label: periode.periode, values: [] });
      parCode.get(periode.periode_code).values.push(periode.valeur);
    }
  }
  return [...parCode.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => ({ label: value.label, value: moyenne(value.values) }));
}

// ----------------------------- Vue d'ensemble -----------------------------

function genererSynthese(modele) {
  const { regions, districts, seuils, comparaisonCle } = modele;
  if (!districts.length) return "Aucun résultat pour cette combinaison de filtres. Élargissez la sélection ou choisissez une autre extraction.";
  const global = moyenne(districts.map((district) => district.tauxMoyen));
  const previous = moyenne(districts.map((district) => district.tauxPrecedent));
  const critiques = districts.filter((district) => district.statut === "critique");
  const meilleure = [...regions].filter((region) => region.tauxMoyen !== null).sort((a, b) => b.tauxMoyen - a.tauxMoyen)[0];
  const plusFaible = [...regions].filter((region) => region.tauxMoyen !== null).sort((a, b) => a.tauxMoyen - b.tauxMoyen)[0];
  const comparaison = comparaisonCle ? `par rapport à l’extraction du ${formaterDate(comparaisonCle)}` : "par rapport à la précédente extraction";
  const variation = global === null || previous === null ? null : Math.round((global - previous) * 10) / 10;
  const tendance = variation === null
    ? "Aucune extraction de comparaison n’est sélectionnée."
    : variation > 0 ? `Le taux moyen progresse de <strong>${pct(variation).replace("%", " points")}</strong> ${comparaison}.`
      : variation < 0 ? `Le taux moyen recule de <strong>${pct(Math.abs(variation)).replace("%", " points")}</strong> ${comparaison}.`
        : `Le taux moyen reste stable ${comparaison}.`;
  const lignes = [
    `Le taux moyen des districts affichés est de <strong>${pct(global)}</strong>.`,
    meilleure && plusFaible ? `<strong>${escapeHtml(libelleRegion(meilleure.nom))}</strong> présente le niveau le plus élevé (${pct(meilleure.tauxMoyen)}), tandis que <strong>${escapeHtml(libelleRegion(plusFaible.nom))}</strong> appelle le suivi le plus rapproché (${pct(plusFaible.tauxMoyen)}).` : "",
    critiques.length ? `<strong>${critiques.length} district${critiques.length > 1 ? "s" : ""}</strong> se situe${critiques.length > 1 ? "nt" : ""} sous le seuil critique de ${seuils.critique}%.` : `Aucun district affiché n’est sous le seuil critique de ${seuils.critique}%.`,
    tendance,
  ].filter(Boolean);
  return lignes.join(" ");
}

export function renderVue(modele) {
  const { regions, districts, seuils, evolution } = modele;
  const tauxGlobal = moyenne(districts.map((district) => district.tauxMoyen));
  const tauxPrevious = moyenne(districts.map((district) => district.tauxPrecedent));
  const variation = tauxGlobal === null || tauxPrevious === null ? null : Math.round((tauxGlobal - tauxPrevious) * 10) / 10;
  const nbCritiques = districts.filter((district) => district.statut === "critique").length;
  const nbCritiquesPrec = districts.filter((district) => district.tauxPrecedent !== null && district.tauxPrecedent < seuils.critique).length;
  const variationCritiques = modele.comparaisonCle ? nbCritiquesPrec - nbCritiques : null;
  const alertes = [...districts].filter((district) => district.statut === "critique").sort((a, b) => (a.tauxMoyen ?? 101) - (b.tauxMoyen ?? 101)).slice(0, 7);
  const aSurveiller = [...districts].filter((district) => district.statut === "surveiller").sort((a, b) => (a.tauxMoyen ?? 101) - (b.tauxMoyen ?? 101)).slice(0, 10);
  const conformes = [...districts].filter((district) => district.statut === "conforme").sort((a, b) => (b.tauxMoyen ?? 0) - (a.tauxMoyen ?? 0)).slice(0, 10);
  const contexte = `${escapeHtml(modele.selection.region)} · ${escapeHtml(modele.selection.periode)}`;
  const listeDistricts = (liste, vide) => liste.length
    ? `<ol class="priority-list">${liste.map((district, index) => `<li><button class="priority-item" type="button" data-district="${escapeHtml(district.region)}||${escapeHtml(district.nom)}"><span class="priority-rank">${String(index + 1).padStart(2, "0")}</span><span><span class="priority-name">${escapeHtml(district.nom)}</span><span class="priority-region">${escapeHtml(libelleRegion(district.region))}</span></span><span class="priority-value">${pct(district.tauxMoyen)}</span></button></li>`).join("")}</ol>`
    : `<p class="empty-state">${vide}</p>`;
  const optionsAlertes = listeDistricts(alertes, `Tous les districts affichés sont au-dessus du seuil critique de ${seuils.critique}%.`);
  const optionsSurveiller = listeDistricts(aSurveiller, "Aucun district dans la zone de vigilance pour cette sélection.");
  const optionsConformes = listeDistricts(conformes, `Aucun district n’atteint encore le seuil de conformité de ${seuils.conforme}% pour cette sélection.`);

  return `<div class="page-stack">
    ${enteteSection("Vue d’ensemble", "Un aperçu national des rapports transmis et des zones à accompagner.", contexte)}
    <section class="grid grid-kpi" aria-label="Indicateurs clés">
      ${kpi("Taux moyen", pct(tauxGlobal), "◌", modele.comparaisonCle ? `vs ${formaterDate(modele.comparaisonCle)}` : "complétude moyenne", "kpi-accent", variation)}
      ${kpi("Régions couvertes", regions.length, "⌖", "dans la sélection")}
      ${kpi("Districts analysés", districts.length, "▤", `${districts.filter((district) => district.statut !== "inconnu").length} avec une valeur disponible`)}
      ${kpi("Districts critiques", nbCritiques, "!", variationCritiques === null ? `seuil < ${seuils.critique}%` : `${variationCritiques > 0 ? "+" : ""}${variationCritiques} vs comparaison`, "kpi-critical", null)}
    </section>
    <section class="card insight-card" aria-labelledby="synthese-titre">
      <div class="insight-icon" aria-hidden="true">✳</div>
      <div class="insight-content"><p class="eyebrow" id="synthese-titre">LECTURE DE LA SITUATION</p><p>${genererSynthese(modele)}</p></div>
      <svg class="insight-sparkline" viewBox="0 0 120 34" aria-hidden="true"><path d="M2 26 C14 23 15 12 27 18 S43 28 53 18 68 8 78 17 92 20 100 10 111 12 118 4" fill="none" stroke="#8ce0b0" stroke-width="2" stroke-linecap="round"/><path d="M2 30 C14 27 15 16 27 22 S43 32 53 22 68 12 78 21 92 24 100 14 111 16 118 8" fill="none" stroke="#8ce0b0" stroke-opacity=".18" stroke-width="8" stroke-linecap="round"/></svg>
    </section>
    <section class="card map-card"><div class="card-head"><div><h2>Carte des districts</h2><p class="card-subtitle">Sélectionnez un district pour ouvrir sa fiche.</p></div><span class="card-aside">${districts.filter((district) => district.feature).length}/${districts.length} contours</span></div><div id="carte" role="group" aria-label="Carte interactive du Sénégal : taux de complétude par district"></div><div class="map-legend"><span class="legend-item"><i class="legend-swatch" style="background:var(--critique)"></i>Critique &lt; ${seuils.critique}%</span><span class="legend-item"><i class="legend-swatch" style="background:var(--surveiller)"></i>À surveiller</span><span class="legend-item"><i class="legend-swatch" style="background:var(--conforme)"></i>Conforme ≥ ${seuils.conforme}%</span></div></section>
    <section class="grid grid2">
      <article class="card"><div class="card-head"><div><h2>Évolution du taux moyen</h2><p class="card-subtitle">Une observation par extraction du lundi.</p></div></div><div class="chartbox"><canvas id="ch-evo-globale" aria-label="Évolution hebdomadaire du taux moyen"></canvas></div></article>
      <article class="card"><div class="card-head"><div><h2>Répartition des districts</h2><p class="card-subtitle">Selon les seuils de complétude</p></div></div><div class="chartbox sm"><canvas id="ch-statuts" aria-label="Répartition des districts par statut"></canvas></div></article>
    </section>
    <section class="grid grid3">
      <article class="card"><div class="card-head"><div><h2>Priorités de suivi</h2><p class="card-subtitle">Districts classés par taux moyen croissant.</p></div><span class="status-chip critique">${nbCritiques} critique${nbCritiques > 1 ? "s" : ""}</span></div>${optionsAlertes}</article>
      <article class="card"><div class="card-head"><div><h2>Districts à surveiller</h2><p class="card-subtitle">Entre ${seuils.critique}% et ${seuils.conforme}%.</p></div><span class="status-chip surveiller">${districts.filter((district) => district.statut === "surveiller").length}</span></div>${optionsSurveiller}</article>
      <article class="card"><div class="card-head"><div><h2>Districts conformes</h2><p class="card-subtitle">Taux moyen décroissant.</p></div><span class="status-chip conforme">${districts.filter((district) => district.statut === "conforme").length}</span></div>${optionsConformes}</article>
    </section>
  </div>`;
}

export function apresRenduVue(modele, theme) {
  const districts = modele.districts;
  grapheDoughnut("ch-statuts", {
    conforme: districts.filter((district) => district.statut === "conforme").length,
    surveiller: districts.filter((district) => district.statut === "surveiller").length,
    critique: districts.filter((district) => district.statut === "critique").length,
  });
  grapheLigne("ch-evo-globale", modele.evolution.semaines.map(formaterDate), [{ label: "Taux moyen", data: modele.evolution.moyenne_generale }], { filled: true });
  detruireCarte();
  initCarte("carte", theme);
  afficherDistricts(districts, { onClicDistrict: ouvrirFicheDistrict, etiquettes: true });
  document.querySelectorAll(".priority-item").forEach((button) => button.addEventListener("click", () => {
    const district = districts.find((item) => `${item.region}||${item.nom}` === button.dataset.district);
    if (district) ouvrirFicheDistrict(district);
  }));
}

// ------------------------- Régions et formulaires -------------------------

function heatCell(value, seuils) {
  const statut = value === null ? "inconnu" : value < seuils.critique ? "critique" : value < seuils.conforme ? "surveiller" : "conforme";
  return `<td class="heatmap-cell" style="background:${couleurStatut(statut)}" title="${pct(value)}">${value ?? "—"}</td>`;
}
function rowDistrict(district, index, withRegion = true) {
  return `<tr><td><button class="row-link" type="button" data-district-index="${index}">${escapeHtml(district.nom)}</button></td>${withRegion ? `<td>${escapeHtml(libelleRegion(district.region))}</td>` : ""}<td class="cell-statut cell-${district.statut}">${puce(district.statut)}${pct(district.tauxMoyen)}</td><td>${delta(district.variation)}</td></tr>`;
}

export function renderRegions(modele) {
  const { regions, formulaires, districts, seuils } = modele;
  const allFormNames = formulaires.map((formulaire) => formulaire.nom);
  const matrix = regions.map((region) => {
    const cells = allFormNames.map((name) => {
      const values = region.districts.flatMap((district) => district.formulaires.filter((form) => form.nom === name).map((form) => form.valeur));
      return heatCell(moyenne(values), seuils);
    }).join("");
    return `<tr><th scope="row">${escapeHtml(libelleRegion(region.nom))}</th>${cells}</tr>`;
  }).join("");
  const sortedDistricts = [...districts].filter((district) => district.tauxMoyen !== null).sort((a, b) => b.tauxMoyen - a.tauxMoyen);
  const top10 = sortedDistricts.slice(0, 10);
  const flop10 = sortedDistricts.slice(-10).reverse();
  const indexFor = (district) => districts.indexOf(district);
  const periodSeries = chartDataPourPeriodes(modele);
  const formLines = [...formulaires].sort((a, b) => (a.tauxMoyen ?? -1) - (b.tauxMoyen ?? -1)).map((form) => `<tr><td><button class="row-link" type="button" data-form-filter="${escapeHtml(form.nom)}">${escapeHtml(form.nom)}</button></td><td class="cell-statut">${pct(form.tauxMoyen)}</td></tr>`).join("");
  const regionLines = regions.map((region) => `<tr><td><button class="row-link" type="button" data-region-filter="${escapeHtml(region.nom)}">${escapeHtml(libelleRegion(region.nom))}</button></td><td class="cell-statut">${pct(region.tauxMoyen)}</td><td>${region.districts.length}</td><td class="cell-critique">${region.nbCritique}</td></tr>`).join("");
  const rankings = (items) => `<div class="table-scroll"><table class="ranking-table"><thead><tr><th>District</th><th>Région</th><th>Taux</th><th>Écart</th></tr></thead><tbody>${items.map((district) => rowDistrict(district, indexFor(district))).join("")}</tbody></table></div>`;
  return `<div class="page-stack">
    ${enteteSection("Régions et formulaires", "Repérez les écarts territoriaux et les formulaires qui nécessitent un appui ciblé.", `${regions.length} régions · ${formulaires.length} formulaires`)}
    <section class="grid grid2"><article class="card"><div class="card-head"><div><h2>Taux moyen par région</h2><p class="card-subtitle">Moyenne des districts selon la sélection active.</p></div></div><div class="chartbox tall"><canvas id="ch-regions"></canvas></div></article>
      <article class="card"><div class="card-head"><div><h2>Taux moyen par formulaire</h2><p class="card-subtitle">Formulaires classés du taux le plus bas au plus élevé.</p></div></div><div class="chartbox tall"><canvas id="ch-formulaires"></canvas></div></article></section>
    <section class="grid grid2"><article class="card"><div class="card-head"><div><h2>Statuts des districts par région</h2><p class="card-subtitle">Nombre de districts par niveau de complétude.</p></div></div><div class="chartbox tall"><canvas id="ch-stats-region"></canvas></div></article>
      <article class="card"><div class="card-head"><div><h2>Taux moyen par période</h2><p class="card-subtitle">Les mois restent séparés pour préserver la lecture des tendances.</p></div></div><div class="chartbox tall"><canvas id="ch-periodes"></canvas></div></article></section>
    <section class="card"><div class="card-head"><div><h2>Carte thermique · régions × formulaires</h2><p class="card-subtitle">Les couleurs suivent les seuils officiels du tableau de bord.</p></div></div><div class="table-scroll"><table class="heatmap"><thead><tr><th>Région</th>${allFormNames.map((name) => `<th title="${escapeHtml(name)}">${escapeHtml(name)}</th>`).join("")}</tr></thead><tbody>${matrix}</tbody></table></div></section>
    <section class="grid grid2"><article class="card"><div class="card-head"><div><h2>10 districts les plus performants</h2><p class="card-subtitle">Taux moyen décroissant.</p></div><span class="status-chip conforme">Top 10</span></div>${rankings(top10)}</article>
      <article class="card"><div class="card-head"><div><h2>10 districts à accompagner</h2><p class="card-subtitle">Taux moyen croissant.</p></div><span class="status-chip critique">À suivre</span></div>${rankings(flop10)}</article></section>
    <section class="grid grid2"><article class="card"><div class="card-head"><div><h2>Synthèse par région</h2><p class="card-subtitle">Comparaison rapide des territoires affichés.</p></div></div><div class="table-scroll"><table id="table-synthese-region"><thead><tr><th>Région</th><th>Taux moyen</th><th>Districts</th><th>Critiques</th></tr></thead><tbody>${regionLines}</tbody></table></div></article>
      <article class="card"><div class="card-head"><div><h2>Synthèse par formulaire</h2><p class="card-subtitle">Valeur moyenne pour le périmètre choisi.</p></div></div><div class="table-scroll"><table id="table-synthese-formulaire"><thead><tr><th>Formulaire</th><th>Taux moyen</th></tr></thead><tbody>${formLines}</tbody></table></div></article></section>
  </div>`;
}

export function apresRenduRegions(modele) {
  const { regions, formulaires, districts, seuils } = modele;
  grapheBarres("ch-regions", regions.map((region) => libelleRegion(region.nom)), regions.map((region) => region.tauxMoyen), { statut: true, seuils, onSelect: (label) => { const region = regions.find((item) => libelleRegion(item.nom) === label); if (region) choisirFiltre("region", region.nom); } });
  const sortedForms = [...formulaires].sort((a, b) => (a.tauxMoyen ?? 0) - (b.tauxMoyen ?? 0));
  grapheBarres("ch-formulaires", sortedForms.map((form) => form.nom), sortedForms.map((form) => form.tauxMoyen), { horizontal: true, statut: true, seuils, onSelect: (label) => choisirFiltre("formulaire", label) });
  grapheBarresEmpilees("ch-stats-region", regions.map((region) => libelleRegion(region.nom)), [
    { label: "Conforme", data: regions.map((region) => region.nbConforme), couleur: couleurStatut("conforme") },
    { label: "À surveiller", data: regions.map((region) => region.nbSurveiller), couleur: couleurStatut("surveiller") },
    { label: "Critique", data: regions.map((region) => region.nbCritique), couleur: couleurStatut("critique") },
  ]);
  const periods = chartDataPourPeriodes(modele);
  grapheBarres("ch-periodes", periods.map((period) => period.label), periods.map((period) => period.value), { statut: true, seuils });
  document.querySelectorAll(".row-link[data-district-index]").forEach((button) => button.addEventListener("click", () => ouvrirFicheDistrict(districts[Number(button.dataset.districtIndex)])));
  document.querySelectorAll("[data-region-filter]").forEach((button) => button.addEventListener("click", () => choisirFiltre("region", button.dataset.regionFilter)));
  document.querySelectorAll("[data-form-filter]").forEach((button) => button.addEventListener("click", () => choisirFiltre("formulaire", button.dataset.formFilter)));
  attacherTriTable("table-synthese-region");
  attacherTriTable("table-synthese-formulaire");
}

// -------------------------------- Évolution --------------------------------

export function renderEvolution(modele) {
  const { evolution } = modele;
  const weeks = evolution.semaines;
  const endIndex = weeks.indexOf(modele.semaineCle);
  const visibleWeeks = endIndex >= 0 ? weeks.slice(0, endIndex + 1) : weeks;
  const tableRows = [...visibleWeeks].reverse().map((week) => {
    const index = weeks.indexOf(week);
    const previousIndex = index - 1;
    const change = previousIndex >= 0 && evolution.moyenne_generale[index] !== null && evolution.moyenne_generale[previousIndex] !== null
      ? Math.round((evolution.moyenne_generale[index] - evolution.moyenne_generale[previousIndex]) * 10) / 10 : null;
    return `<tr><td>${formaterDate(week)}</td><td class="cell-statut">${pct(evolution.moyenne_generale[index])}</td><td>${pct(evolution.taux_remplissage[index])}</td><td>${delta(change)}</td></tr>`;
  }).join("");
  return `<div class="page-stack">
    ${enteteSection("Évolution hebdomadaire", "Suivez les résultats d’un lundi à l’autre, en conservant les périodes de rapport distinctes.", `${visibleWeeks.length} extraction${visibleWeeks.length > 1 ? "s" : ""} dans l’historique`)}
    <section class="card"><div class="card-head"><div><h2>Tendance nationale</h2><p class="card-subtitle">Moyenne pour le territoire, la période et le formulaire sélectionnés.</p></div></div><div class="chartbox xl"><canvas id="ch-evo-detail"></canvas></div></section>
    <section class="card"><div class="card-head"><div><h2>Évolution par région</h2><p class="card-subtitle">Cliquez sur une région dans la légende pour l’isoler.</p></div></div><div class="chartbox xl"><canvas id="ch-evo-regions"></canvas></div></section>
    <section class="card"><div class="card-head"><div><h2>Historique des extractions</h2><p class="card-subtitle">Une extraction hebdomadaire correspond à un lundi.</p></div></div><div class="table-scroll"><table><thead><tr><th>Semaine (lundi)</th><th>Taux moyen</th><th>Cases renseignées</th><th>Écart</th></tr></thead><tbody>${tableRows}</tbody></table></div>${visibleWeeks.length <= 1 ? `<p class="note">Une seule semaine est disponible pour le moment. La comparaison s’enrichira après les prochaines extractions.</p>` : ""}</section>
  </div>`;
}
export function apresRenduEvolution(modele) {
  const { evolution } = modele;
  const labels = evolution.semaines.map(formaterDate);
  grapheLigne("ch-evo-detail", labels, [{ label: "Taux moyen", data: evolution.moyenne_generale }], { filled: true });
  grapheLigne("ch-evo-regions", labels, evolution.par_region.map((series) => ({ label: libelleRegion(series.region), data: series.valeurs })));
}

// -------------------------------- Districts --------------------------------

export function renderDistricts(modele) {
  const regions = [...new Set(modele.districts.map((district) => district.region))].sort((a, b) => a.localeCompare(b, "fr"));
  const rows = modele.districts.map((district, index) => `<tr data-region="${escapeHtml(district.region)}" data-statut="${district.statut}" data-nom="${escapeHtml(district.nom.toLocaleLowerCase("fr"))}"><td><button class="row-link" type="button" data-district-index="${index}">${escapeHtml(district.nom)}</button></td><td>${escapeHtml(libelleRegion(district.region))}</td><td class="cell-statut cell-${district.statut}">${puce(district.statut)}${pct(district.tauxMoyen)}</td><td>${delta(district.variation)}</td><td>${district.formulaires.filter((form) => form.valeur !== null).length}/${district.formulaires.length}</td></tr>`).join("");
  return `<div class="page-stack">
    ${enteteSection("Détail par district", "Filtrez et triez les districts, puis ouvrez une fiche détaillée.", `${modele.districts.length} résultat${modele.districts.length > 1 ? "s" : ""}`)}
    <section class="card"><div class="filtres"><input type="search" id="filtre-recherche" placeholder="Rechercher un district…" aria-label="Rechercher un district"><select id="filtre-region" aria-label="Filtrer par région"><option value="">Toutes les régions</option>${regions.map((region) => `<option value="${escapeHtml(region)}">${escapeHtml(libelleRegion(region))}</option>`).join("")}</select><select id="filtre-statut" aria-label="Filtrer par statut"><option value="">Tous les statuts</option><option value="critique">Critique</option><option value="surveiller">À surveiller</option><option value="conforme">Conforme</option><option value="inconnu">Sans valeur</option></select><button class="button-primary" id="btn-export-csv" type="button"><span aria-hidden="true">↓</span> Exporter le CSV</button></div>
      <p class="table-count" id="district-count">Cliquez sur un district pour consulter les formulaires et les périodes DHIS2.</p>
      <div class="table-scroll"><table id="table-districts"><thead><tr><th class="sortable">District</th><th class="sortable">Région</th><th class="sortable">Taux moyen</th><th>Écart</th><th>Formulaires renseignés</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>
  </div>`;
}

export function apresRenduDistricts(modele) {
  const search = document.getElementById("filtre-recherche");
  const regionSelect = document.getElementById("filtre-region");
  const statusSelect = document.getElementById("filtre-statut");
  const rows = [...document.querySelectorAll("#table-districts tbody tr")];
  const count = document.getElementById("district-count");
  function filter() {
    const term = search.value.trim().toLocaleLowerCase("fr");
    let visible = 0;
    for (const row of rows) {
      const matches = (!term || row.dataset.nom.includes(term)) && (!regionSelect.value || row.dataset.region === regionSelect.value) && (!statusSelect.value || row.dataset.statut === statusSelect.value);
      row.hidden = !matches;
      if (matches) visible += 1;
    }
    count.textContent = `${visible} district${visible > 1 ? "s" : ""} affiché${visible > 1 ? "s" : ""} sur ${rows.length}. Cliquez sur un nom pour ouvrir la fiche détaillée.`;
  }
  search.addEventListener("input", filter);
  regionSelect.addEventListener("change", filter);
  statusSelect.addEventListener("change", filter);
  attacherTriTable("table-districts");
  document.querySelectorAll("#table-districts [data-district-index]").forEach((button, index) => button.addEventListener("click", () => ouvrirFicheDistrict(modele.districts[index])));
  document.getElementById("btn-export-csv").addEventListener("click", () => {
    const visibleRows = rows.filter((row) => !row.hidden);
    const escapeCsv = (value) => `"${String(value).replaceAll('"', '""')}"`;
    const content = [
      ["District", "Région", "Taux moyen", "Écart", "Statut"],
      ...visibleRows.map((row) => [row.children[0].textContent, row.children[1].textContent, row.children[2].textContent.trim(), row.children[3].textContent.trim(), row.dataset.statut]),
    ].map((line) => line.map(escapeCsv).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `districts_${modele.semaineCle}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

// --------------------------- Qualité et méthode ---------------------------

export function renderQualite(modele) {
  const { districtsNonResolus, seuils, evolution } = modele;
  const unresolvedMarkup = districtsNonResolus.length
    ? `<ul>${districtsNonResolus.map((district) => `<li>${escapeHtml(district)}</li>`).join("")}</ul>`
    : `<p class="note">Tous les districts affichés possèdent une correspondance DHIS2 exploitable.</p>`;
  return `<div class="page-stack">
    ${enteteSection("Qualité et méthode", "Contrôlez la complétude des données et consultez les règles de lecture.", `Seuils : ${seuils.critique}% / ${seuils.conforme}%`)}
    <section class="grid grid2"><article class="card"><div class="card-head"><div><h2>Cases renseignées par extraction</h2><p class="card-subtitle">Part des cellules district × période × formulaire contenant une valeur DHIS2.</p></div></div><div class="chartbox"><canvas id="ch-qualite"></canvas></div></article>
      <article class="card"><div class="card-head"><div><h2>Diagnostic des districts</h2><p class="card-subtitle">Correspondance des unités avec le gabarit d’extraction.</p></div></div><div class="diag-summary"><span class="diag-count ${districtsNonResolus.length ? "warn" : ""}">${districtsNonResolus.length}</span><div><strong>${districtsNonResolus.length ? "Correspondance à vérifier" : "Correspondances reconnues"}</strong><div class="note">${districtsNonResolus.length ? `${districtsNonResolus.length} district(s) sans UID dans les données affichées.` : "Aucun district sans UID détecté pour cette sélection."}</div></div></div>${unresolvedMarkup}</article></section>
    <section class="card"><div class="card-head"><div><h2>Seuils de lecture</h2><p class="card-subtitle">Les mêmes seuils sont appliqués aux indicateurs, tableaux et cartes.</p></div></div><ul class="definition-list"><li><strong><span class="status-chip critique">Critique</span></strong><span>Taux strictement inférieur à ${seuils.critique}% : suivi prioritaire du district et du formulaire.</span></li><li><strong><span class="status-chip surveiller">À surveiller</span></strong><span>Taux compris entre ${seuils.critique}% et ${seuils.conforme}% : progression à consolider.</span></li><li><strong><span class="status-chip conforme">Conforme</span></strong><span>Taux supérieur ou égal à ${seuils.conforme}% : niveau attendu atteint.</span></li></ul></section>
    <section class="card prose"><div class="card-head"><div><h2>Méthode de calcul</h2><p class="card-subtitle">Lecture des indicateurs de complétude DHIS2.</p></div></div><p><strong>Taux de complétude (reporting rate)</strong> : pourcentage d’unités sanitaires attendues ayant effectivement transmis leur rapport pour un formulaire et une période donnés.</p><p>Les extractions sont réalisées chaque lundi. Chaque point de la courbe correspond à un lundi distinct ; la période DHIS2 sélectionnée reste identique entre les semaines comparées, afin de ne pas confondre les mois de rapport.</p><p>Les cellules sans valeur restent visibles comme données manquantes et entrent dans le calcul du taux de remplissage de l’extraction.</p></section>
    <p class="note">${evolution.semaines.length} extraction${evolution.semaines.length > 1 ? "s" : ""} présente${evolution.semaines.length > 1 ? "s" : ""} dans l’historique analysé.</p>
  </div>`;
}
export function apresRenduQualite(modele) {
  grapheLigne("ch-qualite", modele.evolution.semaines.map(formaterDate), [{ label: "Cases renseignées", data: modele.evolution.taux_remplissage }], { percent: true });
}

function attacherTriTable(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;
  let sortedColumn = null;
  let ascending = true;
  table.querySelectorAll("thead th").forEach((header, index) => {
    header.classList.add("sortable");
    header.addEventListener("click", () => {
      const body = table.querySelector("tbody");
      const rows = [...body.querySelectorAll("tr")];
      ascending = sortedColumn === index ? !ascending : true;
      sortedColumn = index;
      table.querySelectorAll("thead th").forEach((cell) => cell.removeAttribute("aria-sort"));
      header.setAttribute("aria-sort", ascending ? "ascending" : "descending");
      rows.sort((left, right) => {
        const a = left.children[index]?.textContent.trim() || "";
        const b = right.children[index]?.textContent.trim() || "";
        const numericA = Number(a.replace(/[^\d,.-]/g, "").replace(",", "."));
        const numericB = Number(b.replace(/[^\d,.-]/g, "").replace(",", "."));
        const result = Number.isFinite(numericA) && Number.isFinite(numericB) && a !== "" && b !== "" ? numericA - numericB : a.localeCompare(b, "fr");
        return ascending ? result : -result;
      });
      rows.forEach((row) => body.appendChild(row));
    });
  });
}
