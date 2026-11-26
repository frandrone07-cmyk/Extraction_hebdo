// Données temps réel pour Sokhna Ci, même si l'utilisateur n'a pas ouvert les onglets « Qualité des données » ou
// « Indicateurs FARS » : mêmes calculs et mêmes filtres globaux que ces pages, sans rien afficher.
// Si une page vient d'être chargée avec les mêmes filtres, ses résultats sont réutilisés (pas de nouvelle requête).
import { lireDhis2 } from "./dhis2-client.js";
import { dimensionOu, periodePrecedente, periodesDhis2 } from "./filtres-globaux.js";
import { filtresCourants, lignesAnalytics, memoriser, metadonnees } from "./pages-live.js";
import { dimensionMetriques, syntheseParFormulaire, tableauCompletude } from "./qualite-calculs.js";
import { appliquerRealisation, tableauIndicateurs } from "./fars-calculs.js";
import { formulairesSuivis, indicateursSuivis } from "./suivi-local.js";
import { dernieresDonneesQualite } from "./page-qualite.js";
import { dernieresDonneesFars } from "./page-fars.js";

const memeFiltres = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Qualité : complétude et promptitude par région (formulaires suivis), sur les périodes des filtres globaux.
export async function donneesQualite() {
  const etat = filtresCourants();
  const page = dernieresDonneesQualite();
  if (page && memeFiltres(page.etat, etat)) return page;
  const periodes = periodesDhis2(etat);
  const formulaires = formulairesSuivis();
  if (!periodes.length || !formulaires.length) return null;
  return memoriser(`sokhnaci-qualite-${JSON.stringify(etat)}-${formulaires.map((f) => f.uid).join(",")}`, async () => {
    const meta = await metadonnees();
    const parRegion = { ...etat, niveau: "region", unites: etat.niveau === "region" ? etat.unites : [] };
    const unites = parRegion.unites.length ? meta.regions.filter((r) => parRegion.unites.includes(r.id)) : meta.regions;
    const r = await lireDhis2("analytics.json", { dimension: [dimensionMetriques(formulaires), dimensionOu(parRegion, meta.racine.id)], filter: `pe:${periodes.join(";")}`, skipMeta: "true" });
    const lignes = tableauCompletude(lignesAnalytics(r.donnees), formulaires, unites);
    return { meta, etat, formulaires, periodes, unites, lignes, synthese: syntheseParFormulaire(lignes), misAJour: r.misAJour, violations: null };
  });
}

// FARS : réalisation de chaque indicateur suivi sur toute la période (trimestres pour les rapports trimestriels).
export async function donneesFars() {
  const etat = filtresCourants();
  const page = dernieresDonneesFars();
  if (page && memeFiltres(page.etat, etat) && page.programme === "Tous les programmes") return page;
  const periodes = periodesDhis2(etat);
  const indicateurs = indicateursSuivis();
  const associes = indicateurs.filter((i) => i.uid);
  if (!periodes.length) return null;
  return memoriser(`sokhnaci-fars-${JSON.stringify(etat)}-${associes.map((i) => i.uid).join(",")}`, async () => {
    const meta = await metadonnees();
    const ou = etat.unites.length ? `ou:${etat.unites.join(";")}` : `ou:${meta.racine.id}`;
    let tableau = [];
    let misAJour = new Date().toISOString();
    if (associes.length) {
      const dx = `dx:${associes.map((i) => i.uid).join(";")}`;
      const avecPrecedente = [...new Set([...periodes, periodePrecedente(periodes[0])].filter(Boolean))].sort();
      const [agrege, detail] = await Promise.all([
        lireDhis2("analytics.json", { dimension: dx, filter: [`pe:${periodes.join(";")}`, ou], includeNumDen: "true", skipMeta: "true" }),
        lireDhis2("analytics.json", { dimension: [dx, `pe:${avecPrecedente.join(";")}`], filter: ou, skipMeta: "true" }),
      ]);
      tableau = appliquerRealisation(tableauIndicateurs(lignesAnalytics(detail.donnees), associes, periodes, {}, periodePrecedente), lignesAnalytics(agrege.donnees));
      misAJour = agrege.misAJour;
      const sansValeur = tableau.filter((t) => t.valeur === null);
      const trimestres = periodes.every((p) => /^\d{6}$/.test(p)) ? [...new Set(periodes.map((p) => `${p.slice(0, 4)}Q${Math.ceil(Number(p.slice(4)) / 3)}`))] : [];
      if (sansValeur.length && trimestres.length) {
        const r = await lireDhis2("analytics.json", { dimension: `dx:${sansValeur.map((t) => t.uid).join(";")}`, filter: [`pe:${trimestres.join(";")}`, ou], includeNumDen: "true", skipMeta: "true" });
        const trimestriels = new Map(appliquerRealisation(sansValeur, lignesAnalytics(r.donnees)).filter((t) => t.valeur !== null).map((t) => [t.uid, { ...t, trimestriel: true }]));
        tableau = tableau.map((t) => trimestriels.get(t.uid) || t);
      }
    }
    const parId = new Map(tableau.map((t) => [t.uid, t]));
    const lignes = indicateurs.map((i) => (i.uid && parId.get(i.uid)) || { ...i, valeur: null, ecart: null, statut: "inconnu" });
    return { meta, etat, periodes, tableau: lignes, programme: "Tous les programmes", misAJour };
  });
}
