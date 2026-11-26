// Page « Indicateurs FARS » — « Situation des indicateurs de performance » sur le modèle du canevas de revue :
// Programme | Indicateur | Cible | Réalisation | Écart | Statut, regroupés par programme. Liste par défaut issue du
// canevas ; chacun peut ajouter, associer ou retirer des indicateurs (choix gardé dans son navigateur).
// Toutes les valeurs viennent de /api/analytics (dx / pe / ou) via le serveur intermédiaire ; rien n'est inventé.
import { lireDhis2 } from "./dhis2-client.js";
import { grapheBarres, grapheBarresGroupees, grapheLigne } from "./charts.js";
import { dimensionOu, libellePeriode, NIVEAUX, periodePrecedente, periodesDhis2, resumeFiltres } from "./filtres-globaux.js";
import {
  anneesDisponibles, barreFiltres, boutonsExport, chargementHtml, echapper, enteteMiseAJour, erreurHtml, exporterCsv,
  exporterXlsx, filtresCourants, lignesAnalytics, memoriser, metadonnees, NON_DISPONIBLE, nombre,
} from "./pages-live.js";
import { appliquerRealisation, categoriesDisponibles, elementsDeLExpression, statutCible, tableauIndicateurs } from "./fars-calculs.js";
import { ouvrirAjoutIndicateur } from "./fars-config.js";
import { PROGRAMMES_ORDRE } from "./fars-defaut.js";
import { barreCellule, brancherTableaux, carteChiffre, faireCommenter, miniCourbe, pucesStatut, rechercheTableau } from "./live-ui.js";
import { commentaireFars } from "./sokhnaci-direct.js";
import { enregistrerIndicateurs, indicateursPersonnalises, indicateursSuivis, reinitialiserIndicateurs } from "./suivi-local.js";

const TOUS = "Tous les programmes";
let programmeChoisi = TOUS;
let focus = null;
let generation = 0;
let dernier = null;
let comparerPar = null; // « region » ou « district » ; null = selon le niveau des filtres
let presentation = "total"; // « total » : toute la période ; « mois » : mois par mois
let indicateursEvolution = []; // indicateurs cochés pour comparer leur évolution (vide = indicateur analysé)
const MAX_EVOLUTION = 6;
let evolutionPar = "ensemble"; // analyse détaillée : « ensemble » (toute la sélection) ou « unites » (une courbe par unité)

export function dernieresDonneesFars() { return dernier; }

const valeurCellule = (v, dec = 1) => (v === null || v === undefined ? `<td class="live-nd">${NON_DISPONIBLE}</td>` : `<td>${nombre(v, dec)}</td>`);
const libelleStatut = (t) => (!t.uid ? "À associer" : t.valeur === null || t.valeur === undefined ? "Non disponible" : LIBELLE_STATUT[t.statut]);
const LIBELLE_STATUT = { conforme: "Cible atteinte", surveiller: "Proche de la cible", critique: "Loin de la cible", inconnu: "Sans cible" };

function programmesOrdonnes(indicateurs) {
  const presents = [...new Set(indicateurs.map((i) => i.programme))];
  return [...PROGRAMMES_ORDRE.filter((p) => presents.includes(p)), ...presents.filter((p) => !PROGRAMMES_ORDRE.includes(p))];
}

export function renderFars() {
  return `<div class="page-stack">
    <div class="section-intro"><div><p class="eyebrow">DHIS2 · TEMPS RÉEL</p><h2>Indicateurs FARS — situation des indicateurs de performance</h2><p>Cible, réalisation sur la période choisie, écart et statut, par programme. Ajoutez ou retirez des indicateurs à tout moment.</p></div></div>
    <section id="fars-live" class="qualite-live" aria-label="Indicateurs FARS en temps réel (DHIS2)"></section>
  </div>`;
}
export function apresRenduFars() { monterFars(document.getElementById("fars-live")); }

export function monterFars(racine) {
  if (!racine) return;
  racine.innerHTML = `<div id="fa-filtres"></div><div id="fa-corps">${chargementHtml()}</div>`;
  racine.addEventListener("click", (e) => surClic(e, racine));
  racine.addEventListener("change", (e) => surChangement(e, racine));
  brancherTableaux(racine);
  racine.addEventListener("keydown", (e) => {
    const ligne = e.target.closest?.("tr[data-focus]");
    if (ligne && e.target === ligne && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); choisirFocus(ligne.dataset.focus); }
  });
  charger(racine);
}

// Catégories de désagrégation propres à chaque indicateur (via les éléments de données de ses expressions).
function categoriesParIndicateur(uids) {
  return memoriser(`fars-cat-${uids.join(",")}`, async () => {
    const parInd = new Map();
    for (let i = 0; i < uids.length; i += 60) {
      const r = await lireDhis2("indicators.json", { filter: `id:in:[${uids.slice(i, i + 60).join(",")}]`, fields: "id,numerator,denominator", paging: "false" });
      for (const ind of r.donnees?.indicators || []) parInd.set(ind.id, elementsDeLExpression(ind.numerator, ind.denominator));
    }
    const tous = [...new Set([...parInd.values()].flat())];
    const des = new Map();
    for (let i = 0; i < tous.length; i += 100) {
      const d = await lireDhis2("dataElements.json", { filter: `id:in:[${tous.slice(i, i + 100).join(",")}]`, fields: "id,categoryCombo[categories[id,displayName,categoryOptions[id,displayName]]]", paging: "false" });
      for (const de of d.donnees?.dataElements || []) des.set(de.id, de);
    }
    return new Map([...parInd].map(([uid, liste]) => [uid, categoriesDisponibles(liste.map((id) => des.get(id)).filter(Boolean))]));
  });
}

// Trimestres DHIS2 (2026Q1…) couvrant des périodes mensuelles (202601…) ; vide si la sélection n'est pas mensuelle.
export function trimestresCouvrant(periodes) {
  if (!periodes.every((p) => /^\d{6}$/.test(p))) return [];
  return [...new Set(periodes.map((p) => `${p.slice(0, 4)}Q${Math.ceil(Number(p.slice(4)) / 3)}`))];
}

const ouDeLaSelection = (etat, meta) => (etat.unites.length ? `ou:${etat.unites.join(";")}` : `ou:${meta.racine.id}`);

async function charger(racine, { actualiser = false } = {}) {
  const ma = ++generation;
  const corps = racine.querySelector("#fa-corps");
  corps.innerHTML = chargementHtml();
  let meta;
  try { meta = await metadonnees({ actualiser }); } catch (erreur) {
    if (ma !== generation) return;
    racine.querySelector("#fa-filtres").innerHTML = "";
    corps.innerHTML = `${erreurHtml(erreur)}<p><button type="button" class="live-actualiser" data-action="actualiser">↻ Réessayer</button></p>`;
    dernier = null;
    return;
  }
  const indicateurs = indicateursSuivis();
  const associes = indicateurs.filter((i) => i.uid);
  const [annees, categories] = await Promise.all([
    anneesDisponibles(meta).catch(() => [new Date().getFullYear()]),
    associes.length ? categoriesParIndicateur(associes.map((i) => i.uid)).catch(() => new Map()) : Promise.resolve(new Map()),
  ]);
  if (ma !== generation || !racine.isConnected) return;
  const toutesCategories = [...new Map([...categories.values()].flat().map((c) => [c.id, c])).values()];
  const etat = filtresCourants();
  barreFiltres(racine.querySelector("#fa-filtres"), etat, { annees, unites: { region: meta.regions, district: meta.districts }, categories: toutesCategories }, () => charger(racine), { forcer: actualiser });

  const listeProgrammes = programmesOrdonnes(indicateurs);
  if (programmeChoisi !== TOUS && !listeProgrammes.includes(programmeChoisi)) programmeChoisi = TOUS;
  const visibles = indicateurs.filter((i) => programmeChoisi === TOUS || i.programme === programmeChoisi);
  const visiblesAssocies = visibles.filter((i) => i.uid);

  const outils = `<div class="fa-choix">
      <label class="fg-champ">Programme <select data-fa="programme">${[TOUS, ...listeProgrammes].map((p) => `<option ${p === programmeChoisi ? "selected" : ""}>${echapper(p)}</option>`).join("")}</select></label>
      <button type="button" class="live-actualiser" data-action="ajouter">＋ Ajouter un indicateur</button>
      ${indicateursPersonnalises() ? `<button type="button" class="fg-lien" data-action="defaut">Rétablir la liste par défaut du canevas</button>` : ""}
      <span class="note">${indicateurs.length} indicateur${indicateurs.length > 1 ? "s" : ""} suivi${indicateurs.length > 1 ? "s" : ""}${indicateurs.length - associes.length ? `, dont ${indicateurs.length - associes.length} à associer à DHIS2` : ""}.</span></div>`;
  const periodes = periodesDhis2(etat);
  if (!periodes.length) {
    corps.innerHTML = `${outils}<p class="live-erreur" role="status">Aucune période sélectionnée : cochez au moins une année et un mois (les périodes futures sont exclues).</p>`;
    return;
  }
  try {
    let tableau = [];
    let misAJour = new Date().toISOString();
    if (visiblesAssocies.length) {
      const dx = `dx:${visiblesAssocies.map((i) => i.uid).join(";")}`;
      const ou = ouDeLaSelection(etat, meta);
      const avecPrecedente = [...new Set([...periodes, periodePrecedente(periodes[0])].filter(Boolean))].sort();
      const [agrege, detail] = await Promise.all([
        lireDhis2("analytics.json", { dimension: dx, filter: [`pe:${periodes.join(";")}`, ou], includeNumDen: "true", skipMeta: "true" }, { actualiser }),
        lireDhis2("analytics.json", { dimension: [dx, `pe:${avecPrecedente.join(";")}`], filter: ou, skipMeta: "true" }, { actualiser }),
      ]);
      if (ma !== generation || !racine.isConnected) return;
      tableau = appliquerRealisation(tableauIndicateurs(lignesAnalytics(detail.donnees), visiblesAssocies, periodes, {}, periodePrecedente), lignesAnalytics(agrege.donnees));
      misAJour = agrege.misAJour;
      // Indicateurs de rapports trimestriels (ex. tuberculose, lèpre) : rien au mois près, on relit DHIS2 sur les
      // trimestres qui couvrent les mois choisis.
      const sansValeur = tableau.filter((t) => t.valeur === null);
      const trimestres = trimestresCouvrant(periodes);
      if (sansValeur.length && trimestres.length) {
        const r = await lireDhis2("analytics.json", { dimension: `dx:${sansValeur.map((t) => t.uid).join(";")}`, filter: [`pe:${trimestres.join(";")}`, ou], includeNumDen: "true", skipMeta: "true" }, { actualiser });
        if (ma !== generation || !racine.isConnected) return;
        const trimestriels = new Map(appliquerRealisation(sansValeur, lignesAnalytics(r.donnees)).filter((t) => t.valeur !== null).map((t) => [t.uid, { ...t, trimestriel: true }]));
        tableau = tableau.map((t) => trimestriels.get(t.uid) || t);
      }
    }
    const parId = new Map(tableau.map((t) => [t.uid, t]));
    const lignes = visibles.map((i) => (i.uid && parId.get(i.uid)) || { ...i, valeur: null, ecart: null, numerateur: null, denominateur: null, variation: { sens: null }, statut: "inconnu", serie: [] });
    if (!lignes.some((t) => t.uid && t.uid === focus)) focus = (lignes.find((t) => t.uid && t.valeur !== null) || lignes.find((t) => t.uid))?.uid || null;
    dernier = { meta, etat, periodes, tableau: lignes, programme: programmeChoisi, misAJour, categories };
    corps.innerHTML = rendu(dernier, outils);
    majLecture(dernier);
    dessinerEvolutions(dernier);
    dessinerEvolution(dernier, ma);
    dessinerComparaison(dernier, ma);
    dessinerDesagregation(dernier, ma);
  } catch (erreur) {
    if (ma !== generation) return;
    corps.innerHTML = `${outils}${erreurHtml(erreur)}<p><button type="button" class="live-actualiser" data-action="actualiser">↻ Réessayer</button></p>`;
    dernier = null;
  }
}

function libelleCible(t) {
  if (t.cible === null || t.cible === undefined) return "—";
  return `${t.sens === "bas" ? "≤ " : ""}${nombre(t.cible)}`;
}

function rendu(d, outils) {
  const associes = d.tableau.filter((t) => t.uid);
  const ind = associes.find((t) => t.uid === focus) || associes[0];
  const periodeTexte = `${libellePeriode(d.periodes[0])}${d.periodes.length > 1 ? ` à ${libellePeriode(d.periodes.at(-1))}` : ""}`;
  const groupes = programmesOrdonnes(d.tableau).map((p) => [p, d.tableau.filter((t) => t.programme === p)]);
  const lignesHtml = groupes.map(([programme, items]) => items.map((t, n) => `<tr data-id="${echapper(t.id)}" data-groupe="${echapper(programme)}" data-statut="${statutLigne(t)}"${t.uid ? ` data-focus="${t.uid}" tabindex="0" title="Cliquer pour analyser cet indicateur"` : ""} class="${t.uid && t.uid === focus ? "fa-ligne-active" : ""}">
      ${n === 0 ? `<th scope="rowgroup" rowspan="${items.length}" class="fa-programme" data-entete-groupe>${echapper(programme)}</th>` : ""}
      <td>${echapper(t.nom)}${t.uid ? "" : ` <span class="status-chip inconnu">à associer</span>`}</td>
      <td>${libelleCible(t)}</td>
      ${t.uid ? (t.valeur === null ? `<td class="live-nd">${NON_DISPONIBLE}</td>` : `<td class="fa-realisation">${barreCellule(progresCible(t), t.statut, { libelle: `${nombre(t.valeur)}${t.trimestriel ? ` <small class="note" title="Rapport trimestriel : valeur calculée sur les trimestres couvrant la période">(trim.)</small>` : ""}` })}</td>`) : `<td class="live-nd">${NON_DISPONIBLE}</td>`}
      ${t.ecart === null || t.ecart === undefined ? `<td class="live-nd">—</td>` : `<td>${t.ecart > 0 ? "+" : ""}${nombre(t.ecart)}</td>`}
      ${t.uid ? valeurCellule(t.numerateur, 0) : "<td>—</td>"}${t.uid ? valeurCellule(t.denominateur, 0) : "<td>—</td>"}
      <td class="fa-tendance">${t.uid ? miniCourbe(t.serie, { cible: t.cible }) : ""}${t.variation?.sens ? `<span class="fa-variation ${t.variation.sens}" title="Dernier mois par rapport au précédent">${t.variation.fleche} ${t.variation.ecart > 0 ? "+" : ""}${nombre(t.variation.ecart)}</span>` : t.uid ? "" : "—"}</td>
      <td><span class="status-chip ${t.statut}">${libelleStatut(t)}</span></td>
      <td class="fa-actions">${t.uid ? "" : `<button type="button" data-associer="${echapper(t.id)}">Associer</button>`}<button type="button" data-retirer="${echapper(t.id)}" aria-label="Retirer ${echapper(t.nom)} du suivi">Retirer</button></td>
    </tr>`).join("")).join("");
  const n = (s) => d.tableau.filter((t) => statutLigne(t) === s).length;
  const mesures = n("conforme") + n("surveiller") + n("critique");
  const part = mesures ? (n("conforme") / mesures) * 100 : null;
  const chiffres = `<section class="grid grid-kpi lv-kpis" aria-label="Chiffres clés des indicateurs FARS">
    ${carteChiffre({ titre: "Cible atteinte", valeur: mesures ? `${n("conforme")} <small>/ ${mesures}</small>` : NON_DISPONIBLE, note: part === null ? "Aucune valeur mesurée" : `${nombre(part, 0)} % des indicateurs mesurés`, statut: part === null ? "inconnu" : part >= 60 ? "conforme" : part >= 35 ? "surveiller" : "critique", pourJauge: part })}
    ${carteChiffre({ titre: "Proches de la cible", valeur: String(n("surveiller")), note: "au moins 80 % de la cible", statut: "surveiller", icone: "◐" })}
    ${carteChiffre({ titre: "Loin de la cible", valeur: String(n("critique")), note: "à accompagner en priorité", statut: n("critique") ? "critique" : "conforme", icone: "▼" })}
    ${carteChiffre({ titre: "Sans donnée", valeur: String(n("nd")), note: `dont ${d.tableau.filter((t) => !t.uid).length} à associer à DHIS2`, statut: "inconnu", icone: "?" })}
  </section>`;
  const puces = pucesStatut("fars", [["tous", "Tous", d.tableau.length], ["conforme", "Cible atteinte", n("conforme")], ["surveiller", "Proches", n("surveiller")], ["critique", "Loin", n("critique")], ["nd", "Sans donnée", n("nd")], ["sanscible", "Sans cible", n("sanscible")]].filter(([s, , x]) => s === "tous" || x));
  return `${enteteMiseAJour(d.misAJour)}${outils}
    <p class="note">Sélection : ${echapper(resumeFiltres(d.etat))}. Réalisation calculée par DHIS2 sur toute la période choisie (${echapper(periodeTexte)}). Statut : vert si la cible est atteinte, jaune si proche (au moins 80 % de la cible, ou au plus 125 % pour une cible maximale « ≤ »), rouge sinon.</p>
    ${chiffres}
    <section class="card"><div class="card-head"><div><h2>Situation des indicateurs de performance${d.programme === TOUS ? "" : ` — ${echapper(d.programme)}`}</h2><p class="card-subtitle">${echapper(periodeTexte)} · cliquez sur une ligne pour l’analyser.</p></div><div class="ql-outils">${rechercheTableau("fars", "Rechercher un indicateur…")}${boutonsExport("fars")}</div></div>
      ${puces}
      <div class="table-scroll"><table id="fa-tableau" class="fa-tableau" data-table="fars"><thead><tr><th>Programme</th><th>Indicateur</th><th>Cible</th><th>Réalisation</th><th>Écart</th><th>Numérateur</th><th>Dénominateur</th><th>Tendance</th><th>Statut</th><th><span class="fa-actions-titre">Suivi</span></th></tr></thead><tbody>
      ${lignesHtml || `<tr><td colspan="10" class="note">Aucun indicateur suivi : cliquez sur « Ajouter un indicateur ».</td></tr>`}
      </tbody></table></div></section>
    ${associes.length ? `<section class="card" id="fa-evolutions"><div class="card-head"><div><h2>Évolution des indicateurs</h2><p class="card-subtitle">Cochez les indicateurs à comparer (jusqu’à ${MAX_EVOLUTION}). Une seule année choisie : les indicateurs sont superposés mois par mois. Plusieurs années : un graphique par indicateur, une couleur par année, pour comparer les mêmes mois d’une année à l’autre.</p></div>
      <div class="ql-outils">${choixIndicateursEvolution(d)}</div></div>
      <div id="fa-evol-corps"></div></section>` : ""}
    ${ind ? `<section class="card" id="fa-analyse"><div class="card-head"><div><h2>Analyse détaillée</h2><p class="card-subtitle">Indicateur : <select data-fa="focus" aria-label="Indicateur analysé">${associes.map((t) => `<option value="${t.uid}" ${t.uid === ind.uid ? "selected" : ""}>${echapper(t.programme)} · ${echapper(t.nom)}</option>`).join("")}</select></p></div></div>
      <div class="fa-comp-tete"><h3 class="ql-sous-titre">Évolution par période</h3><div class="fa-comp-outils"><span class="segmented" role="group" aria-label="Évolution de l’ensemble ou par unité">${[["ensemble", "Toute la sélection"], ["unites", "Par région / district"]].map(([k, v]) => `<button type="button" data-evol-par="${k}" aria-pressed="${evolutionPar === k}">${v}</button>`).join("")}</span></div></div>
      <p class="note fa-comp-lecture" id="fa-evolution-lecture"></p><div class="chartbox fa-evol-grande"><canvas id="fa-evolution" role="img" aria-label="Évolution de l’indicateur par période"></canvas></div>
      <div class="fa-comp-tete"><h3 class="ql-sous-titre">Comparaison géographique (${echapper(periodeTexte)})</h3>${outilsComparaison(d)}</div><div id="fa-comparaison">${chargementHtml()}</div>
      <h3 class="ql-sous-titre">Désagrégation</h3><div id="fa-desagregation">${chargementHtml()}</div></section>` : ""}`;
}

// Statut d'une ligne pour les filtres : statut de cible, ou « nd » (pas de valeur / à associer), « sanscible ».
function statutLigne(t) {
  if (!t.uid || t.valeur === null || t.valeur === undefined) return "nd";
  if (t.cible === null || t.cible === undefined) return "sanscible";
  return t.statut;
}
// Avancement vers la cible en % (100 = cible atteinte) ; pour une cible maximale « ≤ », cible / valeur.
function progresCible(t) {
  if (t.cible === null || t.cible === undefined || t.valeur === null) return 100;
  if (t.sens === "bas") return t.valeur <= 0 ? 100 : (t.cible / t.valeur) * 100;
  return t.cible ? (t.valeur / t.cible) * 100 : 100;
}

function cleCommentaire(d) { return `fars|${d.periodes.join(",")}|${d.etat.niveau}|${d.etat.unites.join(",")}|${d.programme}|${d.tableau.map((t) => t.id).join(",")}`; }
// Commentaire vocal automatique de Sokhna Ci (une fois par sélection ; pas de carte affichée sur la page).
function majLecture(d) {
  if (document.getElementById("fars-live")?.offsetParent !== null) faireCommenter(cleCommentaire(d), commentaireFars(d));
}

function choisirFocus(uid) {
  if (!dernier || !uid) return;
  focus = uid;
  document.querySelectorAll("#fa-tableau tr[data-focus]").forEach((tr) => tr.classList.toggle("fa-ligne-active", tr.dataset.focus === uid));
  const select = document.querySelector('[data-fa="focus"]');
  if (select) select.value = uid;
  const ma = generation;
  dessinerEvolution(dernier, ma); dessinerComparaison(dernier, ma); dessinerDesagregation(dernier, ma); suivreFocusEvolution();
  document.getElementById("fa-analyse")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function indicateurFocus(d) { const a = d.tableau.filter((t) => t.uid); return a.find((t) => t.uid === focus) || a[0]; }

// ---------------------------------------------------------------- évolution comparée des indicateurs
const sansAnnee = (pe) => libellePeriode(pe).replace(/\s*\d{4}$/, "");
function uidsEvolution(d) {
  const associes = d.tableau.filter((t) => t.uid);
  const choisis = indicateursEvolution.filter((u) => associes.some((t) => t.uid === u));
  return choisis.length ? choisis : [indicateurFocus(d)?.uid].filter(Boolean);
}
function choixIndicateursEvolution(d) {
  const choisis = uidsEvolution(d);
  const associes = d.tableau.filter((t) => t.uid);
  const groupes = programmesOrdonnes(associes).map((p) => [p, associes.filter((t) => t.programme === p)]);
  return `<details class="fa-evol-choix"><summary>Indicateurs comparés (${choisis.length})</summary><div class="fa-evol-liste">
    ${groupes.map(([p, items]) => `<fieldset><legend>${echapper(p)}</legend>${items.map((t) => `<label><input type="checkbox" data-evol-ind="${t.uid}" ${choisis.includes(t.uid) ? "checked" : ""}> ${echapper(t.nom)}</label>`).join("")}</fieldset>`).join("")}
  </div></details>`;
}

// Une année : un graphique, une courbe par indicateur. Plusieurs années : un graphique par indicateur, une courbe
// par année sur les mêmes mois (ou trimestres), pour distinguer clairement les années.
function dessinerEvolutions(d) {
  const zone = document.getElementById("fa-evol-corps");
  if (!zone) return;
  const inds = uidsEvolution(d).map((u) => d.tableau.find((t) => t.uid === u)).filter(Boolean);
  if (!inds.length) { zone.innerHTML = `<p class="note">Cochez au moins un indicateur.</p>`; return; }
  const annees = [...new Set(d.periodes.map((p) => p.slice(0, 4)))].sort();
  const cibleTxt = (t) => (t.cible === null || t.cible === undefined ? "sans cible" : `cible ${libelleCible(t)}`);
  if (annees.length === 1) {
    const echelles = inds.length > 1 && new Set(inds.map((t) => (Math.max(...t.serie.filter((x) => x !== null), 0) > 150 ? "grand" : "petit"))).size > 1;
    zone.innerHTML = `<p class="note fa-comp-lecture"><b>Comment lire :</b> ${inds.length > 1 ? `${inds.length} indicateurs comparés sur ${annees[0]}, une couleur par indicateur (${inds.map((t) => `${echapper(t.nom)} : ${echapper(cibleTxt(t))}`).join(" ; ")}).${echelles ? " <b>Attention :</b> ces indicateurs n’ont pas la même échelle (nombres et taux) ; comparez surtout leur tendance." : ""}` : `évolution de « ${echapper(inds[0].nom)} » sur ${annees[0]}${inds[0].cible !== null && inds[0].cible !== undefined ? ` ; la ligne en pointillés marque la cible (${echapper(libelleCible(inds[0]))})` : ""}.`} Cliquez sur un nom dans la légende pour masquer ou afficher sa courbe.</p>
      <div class="chartbox fa-evol-grande"><canvas id="fa-evol-0" role="img" aria-label="Évolution comparée des indicateurs en ${annees[0]}"></canvas></div>
      ${tableauEvolution(d, inds, annees)}`;
    const un = inds.length === 1 ? inds[0] : null;
    grapheLigne("fa-evol-0", d.periodes.map(libellePeriode), inds.map((t) => ({ label: t.nom, data: t.serie })), { percent: false, pointOnlyTooltip: inds.length > 1, cible: un?.cible ?? null, libelleCible: un && un.cible !== null && un.cible !== undefined ? `Cible ${libelleCible(un)}` : "" });
    return;
  }
  // Plusieurs années : mêmes mois (ou trimestres) en abscisse, une courbe par année.
  const pas = [...new Set(d.periodes.map((p) => p.slice(4)))].sort();
  const labels = pas.map((x) => sansAnnee(`${annees[0]}${x}`));
  zone.innerHTML = `<p class="note fa-comp-lecture"><b>Comment lire :</b> un graphique par indicateur ; chaque couleur est une année (${annees.join(", ")}), sur les mêmes ${/^\d{2}$/.test(pas[0]) ? "mois" : "périodes"}. Une courbe au-dessus d’une autre indique une valeur plus élevée que l’autre année pour le même mois. Ligne en pointillés : cible.</p>
    <div class="fa-evol-annees">${inds.map((t, i) => `<figure class="fa-evol-fig"><figcaption><b>${echapper(t.nom)}</b><small>${echapper(t.programme)} · ${echapper(cibleTxt(t))}</small></figcaption><div class="chartbox"><canvas id="fa-evol-${i}" role="img" aria-label="${echapper(t.nom)} : comparaison des années ${annees.join(", ")}"></canvas></div></figure>`).join("")}</div>
    ${tableauEvolution(d, inds, annees)}`;
  inds.forEach((t, i) => {
    const parPeriode = new Map(d.periodes.map((p, k) => [p, t.serie[k]]));
    grapheLigne(`fa-evol-${i}`, labels, annees.map((a) => ({ label: a, data: pas.map((x) => parPeriode.get(`${a}${x}`) ?? null) })), { percent: false, cible: t.cible ?? null, libelleCible: t.cible === null || t.cible === undefined ? "" : `Cible ${libelleCible(t)}` });
  });
}
// Sans indicateur coché, la comparaison suit l'indicateur analysé.
function suivreFocusEvolution() {
  if (!dernier || indicateursEvolution.length) return;
  const outils = document.querySelector("#fa-evolutions .ql-outils");
  if (outils) outils.innerHTML = choixIndicateursEvolution(dernier);
  dessinerEvolutions(dernier);
}
// Tableau des valeurs (indicateur × année × période), replié sous les graphiques.
function tableauEvolution(d, inds, annees) {
  const pas = [...new Set(d.periodes.map((p) => p.slice(4)))].sort();
  const lignes = inds.flatMap((t) => annees.map((a) => {
    const parPeriode = new Map(d.periodes.map((p, k) => [p, t.serie[k]]));
    return `<tr><th scope="row">${echapper(t.nom)}</th><td>${a}</td>${pas.map((x) => { const v = d.periodes.includes(`${a}${x}`) ? parPeriode.get(`${a}${x}`) : undefined; return v === undefined ? "<td>—</td>" : v === null ? `<td class="live-nd">—</td>` : `<td>${nombre(v)}</td>`; }).join("")}</tr>`;
  }));
  return `<details><summary>Voir les valeurs</summary><div class="table-scroll"><table class="fa-table-chaude"><thead><tr><th>Indicateur</th><th>Année</th>${pas.map((x) => `<th>${echapper(sansAnnee(`${annees[0]}${x}`))}</th>`).join("")}</tr></thead><tbody>${lignes.join("")}</tbody></table></div></details>`;
}

// Analyse détaillée : courbe de l'indicateur sur toute la sélection, ou une courbe par région / district.
async function dessinerEvolution(d, ma = generation) {
  const ind = indicateurFocus(d);
  const lecture = document.getElementById("fa-evolution-lecture");
  if (!ind) return;
  const labels = d.periodes.map(libellePeriode);
  const optionsCible = { percent: false, cible: ind.cible ?? null, libelleCible: ind.cible === null || ind.cible === undefined ? "" : `Cible ${libelleCible(ind)}` };
  if (evolutionPar === "ensemble") {
    const v = ind.serie.filter((x) => x !== null);
    if (lecture) lecture.innerHTML = v.length ? `<b>Comment lire :</b> réalisation de « ${echapper(ind.nom)} » mois par mois sur toute la sélection${ind.cible !== null && ind.cible !== undefined ? ` ; la ligne en pointillés marque la cible (${echapper(libelleCible(ind))})` : ""}. Première valeur : ${nombre(v[0])}, dernière : ${nombre(v.at(-1))}, plus haute : ${nombre(Math.max(...v))}, plus basse : ${nombre(Math.min(...v))}.` : `Aucune valeur sur la période pour « ${echapper(ind.nom)} ».`;
    grapheLigne("fa-evolution", labels, [{ label: ind.nom, data: ind.serie }], { ...optionsCible, filled: true });
    return;
  }
  const ou = ouComparaison(d);
  const [, nomPluriel] = NOMS_COMPARAISON[niveauComparaison(d)];
  if (lecture) lecture.textContent = "Chargement des courbes par unité…";
  try {
    const r = await lireDhis2("analytics.json", { dimension: [`dx:${ind.uid}`, ou, `pe:${d.periodes.join(";")}`] });
    if (ma !== generation || !document.getElementById("fa-evolution")) return;
    const valeurs = new Map(lignesAnalytics(r.donnees).map((l) => [`${l.ou}|${l.pe}`, Math.round(l.valeur * 10) / 10]));
    const unites = [...new Set(lignesAnalytics(r.donnees).map((l) => l.ou))].map((u) => ({ u, nom: nomUnite(r.donnees, u), serie: d.periodes.map((p) => valeurs.get(`${u}|${p}`) ?? null) }));
    const derniere = (s) => [...s].reverse().find((x) => x !== null) ?? -Infinity;
    unites.sort((a, b) => derniere(b.serie) - derniere(a.serie));
    if (lecture) lecture.innerHTML = unites.length ? `<b>Comment lire :</b> une courbe par ${nomPluriel === "régions" ? "région" : "district"} (${unites.length} ${nomPluriel}), classées dans la légende de la plus haute à la plus basse dernière valeur. Cliquez sur un nom dans la légende pour masquer ou afficher sa courbe.${ind.cible !== null && ind.cible !== undefined ? ` Ligne en pointillés : cible (${echapper(libelleCible(ind))}).` : ""}` : `Aucune valeur par ${nomPluriel === "régions" ? "région" : "district"} sur la période.`;
    grapheLigne("fa-evolution", labels, unites.map((x) => ({ label: x.nom, data: x.serie })), { ...optionsCible, pointOnlyTooltip: true });
  } catch (erreur) { if (lecture) lecture.innerHTML = erreurHtml(erreur); }
}

// ---------------------------------------------------------------- comparaison géographique
// Régions ou districts, sur toute la période (une barre par unité, triées, ligne de cible) ou mois par mois
// (barres groupées si c'est lisible, sinon tableau coloré unités × mois). Une phrase explique la lecture.
const NOMS_COMPARAISON = { region: ["région", "régions"], district: ["district", "districts"] };
function niveauComparaison(d) {
  if (d.etat.niveau === "district") return "district";
  return comparerPar || "region";
}
function outilsComparaison(d) {
  const par = niveauComparaison(d);
  const choix = d.etat.niveau === "district" ? [["district", "Districts"]] : [["region", "Régions"], ["district", "Districts"]];
  return `<div class="fa-comp-outils">
    <label class="fg-champ">Comparer <select data-fa="comparer-par">${choix.map(([k, v]) => `<option value="${k}" ${k === par ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <span class="segmented" role="group" aria-label="Présentation de la comparaison">${[["total", "Toute la période"], ["mois", "Mois par mois"]].map(([k, v]) => `<button type="button" data-comp="${k}" aria-pressed="${presentation === k}">${v}</button>`).join("")}</span></div>`;
}
function ouComparaison(d) {
  const { etat } = d;
  const racine = d.meta.racine.id;
  if (niveauComparaison(d) === "district") {
    if (etat.niveau === "district" && etat.unites.length) return `ou:${etat.unites.join(";")}`;
    if (etat.niveau === "region" && etat.unites.length) return `ou:${etat.unites.join(";")};LEVEL-${NIVEAUX.district.niveau}`;
    return `ou:${racine};LEVEL-${NIVEAUX.district.niveau}`;
  }
  if (etat.niveau === "region" && etat.unites.length) return `ou:${etat.unites.join(";")}`;
  return `ou:${racine};LEVEL-${NIVEAUX.region.niveau}`;
}
const nomUnite = (donnees, id) => (donnees?.metaData?.items?.[id]?.name || id).replace(/^DRS[_ ]/, "");
const arrondi1 = (v) => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const majuscule = (t) => `${t[0].toUpperCase()}${t.slice(1)}`;
const LEGENDE_STATUTS = `<span class="fa-leg"><i class="conforme"></i>Cible atteinte</span><span class="fa-leg"><i class="surveiller"></i>Proche (au moins 80 % de la cible)</span><span class="fa-leg"><i class="critique"></i>Loin de la cible</span>`;

function lectureComparaison(ind, lignes, [nomSingulier, nomPluriel], periodeTexte) {
  const avec = lignes.filter((l) => l.valeur !== null);
  if (!avec.length) return "";
  const meilleur = avec[0];
  const faible = avec.at(-1);
  const aCible = ind.cible !== null && ind.cible !== undefined;
  const atteinte = aCible ? ` <b>${avec.filter((l) => statutCible(l.valeur, ind.cible, ind.sens) === "conforme").length} ${nomPluriel} sur ${avec.length}</b> atteignent la cible (${echapper(libelleCible(ind))}, ligne en pointillés).` : " Aucune cible n’est fixée pour cet indicateur.";
  return `<p class="note fa-comp-lecture"><b>Comment lire :</b> chaque barre est la réalisation de « ${echapper(ind.nom)} » dans un${nomSingulier === "région" ? "e" : ""} ${nomSingulier}, calculée par DHIS2 (numérateur ÷ dénominateur) sur ${echapper(periodeTexte)}, de la plus forte à la plus faible. La couleur indique la position par rapport à la cible.${atteinte} Plus haute : <b>${echapper(meilleur.nom)}</b> (${nombre(meilleur.valeur)}) ; plus basse : <b>${echapper(faible.nom)}</b> (${nombre(faible.valeur)}), soit un écart de ${nombre(meilleur.valeur - faible.valeur)}.</p>`;
}

async function dessinerComparaison(d, ma) {
  const zone = document.getElementById("fa-comparaison");
  const ind = indicateurFocus(d);
  if (!zone || !ind) return;
  const ou = ouComparaison(d);
  const noms = NOMS_COMPARAISON[niveauComparaison(d)];
  const [nomSingulier] = noms;
  const periodeTexte = `${libellePeriode(d.periodes[0])}${d.periodes.length > 1 ? ` à ${libellePeriode(d.periodes.at(-1))}` : ""}`;
  const aCible = ind.cible !== null && ind.cible !== undefined;
  const optionsCible = { cible: aCible ? ind.cible : null, libelleCible: `Cible ${libelleCible(ind)}` };
  const couleur = (v) => { const s = statutCible(v, ind.cible, ind.sens); return getComputedStyle(document.documentElement).getPropertyValue(`--${s === "inconnu" ? "primary" : s}`).trim() || "#087f5b"; };
  zone.innerHTML = chargementHtml();
  try {
    const total = await lireDhis2("analytics.json", { dimension: [`dx:${ind.uid}`, ou], filter: `pe:${d.periodes.join(";")}`, includeNumDen: "true" });
    if (ma !== generation || !zone.isConnected) return;
    const lignes = lignesAnalytics(total.donnees).map((l) => ({ ...l, valeur: arrondi1(l.valeur), nom: nomUnite(total.donnees, l.ou) })).sort((a, b) => b.valeur - a.valeur);
    if (!lignes.length) { zone.innerHTML = `<p class="live-nd">${NON_DISPONIBLE}</p>`; return; }
    const legende = aCible ? `<p class="fa-legende">${LEGENDE_STATUTS}<span class="fa-leg"><i class="cible"></i>Cible ${echapper(libelleCible(ind))}</span></p>` : "";
    if (presentation === "total") {
      const tableau = `<div class="table-scroll"><table><thead><tr><th>${majuscule(nomSingulier)}</th><th>Réalisation</th><th>Numérateur</th><th>Dénominateur</th><th>Statut</th></tr></thead><tbody>${lignes.map((l) => { const s = statutCible(l.valeur, ind.cible, ind.sens); return `<tr><th scope="row">${echapper(l.nom)}</th>${valeurCellule(l.valeur)}${valeurCellule(Number(l.numerator), 0)}${valeurCellule(Number(l.denominator), 0)}<td><span class="status-chip ${s}">${LIBELLE_STATUT[s]}</span></td></tr>`; }).join("")}</tbody></table></div>`;
      zone.innerHTML = `${lectureComparaison(ind, lignes, noms, periodeTexte)}${legende}
        <div class="chartbox" style="height:${Math.max(220, lignes.length * 26 + 70)}px"><canvas id="fa-barres" role="img" aria-label="Réalisation de ${echapper(ind.nom)} par ${nomSingulier}, ${echapper(periodeTexte)}"></canvas></div>
        <details><summary>Voir le tableau</summary>${tableau}</details>`;
      grapheBarres("fa-barres", lignes.map((l) => l.nom), lignes.map((l) => l.valeur), { horizontal: true, pourcent: false, etiquettes: true, couleurParValeur: couleur, nomValeur: "Réalisation", ...optionsCible });
      return;
    }
    // Mois par mois : une valeur par unité et par période.
    const r = await lireDhis2("analytics.json", { dimension: [`dx:${ind.uid}`, ou, `pe:${d.periodes.join(";")}`], skipMeta: "true" });
    if (ma !== generation || !zone.isConnected) return;
    const valeurs = new Map(lignesAnalytics(r.donnees).map((l) => [`${l.ou}|${l.pe}`, arrondi1(l.valeur)]));
    const v = (u, pe) => valeurs.get(`${u}|${pe}`) ?? null;
    const lisible = d.periodes.length <= 6 && lignes.length * d.periodes.length <= 150;
    const cellule = (x) => { if (x === null) return `<td class="fa-chaud nd">—</td>`; const s = statutCible(x, ind.cible, ind.sens); return `<td class="fa-chaud ${s}">${nombre(x)}</td>`; };
    const tableauMois = `<div class="table-scroll"><table class="fa-table-chaude"><thead><tr><th>${majuscule(nomSingulier)}</th>${d.periodes.map((pe) => `<th>${echapper(libellePeriode(pe))}</th>`).join("")}<th>Toute la période</th></tr></thead>
      <tbody>${lignes.map((l) => `<tr><th scope="row">${echapper(l.nom)}</th>${d.periodes.map((pe) => cellule(v(l.ou, pe))).join("")}${cellule(l.valeur)}</tr>`).join("")}</tbody></table></div>`;
    const lecture = `<p class="note fa-comp-lecture"><b>Comment lire :</b> réalisation de « ${echapper(ind.nom)} » pour chaque ${nomSingulier} et chaque mois${aCible ? `, comparée à la cible ${echapper(libelleCible(ind))}` : ""}. ${lisible ? `Chaque couleur de barre est un mois (voir la légende)${aCible ? " ; la ligne en pointillés marque la cible" : ""}.` : `Avec ${d.periodes.length} mois, un graphique serait illisible : le tableau colore chaque case selon la cible (vert : atteinte, jaune : proche, rouge : loin, gris : sans donnée).`} Les ${noms[1]} sont classés selon leur réalisation sur toute la période.</p>`;
    if (lisible) {
      zone.innerHTML = `${lecture}<div class="chartbox" style="height:${Math.max(260, lignes.length * (14 * d.periodes.length + 12) + 90)}px"><canvas id="fa-barres" role="img" aria-label="Réalisation de ${echapper(ind.nom)} par ${nomSingulier} et par mois"></canvas></div>
        <details><summary>Voir le tableau mois par mois</summary>${legende}${tableauMois}</details>`;
      grapheBarresGroupees("fa-barres", lignes.map((l) => l.nom), d.periodes.map((pe) => ({ label: libellePeriode(pe), data: lignes.map((l) => v(l.ou, pe)) })), { horizontal: true, ...optionsCible });
    } else {
      zone.innerHTML = `${lecture}${legende}${tableauMois}`;
    }
  } catch (erreur) { if (zone.isConnected) zone.innerHTML = erreurHtml(erreur); }
}

async function dessinerDesagregation(d, ma) {
  const zone = document.getElementById("fa-desagregation");
  const ind = indicateurFocus(d);
  if (!zone || !ind) return;
  const dispo = d.categories.get(ind.uid) || [];
  if (!dispo.length) { zone.innerHTML = `<p class="note">Cet indicateur n’a pas de désagrégation dans DHIS2 (catégorie « default » seulement).</p>`; return; }
  // Caractéristique choisie dans les filtres si elle existe pour cet indicateur, sinon la première disponible.
  const choisie = dispo.find((c) => d.etat.desagregations[c.id]?.length) || dispo[0];
  const options = d.etat.desagregations[choisie.id]?.length ? d.etat.desagregations[choisie.id] : choisie.options.map((o) => o.id);
  try {
    const r = await lireDhis2("analytics.json", { dimension: [`dx:${ind.uid}`, `${choisie.id}:${options.join(";")}`], filter: [`pe:${d.periodes.join(";")}`, ouDeLaSelection(d.etat, d.meta)] });
    if (ma !== generation || !zone.isConnected) return;
    const lignes = lignesAnalytics(r.donnees);
    const valeurs = options.map((o) => { const l = lignes.find((x) => x[choisie.id] === o); return { nom: choisie.options.find((x) => x.id === o)?.nom || o, valeur: l ? Math.round(l.valeur * 10) / 10 : null }; });
    zone.innerHTML = `<p class="note">${echapper(choisie.nom)} · ${echapper(ind.nom)}${dispo.length > 1 ? ` (autres caractéristiques disponibles dans les filtres : ${dispo.filter((c) => c !== choisie).map((c) => echapper(c.nom)).join(", ")})` : ""}</p>
      <div class="chartbox" style="height:${Math.max(200, valeurs.length * 28 + 60)}px"><canvas id="fa-desag" role="img" aria-label="Désagrégation par ${echapper(choisie.nom)}"></canvas></div>
      <ul class="ql-compteurs">${valeurs.map((v) => `<li><span>${echapper(v.nom)}</span>${v.valeur === null ? `<span class="live-nd">${NON_DISPONIBLE}</span>` : `<b>${nombre(v.valeur)}</b>`}</li>`).join("")}</ul>`;
    grapheBarres("fa-desag", valeurs.map((v) => v.nom), valeurs.map((v) => v.valeur), { horizontal: true, pourcent: false, etiquettes: true });
  } catch (erreur) { if (zone.isConnected) zone.innerHTML = erreurHtml(erreur); }
}

function lignesExport(d) {
  const v = (x) => (x === null || x === undefined ? NON_DISPONIBLE : x);
  return d.tableau.map((t) => [t.programme, t.nom, t.cible === null ? "" : `${t.sens === "bas" ? "≤ " : ""}${t.cible}`, t.uid ? v(t.valeur) : "à associer", v(t.ecart), v(t.numerateur), v(t.denominateur), libelleStatut(t)]);
}

function surChangement(e, racine) {
  if (e.target.dataset?.evolInd && dernier) {
    e.stopPropagation();
    const cases = [...document.querySelectorAll("#fa-evolutions [data-evol-ind]")];
    let choisis = cases.filter((c) => c.checked).map((c) => c.dataset.evolInd);
    if (choisis.length > MAX_EVOLUTION) { e.target.checked = false; choisis = choisis.filter((u) => u !== e.target.dataset.evolInd); alert(`Au plus ${MAX_EVOLUTION} indicateurs à la fois, pour que le graphique reste lisible.`); }
    indicateursEvolution = choisis;
    const resume = document.querySelector("#fa-evolutions .fa-evol-choix summary");
    if (resume) resume.textContent = `Indicateurs comparés (${uidsEvolution(dernier).length})`;
    dessinerEvolutions(dernier);
    return;
  }
  const champ = e.target.dataset?.fa;
  if (!champ) return;
  e.stopPropagation();
  if (champ === "programme") { programmeChoisi = e.target.value; focus = null; charger(racine); }
  else if (champ === "comparer-par" && dernier) { comparerPar = e.target.value; dessinerComparaison(dernier, generation); if (evolutionPar === "unites") dessinerEvolution(dernier, generation); }
  else if (champ === "focus" && dernier) {
    focus = e.target.value;
    document.querySelectorAll("#fa-tableau tr[data-focus]").forEach((tr) => tr.classList.toggle("fa-ligne-active", tr.dataset.focus === focus));
    const ma = generation; suivreFocusEvolution(); dessinerEvolution(dernier, ma); dessinerComparaison(dernier, ma); dessinerDesagregation(dernier, ma);
  }
}

function surClic(e, racine) {
  const b = e.target.closest("button");
  if (b?.dataset.evolPar && dernier) {
    evolutionPar = b.dataset.evolPar;
    b.parentElement.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    dessinerEvolution(dernier, generation);
    return;
  }
  if (b?.dataset.comp && dernier) {
    presentation = b.dataset.comp;
    b.parentElement.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    dessinerComparaison(dernier, generation);
    return;
  }
  if (!b) {
    const ligne = e.target.closest("tr[data-focus]");
    if (ligne && !e.target.closest("a")) choisirFocus(ligne.dataset.focus);
    return;
  }
  const liste = indicateursSuivis();
  const programmes = programmesOrdonnes(liste);
  if (b.dataset.action === "actualiser") charger(racine, { actualiser: true });
  else if (b.dataset.action === "ajouter") {
    ouvrirAjoutIndicateur({ programmes, modele: programmeChoisi === TOUS ? null : { nom: "", programme: programmeChoisi, cible: null, sens: "haut" } }, (nouvel) => {
      if (liste.some((i) => i.uid === nouvel.uid)) { alert("Cet indicateur est déjà suivi."); return; }
      enregistrerIndicateurs([...liste, { ...nouvel, id: nouvel.uid }]);
      charger(racine);
    });
  } else if (b.dataset.associer) {
    const modele = liste.find((i) => i.id === b.dataset.associer);
    if (!modele) return;
    ouvrirAjoutIndicateur({ programmes, modele }, (choisi) => {
      enregistrerIndicateurs(liste.map((i) => (i.id === modele.id ? { ...i, ...choisi, id: choisi.uid } : i)));
      charger(racine);
    });
  } else if (b.dataset.retirer) {
    const cible = liste.find((i) => i.id === b.dataset.retirer);
    if (cible && confirm(`Retirer « ${cible.nom} » du suivi ? (vous pourrez le rajouter plus tard)`)) {
      enregistrerIndicateurs(liste.filter((i) => i.id !== cible.id));
      charger(racine);
    }
  } else if (b.dataset.action === "defaut") {
    if (confirm("Rétablir la liste d’indicateurs du canevas ? Vos ajouts et retraits seront effacés.")) { reinitialiserIndicateurs(); charger(racine); }
  } else if (b.dataset.export === "fars" && dernier) {
    const entetes = ["Programme", "Indicateur", "Cible", "Réalisation", "Écart", "Numérateur", "Dénominateur", "Statut"];
    const nom = `situation_indicateurs_fars_${new Date().toISOString().slice(0, 10)}`;
    if (b.dataset.format === "csv") exporterCsv(nom, entetes, lignesExport(dernier), resumeFiltres(dernier.etat));
    else exporterXlsx(nom, entetes, lignesExport(dernier), resumeFiltres(dernier.etat)).catch((erreur) => alert(erreur.message));
  }
}
