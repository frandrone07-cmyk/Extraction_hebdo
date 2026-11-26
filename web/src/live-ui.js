// Éléments d'interface modernes partagés par les pages « Qualité des données » et « Indicateurs FARS » :
// cartes de chiffres clés avec jauge, barres de progression dans les cellules, mini-courbes, recherche et tri
// des tableaux, carte « Lecture de Sokhna Ci » (points clés écrits à partir des données, jamais inventés).
import { echapper, NON_DISPONIBLE, nombre } from "./pages-live.js";

const vide = (v) => v === null || v === undefined || Number.isNaN(v);

// Jauge circulaire (0 à 100) en SVG ; statut = conforme | surveiller | critique | inconnu.
export function jauge(valeur, statut = "inconnu", taille = 54) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const part = vide(valeur) ? 0 : Math.max(0, Math.min(100, valeur)) / 100;
  return `<svg class="lv-jauge lv-${statut}" width="${taille}" height="${taille}" viewBox="0 0 54 54" aria-hidden="true" focusable="false">
    <circle cx="27" cy="27" r="${r}" class="lv-jauge-fond"/>
    <circle cx="27" cy="27" r="${r}" class="lv-jauge-arc" stroke-dasharray="${(c * part).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 27 27)"/>
  </svg>`;
}

// Carte de chiffre clé (même gabarit que les cartes de la vue d'ensemble : .kpi-card).
export function carteChiffre({ titre, valeur, note = "", statut = "inconnu", icone = "", pourJauge = null, id = "" }) {
  const classe = { critique: "kpi-critical", surveiller: "kpi-warn", conforme: "kpi-accent" }[statut] || "";
  return `<article class="card kpi-card lv-kpi ${classe}"${id ? ` id="${id}"` : ""}>
    <div class="kpi-top"><span class="kpi-label">${echapper(titre)}</span>${pourJauge === null ? `<span class="kpi-icon" aria-hidden="true">${icone}</span>` : jauge(pourJauge, statut, 46)}</div>
    <div class="kpi-value">${valeur}</div><div class="kpi-foot"><span>${note}</span></div></article>`;
}

// Barre de progression dans une cellule (taux en %, ou réalisation rapportée à la cible).
export function barreCellule(valeur, statut, { max = 100, libelle = null } = {}) {
  if (vide(valeur)) return `<span class="live-nd">${NON_DISPONIBLE}</span>`;
  const part = Math.max(0, Math.min(100, (valeur / (max || 100)) * 100));
  return `<span class="lv-barre lv-${statut}"><span class="lv-barre-texte">${libelle ?? `${nombre(valeur)} %`}</span><span class="lv-barre-piste" aria-hidden="true"><span style="width:${part.toFixed(1)}%"></span></span></span>`;
}

// Mini-courbe (sparkline) d'une série ; les trous (valeurs absentes) coupent la ligne.
export function miniCourbe(serie, { cible = null, largeur = 92, hauteur = 26 } = {}) {
  const valeurs = (serie || []).map((v) => (vide(v) ? null : Number(v)));
  const presentes = valeurs.filter((v) => v !== null);
  if (presentes.length < 2) return "—";
  const tout = cible === null || cible === undefined ? presentes : [...presentes, Number(cible)];
  const min = Math.min(...tout);
  const max = Math.max(...tout);
  const echelle = (v) => (max === min ? hauteur / 2 : hauteur - 3 - ((v - min) / (max - min)) * (hauteur - 6));
  const x = (i) => (valeurs.length === 1 ? largeur / 2 : 2 + (i / (valeurs.length - 1)) * (largeur - 4));
  let chemin = "";
  valeurs.forEach((v, i) => { if (v === null) return; chemin += `${chemin && valeurs[i - 1] !== null && valeurs[i - 1] !== undefined ? "L" : "M"}${x(i).toFixed(1)} ${echelle(v).toFixed(1)}`; });
  const dernier = valeurs.map((v, i) => [v, i]).filter(([v]) => v !== null).at(-1);
  const ligneCible = cible === null || cible === undefined ? "" : `<line x1="0" x2="${largeur}" y1="${echelle(cible).toFixed(1)}" y2="${echelle(cible).toFixed(1)}" class="lv-spark-cible"/>`;
  return `<svg class="lv-spark" width="${largeur}" height="${hauteur}" viewBox="0 0 ${largeur} ${hauteur}" role="img" aria-label="Évolution : ${presentes.map((v) => nombre(v)).join(", ")}">${ligneCible}<path d="${chemin}"/><circle cx="${x(dernier[1]).toFixed(1)}" cy="${echelle(dernier[0]).toFixed(1)}" r="2.4"/></svg>`;
}

// Champ de recherche relié à un tableau (filtre les lignes du corps) ; `cle` sert d'identifiant.
export function rechercheTableau(cle, texte = "Rechercher…") {
  return `<label class="lv-recherche"><span class="sr-only">${echapper(texte)}</span><input type="search" data-recherche="${cle}" placeholder="${echapper(texte)}" autocomplete="off"></label>`;
}

// Branche la recherche, le tri par colonne (clic sur l'en-tête) et le filtre par statut d'une racine de page.
export function brancherTableaux(racine) {
  if (racine.dataset.lvBranche) return;
  racine.dataset.lvBranche = "1";
  racine.addEventListener("input", (e) => {
    const champ = e.target.closest("[data-recherche]");
    if (!champ) return;
    const table = racine.querySelector(`[data-table="${champ.dataset.recherche}"]`);
    if (table) filtrerLignes(table);
  });
  racine.addEventListener("click", (e) => {
    const puce = e.target.closest("[data-filtre-statut]");
    if (puce) {
      const groupe = puce.closest("[data-puces]");
      groupe.querySelectorAll("[data-filtre-statut]").forEach((p) => p.setAttribute("aria-pressed", String(p === puce)));
      const table = racine.querySelector(`[data-table="${groupe.dataset.puces}"]`);
      if (table) { table.dataset.statut = puce.dataset.filtreStatut; filtrerLignes(table); }
      return;
    }
    const th = e.target.closest("th[data-tri]");
    if (th) trierPar(th);
  });
  racine.addEventListener("keydown", (e) => {
    const th = e.target.closest("th[data-tri]");
    if (th && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); trierPar(th); }
  });
}

function filtrerLignes(table) {
  const racine = table.closest("section, article") || document;
  const champ = racine.querySelector(`[data-recherche="${table.dataset.table}"]`) || document.querySelector(`[data-recherche="${table.dataset.table}"]`);
  const q = normaliser(champ?.value || "");
  const statut = table.dataset.statut || "tous";
  let visibles = 0;
  for (const tr of table.tBodies[0]?.rows || []) {
    const ok = (!q || normaliser(tr.textContent).includes(q)) && (statut === "tous" || tr.dataset.statut === statut);
    tr.hidden = !ok;
    if (ok) visibles += 1;
  }
  regrouper(table);
  const compteur = document.querySelector(`[data-compteur="${table.dataset.table}"]`);
  if (compteur) compteur.textContent = `${visibles} ligne${visibles > 1 ? "s" : ""}`;
}

// Tableaux regroupés (cellule « Programme » fusionnée sur plusieurs lignes) : après un filtre, la cellule de
// groupe passe sur la première ligne visible et couvre exactement les lignes visibles.
function regrouper(table) {
  const groupes = new Map();
  for (const tr of table.tBodies[0]?.rows || []) {
    if (!tr.dataset.groupe) continue;
    if (!groupes.has(tr.dataset.groupe)) groupes.set(tr.dataset.groupe, []);
    groupes.get(tr.dataset.groupe).push(tr);
  }
  for (const lignes of groupes.values()) {
    const th = lignes.map((tr) => tr.querySelector("[data-entete-groupe]")).find(Boolean);
    const visibles = lignes.filter((tr) => !tr.hidden);
    if (!th || !visibles.length) continue;
    th.rowSpan = visibles.length;
    if (th.parentElement !== visibles[0]) visibles[0].prepend(th);
  }
}

const normaliser = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Tri : valeur numérique de data-v si présente, sinon texte. Clic suivant : ordre inverse.
function trierPar(th) {
  const table = th.closest("table");
  const index = [...th.parentElement.children].indexOf(th);
  const sens = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
  th.parentElement.querySelectorAll("th").forEach((x) => x.removeAttribute("aria-sort"));
  th.setAttribute("aria-sort", sens);
  const corps = table.tBodies[0];
  const lignes = [...corps.rows];
  const valeur = (tr) => {
    const c = tr.cells[index];
    if (!c) return null;
    if (c.dataset.v !== undefined) return c.dataset.v === "" ? null : Number(c.dataset.v);
    return c.textContent.trim();
  };
  lignes.sort((a, b) => {
    const va = valeur(a);
    const vb = valeur(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1; // les « non disponible » toujours en bas
    if (vb === null) return -1;
    const r = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "fr", { numeric: true });
    return sens === "ascending" ? r : -r;
  });
  corps.append(...lignes);
}

export const enteteTriable = (libelle) => `<th scope="col" data-tri tabindex="0" title="Cliquer pour trier">${libelle}<span class="lv-tri" aria-hidden="true"></span></th>`;

// Puces de filtre par statut (avec effectifs) pour un tableau.
export function pucesStatut(cle, effectifs) {
  return `<div class="lv-puces" data-puces="${cle}" role="group" aria-label="Filtrer par statut">${effectifs.map(([statut, libelle, n]) => `<button type="button" class="lv-puce lv-${statut}" data-filtre-statut="${statut}" aria-pressed="${statut === "tous"}">${echapper(libelle)} <b>${n}</b></button>`).join("")}</div>`;
}

// Carte « Lecture de Sokhna Ci » : points clés et bouton pour les entendre.
export function carteLecture(cle, commentaire) {
  if (!commentaire?.points?.length) return "";
  return `<section class="card lv-lecture" aria-label="Lecture de Sokhna Ci">
    <div class="lv-lecture-tete"><span class="lv-lecture-avatar" aria-hidden="true">SC</span><div><h2>Lecture de Sokhna Ci</h2><p class="card-subtitle">Points clés tirés automatiquement des données DHIS2 affichées.</p></div>
    <button type="button" class="live-actualiser" data-commenter="${cle}">🔊 Écouter Sokhna Ci</button></div>
    <ul class="lv-points">${commentaire.points.map((p) => `<li class="lv-point lv-${p.ton}"><span class="lv-point-icone" aria-hidden="true">${{ bien: "▲", alerte: "▼", info: "●" }[p.ton] || "●"}</span><span>${echapper(p.texte)}</span></li>`).join("")}</ul></section>`;
}

// Demande à Sokhna Ci de dire le commentaire (une seule fois par sélection, sauf demande explicite).
export function faireCommenter(cle, commentaire, { force = false } = {}) {
  if (!commentaire?.segments?.length) return;
  document.dispatchEvent(new CustomEvent("sokhnaci:commenter", { detail: { cle, force, dialogue: commentaire } }));
}
