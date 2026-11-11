// Charge les instantanés hebdomadaires compacts et construit le modèle filtré
// utilisé par les cinq vues. Les valeurs manquantes restent dans les lignes
// afin de calculer correctement le taux de remplissage.

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.json();
}

function moyenne(values) {
  const available = values.filter((value) => value !== null && value !== undefined);
  if (!available.length) return null;
  return Math.round((available.reduce((total, value) => total + value, 0) / available.length) * 10) / 10;
}

function statutDepuisValeur(value, seuils) {
  if (value === null || value === undefined) return "inconnu";
  if (value < seuils.critique) return "critique";
  if (value < seuils.conforme) return "surveiller";
  return "conforme";
}

function libelleSemaine(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });
}

function indexer(snapshots) {
  const valeursParSemaine = snapshots.semaines.map(() => []);
  for (const [semaine, district, formulaire, periode, valeur] of snapshots.lignes) {
    valeursParSemaine[semaine].push({ district, formulaire, periode, valeur });
  }
  return { ...snapshots, valeursParSemaine };
}

function moyennePour(snapshot, semaineIndex, districtIndex, formulaireIndex, periodeIndex, selections) {
  const valeurs = snapshot.valeursParSemaine[semaineIndex].filter((ligne) => {
    if (districtIndex !== null && ligne.district !== districtIndex) return false;
    if (selections.regionIndex !== null && snapshot.districts[ligne.district][0] !== selections.regionIndex) return false;
    if (selections.formulaireIndex !== null && ligne.formulaire !== selections.formulaireIndex) return false;
    if (selections.periodeIndex !== null && ligne.periode !== selections.periodeIndex) return false;
    if (formulaireIndex !== null && ligne.formulaire !== formulaireIndex) return false;
    if (periodeIndex !== null && ligne.periode !== periodeIndex) return false;
    return true;
  }).map((ligne) => ligne.valeur);
  return moyenne(valeurs);
}

export function optionsPour(snapshot, semaineCle) {
  const semaineIndex = snapshot.semaines.indexOf(semaineCle);
  if (semaineIndex < 0) return { regions: [], formulaires: [], periodes: [] };
  const regionIds = new Set();
  const formulaireIds = new Set();
  const periodeIds = new Set();
  for (const ligne of snapshot.valeursParSemaine[semaineIndex]) {
    regionIds.add(snapshot.districts[ligne.district][0]);
    formulaireIds.add(ligne.formulaire);
    periodeIds.add(ligne.periode);
  }
  return {
    regions: [...regionIds].map((index) => ({ value: snapshot.regions[index], label: snapshot.regions[index].replace(/^DRS[_ ]/, "") })),
    formulaires: [...formulaireIds].map((index) => ({ value: snapshot.formulaires[index], label: snapshot.formulaires[index] })),
    periodes: [...periodeIds].map((index) => ({ value: snapshot.periodes[index][0], label: snapshot.periodes[index][1] })),
  };
}

export function construireModele(snapshot, semaineCle, comparaisonCle, filters, evolution, geo) {
  const semaineIndex = snapshot.semaines.indexOf(semaineCle);
  const comparaisonIndex = snapshot.semaines.indexOf(comparaisonCle);
  const regionsOptions = optionsPour(snapshot, semaineCle);
  const regionIndex = filters.region ? snapshot.regions.indexOf(filters.region) : null;
  const formulaireIndex = filters.formulaire ? snapshot.formulaires.indexOf(filters.formulaire) : null;
  const periodeIndex = filters.periode
    ? snapshot.periodes.findIndex(([code]) => code === filters.periode)
    : null;
  const selections = {
    regionIndex: regionIndex !== null && regionIndex >= 0 ? regionIndex : null,
    formulaireIndex: formulaireIndex !== null && formulaireIndex >= 0 ? formulaireIndex : null,
    periodeIndex: periodeIndex !== null && periodeIndex >= 0 ? periodeIndex : null,
  };
  const geoParCle = new Map((geo?.features || []).map((feature) => [
    `${feature.properties.region}||${feature.properties.district}`,
    feature,
  ]));
  const weekRows = semaineIndex < 0 ? [] : snapshot.valeursParSemaine[semaineIndex];
  const districtIds = [...new Set(weekRows.map((row) => row.district))];
  const districtModels = [];

  for (const districtId of districtIds) {
    const [districtRegionIndex, districtName, uid] = snapshot.districts[districtId];
    if (selections.regionIndex !== null && districtRegionIndex !== selections.regionIndex) continue;
    const formIds = [...new Set(weekRows.filter((row) => row.district === districtId).map((row) => row.formulaire))];
    const formulaires = formIds
      .filter((id) => selections.formulaireIndex === null || id === selections.formulaireIndex)
      .map((id) => {
        const periodIds = [...new Set(weekRows
          .filter((row) => row.district === districtId && row.formulaire === id)
          .map((row) => row.periode))].sort((a, b) => snapshot.periodes[a][0].localeCompare(snapshot.periodes[b][0]));
        const historySelections = { ...selections, periodeIndex: null };
        const historiquePeriodes = periodIds.map((idPeriode) => {
          const value = moyennePour(snapshot, semaineIndex, districtId, id, idPeriode, historySelections);
          return {
            periode_code: snapshot.periodes[idPeriode][0],
            periode: snapshot.periodes[idPeriode][1],
            valeur: value,
            statut: statutDepuisValeur(value, snapshot.seuils),
          };
        });
        const periodsSelected = selections.periodeIndex === null
          ? historiquePeriodes
          : historiquePeriodes.filter((period) => period.periode_code === snapshot.periodes[selections.periodeIndex]?.[0]);
        const value = moyenne(periodsSelected.map((period) => period.valeur));
        const previousValue = comparaisonIndex < 0
          ? null
          : moyennePour(snapshot, comparaisonIndex, districtId, id, null, selections);
        return {
          nom: snapshot.formulaires[id],
          valeur: value,
          valeurPrecedente: previousValue,
          variation: value === null || previousValue === null ? null : Math.round((value - previousValue) * 10) / 10,
          statut: statutDepuisValeur(value, snapshot.seuils),
          periode: periodsSelected.at(-1)?.periode || null,
          periode_code: periodsSelected.at(-1)?.periode_code || null,
          historiquePeriodes,
        };
      });
    const tauxMoyen = moyenne(formulaires.map((formulaire) => formulaire.valeur));
    const tauxPrecedent = comparaisonIndex < 0 ? null : moyennePour(snapshot, comparaisonIndex, districtId, null, null, selections);
    const cle = `${snapshot.regions[districtRegionIndex]}||${districtName}`;
    districtModels.push({
      region: snapshot.regions[districtRegionIndex],
      nom: districtName,
      uid,
      formulaires,
      tauxMoyen,
      tauxPrecedent,
      variation: tauxMoyen === null || tauxPrecedent === null ? null : Math.round((tauxMoyen - tauxPrecedent) * 10) / 10,
      statut: statutDepuisValeur(tauxMoyen, snapshot.seuils),
      feature: geoParCle.get(cle) || null,
    });
  }

  const regions = [...new Set(districtModels.map((district) => district.region))].sort().map((nom) => {
    const districts = districtModels.filter((district) => district.region === nom);
    return {
      nom,
      districts,
      tauxMoyen: moyenne(districts.map((district) => district.tauxMoyen)),
      nbCritique: districts.filter((district) => district.statut === "critique").length,
      nbSurveiller: districts.filter((district) => district.statut === "surveiller").length,
      nbConforme: districts.filter((district) => district.statut === "conforme").length,
    };
  });
  const formulaires = [...new Set(districtModels.flatMap((district) => district.formulaires.map((formulaire) => formulaire.nom)))].sort().map((nom) => ({
    nom,
    tauxMoyen: moyenne(districtModels.flatMap((district) => district.formulaires
      .filter((formulaire) => formulaire.nom === nom).map((formulaire) => formulaire.valeur))),
  }));

  const serieGenerale = [];
  const tauxRemplissage = [];
  const seriesRegion = [];
  for (let wi = 0; wi < snapshot.semaines.length; wi += 1) {
    const scoped = snapshot.valeursParSemaine[wi].filter((row) => {
      if (selections.regionIndex !== null && snapshot.districts[row.district][0] !== selections.regionIndex) return false;
      if (selections.formulaireIndex !== null && row.formulaire !== selections.formulaireIndex) return false;
      if (selections.periodeIndex !== null && row.periode !== selections.periodeIndex) return false;
      return true;
    });
    serieGenerale.push(moyenne(scoped.map((row) => row.valeur)));
    tauxRemplissage.push(scoped.length ? Math.round((scoped.filter((row) => row.valeur !== null).length / scoped.length) * 1000) / 10 : null);
  }
  const regionsPourEvolution = selections.regionIndex === null ? snapshot.regions.map((_, i) => i) : [selections.regionIndex];
  for (const ri of regionsPourEvolution) {
    seriesRegion.push({
      region: snapshot.regions[ri],
      valeurs: snapshot.semaines.map((_, wi) => {
        const scoped = snapshot.valeursParSemaine[wi].filter((row) => {
          if (snapshot.districts[row.district][0] !== ri) return false;
          if (selections.formulaireIndex !== null && row.formulaire !== selections.formulaireIndex) return false;
          if (selections.periodeIndex !== null && row.periode !== selections.periodeIndex) return false;
          return true;
        });
        return moyenne(scoped.map((row) => row.valeur));
      }),
    });
  }

  const unresolved = new Set(districtModels.filter((district) => !district.uid).map((district) => district.nom));
  const selectedPeriodLabel = selections.periodeIndex === null ? "Toutes les périodes" : snapshot.periodes[selections.periodeIndex][1];
  const selectedRegionLabel = selections.regionIndex === null ? "Toutes les régions" : snapshot.regions[selections.regionIndex];
  const selectedFormLabel = selections.formulaireIndex === null ? "Tous les formulaires" : snapshot.formulaires[selections.formulaireIndex];
  const currentWeekIndex = Math.max(0, semaineIndex);
  const semainesVisibles = snapshot.semaines.slice(0, currentWeekIndex + 1);
  return {
    semaineCle,
    comparaisonCle: comparaisonIndex >= 0 ? comparaisonCle : null,
    semaineLibelle: libelleSemaine(semaineCle),
    seuils: snapshot.seuils || { critique: 70, conforme: 90, baisse: 5 },
    districts: districtModels.sort((a, b) => a.nom.localeCompare(b.nom, "fr")),
    regions,
    formulaires,
    districtsNonResolus: [...unresolved],
    options: regionsOptions,
    selection: {
      region: selectedRegionLabel.replace(/^DRS[_ ]/, ""),
      formulaire: selectedFormLabel,
      periode: selectedPeriodLabel,
      comparaison: comparaisonIndex >= 0 ? libelleSemaine(comparaisonCle) : null,
    },
    evolution: {
      semaines: semainesVisibles,
      moyenne_generale: serieGenerale.slice(0, currentWeekIndex + 1),
      taux_remplissage: tauxRemplissage.slice(0, currentWeekIndex + 1),
      par_region: seriesRegion.map((serie) => ({ ...serie, valeurs: serie.valeurs.slice(0, currentWeekIndex + 1) })),
      par_region_formulaire_periode: evolution.par_region_formulaire_periode,
    },
  };
}

export async function chargerDonnees() {
  const [latest, evolution, snapshots] = await Promise.all([
    fetchJson("data/latest.json"),
    fetchJson("data/evolution.json"),
    fetchJson("data/snapshots.json"),
  ]);
  let geo = null;
  try {
    geo = await fetchJson("data/geo/districts.geojson");
  } catch {
    geo = null;
  }
  const indexed = indexer({ ...snapshots, seuils: latest.seuils });
  return { latest, evolution, snapshot: indexed, geo };
}
