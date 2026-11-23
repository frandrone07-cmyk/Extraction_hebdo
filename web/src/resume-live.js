// Résumé calculé des pages temps réel pour Sokhna Ci : moyennes, 3 unités les plus faibles, 2 meilleures,
// indicateur et formulaire les plus en retard, violations des règles de validation, date de mise à jour.
// Jamais de tableau brut. Rien n'est renvoyé tant qu'aucune donnée DHIS2 n'a été chargée.
import { libelleMiseAJour } from "./dhis2-client.js";
import { resumeFiltres } from "./filtres-globaux.js";

const arrondi = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);

export function resumePourSokhnaci(qualite, fars) {
  if (!qualite && !fars) return null;
  const resume = {};
  if (qualite) {
    const parUnite = new Map();
    for (const l of qualite.lignes) {
      if (l.attendus === null || l.recus === null) continue;
      const u = parUnite.get(l.unite) || { attendus: 0, recus: 0 };
      u.attendus += l.attendus;
      u.recus += l.recus;
      parUnite.set(l.unite, u);
    }
    const unites = [...parUnite].filter(([, u]) => u.attendus > 0).map(([nom, u]) => ({ nom, completude: arrondi((u.recus / u.attendus) * 100) }))
      .sort((a, b) => a.completude - b.completude);
    const total = qualite.synthese.reduce((s, f) => ({ attendus: s.attendus + (f.attendus ?? 0), recus: s.recus + (f.recus ?? 0), aTemps: s.aTemps + (f.aTemps ?? 0) }), { attendus: 0, recus: 0, aTemps: 0 });
    const formulaires = qualite.synthese.filter((f) => f.promptitude !== null).sort((a, b) => a.promptitude - b.promptitude);
    resume.qualite_des_donnees = {
      filtres: resumeFiltres(qualite.etat),
      mise_a_jour: libelleMiseAJour(qualite.misAJour),
      completude_moyenne: total.attendus ? arrondi((total.recus / total.attendus) * 100) : null,
      promptitude_moyenne: total.attendus ? arrondi((total.aTemps / total.attendus) * 100) : null,
      rapports_manquants: total.attendus ? total.attendus - total.recus : null,
      unites_les_plus_faibles: unites.slice(0, 3),
      unites_les_meilleures: unites.slice(-2).reverse(),
      formulaire_le_plus_en_retard: formulaires[0] ? { nom: formulaires[0].formulaire, promptitude: formulaires[0].promptitude } : null,
      violations_regles_de_validation: qualite.violations ?? "contrôle non lancé",
    };
  }
  if (fars) {
    const avecCible = fars.tableau.filter((t) => t.valeur !== null && t.cible);
    const retard = avecCible.sort((a, b) => a.valeur / a.cible - b.valeur / b.cible)[0];
    resume.indicateurs_fars = {
      programme: fars.programme,
      mise_a_jour: libelleMiseAJour(fars.misAJour),
      indicateur_le_plus_en_retard: retard ? { nom: retard.nom, valeur: arrondi(retard.valeur), cible: retard.cible, periode: retard.periode } : null,
      indicateurs: fars.tableau.slice(0, 8).map((t) => ({ nom: t.nom, valeur: arrondi(t.valeur), cible: t.cible, variation: t.variation.ecart })),
    };
  }
  return resume;
}
