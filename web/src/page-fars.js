// Page « Indicateurs FARS » : indicateurs DHIS2 choisis à l'écran de configuration, regroupés par programme.
// Valeur, numérateur et dénominateur, évolution, comparaison entre régions ou districts, variation, désagrégations,
// cibles. Toutes les valeurs viennent de /api/analytics (dx / pe / ou) via le serveur intermédiaire.
import { lireDhis2 } from "./dhis2-client.js";
import { grapheBarres, grapheLigne } from "./charts.js";
import { dimensionOu, libellePeriode, NIVEAUX, periodePrecedente, periodesDhis2, resumeFiltres } from "./filtres-globaux.js";
import {
  anneesDisponibles, barreFiltres, boutonsExport, chargementHtml, echapper, enteteMiseAJour, erreurHtml, exporterCsv,
  exporterXlsx, filtresCourants, lignesAnalytics, memoriser, metadonnees, NON_DISPONIBLE, nombre,
} from "./pages-live.js";
import { categoriesDisponibles, elementsDeLExpression, programmes, statutCible, tableauIndicateurs } from "./fars-calculs.js";
import { ouvrirConfigurationFars } from "./fars-config.js";

let programmeChoisi = null;
let coches = null; // Set des UID coches (null = tous ceux du programme)
let focus = null;
let generation = 0;
let dernier = null;

export function dernieresDonneesFars() { return dernier; }

const valeurCellule = (v, dec = 1) => (v === null || v === undefined ? `<td class="live-nd">${NON_DISPONIBLE}</td>` : `<td>${nombre(v, dec)}</td>`);
const LIBELLE_STATUT = { conforme: "Cible atteinte", surveiller: "Proche de la cible", critique: "Loin de la cible", inconnu: "Sans cible" };

export function renderFars() {
  return `<div class="page-stack">
    <div class="section-intro"><div><p class="eyebrow">DHIS2 · TEMPS RÉEL</p><h2>Indicateurs FARS</h2><p>Indicateurs choisis par programme : valeur, numérateur et dénominateur, évolution, comparaison géographique, désagrégations et cibles.</p></div></div>
    <section id="fars-live" class="qualite-live" aria-label="Indicateurs FARS en temps réel (DHIS2)"></section>
  </div>`;
}
export function apresRenduFars() { monterFars(document.getElementById("fars-live")); }

export function monterFars(racine) {
  if (!racine) return;
  racine.innerHTML = `<div id="fa-filtres"></div><div id="fa-corps">${chargementHtml()}</div>`;
  racine.addEventListener("click", (e) => surClic(e, racine));
  racine.addEventListener("change", (e) => surChangement(e, racine));
  charger(racine);
}

// Catégories de désagrégation propres à chaque indicateur (via les éléments de données de ses expressions).
function categoriesParIndicateur(indicateurs) {
  const cle = `fars-cat-${indicateurs.map((i) => i.uid).join(",")}`;
  return memoriser(cle, async () => {
    const r = await lireDhis2("indicators.json", { filter: `id:in:[${indicateurs.map((i) => i.uid).join(",")}]`, fields: "id,numerator,denominator", paging: "false" });
    const parInd = new Map((r.donnees?.indicators || []).map((i) => [i.id, elementsDeLExpression(i.numerator, i.denominator)]));
    const tous = [...new Set([...parInd.values()].flat())];
    const des = new Map();
    for (let i = 0; i < tous.length; i += 100) {
      const d = await lireDhis2("dataElements.json", { filter: `id:in:[${tous.slice(i, i + 100).join(",")}]`, fields: "id,categoryCombo[categories[id,displayName,categoryOptions[id,displayName]]]", paging: "false" });
      for (const de of d.donnees?.dataElements || []) des.set(de.id, de);
    }
    return new Map([...parInd].map(([uid, liste]) => [uid, categoriesDisponibles(liste.map((id) => des.get(id)).filter(Boolean))]));
  });
}

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
  const indicateurs = meta.config.fars?.indicateurs || [];
  const configurer = `<button type="button" class="live-actualiser" data-action="configurer">⚙ Configurer les indicateurs FARS</button>`;
  if (!indicateurs.length) {
    racine.querySelector("#fa-filtres").innerHTML = "";
    corps.innerHTML = `<p class="live-erreur" role="status">Aucun indicateur FARS n’est encore configuré. Choisissez-les dans DHIS2 (par groupe d’indicateurs ou par nom) et indiquez leur programme et leur cible.</p>${configurer}`;
    return;
  }
  const [annees, categories] = await Promise.all([anneesDisponibles(meta).catch(() => [new Date().getFullYear()]), categoriesParIndicateur(indicateurs).catch(() => new Map())]);
  if (ma !== generation || !racine.isConnected) return;
  const toutesCategories = [...new Map([...categories.values()].flat().map((c) => [c.id, c])).values()];
  const etat = filtresCourants();
  barreFiltres(racine.querySelector("#fa-filtres"), etat, { annees, unites: { region: meta.regions, district: meta.districts }, categories: toutesCategories }, () => charger(racine), { forcer: actualiser });

  const listeProgrammes = programmes(indicateurs);
  if (!listeProgrammes.includes(programmeChoisi)) { programmeChoisi = listeProgrammes[0]; coches = null; }
  const duProgramme = indicateurs.filter((i) => (i.programme || "Sans programme") === programmeChoisi);
  const choisis = duProgramme.filter((i) => !coches || coches.has(i.uid));
  if (!choisis.some((i) => i.uid === focus)) focus = choisis[0]?.uid || null;
  const selecteurs = `<div class="fa-choix">
      <label class="fg-champ">Programme <select data-fa="programme">${listeProgrammes.map((p) => `<option ${p === programmeChoisi ? "selected" : ""}>${echapper(p)}</option>`).join("")}</select></label>
      <fieldset class="fg-bloc"><legend>Indicateurs</legend><div class="fg-puces">${duProgramme.map((i) => `<label class="fg-puce"><input type="checkbox" data-fa="indicateur" value="${i.uid}" ${choisis.includes(i) ? "checked" : ""}> ${echapper(i.nom)}</label>`).join("")}</div></fieldset>
      ${configurer}</div>`;
  const periodes = periodesDhis2(etat);
  if (!choisis.length || !periodes.length) {
    corps.innerHTML = `${selecteurs}<p class="live-erreur" role="status">${!choisis.length ? "Cochez au moins un indicateur." : "Aucune période sélectionnée : cochez au moins une année et un mois (les périodes futures sont exclues)."}</p>`;
    return;
  }
  const ouFiltre = etat.unites.length ? `ou:${etat.unites.join(";")}` : `ou:${meta.racine.id}`;
  const avecPrecedente = [...new Set([...periodes, periodePrecedente(periodes[0])].filter(Boolean))].sort();
  try {
    const r = await lireDhis2("analytics.json", { dimension: [`dx:${choisis.map((i) => i.uid).join(";")}`, `pe:${avecPrecedente.join(";")}`], filter: ouFiltre, includeNumDen: "true", skipMeta: "true" }, { actualiser });
    if (ma !== generation || !racine.isConnected) return;
    const tableau = tableauIndicateurs(lignesAnalytics(r.donnees), choisis, periodes, meta.config.fars.cibles || {}, periodePrecedente);
    dernier = { meta, etat, periodes, tableau, programme: programmeChoisi, misAJour: r.misAJour, categories };
    corps.innerHTML = rendu(dernier, selecteurs);
    grapheLigne("fa-evolution", periodes.map(libellePeriode), tableau.map((t) => ({ label: t.nom, data: t.serie })), { percent: false });
    dessinerComparaison(dernier, ma);
    dessinerDesagregation(dernier, ma);
  } catch (erreur) {
    if (ma !== generation) return;
    corps.innerHTML = `${selecteurs}${erreurHtml(erreur)}<p><button type="button" class="live-actualiser" data-action="actualiser">↻ Réessayer</button></p>`;
    dernier = null;
  }
}

function rendu(d, selecteurs) {
  const niveau = d.etat.niveau === "pays" ? "région" : NIVEAUX[d.etat.niveau].libelle.toLowerCase();
  const ind = d.tableau.find((t) => t.uid === focus) || d.tableau[0];
  return `${enteteMiseAJour(d.misAJour)}${selecteurs}
    <p class="note">Sélection : ${echapper(resumeFiltres(d.etat))}. Valeur affichée : dernière période renseignée de la sélection ; variation par rapport à la période précédente.</p>
    <section class="card"><div class="card-head"><div><h2>Tableau des indicateurs — ${echapper(d.programme)}</h2><p class="card-subtitle">Couleur selon la cible : verte si atteinte, jaune à partir de 80 % de la cible, rouge en dessous.</p></div>${boutonsExport("fars")}</div>
      <div class="table-scroll"><table id="fa-tableau"><thead><tr><th>Indicateur</th><th>Période</th><th>Valeur</th><th>Numérateur</th><th>Dénominateur</th><th>Période précédente</th><th>Variation</th><th>Cible</th><th>Statut</th></tr></thead><tbody>
      ${d.tableau.map((t) => `<tr><th scope="row">${echapper(t.nom)}</th><td>${t.periode ? echapper(libellePeriode(t.periode)) : `<span class="live-nd">${NON_DISPONIBLE}</span>`}</td>${valeurCellule(t.valeur)}${valeurCellule(t.numerateur, 0)}${valeurCellule(t.denominateur, 0)}${valeurCellule(t.valeurPrecedente)}
        <td>${t.variation.sens ? `<span class="fa-variation ${t.variation.sens}" aria-label="${t.variation.sens}">${t.variation.fleche} ${t.variation.ecart > 0 ? "+" : ""}${nombre(t.variation.ecart)}</span>` : `<span class="live-nd">${NON_DISPONIBLE}</span>`}</td>
        ${t.cible === null ? "<td>—</td>" : `<td>${nombre(t.cible)}</td>`}<td><span class="status-chip ${t.statut}">${LIBELLE_STATUT[t.statut]}</span></td></tr>`).join("")}
      </tbody></table></div></section>
    <section class="card"><div class="card-head"><div><h2>Évolution par période</h2><p class="card-subtitle">Une période sans valeur DHIS2 apparaît comme un trou dans la courbe.</p></div></div><div class="chartbox"><canvas id="fa-evolution" role="img" aria-label="Évolution des indicateurs par période"></canvas></div></section>
    <section class="card"><div class="card-head"><div><h2>Comparaison par ${echapper(niveau)}</h2><p class="card-subtitle">Indicateur : <select data-fa="focus" aria-label="Indicateur comparé">${d.tableau.map((t) => `<option value="${t.uid}" ${t.uid === ind.uid ? "selected" : ""}>${echapper(t.nom)}</option>`).join("")}</select> · période : ${ind.periode ? echapper(libellePeriode(ind.periode)) : echapper(libellePeriode(d.periodes.at(-1)))}</p></div></div>
      <div id="fa-comparaison">${chargementHtml()}</div></section>
    <section class="card"><div class="card-head"><div><h2>Désagrégation</h2><p class="card-subtitle">Selon les caractéristiques des éléments de données de l’indicateur (choix dans « Caractéristiques » des filtres).</p></div></div>
      <div id="fa-desagregation">${chargementHtml()}</div></section>`;
}

async function dessinerComparaison(d, ma) {
  const zone = document.getElementById("fa-comparaison");
  const ind = d.tableau.find((t) => t.uid === focus) || d.tableau[0];
  const periode = ind.periode || d.periodes.at(-1);
  const ou = d.etat.niveau === "pays" && !d.etat.unites.length ? `ou:${d.meta.racine.id};LEVEL-${NIVEAUX.region.niveau}` : dimensionOu(d.etat, d.meta.racine.id);
  try {
    const r = await lireDhis2("analytics.json", { dimension: [`dx:${ind.uid}`, ou], filter: `pe:${periode}`, includeNumDen: "true" });
    if (ma !== generation || !zone.isConnected) return;
    const lignes = lignesAnalytics(r.donnees).map((l) => ({ ...l, nom: r.donnees?.metaData?.items?.[l.ou]?.name || l.ou })).sort((a, b) => b.valeur - a.valeur);
    if (!lignes.length) { zone.innerHTML = `<p class="live-nd">${NON_DISPONIBLE}</p>`; return; }
    const cible = ind.cible;
    zone.innerHTML = `<div class="chartbox" style="height:${Math.max(220, lignes.length * 24 + 60)}px"><canvas id="fa-barres" role="img" aria-label="Comparaison géographique de ${echapper(ind.nom)}"></canvas></div>
      <details><summary>Voir le tableau</summary><div class="table-scroll"><table><thead><tr><th>Unité</th><th>Valeur</th><th>Numérateur</th><th>Dénominateur</th><th>Statut</th></tr></thead><tbody>${lignes.map((l) => { const s = statutCible(l.valeur, cible); return `<tr><th scope="row">${echapper(l.nom)}</th>${valeurCellule(l.valeur)}${valeurCellule(Number(l.numerator), 0)}${valeurCellule(Number(l.denominator), 0)}<td><span class="status-chip ${s}">${LIBELLE_STATUT[s]}</span></td></tr>`; }).join("")}</tbody></table></div></details>`;
    const couleur = (v) => getComputedStyle(document.documentElement).getPropertyValue(`--${statutCible(v, cible) === "inconnu" ? "primary" : statutCible(v, cible)}`).trim() || "#087f5b";
    grapheBarres("fa-barres", lignes.map((l) => l.nom), lignes.map((l) => Math.round(l.valeur * 10) / 10), { horizontal: true, pourcent: false, etiquettes: true, couleurParValeur: couleur });
  } catch (erreur) { if (zone.isConnected) zone.innerHTML = erreurHtml(erreur); }
}

async function dessinerDesagregation(d, ma) {
  const zone = document.getElementById("fa-desagregation");
  const ind = d.tableau.find((t) => t.uid === focus) || d.tableau[0];
  const dispo = d.categories.get(ind.uid) || [];
  if (!dispo.length) { zone.innerHTML = `<p class="note">Cet indicateur n’a pas de désagrégation dans DHIS2 (catégorie « default » seulement).</p>`; return; }
  // Caractéristique choisie dans les filtres si elle existe pour cet indicateur, sinon la première disponible.
  const choisie = dispo.find((c) => d.etat.desagregations[c.id]?.length) || dispo[0];
  const options = d.etat.desagregations[choisie.id]?.length ? d.etat.desagregations[choisie.id] : choisie.options.map((o) => o.id);
  const ouFiltre = d.etat.unites.length ? `ou:${d.etat.unites.join(";")}` : `ou:${d.meta.racine.id}`;
  const periode = ind.periode || d.periodes.at(-1);
  try {
    const r = await lireDhis2("analytics.json", { dimension: [`dx:${ind.uid}`, `${choisie.id}:${options.join(";")}`], filter: [`pe:${periode}`, ouFiltre] });
    if (ma !== generation || !zone.isConnected) return;
    const lignes = lignesAnalytics(r.donnees);
    const valeurs = options.map((o) => { const l = lignes.find((x) => x[choisie.id] === o); return { nom: choisie.options.find((x) => x.id === o)?.nom || o, valeur: l ? Math.round(l.valeur * 10) / 10 : null }; });
    zone.innerHTML = `<p class="note">${echapper(choisie.nom)} · ${echapper(ind.nom)} · ${echapper(libellePeriode(periode))}${dispo.length > 1 ? ` (autres caractéristiques disponibles : ${dispo.filter((c) => c !== choisie).map((c) => echapper(c.nom)).join(", ")})` : ""}</p>
      <div class="chartbox" style="height:${Math.max(200, valeurs.length * 28 + 60)}px"><canvas id="fa-desag" role="img" aria-label="Désagrégation par ${echapper(choisie.nom)}"></canvas></div>
      <ul class="ql-compteurs">${valeurs.map((v) => `<li><span>${echapper(v.nom)}</span>${v.valeur === null ? `<span class="live-nd">${NON_DISPONIBLE}</span>` : `<b>${nombre(v.valeur)}</b>`}</li>`).join("")}</ul>`;
    grapheBarres("fa-desag", valeurs.map((v) => v.nom), valeurs.map((v) => v.valeur), { horizontal: true, pourcent: false, etiquettes: true });
  } catch (erreur) { if (zone.isConnected) zone.innerHTML = erreurHtml(erreur); }
}

function lignesExport(d) {
  const v = (x) => (x === null || x === undefined ? NON_DISPONIBLE : x);
  return d.tableau.map((t) => [d.programme, t.nom, t.periode ? libellePeriode(t.periode) : NON_DISPONIBLE, v(t.valeur), v(t.numerateur), v(t.denominateur), v(t.valeurPrecedente), v(t.variation.ecart), v(t.cible), LIBELLE_STATUT[t.statut]]);
}

function surChangement(e, racine) {
  const champ = e.target.dataset?.fa;
  if (!champ) return;
  e.stopPropagation();
  if (champ === "programme") { programmeChoisi = e.target.value; coches = null; focus = null; charger(racine); }
  else if (champ === "indicateur") { coches = new Set([...racine.querySelectorAll('input[data-fa="indicateur"]:checked')].map((c) => c.value)); charger(racine); }
  else if (champ === "focus" && dernier) { focus = e.target.value; const ma = generation; dessinerComparaison(dernier, ma); dessinerDesagregation(dernier, ma); }
}

function surClic(e, racine) {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.action === "actualiser") charger(racine, { actualiser: true });
  else if (b.dataset.action === "configurer") ouvrirConfigurationFars(() => charger(racine, { actualiser: true }));
  else if (b.dataset.export === "fars" && dernier) {
    const entetes = ["Programme", "Indicateur", "Période", "Valeur", "Numérateur", "Dénominateur", "Période précédente", "Variation", "Cible", "Statut"];
    const nom = `indicateurs_fars_${new Date().toISOString().slice(0, 10)}`;
    if (b.dataset.format === "csv") exporterCsv(nom, entetes, lignesExport(dernier), resumeFiltres(dernier.etat));
    else exporterXlsx(nom, entetes, lignesExport(dernier), resumeFiltres(dernier.etat)).catch((erreur) => alert(erreur.message));
  }
}
