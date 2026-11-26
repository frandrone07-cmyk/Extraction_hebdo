// Page « Indicateurs FARS » — « Situation des indicateurs de performance » sur le modèle du canevas de revue :
// Programme | Indicateur | Cible | Réalisation | Écart | Statut, regroupés par programme. Liste par défaut issue du
// canevas ; chacun peut ajouter, associer ou retirer des indicateurs (choix gardé dans son navigateur).
// Toutes les valeurs viennent de /api/analytics (dx / pe / ou) via le serveur intermédiaire ; rien n'est inventé.
import { lireDhis2 } from "./dhis2-client.js";
import { grapheBarres, grapheLigne } from "./charts.js";
import { dimensionOu, libellePeriode, NIVEAUX, periodePrecedente, periodesDhis2, resumeFiltres } from "./filtres-globaux.js";
import {
  anneesDisponibles, barreFiltres, boutonsExport, chargementHtml, echapper, enteteMiseAJour, erreurHtml, exporterCsv,
  exporterXlsx, filtresCourants, lignesAnalytics, memoriser, metadonnees, NON_DISPONIBLE, nombre,
} from "./pages-live.js";
import { appliquerRealisation, categoriesDisponibles, elementsDeLExpression, statutCible, tableauIndicateurs } from "./fars-calculs.js";
import { ouvrirAjoutIndicateur } from "./fars-config.js";
import { PROGRAMMES_ORDRE } from "./fars-defaut.js";
import { barreCellule, brancherTableaux, carteChiffre, carteLecture, faireCommenter, miniCourbe, pucesStatut, rechercheTableau } from "./live-ui.js";
import { commentaireFars } from "./sokhnaci-direct.js";
import { enregistrerIndicateurs, indicateursPersonnalises, indicateursSuivis, reinitialiserIndicateurs } from "./suivi-local.js";

const TOUS = "Tous les programmes";
let programmeChoisi = TOUS;
let focus = null;
let generation = 0;
let dernier = null;

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
    dessinerEvolution(dernier);
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
  const niveau = d.etat.niveau === "pays" ? "région" : NIVEAUX[d.etat.niveau].libelle.toLowerCase();
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
    <div id="fa-lecture"></div>
    <section class="card"><div class="card-head"><div><h2>Situation des indicateurs de performance${d.programme === TOUS ? "" : ` — ${echapper(d.programme)}`}</h2><p class="card-subtitle">${echapper(periodeTexte)} · cliquez sur une ligne pour l’analyser.</p></div><div class="ql-outils">${rechercheTableau("fars", "Rechercher un indicateur…")}${boutonsExport("fars")}</div></div>
      ${puces}
      <div class="table-scroll"><table id="fa-tableau" class="fa-tableau" data-table="fars"><thead><tr><th>Programme</th><th>Indicateur</th><th>Cible</th><th>Réalisation</th><th>Écart</th><th>Numérateur</th><th>Dénominateur</th><th>Tendance</th><th>Statut</th><th><span class="fa-actions-titre">Suivi</span></th></tr></thead><tbody>
      ${lignesHtml || `<tr><td colspan="10" class="note">Aucun indicateur suivi : cliquez sur « Ajouter un indicateur ».</td></tr>`}
      </tbody></table></div></section>
    ${ind ? `<section class="card" id="fa-analyse"><div class="card-head"><div><h2>Analyse détaillée</h2><p class="card-subtitle">Indicateur : <select data-fa="focus" aria-label="Indicateur analysé">${associes.map((t) => `<option value="${t.uid}" ${t.uid === ind.uid ? "selected" : ""}>${echapper(t.programme)} · ${echapper(t.nom)}</option>`).join("")}</select></p></div></div>
      <h3 class="ql-sous-titre">Évolution par période</h3><div class="chartbox"><canvas id="fa-evolution" role="img" aria-label="Évolution de l’indicateur par période"></canvas></div>
      <h3 class="ql-sous-titre">Comparaison par ${echapper(niveau)} (${echapper(periodeTexte)})</h3><div id="fa-comparaison">${chargementHtml()}</div>
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
function majLecture(d) {
  const zone = document.getElementById("fa-lecture");
  if (!zone) return;
  d.commentaire = commentaireFars(d);
  zone.innerHTML = carteLecture("fars", d.commentaire);
  if (document.getElementById("fars-live")?.offsetParent !== null) faireCommenter(cleCommentaire(d), d.commentaire);
}

function choisirFocus(uid) {
  if (!dernier || !uid) return;
  focus = uid;
  document.querySelectorAll("#fa-tableau tr[data-focus]").forEach((tr) => tr.classList.toggle("fa-ligne-active", tr.dataset.focus === uid));
  const select = document.querySelector('[data-fa="focus"]');
  if (select) select.value = uid;
  const ma = generation;
  dessinerEvolution(dernier); dessinerComparaison(dernier, ma); dessinerDesagregation(dernier, ma);
  document.getElementById("fa-analyse")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function indicateurFocus(d) { const a = d.tableau.filter((t) => t.uid); return a.find((t) => t.uid === focus) || a[0]; }

function dessinerEvolution(d) {
  const ind = indicateurFocus(d);
  if (!ind) return;
  const series = [{ label: ind.nom, data: ind.serie }];
  if (ind.cible !== null && ind.cible !== undefined) series.push({ label: `Cible (${libelleCible(ind)})`, data: d.periodes.map(() => ind.cible) });
  grapheLigne("fa-evolution", d.periodes.map(libellePeriode), series, { percent: false });
}

async function dessinerComparaison(d, ma) {
  const zone = document.getElementById("fa-comparaison");
  const ind = indicateurFocus(d);
  if (!zone || !ind) return;
  const ou = d.etat.niveau === "pays" && !d.etat.unites.length ? `ou:${d.meta.racine.id};LEVEL-${NIVEAUX.region.niveau}` : dimensionOu(d.etat, d.meta.racine.id);
  try {
    const r = await lireDhis2("analytics.json", { dimension: [`dx:${ind.uid}`, ou], filter: `pe:${d.periodes.join(";")}`, includeNumDen: "true" });
    if (ma !== generation || !zone.isConnected) return;
    const lignes = lignesAnalytics(r.donnees).map((l) => ({ ...l, nom: r.donnees?.metaData?.items?.[l.ou]?.name || l.ou })).sort((a, b) => b.valeur - a.valeur);
    if (!lignes.length) { zone.innerHTML = `<p class="live-nd">${NON_DISPONIBLE}</p>`; return; }
    zone.innerHTML = `<div class="chartbox" style="height:${Math.max(220, lignes.length * 24 + 60)}px"><canvas id="fa-barres" role="img" aria-label="Comparaison géographique de ${echapper(ind.nom)}"></canvas></div>
      <details><summary>Voir le tableau</summary><div class="table-scroll"><table><thead><tr><th>Unité</th><th>Réalisation</th><th>Numérateur</th><th>Dénominateur</th><th>Statut</th></tr></thead><tbody>${lignes.map((l) => { const s = statutCible(l.valeur, ind.cible, ind.sens); return `<tr><th scope="row">${echapper(l.nom)}</th>${valeurCellule(l.valeur)}${valeurCellule(Number(l.numerator), 0)}${valeurCellule(Number(l.denominator), 0)}<td><span class="status-chip ${s}">${LIBELLE_STATUT[s]}</span></td></tr>`; }).join("")}</tbody></table></div></details>`;
    const couleur = (v) => { const s = statutCible(v, ind.cible, ind.sens); return getComputedStyle(document.documentElement).getPropertyValue(`--${s === "inconnu" ? "primary" : s}`).trim() || "#087f5b"; };
    grapheBarres("fa-barres", lignes.map((l) => l.nom), lignes.map((l) => Math.round(l.valeur * 10) / 10), { horizontal: true, pourcent: false, etiquettes: true, couleurParValeur: couleur });
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
  const champ = e.target.dataset?.fa;
  if (!champ) return;
  e.stopPropagation();
  if (champ === "programme") { programmeChoisi = e.target.value; focus = null; charger(racine); }
  else if (champ === "focus" && dernier) {
    focus = e.target.value;
    document.querySelectorAll("#fa-tableau tr[data-focus]").forEach((tr) => tr.classList.toggle("fa-ligne-active", tr.dataset.focus === focus));
    const ma = generation; dessinerEvolution(dernier); dessinerComparaison(dernier, ma); dessinerDesagregation(dernier, ma);
  }
}

function surClic(e, racine) {
  const b = e.target.closest("button");
  if (!b) {
    const ligne = e.target.closest("tr[data-focus]");
    if (ligne && !e.target.closest("a")) choisirFocus(ligne.dataset.focus);
    return;
  }
  if (b.dataset.commenter && dernier) { faireCommenter(cleCommentaire(dernier), commentaireFars(dernier), { force: true }); return; }
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
