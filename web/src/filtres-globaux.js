// Filtres globaux des pages « temps réel » (Qualité des données, Indicateurs FARS) : années, mois, périodicité,
// niveau géographique et unités, désagrégations. Ils sont conservés d'une page à l'autre et enregistrés dans
// l'adresse (lien partageable). Les fonctions de transformation sont pures et testées.

export const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const MOIS_COURTS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
export const PERIODICITES = { M: "Mensuelle", T: "Trimestrielle", A: "Annuelle" };
// Niveaux de la pyramide sanitaire dans DHIS2 Sénégal. DÉPEND DE VOTRE DHIS2 : niveau 1 = pays, 2 = région (DRS),
// 3 = district ; à vérifier dans /api/organisationUnitLevels si la hiérarchie change.
export const NIVEAUX = { pays: { libelle: "Pays", niveau: 1 }, region: { libelle: "Région (DRS)", niveau: 2 }, district: { libelle: "District", niveau: 3 } };

const uidValide = (v) => /^[A-Za-z0-9]{11}$/.test(v);

export function etatParDefaut(aujourdhui = new Date()) {
  return { annees: [aujourdhui.getFullYear()], mois: MOIS.map((_, i) => i + 1), periodicite: "M", niveau: "region", unites: [], desagregations: {} };
}

// Lecture depuis l'adresse (#…&fa=2025,2026&fm=1,2,3&fp=M&fn=district&fu=uid1,uid2&fd=cat:opt1+opt2;cat2:opt3).
export function lireFiltresUrl(hash, aujourdhui = new Date()) {
  const p = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  const defaut = etatParDefaut(aujourdhui);
  const nombres = (texte, min, max) => (texte || "").split(",").map(Number).filter((n) => Number.isInteger(n) && n >= min && n <= max);
  const annees = nombres(p.get("fa"), 2000, 2100);
  const mois = p.has("fm") ? nombres(p.get("fm"), 1, 12) : defaut.mois;
  const desagregations = {};
  for (const bloc of (p.get("fd") || "").split(";").filter(Boolean)) {
    const [categorie, options] = bloc.split(":");
    const liste = (options || "").split(/[+ ]/).filter(uidValide); // « + » tapé dans l'adresse se lit comme une espace
    if (uidValide(categorie) && liste.length) desagregations[categorie] = liste;
  }
  return {
    annees: annees.length ? [...new Set(annees)].sort() : defaut.annees,
    mois: [...new Set(mois)].sort((a, b) => a - b),
    periodicite: PERIODICITES[p.get("fp")] ? p.get("fp") : "M",
    niveau: NIVEAUX[p.get("fn")] ? p.get("fn") : defaut.niveau,
    unites: (p.get("fu") || "").split(",").filter(uidValide),
    desagregations,
  };
}

// Écriture dans l'adresse en conservant les autres paramètres (onglet, filtres de complétude…).
export function ecrireFiltresUrl(etat, hash) {
  const p = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  p.set("fa", etat.annees.join(","));
  p.set("fm", etat.mois.join(","));
  p.set("fp", etat.periodicite);
  p.set("fn", etat.niveau);
  if (etat.unites.length) p.set("fu", etat.unites.join(",")); else p.delete("fu");
  const fd = Object.entries(etat.desagregations).filter(([, o]) => o.length).map(([c, o]) => `${c}:${o.join("+")}`).join(";");
  if (fd) p.set("fd", fd); else p.delete("fd");
  return p.toString();
}

// Identifiants de période DHIS2 pour la sélection : mois « 202603 », trimestres « 2026Q1 », années « 2026 ».
// Les périodes futures sont exclues. Les mois choisis s'appliquent à chaque année choisie.
export function periodesDhis2(etat, aujourdhui = new Date()) {
  const limite = aujourdhui.getFullYear() * 100 + aujourdhui.getMonth() + 1;
  const resultat = [];
  for (const annee of [...etat.annees].sort()) {
    const mois = etat.mois.filter((m) => annee * 100 + m <= limite);
    if (!mois.length) continue;
    if (etat.periodicite === "A") resultat.push(String(annee));
    else if (etat.periodicite === "T") for (const t of [...new Set(mois.map((m) => Math.ceil(m / 3)))]) resultat.push(`${annee}Q${t}`);
    else for (const m of mois) resultat.push(`${annee}${String(m).padStart(2, "0")}`);
  }
  return resultat;
}

// Libellé lisible d'une période DHIS2.
export function libellePeriode(id) {
  const s = String(id);
  if (/^\d{6}$/.test(s)) return `${MOIS[Number(s.slice(4)) - 1]} ${s.slice(0, 4)}`;
  if (/^\d{4}Q[1-4]$/.test(s)) return `${s.slice(5)}${s.slice(5) === "1" ? "er" : "e"} trimestre ${s.slice(0, 4)}`;
  return s;
}

// Période précédente (pour les variations) : mois, trimestre ou année d'avant.
export function periodePrecedente(id) {
  const s = String(id);
  if (/^\d{6}$/.test(s)) { const a = Number(s.slice(0, 4)); const m = Number(s.slice(4)); return m === 1 ? `${a - 1}12` : `${a}${String(m - 1).padStart(2, "0")}`; }
  if (/^\d{4}Q[1-4]$/.test(s)) { const a = Number(s.slice(0, 4)); const t = Number(s.slice(5)); return t === 1 ? `${a - 1}Q4` : `${a}Q${t - 1}`; }
  if (/^\d{4}$/.test(s)) return String(Number(s) - 1);
  return null;
}

// Dimension « ou » : unités choisies, sinon toutes les unités du niveau choisi sous la racine du pays.
export function dimensionOu(etat, racine) {
  if (etat.unites.length) return `ou:${etat.unites.join(";")}`;
  const niveau = NIVEAUX[etat.niveau]?.niveau || 2;
  return niveau === 1 ? `ou:${racine}` : `ou:${racine};LEVEL-${niveau}`;
}

// Dimensions de désagrégation pour /api/analytics (catégorie:option1;option2).
export function dimensionsDesagregation(etat) {
  return Object.entries(etat.desagregations).filter(([, o]) => o.length).map(([c, o]) => `${c}:${o.join(";")}`);
}

export function resumeFiltres(etat) {
  const mois = etat.mois.length === 12 ? "tous les mois" : etat.mois.map((m) => MOIS_COURTS[m - 1].toLowerCase()).join(", ");
  return `${etat.annees.join(", ")} · ${mois} · ${PERIODICITES[etat.periodicite].toLowerCase()} · ${NIVEAUX[etat.niveau].libelle.toLowerCase()}${etat.unites.length ? ` (${etat.unites.length} sélectionnée${etat.unites.length > 1 ? "s" : ""})` : ""}`;
}

// ---------------------------------------------------------------- barre de filtres (interface)
const echapper = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// options : { annees: [2019…], unites: { region: [{id, nom}], district: [{id, nom, parent}] }, categories: [{id, nom, options:[{id, nom}]}] }
export function barreFiltresHtml(etat, options) {
  const annees = options.annees?.length ? options.annees : etat.annees;
  const unites = options.unites?.[etat.niveau] || [];
  const categories = options.categories || [];
  return `<section class="filtres-globaux card" aria-label="Filtres globaux">
    <div class="fg-ligne">
      <fieldset class="fg-bloc"><legend>Années</legend>
        <div class="fg-puces">${annees.map((a) => `<label class="fg-puce"><input type="checkbox" name="fg-annee" value="${a}" ${etat.annees.includes(a) ? "checked" : ""}> ${a}</label>`).join("")}</div>
        <button type="button" class="fg-lien" data-fg="toutes-annees">Toutes les années</button>
      </fieldset>
      <fieldset class="fg-bloc fg-mois"><legend>Mois</legend>
        <div class="fg-puces">${MOIS.map((m, i) => `<label class="fg-puce"><input type="checkbox" name="fg-mois" value="${i + 1}" ${etat.mois.includes(i + 1) ? "checked" : ""}> ${MOIS_COURTS[i]}</label>`).join("")}</div>
        <span class="fg-actions"><button type="button" class="fg-lien" data-fg="tous-mois">Tout sélectionner</button><button type="button" class="fg-lien" data-fg="aucun-mois">Tout désélectionner</button></span>
      </fieldset>
    </div>
    <div class="fg-ligne">
      <label class="fg-champ">Périodicité <select name="fg-periodicite">${Object.entries(PERIODICITES).map(([k, v]) => `<option value="${k}" ${etat.periodicite === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="fg-champ">Niveau <select name="fg-niveau">${Object.entries(NIVEAUX).map(([k, v]) => `<option value="${k}" ${etat.niveau === k ? "selected" : ""}>${v.libelle}</option>`).join("")}</select></label>
      ${etat.niveau === "pays" ? "" : `<div class="fg-champ fg-unites"><span>${etat.niveau === "district" ? "Districts" : "Régions"} (toutes si aucune cochée)</span>
        <input type="search" class="fg-recherche" placeholder="Rechercher…" aria-label="Rechercher une unité">
        <div class="fg-liste" role="group" aria-label="Unités">${unites.map((u) => `<label data-nom="${echapper(u.nom.toLowerCase())}"><input type="checkbox" name="fg-unite" value="${u.id}" ${etat.unites.includes(u.id) ? "checked" : ""}> ${echapper(u.nom)}</label>`).join("") || "<small>Liste indisponible.</small>"}</div></div>`}
      ${categories.length ? `<div class="fg-champ fg-desagregations"><span>Caractéristiques</span>${categories.map((c) => `<details><summary>${echapper(c.nom)}</summary>${c.options.map((o) => `<label><input type="checkbox" name="fg-option" data-categorie="${c.id}" value="${o.id}" ${(etat.desagregations[c.id] || []).includes(o.id) ? "checked" : ""}> ${echapper(o.nom)}</label>`).join("")}</details>`).join("")}</div>` : ""}
      <button type="button" class="fg-reinitialiser" data-fg="reinitialiser">Réinitialiser les filtres</button>
    </div>
  </section>`;
}

// Lit l'état de la barre affichée.
export function lireBarre(racine, etatPrecedent) {
  const coches = (nom) => [...racine.querySelectorAll(`input[name="${nom}"]:checked`)].map((e) => e.value);
  const desagregations = {};
  for (const e of racine.querySelectorAll('input[name="fg-option"]:checked')) (desagregations[e.dataset.categorie] ||= []).push(e.value);
  const niveau = racine.querySelector('select[name="fg-niveau"]').value;
  return {
    annees: coches("fg-annee").map(Number),
    mois: coches("fg-mois").map(Number),
    periodicite: racine.querySelector('select[name="fg-periodicite"]').value,
    niveau,
    unites: niveau === etatPrecedent.niveau ? coches("fg-unite") : [],
    desagregations,
  };
}

// Branche les interactions ; `surChangement(etat)` est appelé à chaque modification.
export function brancherBarre(racine, etat, options, surChangement) {
  const appliquer = (nouvel) => surChangement(nouvel);
  racine.addEventListener("change", (e) => { if (e.target.matches("input, select")) appliquer(lireBarre(racine, etat)); });
  racine.addEventListener("input", (e) => {
    if (!e.target.matches(".fg-recherche")) return;
    const q = e.target.value.trim().toLowerCase();
    for (const l of racine.querySelectorAll(".fg-liste label")) l.hidden = q && !l.dataset.nom.includes(q);
  });
  racine.addEventListener("click", (e) => {
    const action = e.target.closest("[data-fg]")?.dataset.fg;
    if (!action) return;
    if (action === "reinitialiser") { appliquer(etatParDefaut()); return; }
    const lu = lireBarre(racine, etat);
    if (action === "toutes-annees") lu.annees = [...(options.annees || etat.annees)];
    if (action === "tous-mois") lu.mois = MOIS.map((_, i) => i + 1);
    if (action === "aucun-mois") lu.mois = [];
    appliquer(lu);
  });
}
