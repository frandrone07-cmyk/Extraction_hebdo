// Récupère latest.json / evolution.json / districts.geojson et construit un
// modèle "à plat" (districts, régions, formulaires agrégés) pour simplifier
// le rendu de chaque onglet — c'est ici qu'on décide, pour chaque formulaire
// d'un district, quelle est sa "valeur courante" (la période la plus récente
// de l'extraction de la semaine affichée).

async function fetchJson(url) {
  const reponse = await fetch(url, { cache: "no-store" });
  if (!reponse.ok) throw new Error(`${url} -> HTTP ${reponse.status}`);
  return reponse.json();
}

function statutDepuisValeur(valeur, seuils) {
  if (valeur === null || valeur === undefined) return "inconnu";
  if (valeur < seuils.critique) return "critique";
  if (valeur < seuils.conforme) return "surveiller";
  return "conforme";
}

function moyenne(valeurs) {
  const v = valeurs.filter((x) => x !== null && x !== undefined);
  if (!v.length) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
}

function construireModele(latest, evolution, geo) {
  const seuils = latest.seuils;
  const geoParCle = new Map();
  if (geo && geo.features) {
    for (const f of geo.features) {
      geoParCle.set(`${f.properties.region}||${f.properties.district}`, f);
    }
  }

  const districts = [];
  const formulairesIndex = new Map();

  for (const region of latest.regions) {
    for (const d of region.districts) {
      const formulairesCourants = d.formulaires.map((f) => {
        const derniere = f.periodes[f.periodes.length - 1] || null;
        return {
          nom: f.nom,
          valeur: derniere ? derniere.valeur : null,
          statut: derniere ? derniere.statut : "inconnu",
          periode: derniere ? derniere.periode : null,
          periode_code: derniere ? derniere.periode_code : null,
          historiquePeriodes: f.periodes,
        };
      });
      const tauxMoyen = moyenne(formulairesCourants.map((f) => f.valeur));
      const cle = `${region.nom}||${d.nom}`;
      districts.push({
        region: region.nom,
        nom: d.nom,
        uid: d.uid,
        formulaires: formulairesCourants,
        tauxMoyen,
        statut: statutDepuisValeur(tauxMoyen, seuils),
        feature: geoParCle.get(cle) || null,
      });

      for (const f of formulairesCourants) {
        if (!formulairesIndex.has(f.nom)) formulairesIndex.set(f.nom, []);
        if (f.valeur !== null) formulairesIndex.get(f.nom).push(f.valeur);
      }
    }
  }

  const regionsIndex = new Map();
  for (const d of districts) {
    if (!regionsIndex.has(d.region)) {
      regionsIndex.set(d.region, { nom: d.region, districts: [], valeurs: [] });
    }
    const r = regionsIndex.get(d.region);
    r.districts.push(d);
    if (d.tauxMoyen !== null) r.valeurs.push(d.tauxMoyen);
  }

  const regions = Array.from(regionsIndex.values())
    .map((r) => ({
      nom: r.nom,
      districts: r.districts,
      tauxMoyen: moyenne(r.valeurs),
      nbCritique: r.districts.filter((d) => d.statut === "critique").length,
      nbSurveiller: r.districts.filter((d) => d.statut === "surveiller").length,
      nbConforme: r.districts.filter((d) => d.statut === "conforme").length,
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom));

  const formulaires = Array.from(formulairesIndex.entries())
    .map(([nom, valeurs]) => ({ nom, tauxMoyen: moyenne(valeurs) }))
    .sort((a, b) => a.nom.localeCompare(b.nom));

  const districtsNonResolus = latest.diagnostic ? latest.diagnostic.districts_non_resolus : [];

  return {
    semaineCle: latest.semaine_cle,
    genereLe: latest.genere_le,
    seuils,
    districts: districts.sort((a, b) => a.nom.localeCompare(b.nom)),
    regions,
    formulaires,
    districtsNonResolus,
    evolution,
  };
}

export async function chargerDonnees() {
  const [latest, evolution] = await Promise.all([
    fetchJson("data/latest.json"),
    fetchJson("data/evolution.json"),
  ]);
  let geo = null;
  try {
    geo = await fetchJson("data/geo/districts.geojson");
  } catch {
    geo = null; // la carte affichera un message plutôt que de planter
  }
  return construireModele(latest, evolution, geo);
}
