// Charge les instantanés hebdomadaires compacts et construit le modèle filtré
// utilisé par les cinq vues. Les valeurs manquantes restent dans les lignes
// afin de calculer correctement le taux de remplissage.

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-cache" }) /* revalide (304) au lieu de retélécharger */;
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
  // Index par district : évite de reparcourir toutes les lignes de la semaine pour chaque district.
  const parDistrict = snapshots.semaines.map(() => new Map());
  for (const [semaine, district, formulaire, periode, valeur] of snapshots.lignes) {
    const ligne = { district, formulaire, periode, valeur };
    valeursParSemaine[semaine].push(ligne);
    const groupe = parDistrict[semaine].get(district);
    if (groupe) groupe.push(ligne); else parDistrict[semaine].set(district, [ligne]);
  }
  return { ...snapshots, valeursParSemaine, parDistrict };
}

// Filtres à choix multiples : un seul élément -> index ; plusieurs -> ensemble (Set) ; aucun -> tout.
function regionRetenue(selections, regionIndex) {
  return (selections.regionIndex === null || regionIndex === selections.regionIndex) && (!selections.regionsSet || selections.regionsSet.has(regionIndex));
}
function formulaireRetenu(selections, formulaireIndex) {
  return (selections.formulaireIndex === null || formulaireIndex === selections.formulaireIndex) && (!selections.formulairesSet || selections.formulairesSet.has(formulaireIndex));
}
function indicesChoisis(texte, trouver, tous = "") {
  if (!texte || texte === tous) return [];
  return [...new Set(String(texte).split("|").map(trouver).filter((i) => i >= 0))];
}

function moyennePour(snapshot, semaineIndex, districtIndex, formulaireIndex, periodeIndex, selections) {
  const source = districtIndex !== null ? (snapshot.parDistrict[semaineIndex].get(districtIndex) || []) : snapshot.valeursParSemaine[semaineIndex];
  const valeurs = source.filter((ligne) => {
    if (districtIndex !== null && ligne.district !== districtIndex) return false;
    if (!regionRetenue(selections, snapshot.districts[ligne.district][0])) return false;
    if (!formulaireRetenu(selections, ligne.formulaire)) return false;
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
  const regionIds = indicesChoisis(filters.region, (v) => snapshot.regions.indexOf(v));
  const formulaireIds = indicesChoisis(filters.formulaire, (v) => snapshot.formulaires.indexOf(v));
  const periodeIds = indicesChoisis(filters.periode, (code) => snapshot.periodes.findIndex(([c]) => c === code), "*");
  const selections = {
    regionIndex: regionIds.length === 1 ? regionIds[0] : null,
    regionsSet: regionIds.length > 1 ? new Set(regionIds) : null,
    formulaireIndex: formulaireIds.length === 1 ? formulaireIds[0] : null,
    formulairesSet: formulaireIds.length > 1 ? new Set(formulaireIds) : null,
    periodeIndex: periodeIds.length === 1 ? periodeIds[0] : null,
    periodesSet: periodeIds.length > 1 ? new Set(periodeIds) : null,
  };
  // Le mois choisi peut ne pas exister dans l'extraction comparée (ex. mois en cours) :
  // l'écart est alors calculé sur les mois présents dans les deux extractions.
  let selectionsComparaison = { ...selections, regionIndex: null, regionsSet: null };
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
  } else if (comparaisonIndex >= 0 && semaineIndex >= 0 && selections.periodesSet) {
    // Plusieurs mois choisis : la comparaison porte sur ceux qui existent aussi dans l'extraction comparée.
    const idsComparaison = new Set(snapshot.valeursParSemaine[comparaisonIndex].map((ligne) => ligne.periode));
    const communs = new Set([...selections.periodesSet].filter((id) => idsComparaison.has(id)));
    if (communs.size && communs.size < selections.periodesSet.size) {
      selectionsComparaison = { ...selectionsComparaison, periodesSet: communs };
      comparaisonRepli = [...communs].map((id) => snapshot.periodes[id][1]);
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
  const parDistrictSemaine = semaineIndex < 0 ? new Map() : snapshot.parDistrict[semaineIndex];
  const districtIds = [...parDistrictSemaine.keys()];
  const tousDistricts = [];

  for (const districtId of districtIds) {
    const [districtRegionIndex, districtName, uid] = snapshot.districts[districtId];
    const lignesDistrict = parDistrictSemaine.get(districtId) || [];
    const formIds = [...new Set(lignesDistrict.map((row) => row.formulaire))];
    const formulaires = formIds
      .filter((id) => formulaireRetenu(selections, id))
      .map((id) => {
        const periodIds = [...new Set(lignesDistrict
          .filter((row) => row.formulaire === id)
          .map((row) => row.periode))].sort((a, b) => snapshot.periodes[a][0].localeCompare(snapshot.periodes[b][0]));
        const historySelections = { ...selections, regionIndex: null, regionsSet: null, periodeIndex: null, periodesSet: null };
        const historiquePeriodes = periodIds.map((idPeriode) => {
          const value = moyennePour(snapshot, semaineIndex, districtId, id, idPeriode, historySelections);
          return {
            periode_code: snapshot.periodes[idPeriode][0],
            periode: snapshot.periodes[idPeriode][1],
            valeur: value,
            statut: statutDepuisValeur(value, snapshot.seuils),
          };
        });
        const codesChoisis = selections.periodeIndex !== null ? new Set([snapshot.periodes[selections.periodeIndex]?.[0]])
          : selections.periodesSet ? new Set([...selections.periodesSet].map((i) => snapshot.periodes[i][0])) : null;
        const periodsSelected = codesChoisis === null ? historiquePeriodes : historiquePeriodes.filter((period) => codesChoisis.has(period.periode_code));
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

  const districtModels = selections.regionIndex === null && !selections.regionsSet
    ? tousDistricts
    : tousDistricts.filter((district) => regionRetenue(selections, snapshot.regions.indexOf(district.region)));
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
  if (periodeTendance === null && communesBrutes?.size) {
    // Plusieurs mois choisis : la tendance porte sur ceux de ces mois présents dans toutes les extractions.
    const restreintes = selections.periodesSet ? new Set([...communesBrutes].filter((id) => selections.periodesSet.has(id))) : null;
    periodesCommunes = restreintes?.size ? restreintes : communesBrutes;
  }
  const periodesTendance = periodesCommunes ? [...periodesCommunes].map((id) => snapshot.periodes[id][1]) : [];
  const periodeComparable = (row) => periodesCommunes === null || periodesCommunes.has(row.periode);

  const serieGenerale = [];
  const tauxRemplissage = [];
  const seriesRegion = [];
  for (let wi = 0; wi < snapshot.semaines.length; wi += 1) {
    const scoped = snapshot.valeursParSemaine[wi].filter((row) => {
      if (!regionRetenue(selections, snapshot.districts[row.district][0])) return false;
      if (!formulaireRetenu(selections, row.formulaire)) return false;
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
          if (!formulaireRetenu(selections, row.formulaire)) return false;
          if (periodeTendance !== null && row.periode !== periodeTendance) return false;
          if (!periodeComparable(row)) return false;
          return true;
        });
        return moyenne(scoped.map((row) => row.valeur));
      }),
    });
  }

  const idsPeriodes = [...new Set(snapshot.valeursParSemaine.slice(0, dernierIndexVisible + 1).flatMap((lignes) => lignes.map((ligne) => ligne.periode)))]
    .sort((a, b) => snapshot.periodes[a][0].localeCompare(snapshot.periodes[b][0]));
  const parPeriode = idsPeriodes.map((idPeriode) => ({
    periode_code: snapshot.periodes[idPeriode][0],
    periode: snapshot.periodes[idPeriode][1],
    valeurs: snapshot.semaines.slice(0, dernierIndexVisible + 1).map((_, wi) => moyenne(snapshot.valeursParSemaine[wi].filter((row) => {
      if (row.periode !== idPeriode) return false;
      if (!regionRetenue(selections, snapshot.districts[row.district][0])) return false;
      if (!formulaireRetenu(selections, row.formulaire)) return false;
      return true;
    }).map((row) => row.valeur))),
  }));

  const unresolved = new Set(districtModels.filter((district) => !district.uid).map((district) => district.nom));
  const plusieurs = (liste, nom) => liste.map(nom).join(", ");
  const selectedPeriodLabel = selections.periodeIndex !== null ? snapshot.periodes[selections.periodeIndex][1]
    : selections.periodesSet ? plusieurs([...selections.periodesSet].sort((a, b) => snapshot.periodes[a][0].localeCompare(snapshot.periodes[b][0])), (i) => snapshot.periodes[i][1]) : "Toutes les périodes";
  const selectedRegionLabel = selections.regionIndex !== null ? snapshot.regions[selections.regionIndex]
    : selections.regionsSet ? plusieurs([...selections.regionsSet], (i) => snapshot.regions[i].replace(/^DRS[_ ]/, "")) : "Toutes les régions";
  const selectedFormLabel = selections.formulaireIndex !== null ? snapshot.formulaires[selections.formulaireIndex]
    : selections.formulairesSet ? `${selections.formulairesSet.size} formulaires` : "Tous les formulaires";
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
      regionsCodes: selections.regionsSet ? [...selections.regionsSet].map((i) => snapshot.regions[i]) : selections.regionIndex === null ? [] : [snapshot.regions[selections.regionIndex]],
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
      parPeriode,
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
  const [geo, geoRegions] = await Promise.all([
    fetchJson("data/geo/districts.geojson").catch(() => null),
    fetchJson("data/geo/regions.geojson").catch((error) => { console.warn("Contours régionaux non disponibles", error); return null; }),
  ]);
  const indexed = indexer({ ...snapshots, seuils: latest.seuils });
  return { latest, evolution, snapshot: indexed, geo, geoRegions };
}
