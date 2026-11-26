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
  bornesPeriodes, casesDuFormulaire, compterViolations, dimensionMetriques, exhaustiviteFormulaire, lienSaisieDhis2,
  niveauStructures, plusEnRetard, syntheseParFormulaire, tableauCompletude, tauxMoyens, unitesSansRapport,
  valeursNegatives, versionAuMoins,
} from "./qualite-calculs.js";
import { ouvrirGestionFormulaires } from "./formulaires-config.js";
import { formulairesSuivis } from "./suivi-local.js";
import { tableauDistrictsMensuel } from "./qualite-calculs.js";
import { barreCellule, brancherTableaux, carteChiffre, enteteTriable, faireCommenter, miniCourbe, pucesStatut, rechercheTableau } from "./live-ui.js";
import { commentaireQualite } from "./sokhnaci-direct.js";

let vue = "tableau"; // tableau | barres | courbes
let dernier = null; // dernières données calculées (exports, résumé pour Sokhna Ci)
let generation = 0;
let formulaireDistricts = "tous"; // tableau mensuel/annuel par district : un formulaire ou tous
let anneeDistricts = null;
let validationPeriode = "dernier"; // règles de validation : dernier mois de la sélection, ou toute la sélection
let formulaireAberrantes = null;
let exhaustivitePeriode = "dernier"; // exhaustivité : dernier mois de la sélection, ou toute la sélection

const cellule = (v, rendu = nombre) => (v === null || v === undefined ? `<td class="live-nd">${NON_DISPONIBLE}</td>` : `<td>${rendu(v)}</td>`);
const celluleTaux = (v) => (v === null || v === undefined ? `<td class="live-nd" data-v="">${NON_DISPONIBLE}</td>` : `<td data-v="${v}">${barreCellule(v, statutTaux(v), { libelle: pourcent(v) })}</td>`);
const celluleNombre = (v) => (v === null || v === undefined ? `<td class="live-nd" data-v="">${NON_DISPONIBLE}</td>` : `<td data-v="${v}">${nombre(v, 0)}</td>`);

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
  brancherTableaux(racine);
  racine.addEventListener("change", (e) => {
    if (!dernier || !e.target.dataset?.ql) return;
    if (e.target.dataset.ql === "formulaire") formulaireDistricts = e.target.value;
    if (e.target.dataset.ql === "annee") anneeDistricts = Number(e.target.value);
    if (e.target.dataset.ql === "validation-periode") { validationPeriode = e.target.value; lancerValidation(dernier, generation); return; }
    if (e.target.dataset.ql === "aberrantes-formulaire") { formulaireAberrantes = e.target.value; return; }
    if (e.target.dataset.ql === "exhaustivite-periode") { exhaustivitePeriode = e.target.value; lancerExhaustivite(dernier, generation); return; }
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
    commenter(dernier);
    lancerExhaustivite(dernier, ma); // automatiques, l'un après l'autre (DHIS2 est lent)
    lancerValidation(dernier, ma);
  } catch (erreur) {
    if (ma !== generation) return;
    corps.innerHTML = `${enteteFormulaires}${erreurHtml(erreur)}<p><button type="button" class="live-actualiser" data-action="actualiser">↻ Réessayer</button></p>`;
    dernier = null;
  }
}

function chiffresCles(d) {
  const total = d.synthese.reduce((x, f) => ({ a: x.a + (f.attendus ?? 0), r: x.r + (f.recus ?? 0), t: x.t + (f.aTemps ?? 0) }), { a: 0, r: 0, t: 0 });
  const m = tauxMoyens(d.synthese);
  const sansRapport = unitesSansRapport(d.lignes).length;
  const sur = `moyenne des ${m.formulaires} formulaire${m.formulaires > 1 ? "s" : ""}`;
  return `<section class="grid lv-kpis lv-kpis5" aria-label="Chiffres clés de la qualité des données">
    ${carteChiffre({ titre: "Complétude (taux moyen)", valeur: pourcent(m.completude), note: `${sur} · reçus ÷ attendus`, statut: statutTaux(m.completude), pourJauge: m.completude })}
    ${carteChiffre({ titre: "Promptitude (taux moyen)", valeur: pourcent(m.promptitude), note: `${sur} · à temps ÷ attendus`, statut: statutTaux(m.promptitude), pourJauge: m.promptitude })}
    ${carteChiffre({ titre: "Exhaustivité (taux moyen)", valeur: `<span id="ql-kpi-exh">…</span>`, note: `<span id="ql-kpi-exh-note">Calcul en cours : cases remplies ÷ cases des rapports reçus</span>`, statut: "inconnu", pourJauge: 0, id: "ql-kpi-exhaustivite" })}
    ${carteChiffre({ titre: "Rapports manquants", valeur: total.a ? nombre(total.a - total.r, 0) : NON_DISPONIBLE, note: `${sansRapport} unité${sansRapport > 1 ? "s" : ""} sans aucun rapport`, statut: total.a - total.r > 0 ? (m.completude < 70 ? "critique" : "surveiller") : "conforme", icone: "⌛" })}
    ${carteChiffre({ titre: "Règles de validation", valeur: `<span id="ql-kpi-violations">…</span>`, note: `<span id="ql-kpi-violations-note">Contrôle en cours</span>`, statut: "inconnu", icone: "✓", id: "ql-kpi-validation" })}
  </section>`;
}

function rendu(d, enteteFormulaires) {
  const { synthese, lignes, meta, etat } = d;
  const niveau = NIVEAUX[etat.niveau].libelle.toLowerCase();
  const retard = plusEnRetard(lignes, 10);
  const zero = unitesSansRapport(lignes);
  const lien = (l) => lienSaisieDhis2(meta.sante.lienDhis2, meta.sante.version, { ou: l.uniteUid, ds: l.formulaireUid, pe: d.periodes.at(-1) });
  const lienHtml = (l) => { const u = lien(l); return u ? `<a href="${echapper(u)}" target="_blank" rel="noopener">Ouvrir dans DHIS2 ↗</a>` : ""; };
  const effectifs = ["conforme", "surveiller", "critique", "inconnu"].map((s) => [s, lignes.filter((l) => statutTaux(l.completude) === s).length]);
  const LIB = { conforme: "≥ 90 %", surveiller: "70 à 90 %", critique: "< 70 %", inconnu: "Non disponible" };
  return `${enteteMiseAJour(d.misAJour)}
    ${enteteFormulaires}
    <p class="note">Sélection : ${echapper(resumeFiltres(etat))} · ${d.periodes.length} période${d.periodes.length > 1 ? "s" : ""} (${echapper(libellePeriode(d.periodes[0]))}${d.periodes.length > 1 ? ` à ${echapper(libellePeriode(d.periodes.at(-1)))}` : ""}). DHIS2 ${echapper(meta.sante.version || "")}.</p>
    ${chiffresCles(d)}
    <section class="card"><div class="card-head"><div><h2>Complétude, promptitude et exhaustivité par formulaire</h2><p class="card-subtitle">Rapports attendus, reçus, reçus à temps et manquants (unités affichées : ${echapper(niveau)}, périodes cumulées). Cliquez sur un en-tête pour trier.</p></div>
      <div class="ql-outils"><label class="fg-champ">Exhaustivité sur <select data-ql="exhaustivite-periode"><option value="dernier" ${exhaustivitePeriode === "dernier" ? "selected" : ""}>Dernier mois de la sélection</option><option value="tout" ${exhaustivitePeriode === "tout" ? "selected" : ""}>Toute la sélection (plus long)</option></select></label></div></div>
      <div class="table-scroll"><table id="ql-synthese" data-table="synthese"><thead><tr>${["Formulaire", "Attendus", "Reçus", "À temps", "Complétude", "Promptitude", "Exhaustivité", "Manquants"].map(enteteTriable).join("")}</tr></thead>
      <tbody>${synthese.map((s) => `<tr><th scope="row">${echapper(s.formulaire)}</th>${celluleNombre(s.attendus)}${celluleNombre(s.recus)}${celluleNombre(s.aTemps)}${celluleTaux(s.completude)}${celluleTaux(s.promptitude)}<td data-exh="${s.formulaireUid}" data-v=""><span class="live-chargement">calcul…</span></td>${celluleNombre(s.manquants)}</tr>`).join("")}</tbody>
      <tfoot><tr><th scope="row">Taux moyen (${synthese.length} formulaire${synthese.length > 1 ? "s" : ""})</th><td></td><td></td><td></td>${celluleTaux(tauxMoyens(synthese).completude)}${celluleTaux(tauxMoyens(synthese).promptitude)}<td id="ql-exh-moyenne"><span class="live-chargement">calcul…</span></td><td></td></tr></tfoot></table></div>
      <details class="ql-methode"><summary>Comment ces taux sont-ils calculés ?</summary><ul>
        <li><b>Complétude</b> = rapports reçus ÷ rapports attendus × 100 (DHIS2 « Reporting rate »).</li>
        <li><b>Promptitude</b> = rapports reçus à temps ÷ rapports attendus × 100 (DHIS2 « Reporting rate on time »).</li>
        <li><b>Exhaustivité</b> = cases numériques remplies ÷ cases des rapports reçus × 100, uniquement dans les structures qui ont envoyé le formulaire. DHIS2 n’enregistre pas les zéros (sauf éléments réglés pour les garder) : une case laissée vide parce que la valeur est 0 compte comme non remplie.</li>
        <li><b>Taux moyen</b> = moyenne simple des taux des formulaires : chaque formulaire compte pour un, comme le taux moyen de l’extraction hebdomadaire.</li></ul></details></section>
    <section class="card" id="ql-districts"><div class="card-head"><div><h2>Qualité par district — mensuelle et annuelle</h2><p class="card-subtitle">Complétude (rapports reçus / attendus) de chaque district, mois par mois et sur l’année ; districts les plus faibles en premier.</p></div>
      <div class="ql-outils">${rechercheTableau("districts", "Rechercher un district…")}<label class="fg-champ">Formulaire <select data-ql="formulaire"><option value="tous">Tous les formulaires suivis</option>${d.formulaires.map((f) => `<option value="${f.uid}" ${formulaireDistricts === f.uid ? "selected" : ""}>${echapper(f.nom)}</option>`).join("")}</select></label>
      ${d.etat.annees.length > 1 ? `<label class="fg-champ">Année <select data-ql="annee">${[...d.etat.annees].sort().reverse().map((a) => `<option ${a === anneeDistricts ? "selected" : ""}>${a}</option>`).join("")}</select></label>` : ""}${boutonsExport("districts")}</div></div>
      <div id="ql-districts-corps">${chargementHtml()}</div></section>
    <section class="card"><div class="card-head"><div><h2>Détail par ${echapper(niveau)}</h2><p class="card-subtitle">Choisissez la présentation ; les exports reprennent les filtres appliqués.</p></div>
      <div class="ql-outils">${rechercheTableau("detail", `Rechercher (${niveau}, formulaire)…`)}<span class="segmented" role="group" aria-label="Présentation">${[["tableau", "Tableau"], ["barres", "Barres"], ["courbes", "Courbes"]].map(([k, v]) => `<button type="button" data-vue="${k}" aria-pressed="${vue === k}">${v}</button>`).join("")}</span>${boutonsExport("qualite")}</div></div>
      ${pucesStatut("detail", [["tous", "Toutes", lignes.length], ...effectifs.filter(([, n]) => n).map(([s, n]) => [s, LIB[s], n])])}
      <div id="ql-vue"></div></section>
    <section class="grid grid2">
      <article class="card"><div class="card-head"><div><h2>Unités les plus en retard</h2><p class="card-subtitle">Promptitude la plus faible, puis le plus de rapports manquants.</p></div></div>
        ${retard.length ? `<ol class="ql-classement lv-classement">${retard.map((l, i) => `<li><span class="lv-rang" aria-hidden="true">${i + 1}</span><span class="lv-classement-nom"><b>${echapper(l.unite)}</b> · ${echapper(l.formulaire)}${barreCellule(l.promptitude, statutTaux(l.promptitude), { libelle: `${pourcent(l.promptitude)} à temps` })}</span><span>${l.manquants ? `${nombre(l.manquants, 0)} manquant${l.manquants > 1 ? "s" : ""}` : ""} ${lienHtml(l)}</span></li>`).join("")}</ol>` : `<p class="live-nd">${NON_DISPONIBLE}</p>`}</article>
      <article class="card"><div class="card-head"><div><h2>Unités sans aucun rapport</h2><p class="card-subtitle">Rapports attendus mais aucun reçu sur la sélection.</p></div>${zero.length ? `<span class="status-chip critique">${zero.length}</span>` : ""}</div>
        ${zero.length ? `<ul class="ql-classement">${zero.map((l) => `<li><span><span class="statut-puce statut-critique"></span><b>${echapper(l.unite)}</b> · ${echapper(l.formulaire)}</span><span>${nombre(l.attendus, 0)} attendu${l.attendus > 1 ? "s" : ""} ${lienHtml(l)}</span></li>`).join("")}</ul>` : `<p><span class="status-chip conforme">Aucune</span> Toutes les unités affichées ont transmis au moins un rapport.</p>`}</article>
    </section>
    <section class="card" id="ql-validation"><div class="card-head"><div><h2>Règles de validation</h2><p class="card-subtitle">Contrôle automatique, unité par unité (analyse DHIS2 en lecture seule : rien n’est enregistré dans DHIS2).</p></div>
      <div class="ql-outils"><label class="fg-champ">Période contrôlée <select data-ql="validation-periode"><option value="dernier" ${validationPeriode === "dernier" ? "selected" : ""}>Dernier mois de la sélection</option><option value="tout" ${validationPeriode === "tout" ? "selected" : ""}>Toute la sélection (plus long)</option></select></label>
      <button type="button" class="live-actualiser" data-action="validation">↻ Relancer le contrôle</button></div></div><div id="ql-validation-corps">${chargementHtml("Contrôle des règles de validation…")}</div></section>
    <section class="card" id="ql-anomalies"><div class="card-head"><div><h2>Valeurs aberrantes, négatives et doublons</h2><p class="card-subtitle">Formulaires suivis, périodes sélectionnées.</p></div>
      <span class="ql-outils"><label class="fg-champ">Formulaire <select data-ql="aberrantes-formulaire">${d.formulaires.map((f) => `<option value="${f.uid}" ${formulaireAberrantes === f.uid ? "selected" : ""}>${echapper(f.nom)}</option>`).join("")}</select></label><button type="button" class="live-actualiser" data-action="aberrantes">Valeurs aberrantes</button><button type="button" class="live-actualiser" data-action="negatives">Valeurs négatives</button></span></div>
      <div id="ql-anomalies-corps"><p class="note">Doublons : DHIS2 n’enregistre qu’une seule valeur par élément, période, structure et combinaison de catégories ; un doublon ne peut donc pas exister dans la base. Les valeurs manquantes correspondent aux rapports manquants ci-dessus.</p></div></section>`;
}

// Commentaire vocal automatique de Sokhna Ci (une fois par sélection ; pas de carte affichée sur la page).
function cleCommentaire(d) { return `qualite|${d.periodes.join(",")}|${d.etat.niveau}|${d.etat.unites.join(",")}|${d.formulaires.map((f) => f.uid).join(",")}`; }
function commenter(d) {
  if (document.getElementById("qualite-live")?.offsetParent !== null) faireCommenter(cleCommentaire(d), commentaireQualite(d));
}

// Exhaustivité : pour chaque formulaire, nombre de valeurs saisies (analytics, agrégation COUNT) dans les
// structures qui ont envoyé ce formulaire, rapporté au nombre de cases de leurs rapports reçus.
function niveauFormations(actualiser) {
  return lireDhis2("organisationUnitLevels.json", { fields: "level,displayName", paging: "false" }, { actualiser }).then((r) => niveauStructures(r.donnees?.organisationUnitLevels || []));
}
async function exhaustiviteDe(f, periodes, ouSelection, niveau, actualiser) {
  const ds = await lireDhis2(`dataSets/${f.uid}.json`, { fields: "dataSetElements[categoryCombo[categoryOptionCombos~size],dataElement[id,valueType,categoryCombo[categoryOptionCombos~size]]]" }, { actualiser });
  const { elements, cases } = casesDuFormulaire(ds.donnees?.dataSetElements);
  if (!elements.length) return { taux: null, valeurs: 0, casesAttendues: 0, cases: 0 };
  const ou = `ou:${ouSelection};LEVEL-${niveau}`;
  const rec = await lireDhis2("analytics.json", { dimension: [`dx:${f.uid}.ACTUAL_REPORTS`, ou], filter: `pe:${periodes.join(";")}`, skipMeta: "true" }, { actualiser });
  const rapports = new Map(lignesAnalytics(rec.donnees).map((l) => [l.ou, l.valeur]));
  const valeurs = new Map();
  for (let i = 0; i < elements.length; i += 100) {
    const r = await lireDhis2("analytics.json", { dimension: ou, filter: [`dx:${elements.slice(i, i + 100).join(";")}`, `pe:${periodes.join(";")}`], aggregationType: "COUNT", skipMeta: "true" }, { actualiser });
    for (const l of lignesAnalytics(r.donnees)) valeurs.set(l.ou, (valeurs.get(l.ou) || 0) + l.valeur);
  }
  return { ...exhaustiviteFormulaire(rapports, valeurs, cases), cases };
}

async function lancerExhaustivite(d, ma = generation, { actualiser = false } = {}) {
  const periodes = exhaustivitePeriode === "tout" ? d.periodes : d.periodes.slice(-1);
  const ouSelection = d.etat.unites.length ? d.etat.unites.join(";") : d.meta.racine.id;
  const resultats = new Map();
  d.exhaustivite = resultats;
  d.exhaustivitePeriodes = periodes;
  const cellule = (uid) => document.querySelector(`#ql-synthese [data-exh="${uid}"]`);
  for (const f of d.formulaires) { const c = cellule(f.uid); if (c) { c.dataset.v = ""; c.innerHTML = `<span class="live-chargement">calcul…</span>`; } }
  const majTotaux = (fini) => {
    if (ma !== generation) return;
    const m = tauxMoyens(d.synthese, resultats);
    const valeur = document.getElementById("ql-kpi-exh");
    const note = document.getElementById("ql-kpi-exh-note");
    const pied = document.getElementById("ql-exh-moyenne");
    const periodeTexte = `${libellePeriode(periodes[0])}${periodes.length > 1 ? ` à ${libellePeriode(periodes.at(-1))}` : ""}`;
    if (valeur) valeur.textContent = m.exhaustivite === null ? (fini ? NON_DISPONIBLE : "…") : pourcent(m.exhaustivite);
    if (note) note.textContent = fini ? `moyenne des ${m.formulairesExhaustivite} formulaires · ${periodeTexte}` : `Calcul : ${resultats.size} / ${d.formulaires.length} formulaires (${periodeTexte})…`;
    if (pied) pied.innerHTML = m.exhaustivite === null ? `<span class="live-nd">${fini ? NON_DISPONIBLE : "calcul…"}</span>` : barreCellule(m.exhaustivite, statutTaux(m.exhaustivite), { libelle: pourcent(m.exhaustivite) });
    const carte = document.getElementById("ql-kpi-exhaustivite");
    if (carte && m.exhaustivite !== null) {
      const statut = statutTaux(m.exhaustivite);
      carte.classList.remove("kpi-critical", "kpi-warn", "kpi-accent");
      carte.classList.add({ critique: "kpi-critical", surveiller: "kpi-warn", conforme: "kpi-accent" }[statut]);
      const jauge = carte.querySelector(".lv-jauge");
      if (jauge) { jauge.setAttribute("class", `lv-jauge lv-${statut}`); const arc = jauge.querySelector(".lv-jauge-arc"); const c = 2 * Math.PI * 22; arc.setAttribute("stroke-dasharray", `${((c * Math.min(100, m.exhaustivite)) / 100).toFixed(1)} ${c.toFixed(1)}`); }
    }
  };
  majTotaux(false);
  let niveau;
  try { niveau = await niveauFormations(actualiser); } catch { niveau = 4; }
  const file = [...d.formulaires];
  const travailleur = async () => {
    while (file.length) {
      const f = file.shift();
      let r;
      try { r = await exhaustiviteDe(f, periodes, ouSelection, niveau, actualiser); } catch (erreur) { r = { taux: null, erreur: erreur.message }; }
      if (ma !== generation) return;
      resultats.set(f.uid, r);
      const c = cellule(f.uid);
      if (c) {
        c.dataset.v = r.taux ?? "";
        c.className = r.taux === null ? "live-nd" : "";
        c.title = r.taux === null ? (r.erreur || NON_DISPONIBLE) : `${nombre(r.valeurs, 0)} cases remplies sur ${nombre(r.casesAttendues, 0)} (${r.cases} cases par rapport)`;
        c.innerHTML = r.taux === null ? NON_DISPONIBLE : barreCellule(r.taux, statutTaux(r.taux), { libelle: pourcent(r.taux) });
      }
      majTotaux(false);
    }
  };
  await Promise.all([travailleur(), travailleur(), travailleur()]);
  majTotaux(true);
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
    const cellule = (v, pe) => (v === null ? `<td class="heatmap-cell statut-inconnu" data-v="" title="${NON_DISPONIBLE}">—</td>` : `<td class="heatmap-cell statut-${statutTaux(v)}" data-v="${v}" title="${echapper(libellePeriode(pe))} : ${pourcent(v)}">${nombre(v)}</td>`);
    zone.innerHTML = `${enteteMiseAJour(r.misAJour)}<div class="table-scroll ql-districts-table"><table id="ql-table-districts" data-table="districts"><thead><tr>${enteteTriable("District")}${enteteTriable("Région")}${mois.map((pe) => enteteTriable(echapper(libellePeriode(pe).split(" ")[0].slice(0, 4)))).join("")}${enteteTriable(`Année ${annee}`)}<th scope="col">Tendance</th>${enteteTriable("Rapports manquants")}</tr></thead>
      <tbody>${lignes.map((l) => `<tr><th scope="row">${echapper(l.district)}</th><td>${echapper(l.region.replace(/^DRS[_ ]/, ""))}</td>${l.parMois.map((v, i) => cellule(v, mois[i])).join("")}${l.annuel === null ? `<td class="live-nd" data-v="">${NON_DISPONIBLE}</td>` : `<td data-v="${l.annuel}"><span class="status-chip ${statutTaux(l.annuel)}">${pourcent(l.annuel)}</span></td>`}<td>${miniCourbe(l.parMois, { cible: 90 })}</td><td data-v="${l.manquants}">${l.manquants > 0 ? nombre(l.manquants, 0) : "0"}</td></tr>`).join("")}</tbody></table></div>
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
    zone.innerHTML = `<div class="table-scroll"><table id="ql-detail" data-table="detail"><thead><tr>${enTetesExport().map(enteteTriable).join("")}</tr></thead><tbody>${d.lignes.map((l) => `<tr data-statut="${statutTaux(l.completude)}"><td>${echapper(l.formulaire)}</td><th scope="row">${echapper(l.unite)}</th>${celluleNombre(l.attendus)}${celluleNombre(l.recus)}${celluleNombre(l.aTemps)}${celluleTaux(l.completude)}${celluleTaux(l.promptitude)}${celluleNombre(l.manquants)}</tr>`).join("")}</tbody></table></div><p class="note" data-compteur="detail" aria-live="polite"></p>`;
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

// Unités contrôlées : celles cochées dans les filtres, sinon les régions (DHIS2 met 10 à 15 s par région et par
// mois ; tout le pays d'un coup dépasse son délai de réponse).
function unitesAControler(d) {
  if (d.etat.unites.length) {
    const liste = d.etat.niveau === "district" ? d.meta.districts : d.meta.regions;
    return liste.filter((u) => d.etat.unites.includes(u.id));
  }
  return d.meta.regions.length ? d.meta.regions : [d.meta.racine];
}

async function lancerValidation(d, ma = generation, { actualiser = false } = {}) {
  const zone = document.getElementById("ql-validation-corps");
  if (!zone) return;
  const periodes = validationPeriode === "tout" ? d.periodes : d.periodes.slice(-1);
  const bornes = bornesPeriodes(periodes);
  const unites = unitesAControler(d);
  const resultats = [];
  const echecs = [];
  let faites = 0;
  let misAJour = null;
  const progression = () => {
    if (zone.isConnected && faites < unites.length) zone.innerHTML = chargementHtml(`Contrôle des règles de validation : ${faites} / ${unites.length} unités contrôlées (${libellePeriode(periodes[0])}${periodes.length > 1 ? ` à ${libellePeriode(periodes.at(-1))}` : ""})…`);
  };
  progression();
  const file = [...unites];
  const travailleur = async () => {
    while (file.length) {
      const u = file.shift();
      try {
        const r = await analyserDhis2("dataAnalysis/validationRules", { ou: u.id, startDate: bornes.debut, endDate: bornes.fin, persist: false, notification: false }, { actualiser });
        if (Array.isArray(r.donnees)) resultats.push(...r.donnees);
        misAJour = r.misAJour;
      } catch (erreur) { echecs.push({ unite: u.nom, message: erreur.message }); }
      faites += 1;
      if (ma !== generation) return;
      progression();
    }
  };
  await Promise.all([travailleur(), travailleur(), travailleur()]);
  if (ma !== generation || !zone.isConnected) return;
  const c = compterViolations(resultats, d.meta.regions, d.meta.districts);
  d.violations = c.total;
  d.violationsDetail = c;
  majKpiValidation(c.total, unites.length - echecs.length, echecs.length);
  const liste = (titre, items) => `<div><h3 class="ql-sous-titre">${titre}</h3>${items.length ? `<ul class="ql-compteurs">${items.slice(0, 15).map((i) => `<li><span>${echapper(i.nom)}</span><b>${i.nombre}</b></li>`).join("")}</ul>` : `<p class="note">Aucune.</p>`}</div>`;
  const lien = (v) => lienSaisieDhis2(d.meta.sante.lienDhis2, d.meta.sante.version, { ou: v.organisationUnitId, pe: v.periodId });
  const periodeTexte = `${libellePeriode(periodes[0])}${periodes.length > 1 ? ` à ${libellePeriode(periodes.at(-1))}` : ""}`;
  zone.innerHTML = `${misAJour ? enteteMiseAJour(misAJour) : ""}
    <p><span class="status-chip ${c.total ? "critique" : "conforme"}">${nombre(c.total, 0)} violation${c.total > 1 ? "s" : ""}</span> sur ${unites.length - echecs.length} unité${unites.length - echecs.length > 1 ? "s" : ""} contrôlée${unites.length - echecs.length > 1 ? "s" : ""} · ${echapper(periodeTexte)}</p>
    ${echecs.length ? `<p class="live-erreur" role="status">${echecs.length} unité${echecs.length > 1 ? "s n’ont" : " n’a"} pas pu être contrôlée${echecs.length > 1 ? "s" : ""} (${echecs.map((e) => echapper(e.unite)).join(", ")}) : ${echapper(echecs[0].message)} Leurs violations ne sont pas comptées.</p>` : ""}
    ${c.total ? `<div class="grid grid3">${liste("Par règle", c.parRegle)}${liste("Par région", c.parRegion)}${liste("Par district", c.parDistrict)}</div>
    <details><summary>Voir le détail des violations (${Math.min(c.total, 300)} premières)</summary><div class="table-scroll ql-districts-table"><table><thead><tr><th>Règle</th><th>Unité</th><th>Période</th><th>Gauche</th><th>Opérateur</th><th>Droite</th><th>Importance</th><th>Corriger</th></tr></thead><tbody>
    ${resultats.slice(0, 300).map((v) => { const u = lien(v); return `<tr><td>${echapper(v.validationRuleDescription || v.validationRuleId)}</td><td>${echapper(v.organisationUnitDisplayName || v.organisationUnitId)}</td><td>${echapper(v.periodDisplayName || v.periodId)}</td>${cellule(v.leftSideValue)}<td>${echapper(v.operator || "")}</td>${cellule(v.rightSideValue)}<td>${echapper(v.importance || "")}</td><td>${u ? `<a href="${echapper(u)}" target="_blank" rel="noopener">Ouvrir dans DHIS2 ↗</a>` : ""}</td></tr>`; }).join("")}
    </tbody></table></div></details>` : echecs.length === unites.length ? "" : `<p>Aucune règle de validation n’est violée sur la sélection.</p>`}`;
}

function majKpiValidation(total, controlees, echecs) {
  const carte = document.getElementById("ql-kpi-validation");
  if (!carte) return;
  const valeur = carte.querySelector("#ql-kpi-violations");
  const note = carte.querySelector("#ql-kpi-violations-note");
  if (!controlees) { valeur.textContent = NON_DISPONIBLE; note.textContent = "Contrôle impossible pour le moment"; return; }
  valeur.textContent = nombre(total, 0);
  note.textContent = `violation${total > 1 ? "s" : ""} sur ${controlees} unité${controlees > 1 ? "s" : ""} contrôlée${controlees > 1 ? "s" : ""}${echecs ? ` (${echecs} non contrôlée${echecs > 1 ? "s" : ""})` : ""}`;
  carte.classList.remove("kpi-critical", "kpi-warn", "kpi-accent");
  carte.classList.add(total ? "kpi-critical" : "kpi-accent");
}

async function lancerAberrantes(d) {
  const zone = document.getElementById("ql-anomalies-corps");
  // DÉPEND DE LA VERSION DE DHIS2 : /api/outlierDetection existe depuis la 2.36.
  if (!versionAuMoins(d.meta.sante.version, "2.36")) {
    zone.innerHTML = `<p class="live-erreur">La recherche de valeurs aberrantes nécessite DHIS2 2.36 ou plus récent (version actuelle : ${echapper(d.meta.sante.version || "inconnue")}).</p>`;
    return;
  }
  if (!(d.etat.niveau === "district" && d.etat.unites.length === 1)) {
    zone.innerHTML = `<p class="live-erreur" role="status">Pour les valeurs aberrantes, choisissez le niveau « District » et cochez un seul district dans les filtres, puis un formulaire : ce calcul est très long pour DHIS2 (jusqu’à 1 min 30 pour un district et un formulaire), il ne peut pas être fait sur tout le pays.</p>`;
    return;
  }
  const formulaire = d.formulaires.find((f) => f.uid === formulaireAberrantes) || d.formulaires[0];
  zone.innerHTML = chargementHtml(`Recherche des valeurs aberrantes (${formulaire.nom}) : DHIS2 peut mettre 1 à 2 minutes…`);
  const bornes = bornesPeriodes(d.periodes);
  try {
    const r = await lireDhis2("outlierDetection", { ds: formulaire.uid, ou: d.etat.unites[0], startDate: bornes.debut, endDate: bornes.fin, algorithm: "MOD_Z_SCORE", maxResults: 200 }, { delaiMs: 150000 });
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
      lireDhis2("organisationUnitLevels.json", { fields: "level,displayName", paging: "false" }),
      ...d.formulaires.map((f) => lireDhis2(`dataSets/${f.uid}.json`, { fields: "dataSetElements[dataElement[id,valueType]]" })),
    ]);
    const niveauFormations = niveauStructures(niveaux.donnees?.organisationUnitLevels || []);
    const elements = [...new Set(formulaires.flatMap((r) => (r.donnees?.dataSetElements || []).filter((e) => /INTEGER|NUMBER/.test(e.dataElement?.valueType || "NUMBER")).map((e) => e.dataElement.id)))];
    const negatives = [];
    let misAJour = null;
    for (let i = 0; i < elements.length; i += 40) {
      const r = await lireDhis2("analytics.json", { dimension: [`dx:${elements.slice(i, i + 40).join(";")}`, `pe:${d.periodes.join(";")}`, `ou:${d.etat.unites[0]};LEVEL-${niveauFormations}`] });
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
  } else if (bouton.dataset.action === "validation") lancerValidation(dernier, generation, { actualiser: true });
  else if (bouton.dataset.action === "aberrantes") lancerAberrantes(dernier);
  else if (bouton.dataset.action === "negatives") lancerNegatives(dernier);
}
