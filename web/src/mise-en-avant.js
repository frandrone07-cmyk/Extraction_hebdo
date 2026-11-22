// Quand Sokhna Ci parle d'un élément (un indicateur, une carte, un graphique, une solution…), l'affichage défile
// jusqu'à lui et le met en valeur par un halo, le temps de la phrase. Utilisé en mode TV et dans le tableau de bord.
const CLASSE = "sna-focus";
const REDUIT = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Pour une carte ou un graphique, c'est la carte entière qui est mise en valeur.
const ZONES_DANS_CARTE = "canvas, #carte, #carte-regions, #tv-map, #tv-map-regions, .heatmap, .tv-priorities";

let actuels = [];

export function effacerMiseEnAvant() {
  for (const element of actuels) element.classList.remove(CLASSE);
  actuels = [];
}

export function mettreEnAvant(racine, selecteur) {
  effacerMiseEnAvant();
  if (!racine || !selecteur) return null;
  let elements;
  try { elements = [...racine.querySelectorAll(selecteur)]; } catch { return null; }
  elements = elements
    .map((element) => (element.matches(ZONES_DANS_CARTE) ? element.closest(".card, .bilan-carte") || element : element))
    .filter((element, i, tous) => element && tous.indexOf(element) === i && element.getClientRects().length);
  if (!elements.length) return null;
  for (const element of elements) element.classList.add(CLASSE);
  actuels = elements;
  elements[0].scrollIntoView({ behavior: REDUIT() ? "auto" : "smooth", block: "center", inline: "nearest" });
  return elements[0];
}
