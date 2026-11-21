// Compétences d'analyse de Sokhna Ci : lecture statistique des résultats (concentration,
// dispersion, atypiques, retard global ou ciblé, formulaires systémiques ou locaux, dynamique).
// Tout est calculé à partir du modèle affiché : aucune valeur n'est estimée ni inventée.

const utiles = (valeurs) => valeurs.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
export function moyenne(valeurs) {
  const v = utiles(valeurs);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
export function mediane(valeurs) {
  const v = utiles(valeurs).sort((a, b) => a - b);
  if (!v.length) return null;
  const milieu = Math.floor(v.length / 2);
  return v.length % 2 ? v[milieu] : (v[milieu - 1] + v[milieu]) / 2;
}
export function ecartType(valeurs) {
  const v = utiles(valeurs);
  if (v.length < 2) return null;
  const m = moyenne(v);
  return Math.sqrt(v.reduce((somme, x) => somme + (x - m) ** 2, 0) / v.length);
}
const arrondi = (x) => Math.round(x * 10) / 10;

export function analyser(model) {
  const seuils = model.seuils;
  const regions = model.toutesRegions || [];
  const districts = regions.flatMap((region) => region.districts).filter((d) => d.tauxMoyen !== null && d.tauxMoyen !== undefined);
  const critiques = districts.filter((d) => d.tauxMoyen < seuils.critique);

  // 1. Concentration territoriale des districts en rouge
  const rougesParRegion = regions
    .map((region) => ({
      nom: region.nom,
      nb: region.districts.filter((d) => d.tauxMoyen !== null && d.tauxMoyen !== undefined && d.tauxMoyen < seuils.critique).length,
      total: region.districts.length,
    }))
    .filter((region) => region.nb > 0)
    .sort((a, b) => b.nb - a.nb || b.nb / b.total - a.nb / a.total);
  const regionsToutesRouges = rougesParRegion.filter((region) => region.nb === region.total && region.total >= 2);
  const principales = rougesParRegion.slice(0, 3);
  const partPrincipales = critiques.length ? (principales.reduce((somme, region) => somme + region.nb, 0) / critiques.length) * 100 : null;

  // 2. Dispersion entre districts
  const taux = districts.map((d) => d.tauxMoyen);
  const dispersion = { moyenne: moyenne(taux), mediane: mediane(taux), ecartType: ecartType(taux) };

  // 3. Districts atypiques par rapport à la médiane de leur région
  const atypiques = [];
  for (const region of regions) {
    const valeurs = region.districts.filter((d) => d.tauxMoyen !== null && d.tauxMoyen !== undefined);
    if (valeurs.length < 3) continue;
    const reference = mediane(valeurs.map((d) => d.tauxMoyen));
    for (const district of valeurs) {
      const ecart = district.tauxMoyen - reference;
      if (Math.abs(ecart) >= 25) atypiques.push({ district, region, ecart: arrondi(ecart) });
    }
  }
  atypiques.sort((a, b) => a.ecart - b.ecart);

  // 4. Retard global (presque tous les formulaires) ou ciblé (quelques formulaires)
  const partSousSeuil = (district) => {
    const valeurs = utiles(district.formulaires.map((f) => f.valeur));
    return valeurs.length >= 5 ? valeurs.filter((v) => v < seuils.critique).length / valeurs.length : null;
  };
  const globaux = critiques.filter((d) => (partSousSeuil(d) ?? 0) >= 0.8);
  const cibles = critiques.filter((d) => partSousSeuil(d) !== null && partSousSeuil(d) < 0.8);

  // 5. Formulaires systémiques (bas partout) ou locaux (très variables d'une région à l'autre)
  const noms = [...new Set(districts.flatMap((d) => d.formulaires.map((f) => f.nom)))];
  const formulaires = noms.map((nom) => {
    const parRegion = regions
      .map((region) => ({ region, taux: moyenne(region.districts.flatMap((d) => d.formulaires.filter((f) => f.nom === nom).map((f) => f.valeur))) }))
      .filter((x) => x.taux !== null);
    const valeurs = parRegion.map((x) => x.taux);
    return { nom, moyenne: moyenne(valeurs), ecartType: ecartType(valeurs), min: Math.min(...valeurs), max: Math.max(...valeurs), parRegion };
  }).filter((f) => f.moyenne !== null && Number.isFinite(f.min));
  const systemiques = formulaires.filter((f) => f.moyenne < seuils.critique && (f.ecartType ?? 99) < 12).sort((a, b) => a.moyenne - b.moyenne);
  const locaux = formulaires.filter((f) => f.max - f.min >= 40).sort((a, b) => b.max - b.min - (a.max - a.min));

  // 6. Dynamique entre extractions
  const serie = utiles(model.evolution?.moyenne_generale || []);
  const rythme = serie.length >= 2 ? arrondi((serie.at(-1) - serie[0]) / (serie.length - 1)) : null;
  const dernierPas = serie.length >= 2 ? arrondi(serie.at(-1) - serie.at(-2)) : null;
  const regionsDynamique = (model.evolution?.par_region || [])
    .map((s) => {
      const v = utiles(s.valeurs);
      return v.length >= 3 ? { nom: s.region, gain: arrondi(v.at(-1) - v.at(-3)) } : null;
    })
    .filter(Boolean);
  const stagnantes = regionsDynamique.filter((r) => Math.abs(r.gain) < 0.5);
  const meilleureProgression = [...regionsDynamique].sort((a, b) => b.gain - a.gain)[0] || null;

  // 7. Valeurs à zéro
  const cellules = districts.flatMap((d) => d.formulaires.map((f) => f.valeur));
  const zeros = cellules.filter((v) => v === 0).length;

  return {
    critiques, rougesParRegion, regionsToutesRouges, principales, partPrincipales,
    dispersion, atypiques, globaux, cibles, formulaires, systemiques, locaux,
    rythme, dernierPas, nbExtractions: serie.length, stagnantes, meilleureProgression, zeros,
  };
}
