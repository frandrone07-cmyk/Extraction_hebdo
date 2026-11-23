// Calculs de la page « Indicateurs FARS » (fonctions pures, testées). Aucune valeur n'est inventée :
// une valeur absente reste `null` et s'affiche « Donnée non disponible ».

// Éléments de données cités dans une expression d'indicateur DHIS2 : #{uidElement} ou #{uidElement.uidCombinaison}.
export function elementsDeLExpression(...expressions) {
  const uids = new Set();
  for (const e of expressions) for (const m of String(e || "").matchAll(/#\{([A-Za-z0-9]{11})(?:\.[A-Za-z0-9*]{1,11})*\}/g)) uids.add(m[1]);
  return [...uids];
}

// Catégories de désagrégation communes aux éléments de données d'un indicateur (la catégorie « default » est
// ignorée). dataElements : réponse /api/dataElements?fields=categoryCombo[categories[id,displayName,categoryOptions[id,displayName]]].
export function categoriesDisponibles(dataElements) {
  const listes = (dataElements || []).map((de) => (de.categoryCombo?.categories || []).filter((c) => c.displayName !== "default" && c.name !== "default"));
  if (!listes.length) return [];
  const communes = listes[0].filter((c) => listes.every((l) => l.some((x) => x.id === c.id)));
  return communes.map((c) => ({ id: c.id, nom: c.displayName, options: (c.categoryOptions || []).map((o) => ({ id: o.id, nom: o.displayName })) }));
}

// Statut par rapport à la cible : atteinte (≥ cible), proche (≥ 80 % de la cible), loin (< 80 %).
export function statutCible(valeur, cible) {
  if (valeur === null || valeur === undefined || !Number.isFinite(cible) || cible <= 0) return "inconnu";
  if (valeur >= cible) return "conforme";
  return valeur >= 0.8 * cible ? "surveiller" : "critique";
}

// Variation entre deux périodes : écart absolu, sens et flèche.
export function variation(courant, precedent) {
  if (courant === null || courant === undefined || precedent === null || precedent === undefined) return { ecart: null, sens: null, fleche: "" };
  const ecart = Math.round((courant - precedent) * 10) / 10;
  const sens = ecart > 0 ? "hausse" : ecart < 0 ? "baisse" : "stable";
  return { ecart, sens, fleche: { hausse: "▲", baisse: "▼", stable: "▶" }[sens] };
}

const nombreOuNull = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// lignes : réponse analytics dx × pe avec includeNumDen (colonnes dx, pe, valeur, numerator, denominator).
// Retourne, pour chaque indicateur : série par période, dernière période renseignée, numérateur, dénominateur,
// valeur de la période précédente, variation, cible et statut.
export function tableauIndicateurs(lignes, indicateurs, periodes, cibles = {}, periodePrecedente = () => null) {
  return indicateurs.map((ind) => {
    const parPeriode = new Map(lignes.filter((l) => l.dx === ind.uid).map((l) => [l.pe, l]));
    const serie = periodes.map((p) => nombreOuNull(parPeriode.get(p)?.valeur));
    const derniere = [...periodes].reverse().find((p) => parPeriode.has(p)) || null;
    const ligne = derniere ? parPeriode.get(derniere) : null;
    const valeur = nombreOuNull(ligne?.valeur);
    const precedente = derniere ? periodePrecedente(derniere) : null;
    const valeurPrecedente = precedente ? nombreOuNull(parPeriode.get(precedente)?.valeur) : null;
    const cible = nombreOuNull(cibles[ind.uid]);
    return {
      ...ind, serie, periode: derniere, valeur,
      numerateur: nombreOuNull(ligne?.numerator), denominateur: nombreOuNull(ligne?.denominator),
      periodePrecedente: precedente, valeurPrecedente, variation: variation(valeur, valeurPrecedente),
      cible, statut: statutCible(valeur, cible),
    };
  });
}

// Programmes (regroupements) des indicateurs configurés, dans l'ordre de première apparition.
export function programmes(indicateurs) {
  return [...new Set(indicateurs.map((i) => i.programme || "Sans programme"))];
}
