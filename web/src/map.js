// Carte Leaflet 1.9.4 (CDN, voir index.html). Choroplèthe par statut de
// district. Tuiles OpenStreetMap standard (gratuites, sans clé API) ; le
// thème sombre s'obtient par un filtre CSS sur les tuiles plutôt que par un
// fournisseur de tuiles sombres tiers (évite toute dépendance à une clé API).

let carte = null;
let coucheDistricts = null;
let coucheTuiles = null;

const COULEURS = { critique: "#c0392b", surveiller: "#b8860b", conforme: "#1e8449", inconnu: "#95a5a6" };

function tuiles() {
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18,
  });
}

function appliquerFiltreTheme(theme) {
  const panneau = document.querySelector("#carte .leaflet-tile-pane");
  if (panneau) panneau.style.filter = theme === "dark" ? "invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)" : "";
}

export function initCarte(elementId, theme) {
  if (typeof L === "undefined") return null;
  carte = L.map(elementId, { scrollWheelZoom: false }).setView([14.5, -14.5], 7);
  coucheTuiles = tuiles().addTo(carte);
  appliquerFiltreTheme(theme);
  return carte;
}

export function basculerThemeCarte(theme) {
  appliquerFiltreTheme(theme);
}

export function afficherDistricts(districts, { onClicDistrict } = {}) {
  if (!carte) return;
  if (coucheDistricts) carte.removeLayer(coucheDistricts);

  const avecContour = districts.filter((d) => d.feature);
  if (!avecContour.length) return;

  coucheDistricts = L.geoJSON(
    avecContour.map((d) => d.feature),
    {
      style: (feature) => {
        const d = avecContour.find((x) => x.feature === feature);
        return { color: "#fff", weight: 1, fillColor: COULEURS[d.statut] || COULEURS.inconnu, fillOpacity: 0.75 };
      },
      onEachFeature: (feature, layer) => {
        const d = avecContour.find((x) => x.feature === feature);
        if (!d) return;
        layer.bindTooltip(
          `<strong>${d.nom}</strong><br>${d.region.replace(/^DRS_/, "")}<br>Taux moyen : ${d.tauxMoyen ?? "—"}%`,
          { sticky: true }
        );
        if (onClicDistrict) layer.on("click", () => onClicDistrict(d));
      },
    }
  ).addTo(carte);

  try {
    carte.fitBounds(coucheDistricts.getBounds(), { padding: [10, 10] });
  } catch {
    /* pas de contours exploitables -> on garde la vue par defaut */
  }
}
