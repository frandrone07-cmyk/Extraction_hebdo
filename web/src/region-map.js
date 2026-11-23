let carteRegions = null;
let couchesParRegion = new Map();
let coucheEtiquettes = null;
let regionSelectionnee = null;
let gererEtiquettes = null;

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

let observateurTailleRegions = null;
let cadrageRegions = null; // dernier cadrage, réappliqué quand la carte change de taille
let minuterieCadrageRegions = 0;
export function detruireCarteRegions() {
  observateurTailleRegions?.disconnect();
  observateurTailleRegions = null;
  cadrageRegions = null;
  carteRegions?.remove();
  carteRegions = null;
  couchesParRegion = new Map();
  coucheEtiquettes = null;
  regionSelectionnee = null;
  gererEtiquettes = null;
}

export function initCarteRegions(elementId, theme) {
  if (typeof L === "undefined") return null;
  const element = document.getElementById(elementId);
  if (!element) return null;
  detruireCarteRegions();
  carteRegions = L.map(element, { scrollWheelZoom: false, zoomControl: true, preferCanvas: true, zoomSnap: 0.25, zoomDelta: 0.5 }).setView([14.5, -14.5], 7);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18,
    crossOrigin: true,
  }).addTo(carteRegions);
  const pane = element.querySelector(".leaflet-tile-pane");
  if (pane && theme === "dark") pane.style.filter = "invert(1) hue-rotate(180deg) brightness(.82) contrast(.92)";
  if ("ResizeObserver" in window) {
    observateurTailleRegions = new ResizeObserver(() => {
      carteRegions?.invalidateSize({ pan: false });
      clearTimeout(minuterieCadrageRegions);
      minuterieCadrageRegions = setTimeout(() => { if (carteRegions) cadrageRegions?.(); }, 120);
    });
    observateurTailleRegions.observe(element);
  }
  return carteRegions;
}

export function afficherRegions(regions, seuils, selectionRegion = null) {
  if (!carteRegions) return;
  couchesParRegion = new Map();
  regionSelectionnee = selectionRegion;
  const avecContours = regions.filter((region) => region.feature);
  if (!avecContours.length) return;
  const regionParFeature = new Map(avecContours.map((region) => [region.feature, region]));
  const entreesEtiquettes = [];
  coucheEtiquettes = L.layerGroup().addTo(carteRegions);
  const couche = L.geoJSON(avecContours.map((region) => region.feature), {
    style: (feature) => {
      const region = regionParFeature.get(feature);
      const active = region?.nom === regionSelectionnee;
      return {
        color: active ? "#163b31" : "#fff",
        weight: active ? 4 : 2,
        fillColor: couleur(statut(region?.tauxMoyen, seuils)),
        fillOpacity: active ? .85 : .58,
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
      const bounds = layer.getBounds();
      const [longitude, latitude] = feature.properties.centre || [bounds.getCenter().lng, bounds.getCenter().lat];
      const marqueur = L.marker([latitude, longitude], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: "region-rate-label",
          html: `<span data-region="${echapper(region.nom)}" style="background:${couleur(statut(region.tauxMoyen, seuils))}"><strong>${echapper(nom)}</strong><small>${pourcentage(region.tauxMoyen)}</small></span>`,
          iconSize: null,
        }),
      }).addTo(coucheEtiquettes);
      entreesEtiquettes.push({
        marqueur,
        nom: region.nom,
        centre: [latitude, longitude],
        largeur: Math.min(88, Math.max(38, nom.length * 4.4 + 10)),
        surface: (bounds.getNorth() - bounds.getSouth()) * (bounds.getEast() - bounds.getWest()),
      });
    },
  }).addTo(carteRegions);
  gererEtiquettes = () => {
    if (!carteRegions) return;
    const taille = carteRegions.getSize();
    const places = [];
    const priorite = [...entreesEtiquettes].sort((a, b) => (
      Number(b.nom === regionSelectionnee) - Number(a.nom === regionSelectionnee) || b.surface - a.surface
    ));
    for (const entree of priorite) {
      const point = carteRegions.latLngToContainerPoint(entree.centre);
      const boite = { x: point.x - entree.largeur / 2, y: point.y - 11, largeur: entree.largeur, hauteur: 22 };
      const active = entree.nom === regionSelectionnee;
      const dansCarte = point.x >= 0 && point.x <= taille.x && point.y >= 0 && point.y <= taille.y;
      const libre = active || (dansCarte && !places.some((place) => (
        Math.abs(place.x - boite.x) < (place.largeur + boite.largeur) / 2 + 3
        && Math.abs(place.y - boite.y) < (place.hauteur + boite.hauteur) / 2 + 3
      )));
      const element = entree.marqueur.getElement();
      if (element) {
        element.style.visibility = libre ? "visible" : "hidden";
        element.classList.toggle("region-label-selected", active);
      }
      if (libre) places.push(boite);
    }
  };
  carteRegions.on("zoomend moveend", gererEtiquettes);
  try {
    const bounds = regionSelectionnee ? couchesParRegion.get(regionSelectionnee)?.getBounds() : null;
    const limites = bounds || couche.getBounds();
    const maxZoom = regionSelectionnee ? 9 : 8;
    cadrageRegions = () => carteRegions.fitBounds(limites, { padding: [20, 20], maxZoom });
    cadrageRegions();
  } catch {
    return;
  }
  requestAnimationFrame(() => {
    carteRegions?.invalidateSize();
    gererEtiquettes?.();
  });
}

export function mettreEnEvidenceRegion(nom) {
  if (!carteRegions) return false;
  regionSelectionnee = nom;
  for (const [region, layer] of couchesParRegion) {
    layer.setStyle({ color: region === nom ? "#163b31" : "#fff", weight: region === nom ? 4 : 2, fillOpacity: region === nom ? .85 : .58 });
  }
  const layer = couchesParRegion.get(nom);
  layer?.bringToFront();
  if (layer) {
    cadrageRegions = () => carteRegions.fitBounds(layer.getBounds(), { padding: [20, 20], maxZoom: 9 });
    cadrageRegions();
  }
  gererEtiquettes?.();
  return Boolean(layer);
}
