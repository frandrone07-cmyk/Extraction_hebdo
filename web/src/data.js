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
    if (selections.periodesSet && !selections.periodesSet.has(ligne.periode)) return false;
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

function ecart(actuel, precedent) {
  return actuel === null || actuel === undefined || precedent === null || precedent === undefined ? null : Math.round((actuel - precedent) * 10) / 10;
}

function construireRegions(districtModels, nomsRegions, geoRegionParNom) {
  return nomsRegions.map((nom) => {
    const districts = districtModels.filter((district) => district.region === nom);
    const tauxMoyen = moyenne(districts.map((district) => district.tauxMoyen));
    const tauxPrecedent = moyenne(districts.map((district) => district.tauxPrecedent));
    return {
      nom,
      districts,
      tauxMoyen,
      tauxPrecedent,
      variation: ecart(moyenne(districts.map((district) => district.tauxComparable)), tauxPrecedent),
      nbCritique: districts.filter((district) => district.statut === "critique").length,
      nbSurveiller: districts.filter((district) => district.statut === "surveiller").length,
      nbConforme: districts.filter((district) => district.statut === "conforme").length,
      feature: geoRegionParNom.get(nom) || null,
    };
  });
}

export function construireModele(snapshot, semaineCle, comparaisonCle, filters, evolution, geo, geoRegions = null) {
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
  // Le mois choisi peut ne pas exister dans l'extraction comparée (ex. mois en cours) :
  // l'écart est alors calculé sur les mois présents dans les deux extractions.
  let selectionsComparaison = { ...selections, regionIndex: null };
  let comparaisonRepli = null;
  if (comparaisonIndex >= 0 && semaineIndex >= 0 && selections.periodeIndex !== null) {
    const ids = (index) => new Set(snapshot.valeursParSemaine[index].map((ligne) => ligne.periode));
    const idsComparaison = ids(comparaisonIndex);
    if (!idsComparaison.has(selections.periodeIndex)) {
      const communs = new Set([...ids(semaineIndex)].filter((id) => idsComparaison.has(id)));
      if (communs.size) {
        selectionsComparaison = { ...selectionsComparaison, periodeIndex: null, periodesSet: communs };
        comparaisonRepli = [...communs].map((id) => snapshot.periodes[id][1]);
      }
    }
  }
  const geoParCle = new Map((geo?.features || []).map((feature) => [
    `${feature.properties.region}||${feature.properties.district}`,
    feature,
  ]));
  const geoRegionParNom = new Map((geoRegions?.features || []).map((feature) => [
    feature.properties.region,
    feature,
  ]));
  const weekRows = semaineIndex < 0 ? [] : snapshot.valeursParSemaine[semaineIndex];
  const districtIds = [...new Set(weekRows.map((row) => row.district))];
  const tousDistricts = [];

  for (const districtId of districtIds) {
    const [districtRegionIndex, districtName, uid] = snapshot.districts[districtId];
    const formIds = [...new Set(weekRows.filter((row) => row.district === districtId).map((row) => row.formulaire))];
    const formulaires = formIds
      .filter((id) => selections.formulaireIndex === null || id === selections.formulaireIndex)
      .map((id) => {
        const periodIds = [...new Set(weekRows
          .filter((row) => row.district === districtId && row.formulaire === id)
          .map((row) => row.periode))].sort((a, b) => snapshot.periodes[a][0].localeCompare(snapshot.periodes[b][0]));
        const historySelections = { ...selections, regionIndex: null, periodeIndex: null };
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
          : moyennePour(snapshot, comparaisonIndex, districtId, id, null, selectionsComparaison);
        const valeurComparable = comparaisonRepli ? moyennePour(snapshot, semaineIndex, districtId, id, null, selectionsComparaison) : value;
        return {
          nom: snapshot.formulaires[id],
          valeur: value,
          valeurPrecedente: previousValue,
          valeurComparable,
          variation: ecart(valeurComparable, previousValue),
          statut: statutDepuisValeur(value, snapshot.seuils),
          periode: periodsSelected.at(-1)?.periode || null,
          periode_code: periodsSelected.at(-1)?.periode_code || null,
          historiquePeriodes,
        };
      });
    const tauxMoyen = moyenne(formulaires.map((formulaire) => formulaire.valeur));
      const tauxPrecedent = comparaisonIndex < 0 ? null : moyennePour(snapshot, comparaisonIndex, districtId, null, null, selectionsComparaison);
      const tauxComparable = comparaisonRepli ? moyennePour(snapshot, semaineIndex, districtId, null, null, selectionsComparaison) : tauxMoyen;
    const cle = `${snapshot.regions[districtRegionIndex]}||${districtName}`;
      tousDistricts.push({
      region: snapshot.regions[districtRegionIndex],
      nom: districtName,
      uid,
      formulaires,
      tauxMoyen,
      tauxPrecedent,
      tauxComparable,
      variation: ecart(tauxComparable, tauxPrecedent),
      statut: statutDepuisValeur(tauxMoyen, snapshot.seuils),
      feature: geoParCle.get(cle) || null,
    });
  }

  const districtModels = selections.regionIndex === null
    ? tousDistricts
    : tousDistricts.filter((district) => snapshot.regions[selections.regionIndex] === district.region);
  const regions = construireRegions(districtModels, [...new Set(districtModels.map((district) => district.region))].sort(), geoRegionParNom);
  const toutesRegions = construireRegions(tousDistricts, snapshot.regions, geoRegionParNom);
  const resumeFormulaire = (nom, districtsSource) => {
    const lignes = districtsSource.flatMap((district) => district.formulaires.filter((formulaire) => formulaire.nom === nom));
    const tauxMoyen = moyenne(lignes.map((formulaire) => formulaire.valeur));
    const tauxPrecedent = moyenne(lignes.map((formulaire) => formulaire.valeurPrecedente));
    return { nom, tauxMoyen, tauxPrecedent, variation: ecart(moyenne(lignes.map((formulaire) => formulaire.valeurComparable)), tauxPrecedent) };
  };
  const formulaires = [...new Set(districtModels.flatMap((district) => district.formulaires.map((formulaire) => formulaire.nom)))].sort()
    .map((nom) => resumeFormulaire(nom, districtModels));
  const tousFormulaires = snapshot.formulaires.map((nom) => resumeFormulaire(nom, tousDistricts));

  // Une tendance compare des mois présents dans TOUTES les extractions affichées :
  // sans mois choisi, ou si le mois choisi n'existe que dans une seule extraction
  // (ex. le mois en cours), on retombe sur les mois communs à toutes les extractions.
  const dernierIndexVisible = Math.max(0, semaineIndex);
  const periodesParSemaine = [];
  for (let wi = 0; wi <= dernierIndexVisible; wi += 1) periodesParSemaine.push(new Set(snapshot.valeursParSemaine[wi].map((row) => row.periode)));
  const communesBrutes = periodesParSemaine.reduce((acc, presentes) => (acc === null ? presentes : new Set([...acc].filter((id) => presentes.has(id)))), null);
  let periodeTendance = selections.periodeIndex;
  let periodesCommunes = null;
  let tendanceRepli = false;
  let motifRepli = null;
  if (selections.periodeIndex !== null && communesBrutes?.size) {
    if (filters.periodeAuto) motifRepli = "auto";
    else if (periodesParSemaine.filter((presentes) => presentes.has(selections.periodeIndex)).length < 2) motifRepli = "absent";
  }
  if (motifRepli) {
    periodeTendance = null;
    tendanceRepli = true;
  }
  if (periodeTendance === null && communesBrutes?.size) periodesCommunes = communesBrutes;
  const periodesTendance = periodesCommunes ? [...periodesCommunes].map((id) => snapshot.periodes[id][1]) : [];
  const periodeComparable = (row) => periodesCommunes === null || periodesCommunes.has(row.periode);

  const serieGenerale = [];
  const tauxRemplissage = [];
  const seriesRegion = [];
  for (let wi = 0; wi < snapshot.semaines.length; wi += 1) {
    const scoped = snapshot.valeursParSemaine[wi].filter((row) => {
      if (selections.regionIndex !== null && snapshot.districts[row.district][0] !== selections.regionIndex) return false;
      if (selections.formulaireIndex !== null && row.formulaire !== selections.formulaireIndex) return false;
      if (periodeTendance !== null && row.periode !== periodeTendance) return false;
      if (!periodeComparable(row)) return false;
      return true;
    });
    serieGenerale.push(moyenne(scoped.map((row) => row.valeur)));
    tauxRemplissage.push(scoped.length ? Math.round((scoped.filter((row) => row.valeur !== null).length / scoped.length) * 1000) / 10 : null);
  }
  const regionsPourEvolution = snapshot.regions.map((_, i) => i);
  for (const ri of regionsPourEvolution) {
    seriesRegion.push({
      region: snapshot.regions[ri],
      valeurs: snapshot.semaines.map((_, wi) => {
        const scoped = snapshot.valeursParSemaine[wi].filter((row) => {
          if (snapshot.districts[row.district][0] !== ri) return false;
          if (selections.formulaireIndex !== null && row.formulaire !== selections.formulaireIndex) return false;
          if (periodeTendance !== null && row.periode !== periodeTendance) return false;
          if (!periodeComparable(row)) return false;
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
    comparaisonRepli,
    semaineLibelle: libelleSemaine(semaineCle),
    seuils: snapshot.seuils || { critique: 70, conforme: 90, baisse: 5 },
    districts: districtModels.sort((a, b) => a.nom.localeCompare(b.nom, "fr")),
    regions,
    formulaires,
    districtsNonResolus: [...unresolved],
    options: regionsOptions,
    toutesRegions,
    tousFormulaires,
    selection: {
      region: selectedRegionLabel.replace(/^DRS[_ ]/, ""),
      regionCode: selections.regionIndex === null ? null : snapshot.regions[selections.regionIndex],
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
      tendanceRepli,
      motifRepli,
      periodesTendance,
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
  let geoRegions = null;
  try {
    geo = await fetchJson("data/geo/districts.geojson");
  } catch {
    geo = null;
  }
  try {
    geoRegions = await fetchJson("data/geo/regions.geojson");
  } catch (error) {
    console.warn("Contours régionaux non disponibles", error);
  }
  const indexed = indexer({ ...snapshots, seuils: latest.seuils });
  return { latest, evolution, snapshot: indexed, geo, geoRegions };
}
