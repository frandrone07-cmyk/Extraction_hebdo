let carte = null;
let observateurTaille = null;
// Dernier cadrage demandé (Sénégal, région ou district) : réappliqué quand le cadre change de taille, pour que
// le pays (ou la zone choisie) remplisse toujours la carte agrandie.
let cadrageActuel = null;
let minuterieCadrage = 0; // la carte suit la taille de son cadre (ex. Sokhna Ci réduite → carte plus grande)
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
let etiquetteActiveSeule = false;

// Point situé réellement dans le polygone (le centre du rectangle englobant peut tomber en mer ou dans un autre district).
function pointInterieur(layer) {
  const polygones = layer.getLatLngs();
  const estAnneau = (valeur) => Array.isArray(valeur) && valeur.length && valeur[0] && valeur[0].lat !== undefined;
  const anneaux = estAnneau(polygones[0]) ? [polygones[0]] : polygones.map((polygone) => polygone[0]);
  const aire = (anneau) => { const b = L.latLngBounds(anneau); return (b.getNorth() - b.getSouth()) * (b.getEast() - b.getWest()); };
  const anneau = anneaux.filter(estAnneau).sort((a, b) => aire(b) - aire(a))[0];
  if (!anneau) return layer.getBounds().getCenter();
  const dedans = (x, y) => {
    let inside = false;
    for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
      const a = anneau[i];
      const b = anneau[j];
      if ((a.lat > y) !== (b.lat > y) && x < ((b.lng - a.lng) * (y - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
    }
    return inside;
  };
  let sommeAire = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    const f = anneau[j].lng * anneau[i].lat - anneau[i].lng * anneau[j].lat;
    sommeAire += f;
    cx += (anneau[j].lng + anneau[i].lng) * f;
    cy += (anneau[j].lat + anneau[i].lat) * f;
  }
  if (sommeAire) {
    const x = cx / (3 * sommeAire);
    const y = cy / (3 * sommeAire);
    if (dedans(x, y)) return L.latLng(y, x);
  }
  const b = L.latLngBounds(anneau);
  let meilleur = null;
  let distanceMax = -1;
  for (let i = 1; i < 14; i += 1) {
    for (let k = 1; k < 14; k += 1) {
      const x = b.getWest() + ((b.getEast() - b.getWest()) * i) / 14;
      const y = b.getSouth() + ((b.getNorth() - b.getSouth()) * k) / 14;
      if (!dedans(x, y)) continue;
      const proche = Math.min(...anneau.map((point) => (point.lng - x) ** 2 + (point.lat - y) ** 2));
      if (proche > distanceMax) { distanceMax = proche; meilleur = L.latLng(y, x); }
    }
  }
  return meilleur || b.getCenter();
}

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
  observateurTaille?.disconnect();
  observateurTaille = null;
  cadrageActuel = null;
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
  carte = L.map(element, { scrollWheelZoom: false, zoomControl: true, preferCanvas: true, zoomSnap: 0.25, zoomDelta: 0.5 }).setView([14.5, -14.5], 7);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18,
    crossOrigin: true,
  }).addTo(carte);
  appliquerTheme(theme);
  if ("ResizeObserver" in window) {
    observateurTaille = new ResizeObserver(() => {
      carte?.invalidateSize({ pan: false });
      clearTimeout(minuterieCadrage);
      minuterieCadrage = setTimeout(() => { if (carte) cadrageActuel?.(); }, 120);
    });
    observateurTaille.observe(element);
  }
  return carte;
}

export function basculerThemeCarte(theme) { appliquerTheme(theme); }

export function centrerRegion(region) {
  if (!carte || !limitesRegions.has(region)) return false;
  regionEtiquettes = region;
  cadrageActuel = () => carte.fitBounds(limitesRegions.get(region), { padding: [28, 28], maxZoom: 10 });
  cadrageActuel();
  gererZoomEtiquettes?.();
  return true;
}

export function afficherVueComplete() {
  if (!carte || !limitesCarte) return false;
  if (districtActif) coucheDistricts.resetStyle(districtActif);
  districtActif?.closeTooltip();
  districtActif = null;
  regionEtiquettes = null;
  cadrageActuel = () => carte.fitBounds(limitesCarte, { padding: [28, 28], maxZoom: 8 });
  cadrageActuel();
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
  cadrageActuel = () => carte.fitBounds(bounds, { padding: [48, 48], maxZoom: 11 });
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    carte.fitBounds(bounds, { padding: [48, 48], maxZoom: 11 });
  } else {
    carte.flyToBounds(bounds, { padding: [48, 48], maxZoom: 11, duration: .8 });
  }
  if (!etiquetteActiveSeule) layer.openTooltip();
  gererZoomEtiquettes?.();
  return true;
}

export function afficherDistricts(districts, { onClicDistrict, etiquettes = false, nomsEtiquettes = false, seuils = null, activeSeule = false } = {}) {
  if (!carte) return;
  etiquetteActiveSeule = activeSeule;
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
      const centre = pointInterieur(layer);
      const marqueur = L.marker(centre, {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: `carte-etiquette${nomsEtiquettes ? " carte-etiquette-nom" : ""}`,
          html: nomsEtiquettes
            ? `<span class="statut-${statutEtiquette}" data-region="${escapeHtml(district.region)}" style="background:${couleurEtiquette}"><strong>${escapeHtml(district.nom)}</strong><small>${tauxEtiquette}%</small></span>`
            : `<span class="statut-${statutEtiquette}" data-region="${escapeHtml(district.region)}" style="background:${couleurEtiquette}">${tauxEtiquette}%</span>`,
          iconSize: null,
        }),
      });
      const surface = (limites.getNorth() - limites.getSouth()) * (limites.getEast() - limites.getWest());
      entrees.push({ marqueur, limites, centre, surface, region: district.region, nom: district.nom, key: `${district.region}||${district.nom}` });
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
        if ((regionEtiquettes && entree.region !== regionEtiquettes) || (etiquetteActiveSeule && etiquetteDistrictActive && entree.key !== etiquetteDistrictActive)) {
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
        const centre = carte.latLngToContainerPoint(entree.centre);
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
    const limites = limitesCarte;
    cadrageActuel = () => carte.fitBounds(limites, { padding: [16, 16], maxZoom: 8 });
    cadrageActuel();
  } catch { /* contours partiels */ }
  requestAnimationFrame(() => {
    carte?.invalidateSize();
    gererZoomEtiquettes?.();
  });
}
