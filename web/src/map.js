const ZOOM_MIN_ETIQUETTES = 9;
let carte = null;
let coucheDistricts = null;
let coucheEtiquettes = null;
let gererZoomEtiquettes = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}
function couleur(statut) {
  const variable = { critique: "--critique", surveiller: "--surveiller", conforme: "--conforme", inconnu: "--inconnu" }[statut] || "--inconnu";
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}
function appliquerTheme(theme) {
  const pane = document.querySelector("#carte .leaflet-tile-pane");
  if (pane) pane.style.filter = theme === "dark" ? "invert(1) hue-rotate(180deg) brightness(.82) contrast(.92)" : "";
}

export function detruireCarte() {
  if (!carte) return;
  carte.remove();
  carte = null;
  coucheDistricts = null;
  coucheEtiquettes = null;
  gererZoomEtiquettes = null;
}

export function initCarte(elementId, theme) {
  if (typeof L === "undefined") return null;
  const element = document.getElementById(elementId);
  if (!element) return null;
  detruireCarte();
  carte = L.map(element, { scrollWheelZoom: false, zoomControl: true, preferCanvas: true }).setView([14.5, -14.5], 7);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18,
    crossOrigin: true,
  }).addTo(carte);
  appliquerTheme(theme);
  return carte;
}

export function basculerThemeCarte(theme) { appliquerTheme(theme); }

export function afficherDistricts(districts, { onClicDistrict, etiquettes = false } = {}) {
  if (!carte) return;
  if (coucheDistricts) carte.removeLayer(coucheDistricts);
  if (coucheEtiquettes) carte.removeLayer(coucheEtiquettes);
  if (gererZoomEtiquettes) { carte.off("zoomend", gererZoomEtiquettes); gererZoomEtiquettes = null; }
  const withContour = districts.filter((district) => district.feature);
  if (!withContour.length) return;
  const byFeature = new Map(withContour.map((district) => [district.feature, district]));
  coucheDistricts = L.geoJSON(withContour.map((district) => district.feature), {
    style: (feature) => {
      const district = byFeature.get(feature);
      return { color: "#fff", weight: 1, fillColor: couleur(district?.statut), fillOpacity: .78, opacity: .9 };
    },
    onEachFeature: (feature, layer) => {
      const district = byFeature.get(feature);
      if (!district) return;
      const region = district.region.replace(/^DRS[_ ]/, "");
      layer.bindTooltip(`<strong>${escapeHtml(district.nom)}</strong><br>${escapeHtml(region)}<br>Taux moyen : ${district.tauxMoyen ?? "—"}%`, { sticky: true, direction: "top" });
      if (onClicDistrict) layer.on("click", () => onClicDistrict(district));
    },
  }).addTo(carte);

  if (etiquettes) {
    coucheEtiquettes = L.layerGroup();
    coucheDistricts.eachLayer((layer) => {
      const district = byFeature.get(layer.feature);
      if (!district || district.tauxMoyen === null || district.tauxMoyen === undefined) return;
      let centre;
      try { centre = layer.getBounds().getCenter(); } catch { return; }
      L.marker(centre, {
        interactive: false,
        icon: L.divIcon({
          className: "carte-etiquette",
          html: `<span style="background:${couleur(district.statut)}">${Math.round(district.tauxMoyen)}%</span>`,
          iconSize: null,
        }),
      }).addTo(coucheEtiquettes);
    });
    // Chevauchement illisible en zone dense (Dakar) au niveau pays : les
    // etiquettes n'apparaissent qu'une fois suffisamment zoome.
    gererZoomEtiquettes = () => {
      if (!carte || !coucheEtiquettes) return;
      const visible = carte.getZoom() >= ZOOM_MIN_ETIQUETTES;
      const presente = carte.hasLayer(coucheEtiquettes);
      if (visible && !presente) coucheEtiquettes.addTo(carte);
      else if (!visible && presente) carte.removeLayer(coucheEtiquettes);
    };
    carte.on("zoomend", gererZoomEtiquettes);
    if (carte.getZoom() >= ZOOM_MIN_ETIQUETTES) coucheEtiquettes.addTo(carte);
  }

  try { carte.fitBounds(coucheDistricts.getBounds(), { padding: [16, 16], maxZoom: 9 }); } catch { /* contours partiels */ }
  requestAnimationFrame(() => {
    carte?.invalidateSize();
    gererZoomEtiquettes?.();
  });
}
