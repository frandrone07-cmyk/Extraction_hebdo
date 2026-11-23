// Ordres de navigation donnés à Sokhna Ci (voix ou clavier) : changer d'onglet, zoomer la carte sur une région
// ou un district, revenir à la vue nationale, lancer le mode TV. Un verbe d'action est exigé pour ne pas
// confondre un ordre avec une question (« l'évolution de Dakar » reste une question).
import { centrerDistrict, centrerRegion, afficherVueComplete } from "./map.js";
import { mettreEnEvidenceRegion } from "./region-map.js";
import { labelRegion, segment, toutesDistricts } from "./sokhnaci-dialogue.js";

const norm = (texte) => String(texte ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const contient = (q, nom) => { const n = norm(nom); return n.length >= 3 && ` ${q} `.includes(` ${n} `); };

// « va » seul ne suffit pas (« comment va Dakar Centre ? » est une question) : il faut « va vers / sur / à / dans ».
const VERBE_ALLER = /\b(vas? (vers|sur|a|au|dans)|aller (vers|sur|a|au|dans)|allons|allez|dirige toi|dirigez vous|dirige|ouvre|ouvrir|affiche|afficher|montre moi|passe (a|sur|dans|vers)|passons|emmene moi|amene moi|navigue|retourne (a|sur|vers|dans)|reviens (a|sur|vers|dans))\b/;
const ONGLETS = [
  { onglet: "vue", libelle: "Vue d’ensemble", motif: /\b(vue d ensemble|accueil|tableau de bord|page d accueil|synthese generale)\b/ },
  { onglet: "regions", libelle: "Régions et formulaires", motif: /\b(regions et formulaires|onglet regions?|onglet formulaires?)\b/ },
  { onglet: "evolution", libelle: "Évolution", motif: /\bevolution\b/ },
  { onglet: "districts", libelle: "Districts", motif: /\b(onglet districts?|liste des districts|vers les districts|aux districts)\b/ },
  { onglet: "qualite", libelle: "Qualité et méthode", motif: /\b(qualite|methode)\b/ },
  { onglet: "assistante", libelle: "Sokhna Ci AI", motif: /\b(sokhna ci ai|espace complet|espace sokhna|ton espace)\b/ },
];
// « centre » seul ne suffit pas (district « Dakar Centre ») : il faut « centre sur », « recentre », « zoome »…
const ZOOM = /\b(zoom\w*|agrandi\w*|rapproche toi|focus\w*|recentre\w*|centre(r|z)? (la carte )?sur|cadre(r|z)? sur)\b/;
const NATIONAL = /\b(dezoom\w*|vue nationale|tout le senegal|vue complete|carte complete|reviens a la vue nationale)\b/;

// Renvoie l'ordre reconnu, ou null si le texte n'est pas un ordre de navigation.
export function commandeNavigation(texte, model) {
  const q = norm(texte);
  if (!q || q.split(" ").length > 14) return null;
  if (/\b(mode tv|diaporama)\b/.test(q) && /\b(passe|lance|active|ouvre|demarre|mets|mode tv)\b/.test(q)) return { type: "tv" };
  if (NATIONAL.test(q)) return { type: "national" };
  if (ZOOM.test(q) && model) {
    const regions = (model.toutesRegions || []).filter((r) => contient(q, labelRegion(r.nom)));
    const districts = toutesDistricts(model).filter((d) => contient(q, d.nom)).sort((a, b) => norm(b.nom).length - norm(a.nom).length);
    const parleDistrict = /\bdistricts?\b/.test(q);
    const homonyme = (d) => regions.some((r) => norm(labelRegion(r.nom)) === norm(d.nom));
    const district = districts.find((d) => !homonyme(d) || parleDistrict);
    if (district && (parleDistrict || !regions.length)) return { type: "district", district };
    if (regions[0]) return { type: "region", region: regions[0] };
    if (/\b(carte|fond de carte)\b/.test(q)) return { type: "carte" };
  }
  if (VERBE_ALLER.test(q) || /\bonglet\b/.test(q)) {
    const cible = ONGLETS.find((o) => o.motif.test(q));
    if (cible) return { type: "onglet", ...cible };
  }
  return null;
}

const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function ongletActif() { return document.querySelector('[role="tab"][aria-selected="true"]')?.dataset.tab || "vue"; }
async function allerA(onglet) {
  if (ongletActif() === onglet) return;
  document.querySelector(`[role="tab"][data-tab="${onglet}"]`)?.click();
  await attendre(250); // le temps que l'onglet et ses cartes soient dessinés
}
function montrerCartes() {
  document.getElementById("carte")?.closest(".card")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
}

// Exécute l'ordre et renvoie la phrase que Sokhna Ci prononce.
export async function executerNavigation(commande) {
  if (commande.type === "tv") {
    document.getElementById("btn-tv")?.click();
    return { emotion: "souriante", segments: [segment("Je lance le mode TV.", "pointer_ecran")] };
  }
  if (commande.type === "onglet") {
    await allerA(commande.onglet);
    return { emotion: "souriante", segments: [segment(`Voici l’onglet ${commande.libelle}.`, "pointer_ecran")] };
  }
  await allerA("vue");
  montrerCartes();
  if (commande.type === "national" || commande.type === "carte") {
    afficherVueComplete();
    return { emotion: "neutre", segments: [segment("Voici la carte de tout le Sénégal.", "geste_ouvert")] };
  }
  if (commande.type === "region") {
    const ok = centrerRegion(commande.region.nom);
    mettreEnEvidenceRegion(commande.region.nom);
    return { emotion: "neutre", segments: [segment(ok ? `Je zoome sur la région de ${labelRegion(commande.region.nom)}.` : `La carte de la région de ${labelRegion(commande.region.nom)} n’est pas disponible pour le moment.`, "pointer_ecran")] };
  }
  const { district } = commande;
  const ok = centrerDistrict(district.region, district.nom);
  mettreEnEvidenceRegion(district.region);
  return { emotion: "neutre", segments: [segment(ok ? `Je zoome sur le district de ${district.nom}, région de ${labelRegion(district.region)}.` : `Le contour du district de ${district.nom} n’est pas disponible sur la carte.`, "pointer_ecran")] };
}
