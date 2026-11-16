let carte = null;
let coucheDistricts = null;
let coucheEtiquettes = null;
let gererZoomEtiquettes = null;
let limitesRegions = new Map();
let limitesDistricts = new Map();
let couchesParDistrict = new Map();
let regionEtiquettes = null;
let limitesCarte = null;
let districtActif = null;
let etiquetteDistrictActive = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}
function couleur(statut) {
  const variable = { critique: "--critique", surveiller: "--surveiller", conforme: "--conforme", inconnu: "--inconnu" }[statut] || "--inconnu";
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}
function statutPourTaux(taux, seuils) {
  if (taux === null || taux === undefined) return "inconnu";
  if (taux < seuils.critique) return "critique";
  if (taux < seuils.conforme) return "surveiller";
  return "conforme";
}
function afficherTaux(taux) {
  return Number(taux).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}
function appliquerTheme(theme) {
  const pane = document.querySelector("#carte .leaflet-tile-pane");
  if (pane) pane.style.filter = theme === "dark" ? "invert(1) hue-rotate(180deg) brightness(.82) contrast(.92)" : "";
}

export function detruireCarte() {
  if (carte) carte.remove();
  carte = null;
  coucheDistricts = null;
  coucheEtiquettes = null;
  gererZoomEtiquettes = null;
  limitesRegions = new Map();
  limitesDistricts = new Map();
  couchesParDistrict = new Map();
  regionEtiquettes = null;
  limitesCarte = null;
  districtActif = null;
  etiquetteDistrictActive = null;
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

export function centrerRegion(region) {
  if (!carte || !limitesRegions.has(region)) return false;
  regionEtiquettes = region;
  carte.fitBounds(limitesRegions.get(region), { padding: [28, 28], maxZoom: 10 });
  gererZoomEtiquettes?.();
  return true;
}

export function afficherVueComplete() {
  if (!carte || !limitesCarte) return false;
  if (districtActif) coucheDistricts.resetStyle(districtActif);
  districtActif?.closeTooltip();
  districtActif = null;
  regionEtiquettes = null;
  carte.fitBounds(limitesCarte, { padding: [28, 28], maxZoom: 8 });
  etiquetteDistrictActive = null;
  gererZoomEtiquettes?.();
  return true;
}

export function centrerDistrict(region, nom) {
  if (!carte) return false;
  const key = `${region}||${nom}`;
  const bounds = limitesDistricts.get(key);
  const layer = couchesParDistrict.get(key);
  if (!bounds || !layer) return false;
  if (districtActif && districtActif !== layer) {
    coucheDistricts.resetStyle(districtActif);
    districtActif.closeTooltip();
  }
  districtActif = layer;
  etiquetteDistrictActive = key;
  layer.setStyle({ color: "#fff", weight: 3, fillOpacity: 1, opacity: 1 });
  layer.bringToFront();
  regionEtiquettes = region;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    carte.fitBounds(bounds, { padding: [48, 48], maxZoom: 11 });
  } else {
    carte.flyToBounds(bounds, { padding: [48, 48], maxZoom: 11, duration: .8 });
  }
  layer.openTooltip();
  gererZoomEtiquettes?.();
  return true;
}

export function afficherDistricts(districts, { onClicDistrict, etiquettes = false, nomsEtiquettes = false, seuils = null } = {}) {
  if (!carte) return;
  if (coucheDistricts) carte.removeLayer(coucheDistricts);
  if (coucheEtiquettes) carte.removeLayer(coucheEtiquettes);
  if (gererZoomEtiquettes) { carte.off("zoomend moveend", gererZoomEtiquettes); gererZoomEtiquettes = null; }
  limitesRegions = new Map();
  limitesDistricts = new Map();
  couchesParDistrict = new Map();
  regionEtiquettes = null;
  limitesCarte = null;
  districtActif = null;
  const withContour = districts.filter((district) => district.feature);
  if (!withContour.length) return;
  const byFeature = new Map(withContour.map((district) => [district.feature, district]));
  coucheDistricts = L.geoJSON(withContour.map((district) => district.feature), {
    style: (feature) => {
      const district = byFeature.get(feature);
      const statut = seuils && district ? statutPourTaux(district.tauxMoyen, seuils) : district?.statut;
      return { color: "#fff", weight: 1, fillColor: couleur(statut), fillOpacity: .78, opacity: .9 };
    },
    onEachFeature: (feature, layer) => {
      const district = byFeature.get(feature);
      if (!district) return;
      try {
        const bounds = layer.getBounds();
        const key = `${district.region}||${district.nom}`;
        limitesDistricts.set(key, bounds);
        couchesParDistrict.set(key, layer);
        if (limitesRegions.has(district.region)) limitesRegions.get(district.region).extend(bounds);
        else limitesRegions.set(district.region, bounds);
      } catch { /* contour incomplet */ }
      const region = district.region.replace(/^DRS[_ ]/, "");
      const taux = district.tauxMoyen === null || district.tauxMoyen === undefined ? "—" : `${afficherTaux(district.tauxMoyen)}%`;
      layer.bindTooltip(`<strong>${escapeHtml(district.nom)}</strong><br>${escapeHtml(region)}<br>Taux moyen : ${taux}`, { sticky: true, direction: "top", offset: nomsEtiquettes ? [0, -34] : [0, 0] });
      if (onClicDistrict) layer.on("click", () => onClicDistrict(district));
    },
  }).addTo(carte);
  if (etiquettes) {
    coucheEtiquettes = L.layerGroup().addTo(carte);
    const entrees = [];
    coucheDistricts.eachLayer((layer) => {
      const district = byFeature.get(layer.feature);
      if (!district || (!nomsEtiquettes && (district.tauxMoyen === null || district.tauxMoyen === undefined))) return;
      let limites;
      try { limites = layer.getBounds(); } catch { return; }
      const statutEtiquette = seuils ? statutPourTaux(district.tauxMoyen, seuils) : district.statut;
      const couleurEtiquette = couleur(statutEtiquette);
      const tauxEtiquette = afficherTaux(district.tauxMoyen);
      const marqueur = L.marker(limites.getCenter(), {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: `carte-etiquette${nomsEtiquettes ? " carte-etiquette-nom" : ""}`,
          html: nomsEtiquettes
            ? `<span data-region="${escapeHtml(district.region)}" style="background:${couleurEtiquette}"><strong>${escapeHtml(district.nom)}</strong><small>${tauxEtiquette}%</small></span>`
            : `<span data-region="${escapeHtml(district.region)}" style="background:${couleurEtiquette}">${tauxEtiquette}%</span>`,
          iconSize: null,
        }),
      });
      const surface = (limites.getNorth() - limites.getSouth()) * (limites.getEast() - limites.getWest());
      entrees.push({ marqueur, limites, surface, region: district.region, nom: district.nom, key: `${district.region}||${district.nom}` });
    });
    entrees.sort((a, b) => b.surface - a.surface);
    // Placement glouton : les grands districts d'abord ; une etiquette n'est
    // affichee que si elle tient dans son district et ne recouvre aucune autre,
    // pour laisser les couleurs lisibles dans les zones denses (Dakar).
    gererZoomEtiquettes = () => {
      if (!carte || !coucheEtiquettes) return;
      const grand = carte.getSize().x >= 900;
      const largeur = grand ? 34 : 30;
      const hauteur = grand ? 15 : 14;
      const places = [];
      const ordre = [...entrees].sort((a, b) => (b.key === etiquetteDistrictActive) - (a.key === etiquetteDistrictActive));
      for (const entree of ordre) {
        const present = coucheEtiquettes.hasLayer(entree.marqueur);
        if (regionEtiquettes && entree.region !== regionEtiquettes) {
          if (present) coucheEtiquettes.removeLayer(entree.marqueur);
          continue;
        }
        const nord = carte.latLngToContainerPoint(entree.limites.getNorthWest());
        const sud = carte.latLngToContainerPoint(entree.limites.getSouthEast());
        const mesure = entree.marqueur.getElement()?.firstElementChild;
        const largeurEtiquette = mesure?.offsetWidth || (nomsEtiquettes ? Math.min(80, Math.max(48, entree.nom.length * 4 + 10)) : largeur);
        const hauteurEtiquette = mesure?.offsetHeight || (nomsEtiquettes ? 26 : hauteur);
        const active = entree.key === etiquetteDistrictActive;
        const tient = (sud.x - nord.x) >= largeurEtiquette * (nomsEtiquettes ? 0.5 : 0.9)
          && (sud.y - nord.y) >= hauteurEtiquette * (nomsEtiquettes ? 0.5 : 0.9);
        const centre = carte.latLngToContainerPoint(entree.limites.getCenter());
        const boite = { x: centre.x - largeurEtiquette / 2, y: centre.y - hauteurEtiquette / 2, l: largeurEtiquette, h: hauteurEtiquette };
        const chevauche = places.some((p) => boite.x < p.x + p.l + 3 && p.x < boite.x + boite.l + 3 && boite.y < p.y + p.h + 3 && p.y < boite.y + boite.h + 3);
        const libre = active || (tient && !chevauche);
        if (libre) {
          places.push(boite);
          if (!present) coucheEtiquettes.addLayer(entree.marqueur);
          entree.marqueur.getElement()?.classList.toggle("carte-etiquette-active", active);
          entree.marqueur.setZIndexOffset(active ? 1000 : 0);
        } else if (present) {
          coucheEtiquettes.removeLayer(entree.marqueur);
        }
      }
    };
    carte.on("zoomend moveend", gererZoomEtiquettes);
  }

  try {
    limitesCarte = coucheDistricts.getBounds();
    carte.fitBounds(limitesCarte, { padding: [16, 16], maxZoom: 8 });
  } catch { /* contours partiels */ }
  requestAnimationFrame(() => {
    carte?.invalidateSize();
    gererZoomEtiquettes?.();
  });
}
