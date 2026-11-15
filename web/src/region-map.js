let carteRegions = null;
let couchesParRegion = new Map();

function couleur(statut) {
  const variable = { critique: "--critique", surveiller: "--surveiller", conforme: "--conforme", inconnu: "--inconnu" }[statut] || "--inconnu";
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}

function statut(taux, seuils) {
  if (taux === null || taux === undefined) return "inconnu";
  if (taux < seuils.critique) return "critique";
  if (taux < seuils.conforme) return "surveiller";
  return "conforme";
}

function pourcentage(taux) {
  return taux === null || taux === undefined
    ? "—"
    : `${Number(taux).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function echapper(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

export function detruireCarteRegions() {
  carteRegions?.remove();
  carteRegions = null;
  couchesParRegion = new Map();
}

export function initCarteRegions(elementId, theme) {
  if (typeof L === "undefined") return null;
  const element = document.getElementById(elementId);
  if (!element) return null;
  detruireCarteRegions();
  carteRegions = L.map(element, { scrollWheelZoom: false, zoomControl: true, preferCanvas: true }).setView([14.5, -14.5], 7);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18,
    crossOrigin: true,
  }).addTo(carteRegions);
  const pane = element.querySelector(".leaflet-tile-pane");
  if (pane && theme === "dark") pane.style.filter = "invert(1) hue-rotate(180deg) brightness(.82) contrast(.92)";
  return carteRegions;
}

export function afficherRegions(regions, seuils) {
  if (!carteRegions) return;
  couchesParRegion = new Map();
  const avecContours = regions.filter((region) => region.feature);
  if (!avecContours.length) return;
  const regionParFeature = new Map(avecContours.map((region) => [region.feature, region]));
  const couche = L.geoJSON(avecContours.map((region) => region.feature), {
    style: (feature) => {
      const region = regionParFeature.get(feature);
      return {
        color: "#fff",
        weight: 2,
        fillColor: couleur(statut(region?.tauxMoyen, seuils)),
        fillOpacity: .8,
      };
    },
    onEachFeature: (feature, layer) => {
      const region = regionParFeature.get(feature);
      if (!region) return;
      couchesParRegion.set(region.nom, layer);
      const nom = region.nom.replace(/^DRS[_ ]/, "");
      layer.bindTooltip(`<strong>${echapper(nom)}</strong><br>Taux moyen : ${pourcentage(region.tauxMoyen)}`, {
        sticky: true,
        direction: "top",
      });
      if (region.tauxMoyen !== null && region.tauxMoyen !== undefined) {
        const bounds = layer.getBounds();
        const [longitude, latitude] = feature.properties.centre || [bounds.getCenter().lng, bounds.getCenter().lat];
        L.marker([latitude, longitude], {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: "region-rate-label",
              html: `<span style="background:${couleur(statut(region.tauxMoyen, seuils))}">${pourcentage(region.tauxMoyen)}</span>`,
            iconSize: null,
          }),
        }).addTo(carteRegions);
      }
    },
  }).addTo(carteRegions);
  try {
    carteRegions.fitBounds(couche.getBounds(), { padding: [20, 20], maxZoom: 8 });
  } catch {
    return;
  }
  requestAnimationFrame(() => carteRegions?.invalidateSize());
}

export function mettreEnEvidenceRegion(nom) {
  if (!carteRegions) return false;
  for (const [region, layer] of couchesParRegion) {
    layer.setStyle({ color: region === nom ? "#163b31" : "#fff", weight: region === nom ? 4 : 2, fillOpacity: region === nom ? .98 : .8 });
  }
  couchesParRegion.get(nom)?.bringToFront();
  return couchesParRegion.has(nom);
}
