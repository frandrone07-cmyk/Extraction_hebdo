// Bilan global (dernière diapositive du mode TV) : situation d'ensemble, formulaires sans données et solutions
// proposées. Tout est déduit des données affichées et de l'analyse statistique ; aucune valeur n'est inventée.
// Les textes utilisent les marqueurs «T:» «E:» «P:» «D:» : chiffres à l'écran, nombres en toutes lettres à l'oral.
import { analyser } from "./sokhnaci-analyse.js";
import { D, E, P, T, labelRegion, liste, nomFormulaire } from "./sokhnaci-dialogue.js";

const un = (x) => Math.round(x * 10) / 10;
const moyenne = (v) => { const u = v.filter((x) => x !== null && x !== undefined); return u.length ? u.reduce((a, b) => a + b, 0) / u.length : null; };

export function construireBilan(model) {
  const seuils = model.seuils;
  const districts = model.districts || [];
  const avecTaux = districts.filter((d) => d.tauxMoyen !== null && d.tauxMoyen !== undefined);
  const taux = moyenne(avecTaux.map((d) => d.tauxMoyen));
  const comparable = moyenne(districts.map((d) => d.tauxComparable));
  const precedent = moyenne(districts.map((d) => d.tauxPrecedent));
  const ecart = comparable !== null && precedent !== null ? un(comparable - precedent) : null;
  const rouges = avecTaux.filter((d) => d.tauxMoyen < seuils.critique).length;
  const verts = avecTaux.filter((d) => d.tauxMoyen >= seuils.conforme).length;
  const oranges = avecTaux.length - rouges - verts;
  const regions = (model.toutesRegions || []).filter((r) => r.tauxMoyen !== null && r.tauxMoyen !== undefined).sort((a, b) => a.tauxMoyen - b.tauxMoyen);

  // Formulaires sans données : cellules district × formulaire vides (rapport absent) ou à zéro.
  const parFormulaire = new Map();
  for (const district of districts) {
    for (const f of district.formulaires || []) {
      const ligne = parFormulaire.get(f.nom) || { nom: f.nom, attendus: 0, vides: 0, zeros: 0, districtsVides: [] };
      ligne.attendus += 1;
      if (f.valeur === null || f.valeur === undefined) { ligne.vides += 1; ligne.districtsVides.push(district.nom); } else if (f.valeur === 0) ligne.zeros += 1;
      parFormulaire.set(f.nom, ligne);
    }
  }
  const sansDonnees = [...parFormulaire.values()]
    .map((l) => ({ ...l, manquants: l.vides + l.zeros, part: l.attendus ? un(((l.vides + l.zeros) / l.attendus) * 100) : 0 }))
    .filter((l) => l.manquants > 0)
    .sort((a, b) => b.part - a.part || b.manquants - a.manquants);
  const totalManquants = sansDonnees.reduce((n, l) => n + l.manquants, 0);
  const totalCellules = [...parFormulaire.values()].reduce((n, l) => n + l.attendus, 0);

  const a = analyser(model);
  const solutions = [];
  const ajouter = (solution) => { if (solutions.length < 5) solutions.push(solution); };
  if (a.globaux.length) {
    const cites = [...a.globaux].sort((x, y) => x.tauxMoyen - y.tauxMoyen).slice(0, 3).map((d) => d.nom);
    ajouter({ priorite: "Immédiat", icone: "☎", titre: "Relancer les districts en retard sur presque tous les formulaires",
      detail: `${E(a.globaux.length)} ${a.globaux.length > 1 ? "districts" : "district"}, dont ${liste(cites)} : appel au point focal DHIS2 et saisie de rattrapage sous 48 heures.` });
  }
  const vide = sansDonnees.find((l) => l.vides > 0);
  if (vide) {
    ajouter({ priorite: "Cette semaine", icone: "⚙", titre: "Clarifier les formulaires sans données",
      detail: `« ${nomFormulaire(vide.nom)} » : ${E(vide.vides)} ${vide.vides > 1 ? "districts sans donnée" : "district sans donnée"}. Vérifier s’il s’applique à ces structures et son affectation dans DHIS2.` });
  }
  if (a.systemiques.length) {
    const f = a.systemiques[0];
    ajouter({ priorite: "Ce mois", icone: "🎓", titre: `Plan national pour « ${nomFormulaire(f.nom)} »`,
      detail: `Bas dans toutes les régions, autour de ${T(un(f.moyenne))} : rappel de la procédure et courte formation des agents de saisie.` });
  }
  if (a.regionsToutesRouges.length) {
    const noms = a.regionsToutesRouges.slice(0, 3).map((r) => labelRegion(r.nom));
    ajouter({ priorite: "Cette semaine", icone: "🤝", titre: `Appui renforcé à ${liste(noms)}`,
      detail: `Tous leurs districts sont en rouge : réunion de coordination avec ${a.regionsToutesRouges.length > 1 ? "ces régions médicales" : "la région médicale"} et suivi chaque semaine.` });
  }
  const atypique = a.atypiques.find((x) => x.ecart < 0);
  if (atypique) {
    ajouter({ priorite: "Cette semaine", icone: "🔎", titre: `Vérifier la situation du district de ${atypique.district.nom}`,
      detail: `Ce district est ${P(atypique.ecart)} sous la médiane des districts de la région ${labelRegion(atypique.region.nom)} : contrôler la saisie, la connexion ou l’absence de personnel.` });
  }
  if (a.zeros > 0) {
    ajouter({ priorite: "Ce mois", icone: "✓", titre: "Contrôler les valeurs à zéro",
      detail: `${E(a.zeros)} ${a.zeros > 1 ? "valeurs sont" : "valeur est"} à zéro : distinguer « rapport non envoyé » et « formulaire non applicable » pour fiabiliser le taux.` });
  }
  if (a.stagnantes.length) {
    ajouter({ priorite: "Ce mois", icone: "📈", titre: "Relancer la dynamique des régions qui stagnent",
      detail: `${liste(a.stagnantes.slice(0, 3).map((r) => labelRegion(r.nom)))} : objectif de progression fixé avec chaque équipe régionale.` });
  }
  if (!solutions.length) {
    ajouter({ priorite: "Ce mois", icone: "★", titre: "Maintenir la dynamique",
      detail: "Aucun point bloquant majeur : partager les bonnes pratiques des districts conformes." });
  }

  return {
    semaineCle: model.semaineCle, comparaisonCle: model.comparaisonCle, periode: model.selection?.periode,
    taux: taux === null ? null : un(taux), ecart, seuils,
    effectifs: { total: avecTaux.length, rouges, oranges, verts },
    regionPire: regions[0] || null, regionMeilleure: regions.at(-1) || null,
    sansDonnees: sansDonnees.slice(0, 6), totalManquants, totalCellules, nbFormulaires: parFormulaire.size,
    solutions,
  };
}

// Commentaire oral de Sokhna Ci pour la diapositive de bilan.
export function texteBilan(b) {
  const phrases = [];
  phrases.push(`Pour conclure, voici la situation globale au ${D(b.semaineCle)}.`);
  if (b.taux !== null) {
    const tendance = b.ecart === null ? "" : Math.abs(b.ecart) < 0.5 ? ", stable" : `, ${b.ecart > 0 ? "en hausse" : "en baisse"} de ${P(b.ecart)}`;
    phrases.push(`Le taux moyen est de ${T(b.taux)}${tendance}, avec ${E(b.effectifs.rouges)} districts en rouge sur ${E(b.effectifs.total)}.`);
  }
  if (b.sansDonnees.length) {
    const premiers = b.sansDonnees.slice(0, 2).map((l) => `« ${nomFormulaire(l.nom)} », ${E(l.manquants)} ${l.manquants > 1 ? "districts" : "district"}`);
    phrases.push(`Les formulaires les plus souvent sans données sont ${liste(premiers)}.`);
  } else phrases.push("Tous les formulaires ont des données.");
  phrases.push(`Je propose ${b.solutions.length > 1 ? `${E(b.solutions.length)} actions` : "une action"}.`);
  b.solutions.slice(0, 3).forEach((s, i) => phrases.push(`${["D’abord", "Ensuite", "Enfin"][i]}, ${s.priorite === "Immédiat" ? "immédiatement" : s.priorite.toLowerCase()} : ${s.titre.charAt(0).toLowerCase()}${s.titre.slice(1)}.`));
  return phrases;
}
