// Page « Qualité des données » — partie temps réel (DHIS2 via le serveur intermédiaire, lecture seule) :
// complétude et promptitude par formulaire suivi, unités en retard ou sans rapport, règles de validation,
// valeurs aberrantes et négatives. Chaque problème renvoie vers DHIS2 (nouvel onglet) pour correction.
import { analyserDhis2, lireDhis2 } from "./dhis2-client.js";
import { grapheBarres, grapheLigne } from "./charts.js";
import { dimensionOu, libellePeriode, NIVEAUX, periodesDhis2, resumeFiltres } from "./filtres-globaux.js";
import {
  anneesDisponibles, barreFiltres, boutonsExport, chargementHtml, echapper, enteteMiseAJour, erreurHtml, exporterCsv,
  exporterXlsx, filtresCourants, lignesAnalytics, metadonnees, NON_DISPONIBLE, nombre, pourcent, statutTaux,
} from "./pages-live.js";
import {
  bornesPeriodes, compterViolations, dimensionMetriques, lienSaisieDhis2, plusEnRetard, syntheseParFormulaire,
  tableauCompletude, unitesSansRapport, valeursNegatives, versionAuMoins,
} from "./qualite-calculs.js";
import { ouvrirGestionFormulaires } from "./formulaires-config.js";
import { formulairesSuivis } from "./suivi-local.js";
import { tableauDistrictsMensuel } from "./qualite-calculs.js";

let vue = "tableau"; // tableau | barres | courbes
let dernier = null; // dernières données calculées (exports, résumé pour Sokhna Ci)
let generation = 0;
let formulaireDistricts = "tous"; // tableau mensuel/annuel par district : un formulaire ou tous
let anneeDistricts = null;

const cellule = (v, rendu = nombre) => (v === null || v === undefined ? `<td class="live-nd">${NON_DISPONIBLE}</td>` : `<td>${rendu(v)}</td>`);
const celluleTaux = (v) => (v === null || v === undefined ? `<td class="live-nd">${NON_DISPONIBLE}</td>` : `<td><span class="status-chip ${statutTaux(v)}">${pourcent(v)}</span></td>`);

export function dernieresDonneesQualite() { return dernier; }

function unitesAffichees(meta, etat) {
  if (etat.niveau === "pays") return meta.racine ? [meta.racine] : [];
  const liste = etat.niveau === "district" ? meta.districts : meta.regions;
  return etat.unites.length ? liste.filter((u) => etat.unites.includes(u.id)) : liste;
}

export function monterQualite(racine) {
  if (!racine) return;
  racine.innerHTML = `<div id="ql-filtres"></div><div id="ql-corps">${chargementHtml()}</div>`;
  racine.addEventListener("click", (e) => surClic(e, racine));
  racine.addEventListener("change", (e) => {
    if (!dernier || !e.target.dataset?.ql) return;
    if (e.target.dataset.ql === "formulaire") formulaireDistricts = e.target.value;
    if (e.target.dataset.ql === "annee") anneeDistricts = Number(e.target.value);
    dessinerDistricts(dernier, generation);
  });
  charger(racine);
}

async function charger(racine, { actualiser = false } = {}) {
  const ma = ++generation;
  const corps = racine.querySelector("#ql-corps");
  corps.innerHTML = chargementHtml();
  let meta;
  try {
    meta = await metadonnees({ actualiser });
  } catch (erreur) {
    if (ma !== generation) return;
    racine.querySelector("#ql-filtres").innerHTML = "";
    corps.innerHTML = `${erreurHtml(erreur)}<p><button type="button" class="live-actualiser" data-action="actualiser">↻ Réessayer</button></p>`;
    dernier = null;
    return;
  }
  const annees = await anneesDisponibles(meta).catch(() => [new Date().getFullYear()]);
  if (ma !== generation || !racine.isConnected) return;
  const etat = filtresCourants();
  barreFiltres(racine.querySelector("#ql-filtres"), etat, { annees, unites: { region: meta.regions, district: meta.districts }, categories: [] }, () => charger(racine), { forcer: actualiser });

  const formulaires = formulairesSuivis();
  const periodes = periodesDhis2(etat);
  const enteteFormulaires = `<div class="ql-formulaires"><details><summary>${formulaires.length} formulaire${formulaires.length > 1 ? "s" : ""} suivi${formulaires.length > 1 ? "s" : ""}</summary><ul class="ql-liste-formulaires">${formulaires.map((f) => `<li>${echapper(f.nom)}</li>`).join("")}</ul></details> <button type="button" class="live-actualiser" data-action="formulaires">＋ Ajouter ou retirer des formulaires</button></div>`;
  if (!formulaires.length) {
    corps.innerHTML = `${enteteFormulaires}<p class="live-erreur" role="status">Aucun formulaire n’est encore suivi. Cliquez sur « Ajouter ou retirer des formulaires » pour choisir les formulaires DHIS2 à contrôler.</p>`;
    return;
  }
  if (!periodes.length) {
    corps.innerHTML = `${enteteFormulaires}<p class="live-erreur" role="status">Aucune période sélectionnée : cochez au moins une année et un mois (les périodes futures sont exclues).</p>`;
    return;
  }
  const unites = unitesAffichees(meta, etat);
  try {
    const r = await lireDhis2("analytics.json", { dimension: [dimensionMetriques(formulaires), dimensionOu(etat, meta.racine.id)], filter: `pe:${periodes.join(";")}`, skipMeta: "true" }, { actualiser });
    if (ma !== generation || !racine.isConnected) return;
    const lignes = tableauCompletude(lignesAnalytics(r.donnees), formulaires, unites);
    dernier = { meta, etat, formulaires, periodes, unites, lignes, synthese: syntheseParFormulaire(lignes), misAJour: r.misAJour, violations: null };
    corps.innerHTML = rendu(dernier, enteteFormulaires);
    dessinerVue(dernier);
    dessinerDistricts(dernier, ma);
  } catch (erreur) {
    if (ma !== generation) return;
    corps.innerHTML = `${enteteFormulaires}${erreurHtml(erreur)}<p><button type="button" class="live-actualiser" data-action="actualiser">↻ Réessayer</button></p>`;
    dernier = null;
  }
}

function rendu(d, enteteFormulaires) {
  const { synthese, lignes, meta, etat } = d;
  const niveau = NIVEAUX[etat.niveau].libelle.toLowerCase();
  const retard = plusEnRetard(lignes, 10);
  const zero = unitesSansRapport(lignes);
  const lien = (l) => lienSaisieDhis2(meta.sante.lienDhis2, meta.sante.version, { ou: l.uniteUid, ds: l.formulaireUid, pe: d.periodes.at(-1) });
  const lienHtml = (l) => { const u = lien(l); return u ? `<a href="${echapper(u)}" target="_blank" rel="noopener">Ouvrir dans DHIS2 ↗</a>` : ""; };
  return `${enteteMiseAJour(d.misAJour)}
    ${enteteFormulaires}
    <p class="note">Sélection : ${echapper(resumeFiltres(etat))} · ${d.periodes.length} période${d.periodes.length > 1 ? "s" : ""} (${echapper(libellePeriode(d.periodes[0]))}${d.periodes.length > 1 ? ` à ${echapper(libellePeriode(d.periodes.at(-1)))}` : ""}). DHIS2 ${echapper(meta.sante.version || "")}.</p>
    <section class="card"><div class="card-head"><div><h2>Complétude et promptitude par formulaire</h2><p class="card-subtitle">Rapports attendus, reçus, reçus à temps et manquants (unités affichées : ${echapper(niveau)}, périodes cumulées).</p></div></div>
      <div class="table-scroll"><table id="ql-synthese"><thead><tr><th>Formulaire</th><th>Attendus</th><th>Reçus</th><th>À temps</th><th>Complétude</th><th>Promptitude</th><th>Manquants</th></tr></thead>
      <tbody>${synthese.map((s) => `<tr><th scope="row">${echapper(s.formulaire)}</th>${cellule(s.attendus, (v) => nombre(v, 0))}${cellule(s.recus, (v) => nombre(v, 0))}${cellule(s.aTemps, (v) => nombre(v, 0))}${celluleTaux(s.completude)}${celluleTaux(s.promptitude)}${cellule(s.manquants, (v) => nombre(v, 0))}</tr>`).join("")}</tbody></table></div></section>
    <section class="card" id="ql-districts"><div class="card-head"><div><h2>Qualité par district — mensuelle et annuelle</h2><p class="card-subtitle">Complétude (rapports reçus / attendus) de chaque district, mois par mois et sur l’année ; districts les plus faibles en premier.</p></div>
      <div class="ql-outils"><label class="fg-champ">Formulaire <select data-ql="formulaire"><option value="tous">Tous les formulaires suivis</option>${d.formulaires.map((f) => `<option value="${f.uid}" ${formulaireDistricts === f.uid ? "selected" : ""}>${echapper(f.nom)}</option>`).join("")}</select></label>
      ${d.etat.annees.length > 1 ? `<label class="fg-champ">Année <select data-ql="annee">${[...d.etat.annees].sort().reverse().map((a) => `<option ${a === anneeDistricts ? "selected" : ""}>${a}</option>`).join("")}</select></label>` : ""}${boutonsExport("districts")}</div></div>
      <div id="ql-districts-corps">${chargementHtml()}</div></section>
    <section class="card"><div class="card-head"><div><h2>Détail par ${echapper(niveau)}</h2><p class="card-subtitle">Choisissez la présentation ; les exports reprennent les filtres appliqués.</p></div>
      <div class="ql-outils"><span class="segmented" role="group" aria-label="Présentation">${[["tableau", "Tableau"], ["barres", "Barres"], ["courbes", "Courbes"]].map(([k, v]) => `<button type="button" data-vue="${k}" aria-pressed="${vue === k}">${v}</button>`).join("")}</span>${boutonsExport("qualite")}</div></div>
      <div id="ql-vue"></div></section>
    <section class="grid grid2">
      <article class="card"><div class="card-head"><div><h2>Unités les plus en retard</h2><p class="card-subtitle">Promptitude la plus faible, puis le plus de rapports manquants.</p></div></div>
        ${retard.length ? `<ol class="ql-classement">${retard.map((l) => `<li><span><b>${echapper(l.unite)}</b> · ${echapper(l.formulaire)}</span><span><span class="status-chip ${statutTaux(l.promptitude)}">${pourcent(l.promptitude)}</span> ${l.manquants ? `${nombre(l.manquants, 0)} manquant${l.manquants > 1 ? "s" : ""}` : ""} ${lienHtml(l)}</span></li>`).join("")}</ol>` : `<p class="live-nd">${NON_DISPONIBLE}</p>`}</article>
      <article class="card"><div class="card-head"><div><h2>Unités sans aucun rapport</h2><p class="card-subtitle">Rapports attendus mais aucun reçu sur la sélection.</p></div></div>
        ${zero.length ? `<ul class="ql-classement">${zero.map((l) => `<li><span><b>${echapper(l.unite)}</b> · ${echapper(l.formulaire)}</span><span>${nombre(l.attendus, 0)} attendu${l.attendus > 1 ? "s" : ""} ${lienHtml(l)}</span></li>`).join("")}</ul>` : `<p><span class="status-chip conforme">Aucune</span> Toutes les unités affichées ont transmis au moins un rapport.</p>`}</article>
    </section>
    <section class="card" id="ql-validation"><div class="card-head"><div><h2>Règles de validation</h2><p class="card-subtitle">Analyse DHIS2 en lecture seule : rien n’est enregistré dans DHIS2.</p></div>
      <button type="button" class="live-actualiser" data-action="validation">Lancer le contrôle</button></div><div id="ql-validation-corps"><p class="note">Le contrôle porte sur ${etat.unites.length === 1 ? "l’unité choisie" : "tout le pays"} et les périodes sélectionnées.</p></div></section>
    <section class="card" id="ql-anomalies"><div class="card-head"><div><h2>Valeurs aberrantes, négatives et doublons</h2><p class="card-subtitle">Formulaires suivis, périodes sélectionnées.</p></div>
      <span class="ql-outils"><button type="button" class="live-actualiser" data-action="aberrantes">Valeurs aberrantes</button><button type="button" class="live-actualiser" data-action="negatives">Valeurs négatives</button></span></div>
      <div id="ql-anomalies-corps"><p class="note">Doublons : DHIS2 n’enregistre qu’une seule valeur par élément, période, structure et combinaison de catégories ; un doublon ne peut donc pas exister dans la base. Les valeurs manquantes correspondent aux rapports manquants ci-dessus.</p></div></section>`;
}

// Districts concernés par la sélection : districts choisis, districts des régions choisies, ou tous.
function districtsDeLaSelection(d) {
  const nomRegion = new Map(d.meta.regions.map((r) => [r.id, r.nom]));
  const avecRegion = (liste) => liste.map((x) => ({ ...x, region: nomRegion.get(x.parent) || "" }));
  if (d.etat.niveau === "district" && d.etat.unites.length) return avecRegion(d.meta.districts.filter((x) => d.etat.unites.includes(x.id)));
  if (d.etat.niveau === "region" && d.etat.unites.length) return avecRegion(d.meta.districts.filter((x) => d.etat.unites.includes(x.parent)));
  return avecRegion(d.meta.districts);
}

async function dessinerDistricts(d, ma) {
  const zone = document.getElementById("ql-districts-corps");
  if (!zone) return;
  const annee = d.etat.annees.includes(anneeDistricts) ? anneeDistricts : Math.max(...d.etat.annees);
  const limite = new Date().getFullYear() * 100 + new Date().getMonth() + 1;
  const mois = [...d.etat.mois].sort((a, b) => a - b).map((m) => `${annee}${String(m).padStart(2, "0")}`).filter((pe) => Number(pe) <= limite);
  const formulaires = formulaireDistricts === "tous" ? d.formulaires : d.formulaires.filter((f) => f.uid === formulaireDistricts);
  const districts = districtsDeLaSelection(d);
  if (!mois.length || !formulaires.length || !districts.length) { zone.innerHTML = `<p class="live-nd">${NON_DISPONIBLE}</p>`; return; }
  zone.innerHTML = chargementHtml("Chargement de la complétude par district…");
  const tous = districts.length === d.meta.districts.length;
  try {
    const r = await lireDhis2("analytics.json", {
      dimension: [`dx:${formulaires.flatMap((f) => [`${f.uid}.ACTUAL_REPORTS`, `${f.uid}.EXPECTED_REPORTS`]).join(";")}`, `pe:${mois.join(";")}`, tous ? `ou:${d.meta.racine.id};LEVEL-${NIVEAUX.district.niveau}` : `ou:${districts.map((x) => x.id).join(";")}`],
      skipMeta: "true",
    });
    if (ma !== generation || !zone.isConnected) return;
    const lignes = tableauDistrictsMensuel(lignesAnalytics(r.donnees), formulaires.map((f) => f.uid), districts, mois);
    d.districts = { annee, mois, lignes, formulaire: formulaireDistricts === "tous" ? "Tous les formulaires suivis" : formulaires[0].nom };
    const cellule = (v) => (v === null ? `<td class="heatmap-cell statut-inconnu" title="${NON_DISPONIBLE}">—</td>` : `<td class="heatmap-cell statut-${statutTaux(v)}">${nombre(v)}</td>`);
    zone.innerHTML = `${enteteMiseAJour(r.misAJour)}<div class="table-scroll ql-districts-table"><table id="ql-table-districts"><thead><tr><th>District</th><th>Région</th>${mois.map((pe) => `<th>${echapper(libellePeriode(pe).split(" ")[0].slice(0, 4))}</th>`).join("")}<th>Année ${annee}</th><th>Rapports manquants</th></tr></thead>
      <tbody>${lignes.map((l) => `<tr><th scope="row">${echapper(l.district)}</th><td>${echapper(l.region.replace(/^DRS[_ ]/, ""))}</td>${l.parMois.map(cellule).join("")}${l.annuel === null ? `<td class="live-nd">${NON_DISPONIBLE}</td>` : `<td><span class="status-chip ${statutTaux(l.annuel)}">${pourcent(l.annuel)}</span></td>`}<td>${l.manquants > 0 ? nombre(l.manquants, 0) : "0"}</td></tr>`).join("")}</tbody></table></div>
      <p class="note">Rouge : moins de 70 % · jaune : 70 à 90 % · vert : 90 % et plus. « — » : aucun rapport attendu ce mois-là. L’annuel additionne les rapports reçus et attendus des mois choisis.</p>`;
  } catch (erreur) { if (zone.isConnected) zone.innerHTML = erreurHtml(erreur); }
}

function enTetesExport() { return ["Formulaire", "Unité", "Attendus", "Reçus", "À temps", "Complétude (%)", "Promptitude (%)", "Manquants"]; }
function lignesExport(d) {
  const v = (x) => (x === null || x === undefined ? NON_DISPONIBLE : x);
  return d.lignes.map((l) => [l.formulaire, l.unite, v(l.attendus), v(l.recus), v(l.aTemps), v(l.completude), v(l.promptitude), v(l.manquants)]);
}

async function dessinerVue(d) {
  const zone = document.getElementById("ql-vue");
  if (!zone) return;
  if (vue === "tableau") {
    zone.innerHTML = `<div class="table-scroll"><table id="ql-detail"><thead><tr>${enTetesExport().map((t) => `<th>${t}</th>`).join("")}</tr></thead><tbody>${d.lignes.map((l) => `<tr><td>${echapper(l.formulaire)}</td><th scope="row">${echapper(l.unite)}</th>${cellule(l.attendus, (x) => nombre(x, 0))}${cellule(l.recus, (x) => nombre(x, 0))}${cellule(l.aTemps, (x) => nombre(x, 0))}${celluleTaux(l.completude)}${celluleTaux(l.promptitude)}${cellule(l.manquants, (x) => nombre(x, 0))}</tr>`).join("")}</tbody></table></div>`;
    return;
  }
  if (vue === "barres") {
    zone.innerHTML = d.formulaires.map((f, i) => {
      const n = d.lignes.filter((l) => l.formulaireUid === f.uid).length;
      return `<h3 class="ql-sous-titre">${echapper(f.nom)} — complétude</h3><div class="chartbox" style="height:${Math.max(220, n * 22 + 60)}px"><canvas id="ql-barres-${i}" role="img" aria-label="Complétude par unité, ${echapper(f.nom)}"></canvas></div>`;
    }).join("");
    d.formulaires.forEach((f, i) => {
      const l = d.lignes.filter((x) => x.formulaireUid === f.uid);
      grapheBarres(`ql-barres-${i}`, l.map((x) => x.unite), l.map((x) => x.completude), { horizontal: true, statut: true, etiquettes: true });
    });
    return;
  }
  // Courbes : complétude mois par mois (ou trimestre/année) pour chaque formulaire, sur les unités choisies.
  zone.innerHTML = chargementHtml("Chargement de l’évolution…");
  try {
    const r = await lireDhis2("analytics.json", { dimension: [`dx:${d.formulaires.map((f) => `${f.uid}.REPORTING_RATE`).join(";")}`, `pe:${d.periodes.join(";")}`], filter: dimensionOu(d.etat, d.meta.racine.id), skipMeta: "true" });
    const lignes = lignesAnalytics(r.donnees);
    const valeur = (f, p) => { const t = lignes.find((l) => l.dx === `${f.uid}.REPORTING_RATE` && l.pe === p); return t ? Math.round(t.valeur * 10) / 10 : null; };
    if (!document.getElementById("ql-vue") || vue !== "courbes") return;
    zone.innerHTML = `<div class="chartbox"><canvas id="ql-courbes" role="img" aria-label="Évolution de la complétude par période"></canvas></div><p class="note">Une période sans valeur DHIS2 apparaît comme un trou dans la courbe (${NON_DISPONIBLE.toLowerCase()}).</p>`;
    grapheLigne("ql-courbes", d.periodes.map(libellePeriode), d.formulaires.map((f) => ({ label: f.nom, data: d.periodes.map((p) => valeur(f, p)) })), { percent: true });
  } catch (erreur) {
    zone.innerHTML = erreurHtml(erreur);
  }
}

async function lancerValidation(d) {
  const zone = document.getElementById("ql-validation-corps");
  zone.innerHTML = chargementHtml("Contrôle des règles de validation en cours… (cela peut prendre une minute)");
  const bornes = bornesPeriodes(d.periodes);
  const cible = d.etat.unites.length === 1 ? d.etat.unites[0] : d.meta.racine.id;
  try {
    const r = await analyserDhis2("dataAnalysis/validationRules", { ou: cible, startDate: bornes.debut, endDate: bornes.fin, persist: false, notification: false });
    const resultats = Array.isArray(r.donnees) ? r.donnees : [];
    const c = compterViolations(resultats, d.meta.regions, d.meta.districts);
    d.violations = c.total;
    const liste = (titre, items) => `<div><h3 class="ql-sous-titre">${titre}</h3>${items.length ? `<ul class="ql-compteurs">${items.slice(0, 15).map((i) => `<li><span>${echapper(i.nom)}</span><b>${i.nombre}</b></li>`).join("")}</ul>` : `<p class="note">Aucune.</p>`}</div>`;
    const lien = (v) => lienSaisieDhis2(d.meta.sante.lienDhis2, d.meta.sante.version, { ou: v.organisationUnitId, pe: v.periodId });
    zone.innerHTML = `${enteteMiseAJour(r.misAJour)}<p><span class="status-chip ${c.total ? "critique" : "conforme"}">${c.total} violation${c.total > 1 ? "s" : ""}</span> ${c.total >= 500 ? "(DHIS2 limite le nombre de résultats renvoyés ; affinez la sélection.)" : ""}</p>
      ${c.total ? `<div class="grid grid3">${liste("Par règle", c.parRegle)}${liste("Par région", c.parRegion)}${liste("Par district", c.parDistrict)}</div>
      <details><summary>Voir le détail des violations (${Math.min(c.total, 300)} premières)</summary><div class="table-scroll"><table><thead><tr><th>Règle</th><th>Unité</th><th>Période</th><th>Gauche</th><th>Opérateur</th><th>Droite</th><th>Importance</th><th>Corriger</th></tr></thead><tbody>
      ${resultats.slice(0, 300).map((v) => { const u = lien(v); return `<tr><td>${echapper(v.validationRuleDescription || v.validationRuleId)}</td><td>${echapper(v.organisationUnitDisplayName || v.organisationUnitId)}</td><td>${echapper(v.periodDisplayName || v.periodId)}</td>${cellule(v.leftSideValue)}<td>${echapper(v.operator || "")}</td>${cellule(v.rightSideValue)}<td>${echapper(v.importance || "")}</td><td>${u ? `<a href="${echapper(u)}" target="_blank" rel="noopener">Ouvrir dans DHIS2 ↗</a>` : ""}</td></tr>`; }).join("")}
      </tbody></table></div></details>` : `<p>Aucune règle de validation n’est violée sur la sélection.</p>`}`;
  } catch (erreur) {
    zone.innerHTML = erreurHtml(erreur);
  }
}

async function lancerAberrantes(d) {
  const zone = document.getElementById("ql-anomalies-corps");
  // DÉPEND DE LA VERSION DE DHIS2 : /api/outlierDetection existe depuis la 2.36.
  if (!versionAuMoins(d.meta.sante.version, "2.36")) {
    zone.innerHTML = `<p class="live-erreur">La recherche de valeurs aberrantes nécessite DHIS2 2.36 ou plus récent (version actuelle : ${echapper(d.meta.sante.version || "inconnue")}).</p>`;
    return;
  }
  zone.innerHTML = chargementHtml("Recherche des valeurs aberrantes…");
  const bornes = bornesPeriodes(d.periodes);
  const unites = d.etat.unites.length ? d.etat.unites : [d.meta.racine.id];
  try {
    const r = await lireDhis2("outlierDetection", { ds: d.formulaires.map((f) => f.uid), ou: unites, startDate: bornes.debut, endDate: bornes.fin, algorithm: "Z_SCORE", threshold: 3, maxResults: 200, orderBy: "Z_SCORE" });
    const valeurs = r.donnees?.outlierValues || [];
    const lien = (v) => lienSaisieDhis2(d.meta.sante.lienDhis2, d.meta.sante.version, { ou: v.ou, pe: v.pe });
    zone.innerHTML = `${enteteMiseAJour(r.misAJour)}<p><span class="status-chip ${valeurs.length ? "surveiller" : "conforme"}">${valeurs.length} valeur${valeurs.length > 1 ? "s" : ""} aberrante${valeurs.length > 1 ? "s" : ""}</span> (écart à la moyenne supérieur à 3 écarts-types)</p>
      ${valeurs.length ? `<div class="table-scroll"><table><thead><tr><th>Élément</th><th>Structure</th><th>Période</th><th>Valeur</th><th>Moyenne</th><th>Score Z</th><th>Corriger</th></tr></thead><tbody>${valeurs.map((v) => { const u = lien(v); return `<tr><td>${echapper(v.deName || v.de)}${v.cocName && v.cocName !== "default" ? ` · ${echapper(v.cocName)}` : ""}</td><td>${echapper(v.ouName || v.ou)}</td><td>${echapper(libellePeriode(v.pe))}</td>${cellule(v.value)}${cellule(v.mean)}${cellule(v.zScore, (x) => nombre(x, 2))}<td>${u ? `<a href="${echapper(u)}" target="_blank" rel="noopener">Ouvrir dans DHIS2 ↗</a>` : ""}</td></tr>`; }).join("")}</tbody></table></div>` : ""}`;
  } catch (erreur) {
    zone.innerHTML = erreurHtml(erreur);
  }
}

async function lancerNegatives(d) {
  const zone = document.getElementById("ql-anomalies-corps");
  if (!(d.etat.niveau === "district" && d.etat.unites.length === 1)) {
    zone.innerHTML = `<p class="live-erreur" role="status">Pour rechercher les valeurs négatives structure par structure, choisissez le niveau « District » et cochez un seul district (la recherche sur tout le pays serait trop lourde pour DHIS2).</p>`;
    return;
  }
  zone.innerHTML = chargementHtml("Recherche des valeurs négatives…");
  try {
    const [niveaux, ...formulaires] = await Promise.all([
      lireDhis2("organisationUnitLevels.json", { fields: "level", paging: "false" }),
      ...d.formulaires.map((f) => lireDhis2(`dataSets/${f.uid}.json`, { fields: "dataSetElements[dataElement[id,valueType]]" })),
    ]);
    const niveauStructures = Math.max(...(niveaux.donnees?.organisationUnitLevels || []).map((n) => n.level));
    const elements = [...new Set(formulaires.flatMap((r) => (r.donnees?.dataSetElements || []).filter((e) => /INTEGER|NUMBER/.test(e.dataElement?.valueType || "NUMBER")).map((e) => e.dataElement.id)))];
    const negatives = [];
    let misAJour = null;
    for (let i = 0; i < elements.length; i += 40) {
      const r = await lireDhis2("analytics.json", { dimension: [`dx:${elements.slice(i, i + 40).join(";")}`, `pe:${d.periodes.join(";")}`, `ou:${d.etat.unites[0]};LEVEL-${niveauStructures}`] });
      misAJour = r.misAJour;
      for (const l of valeursNegatives(lignesAnalytics(r.donnees))) negatives.push({ ...l, element: r.donnees?.metaData?.items?.[l.dx]?.name || l.dx, structure: r.donnees?.metaData?.items?.[l.ou]?.name || l.ou });
    }
    const lien = (v) => lienSaisieDhis2(d.meta.sante.lienDhis2, d.meta.sante.version, { ou: v.ou, pe: v.pe });
    zone.innerHTML = `${misAJour ? enteteMiseAJour(misAJour) : ""}<p><span class="status-chip ${negatives.length ? "critique" : "conforme"}">${negatives.length} valeur${negatives.length > 1 ? "s" : ""} négative${negatives.length > 1 ? "s" : ""}</span> sur ${elements.length} éléments de données.</p>
      ${negatives.length ? `<div class="table-scroll"><table><thead><tr><th>Élément</th><th>Structure</th><th>Période</th><th>Valeur</th><th>Corriger</th></tr></thead><tbody>${negatives.map((v) => { const u = lien(v); return `<tr><td>${echapper(v.element)}</td><td>${echapper(v.structure)}</td><td>${echapper(libellePeriode(v.pe))}</td><td>${nombre(v.valeur)}</td><td>${u ? `<a href="${echapper(u)}" target="_blank" rel="noopener">Ouvrir dans DHIS2 ↗</a>` : ""}</td></tr>`; }).join("")}</tbody></table></div>` : ""}`;
  } catch (erreur) {
    zone.innerHTML = erreurHtml(erreur);
  }
}

function surClic(e, racine) {
  const bouton = e.target.closest("button");
  if (!bouton) return;
  if (bouton.dataset.action === "actualiser") { charger(racine, { actualiser: true }); return; }
  if (bouton.dataset.action === "formulaires") { ouvrirGestionFormulaires(() => charger(racine, { actualiser: true })); return; }
  if (!dernier) return;
  if (bouton.dataset.vue) {
    vue = bouton.dataset.vue;
    racine.querySelectorAll("[data-vue]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.vue === vue)));
    dessinerVue(dernier);
  } else if (bouton.dataset.export === "districts") {
    const t = dernier.districts;
    if (!t) return;
    const entetes = ["District", "Région", ...t.mois.map(libellePeriode), `Année ${t.annee}`, "Rapports manquants"];
    const lignes = t.lignes.map((l) => [l.district, l.region, ...l.parMois.map((v) => v ?? NON_DISPONIBLE), l.annuel ?? NON_DISPONIBLE, l.manquants]);
    const nom = `qualite_districts_${t.annee}_${new Date().toISOString().slice(0, 10)}`;
    const filtres = `${resumeFiltres(dernier.etat)} · ${t.formulaire}`;
    if (bouton.dataset.format === "csv") exporterCsv(nom, entetes, lignes, filtres);
    else exporterXlsx(nom, entetes, lignes, filtres).catch((erreur) => alert(erreur.message));
  } else if (bouton.dataset.export === "qualite") {
    const nom = `qualite_donnees_${new Date().toISOString().slice(0, 10)}`;
    const filtres = resumeFiltres(dernier.etat);
    if (bouton.dataset.format === "csv") exporterCsv(nom, enTetesExport(), lignesExport(dernier), filtres);
    else exporterXlsx(nom, enTetesExport(), lignesExport(dernier), filtres).catch((erreur) => alert(erreur.message));
  } else if (bouton.dataset.action === "validation") lancerValidation(dernier);
  else if (bouton.dataset.action === "aberrantes") lancerAberrantes(dernier);
  else if (bouton.dataset.action === "negatives") lancerNegatives(dernier);
}
