// Socle des pages « temps réel » (données lues dans DHIS2 via le serveur intermédiaire) : métadonnées, filtres
// globaux, en-tête « Mis à jour le … » avec Actualiser, messages d'erreur, exports CSV et Excel.
// Aucune valeur n'est inventée : une donnée absente s'affiche « Donnée non disponible ».
import { ErreurDhis2, etatService, libelleMiseAJour, lireConfiguration, lireDhis2 } from "./dhis2-client.js";
import { barreFiltresHtml, brancherBarre, ecrireFiltresUrl, etatParDefaut, lireBarre, lireFiltresUrl, MOIS_COURTS, NIVEAUX, periodesDhis2, PERIODICITES } from "./filtres-globaux.js";

export const NON_DISPONIBLE = "Donnée non disponible";
export const echapper = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const nombre = (v, decimales = 1) => (v === null || v === undefined || Number.isNaN(v) ? NON_DISPONIBLE : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: decimales }));
export const pourcent = (v) => (v === null || v === undefined || Number.isNaN(v) ? NON_DISPONIBLE : `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
export function statutTaux(v, seuils = { critique: 70, conforme: 90 }) {
  if (v === null || v === undefined || Number.isNaN(v)) return "inconnu";
  return v < seuils.critique ? "critique" : v < seuils.conforme ? "surveiller" : "conforme";
}

// ---------------------------------------------------------------- mémoire de session (évite de recharger)
const memoire = new Map();
export function memoriser(cle, fabrique, { actualiser = false } = {}) {
  if (actualiser) memoire.delete(cle);
  if (!memoire.has(cle)) memoire.set(cle, fabrique().catch((erreur) => { memoire.delete(cle); throw erreur; }));
  return memoire.get(cle);
}
export function viderMemoire() { memoire.clear(); }

// ---------------------------------------------------------------- métadonnées
export function metadonnees({ actualiser = false } = {}) {
  return memoriser("meta", async () => {
    const sante = await etatService();
    if (!sante.configure) throw new ErreurDhis2("La connexion à DHIS2 n’est pas encore configurée sur le serveur intermédiaire (identifiants à saisir par l’administrateur).");
    if (!sante.joignable) throw new ErreurDhis2(sante.message || "DHIS2 est injoignable pour le moment.");
    const champs = { fields: "id,displayName,parent[id]", paging: "false" };
    const [racine, regions, districts, config] = await Promise.all([
      lireDhis2("organisationUnits.json", { ...champs, level: 1 }, { actualiser }),
      lireDhis2("organisationUnits.json", { ...champs, level: 2 }, { actualiser }),
      lireDhis2("organisationUnits.json", { ...champs, level: 3 }, { actualiser }),
      lireConfiguration(),
    ]);
    const liste = (r) => (r.donnees?.organisationUnits || []).map((u) => ({ id: u.id, nom: u.displayName, parent: u.parent?.id || null })).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    return { sante, racine: liste(racine)[0] || null, regions: liste(regions), districts: liste(districts), config };
  }, { actualiser });
}

// Années où des rapports existent dans DHIS2 (sur un formulaire suivi), de la première saisie à l'année en cours.
export function anneesDisponibles(meta) {
  return memoriser("annees", async () => {
    const enCours = new Date().getFullYear();
    let formulaire = meta.config.formulaires?.[0]?.uid;
    if (!formulaire) {
      const r = await lireDhis2("dataSets.json", { fields: "id", paging: "false" });
      formulaire = r.donnees?.dataSets?.[0]?.id;
    }
    if (!formulaire || !meta.racine) return [enCours];
    const r = await lireDhis2("analytics.json", { dimension: [`dx:${formulaire}.ACTUAL_REPORTS`, "pe:THIS_YEAR;LAST_10_YEARS"], filter: `ou:${meta.racine.id}`, skipMeta: "true" });
    const annees = (r.donnees?.rows || []).filter((ligne) => Number(ligne[2]) > 0).map((ligne) => Number(String(ligne[1]).slice(0, 4)));
    if (!annees.length) return [enCours];
    const debut = Math.min(...annees);
    return Array.from({ length: enCours - debut + 1 }, (_, i) => debut + i);
  });
}

// ---------------------------------------------------------------- filtres partagés entre les pages
export function filtresCourants() { return lireFiltresUrl(location.hash); }
export function enregistrerFiltres(etat) {
  const hash = ecrireFiltresUrl(etat, location.hash);
  history.replaceState(null, "", `#${hash}`);
}
// Filtres en tiroir : un bandeau résume la sélection (puces) ; le bouton « Filtres » ouvre un panneau latéral
// où l'on coche à loisir, puis « Appliquer » recharge la page une seule fois (« Annuler » ou Échap : rien ne change).
// Le bandeau n'est redessiné que si nécessaire, pour ne pas faire perdre le focus clavier.
export function resumeFiltresPuces(etat, options) {
  const unites = options.unites?.[etat.niveau] || [];
  const mois = etat.mois.length === 12 ? "Tous les mois" : etat.mois.length ? etat.mois.map((m) => MOIS_COURTS[m - 1]).join(", ") : "Aucun mois";
  const nomsUnites = etat.unites.map((id) => unites.find((u) => u.id === id)?.nom || id).map((n) => n.replace(/^DRS[_ ]/, ""));
  const lieu = etat.niveau === "pays" ? "Sénégal (national)" : etat.unites.length ? (nomsUnites.length > 3 ? `${nomsUnites.slice(0, 3).join(", ")} +${nomsUnites.length - 3}` : nomsUnites.join(", ")) : `${etat.niveau === "district" ? "Tous les districts" : "Toutes les régions"}`;
  const nbCaracteristiques = Object.values(etat.desagregations || {}).reduce((n, l) => n + l.length, 0);
  const puce = (icone, libelle, valeur) => `<span class="fg-chip"><span aria-hidden="true">${icone}</span><span class="fg-chip-lib">${libelle}</span> ${echapper(valeur)}</span>`;
  return [
    puce("📅", "Année", etat.annees.length ? [...etat.annees].sort().join(", ") : "Aucune"),
    puce("🗓", "Mois", mois),
    puce("⏱", "Périodicité", PERIODICITES[etat.periodicite] || etat.periodicite),
    puce("📍", NIVEAUX[etat.niveau]?.libelle || "Niveau", lieu),
    nbCaracteristiques ? puce("⚲", "Caractéristiques", `${nbCaracteristiques} option${nbCaracteristiques > 1 ? "s" : ""}`) : "",
  ].join("");
}

export function barreFiltres(conteneur, etat, options, surChangement, { forcer = false } = {}) {
  if (conteneur.firstElementChild && !forcer) return;
  const id = `fg-tiroir-${conteneur.id || Math.random().toString(36).slice(2)}`;
  conteneur.innerHTML = `<section class="fg-bandeau card" aria-label="Filtres appliqués">
      <div class="fg-chips">${resumeFiltresPuces(etat, options)}</div>
      <button type="button" class="fg-ouvrir" aria-haspopup="dialog" aria-controls="${id}" aria-expanded="false"><span aria-hidden="true">⚙</span> Filtres</button>
    </section>
    <div class="fg-tiroir-fond" hidden></div>
    <aside class="fg-tiroir" id="${id}" role="dialog" aria-modal="true" aria-labelledby="${id}-titre" hidden>
      <header class="fg-tiroir-tete"><div><p class="eyebrow">EXPLORER LES DONNÉES</p><h2 id="${id}-titre">Filtres</h2></div><button type="button" class="icon-button close-button fg-fermer" aria-label="Fermer les filtres">×</button></header>
      <div class="fg-tiroir-corps"></div>
      <footer class="fg-tiroir-pied"><button type="button" class="fg-pied-reinit">Réinitialiser</button><span class="fg-pied-info" aria-live="polite"></span><button type="button" class="fg-annuler">Annuler</button><button type="button" class="fg-appliquer">Appliquer</button></footer>
    </aside>`;
  const bouton = conteneur.querySelector(".fg-ouvrir");
  const tiroir = conteneur.querySelector(".fg-tiroir");
  const fond = conteneur.querySelector(".fg-tiroir-fond");
  // Le tiroir est rattaché au <body> : une animation (transform) d'un parent fausserait sa position fixe.
  for (const ancien of document.querySelectorAll(`body > [data-tiroir-de="${id}"]`)) ancien.remove();
  fond.dataset.tiroirDe = id;
  tiroir.dataset.tiroirDe = id;
  document.body.append(fond, tiroir);
  const corps = tiroir.querySelector(".fg-tiroir-corps");
  const info = tiroir.querySelector(".fg-pied-info");
  let brouillon = etat;
  const majInfo = () => {
    const n = periodesDhis2(brouillon).length;
    info.textContent = n ? `${n} période${n > 1 ? "s" : ""} DHIS2` : "Aucune période : cochez une année et un mois";
    tiroir.querySelector(".fg-appliquer").disabled = !n;
  };
  const dessinerCorps = (e) => {
    corps.innerHTML = barreFiltresHtml(e, options);
    const section = corps.firstElementChild;
    brancherBarre(section, e, options, (nouvel) => {
      const redessiner = nouvel.niveau !== e.niveau || JSON.stringify(lireBarre(section, e)) !== JSON.stringify(nouvel);
      brouillon = nouvel;
      if (redessiner) dessinerCorps(nouvel);
      majInfo();
    });
  };
  const fermer = () => {
    tiroir.classList.remove("ouvert");
    fond.classList.remove("ouvert");
    bouton.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", clavier, true);
    setTimeout(() => { tiroir.hidden = true; fond.hidden = true; }, 250);
    bouton.focus();
  };
  const clavier = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); fermer(); } };
  const ouvrir = () => {
    brouillon = filtresCourants();
    dessinerCorps(brouillon);
    majInfo();
    tiroir.hidden = false;
    fond.hidden = false;
    bouton.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => { tiroir.classList.add("ouvert"); fond.classList.add("ouvert"); });
    document.addEventListener("keydown", clavier, true);
    setTimeout(() => corps.querySelector("input, select")?.focus(), 60);
  };
  bouton.addEventListener("click", ouvrir);
  fond.addEventListener("click", fermer);
  tiroir.querySelector(".fg-fermer").addEventListener("click", fermer);
  tiroir.querySelector(".fg-annuler").addEventListener("click", fermer);
  tiroir.querySelector(".fg-pied-reinit").addEventListener("click", () => { brouillon = etatParDefaut(); dessinerCorps(brouillon); majInfo(); });
  tiroir.querySelector(".fg-appliquer").addEventListener("click", () => {
    const nouvel = brouillon;
    enregistrerFiltres(nouvel);
    fermer();
    conteneur.querySelector(".fg-chips").innerHTML = resumeFiltresPuces(nouvel, options);
    surChangement(nouvel);
  });
}

// ---------------------------------------------------------------- éléments d'interface
export function enteteMiseAJour(misAJour) {
  return `<p class="live-maj"><span>${echapper(libelleMiseAJour(misAJour))}</span> <button type="button" class="live-actualiser" data-action="actualiser">↻ Actualiser</button></p>`;
}
export function erreurHtml(erreur) {
  const message = erreur instanceof ErreurDhis2 ? erreur.message : "Une erreur inattendue s’est produite. Réessayez dans quelques instants.";
  return `<div class="live-erreur" role="alert"><strong>Données DHIS2 indisponibles.</strong> ${echapper(message)} Aucun chiffre n’est affiché tant que la connexion ne fonctionne pas.</div>`;
}
export const chargementHtml = (texte = "Chargement des données DHIS2…") => `<p class="live-chargement" role="status">${echapper(texte)}</p>`;

// Lecture d'une réponse /api/analytics en lignes { dx, pe, ou, valeur, … } (les colonnes viennent des en-têtes).
export function lignesAnalytics(donnees) {
  const colonnes = (donnees?.headers || []).map((h) => h.name);
  return (donnees?.rows || []).map((ligne) => Object.fromEntries(colonnes.map((nom, i) => [nom === "value" ? "valeur" : nom, nom === "value" ? Number(ligne[i]) : ligne[i]])));
}
export const nomItem = (donnees, id) => donnees?.metaData?.items?.[id]?.name || id;

// ---------------------------------------------------------------- exports (avec les filtres appliqués)
function telecharger(nom, contenu, type) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const lien = Object.assign(document.createElement("a"), { href: url, download: nom });
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exporterCsv(nom, entetes, lignes, filtres = "") {
  const cellule = (v) => { const t = String(v ?? ""); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const texte = [filtres ? `Filtres : ${filtres}` : null, entetes.map(cellule).join(";"), ...lignes.map((l) => l.map(cellule).join(";"))].filter((x) => x !== null).join("\n");
  telecharger(`${nom}.csv`, `﻿${texte}`, "text/csv;charset=utf-8");
}
// Excel (.xlsx) : bibliothèque SheetJS chargée à la demande depuis cdnjs.
export async function exporterXlsx(nom, entetes, lignes, filtres = "") {
  if (!window.XLSX) {
    await new Promise((resolve, reject) => {
      const script = Object.assign(document.createElement("script"), { src: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js", onload: resolve, onerror: reject });
      document.head.appendChild(script);
    }).catch(() => { throw new ErreurDhis2("La bibliothèque Excel n’a pas pu être chargée ; utilisez l’export CSV."); });
  }
  const feuille = window.XLSX.utils.aoa_to_sheet([...(filtres ? [[`Filtres : ${filtres}`], []] : []), entetes, ...lignes]);
  const classeur = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(classeur, feuille, "Données");
  window.XLSX.writeFile(classeur, `${nom}.xlsx`);
}
export function boutonsExport(cle) {
  return `<span class="live-exports"><button type="button" data-export="${cle}" data-format="xlsx">Excel (.xlsx)</button><button type="button" data-export="${cle}" data-format="csv">CSV</button></span>`;
}
