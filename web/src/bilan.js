// Bilan global (dernière diapositive du mode TV) : situation d'ensemble, formulaires sans données et solutions
// proposées. Tout est déduit des données affichées et de l'analyse statistique ; aucune valeur n'est inventée.
// Les textes utilisent les marqueurs «T:» «E:» «P:» «D:» : chiffres à l'écran, nombres en toutes lettres à l'oral.
import { analyser } from "./sokhnaci-analyse.js";
import { D, E, P, T, labelRegion, liste, nomFormulaire, versAffichage } from "./sokhnaci-dialogue.js";

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

// Commentaire oral de Sokhna Ci pour le bilan : chaque phrase indique la zone de l'écran qu'elle commente
// (« cible »), pour que l'affichage défile jusqu'à elle et la mette en valeur.
export function texteBilan(b) {
  const phrases = [];
  phrases.push({ texte: `Pour conclure, voici la situation globale au ${D(b.semaineCle)}.`, cible: ".bilan-hero" });
  if (b.taux !== null) {
    const tendance = b.ecart === null ? "" : Math.abs(b.ecart) < 0.5 ? ", stable" : `, ${b.ecart > 0 ? "en hausse" : "en baisse"} de ${P(b.ecart)}`;
    phrases.push({ texte: `Le taux moyen est de ${T(b.taux)}${tendance}, avec ${E(b.effectifs.rouges)} districts en rouge sur ${E(b.effectifs.total)}.`, cible: ".bilan-anneau" });
  }
  if (b.sansDonnees.length) {
    const premiers = b.sansDonnees.slice(0, 2).map((l) => `« ${nomFormulaire(l.nom)} », ${E(l.manquants)} ${l.manquants > 1 ? "districts" : "district"}`);
    phrases.push({ texte: `Les formulaires les plus souvent sans données sont ${liste(premiers)}.`, cible: ".bilan-manquants" });
  } else phrases.push({ texte: "Tous les formulaires ont des données.", cible: ".bilan-manquants" });
  phrases.push({ texte: `Je propose ${b.solutions.length > 1 ? `${E(b.solutions.length)} actions` : "une action"}.`, cible: ".bilan-solutions" });
  b.solutions.slice(0, 3).forEach((s, i) => phrases.push({
    texte: `${["D’abord", "Ensuite", "Enfin"][i]}, ${s.priorite === "Immédiat" ? "immédiatement" : s.priorite.toLowerCase()} : ${s.titre.charAt(0).toLowerCase()}${s.titre.slice(1)}.`,
    cible: `.bilan-solution:nth-child(${i + 1})`,
  }));
  return phrases;
}

// ---------------------------------------------------------------- affichage (diaporama TV et vue d'ensemble)
const echapper = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (v) => (v === null || v === undefined ? "—" : `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const PRIORITES = { "Immédiat": "immediat", "Cette semaine": "semaine", "Ce mois": "mois" };

// `id` rend les identifiants uniques (le bilan peut exister à la fois dans la page et dans le diaporama) ;
// `niveau` = niveau du titre principal (1 sur une diapositive, 2 dans la page), les cartes prennent le suivant.
export function bilanHtml(model, { id = "bilan", niveau = 1, libelleDate = "" } = {}) {
  const b = construireBilan(model);
  const h = `h${niveau}`;
  const hc = `h${Math.min(6, niveau + 1)}`;
  const aff = (texte) => echapper(versAffichage(texte));
  const statut = b.taux === null ? "inconnu" : b.taux < b.seuils.critique ? "critique" : b.taux < b.seuils.conforme ? "surveiller" : "conforme";
  const libelleStatut = { critique: "Critique", surveiller: "À surveiller", conforme: "Conforme", inconnu: "Sans taux" }[statut];
  const rayon = 54;
  const circonference = 2 * Math.PI * rayon;
  const rempli = circonference * Math.max(0, Math.min(100, b.taux ?? 0)) / 100;
  const delta = b.ecart === null ? "" : `<span class="bilan-delta ${b.ecart >= 0 ? "hausse" : "baisse"}">${b.ecart >= 0 ? "▲" : "▼"} ${echapper(Math.abs(b.ecart).toLocaleString("fr-FR"))} pt</span>`;
  const total = Math.max(1, b.effectifs.total);
  const part = (n) => `${(n / total) * 100}%`;
  const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
  const manquants = b.sansDonnees.length
    ? b.sansDonnees.map((l, i) => `<li style="--i:${i}"><div class="bilan-ligne"><strong title="${echapper(l.nom)}">${echapper(nomFormulaire(l.nom))}</strong><b>${echapper(l.part.toLocaleString("fr-FR"))} %</b></div><div class="bilan-jauge" aria-hidden="true"><i style="width:${Math.min(100, l.part)}%"></i></div><small>${pluriel(l.vides, "district")} sans donnée · ${l.zeros} à zéro · ${l.attendus} attendus</small></li>`).join("")
    : `<li class="bilan-vide">Tous les formulaires ont des données pour cette sélection.</li>`;
  const solutions = b.solutions.map((s, i) => `<li class="bilan-solution" style="--i:${i}"><span class="bilan-icone" aria-hidden="true">${s.icone}</span><div><span class="bilan-pill ${PRIORITES[s.priorite] || "mois"}">${echapper(s.priorite)}</span><strong>${aff(s.titre)}</strong><p>${aff(s.detail)}</p></div></li>`).join("");
  const degrade = `bilan-degrade-${id}`;
  return `<div class="tv-bilan" data-bilan="${echapper(id)}">
    <header class="bilan-tete"><div><span class="eyebrow">BILAN DE LA SEMAINE</span><${h}>Situation globale et solutions</${h}></div><p>Extraction du ${echapper(libelleDate || b.semaineCle)} · ${echapper(b.periode || "")}</p></header>
    <div class="bilan-grille">
      <article class="bilan-carte bilan-hero" style="--i:0">
        <${hc}>Situation globale</${hc}>
        <div class="bilan-anneau ${statut}">
          <svg viewBox="0 0 140 140" role="img" aria-label="Taux moyen : ${echapper(pct(b.taux))}">
            <defs><linearGradient id="${degrade}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="arret-a"/><stop offset="1" class="arret-b"/></linearGradient></defs>
            <circle cx="70" cy="70" r="${rayon}" class="anneau-fond"/>
            <circle cx="70" cy="70" r="${rayon}" class="anneau-valeur" style="stroke:url(#${degrade})" stroke-dasharray="${rempli.toFixed(1)} ${circonference.toFixed(1)}" transform="rotate(-90 70 70)"/>
          </svg>
          <div class="bilan-anneau-texte"><strong>${echapper(pct(b.taux))}</strong><span>taux moyen</span>${delta}</div>
        </div>
        <span class="bilan-statut ${statut}">${libelleStatut}</span>
        <div class="bilan-barre" role="img" aria-label="${b.effectifs.rouges} districts critiques, ${b.effectifs.oranges} à surveiller, ${b.effectifs.verts} conformes">
          <i class="critique" style="width:${part(b.effectifs.rouges)}"></i><i class="surveiller" style="width:${part(b.effectifs.oranges)}"></i><i class="conforme" style="width:${part(b.effectifs.verts)}"></i>
        </div>
        <ul class="bilan-legende"><li><i class="critique"></i>${pluriel(b.effectifs.rouges, "critique")}</li><li><i class="surveiller"></i>${b.effectifs.oranges} à surveiller</li><li><i class="conforme"></i>${pluriel(b.effectifs.verts, "conforme")}</li></ul>
        <div class="bilan-regions">
          ${b.regionPire ? `<div><span>Plus en retard</span><strong>${echapper(labelRegion(b.regionPire.nom))}</strong><b class="critique">${echapper(pct(b.regionPire.tauxMoyen))}</b></div>` : ""}
          ${b.regionMeilleure ? `<div><span>Mieux placée</span><strong>${echapper(labelRegion(b.regionMeilleure.nom))}</strong><b class="conforme">${echapper(pct(b.regionMeilleure.tauxMoyen))}</b></div>` : ""}
        </div>
      </article>
      <article class="bilan-carte bilan-manquants" style="--i:1">
        <${hc}>Formulaires sans données</${hc}>
        <p class="bilan-sous">${b.totalManquants} cellule${b.totalManquants > 1 ? "s" : ""} district × formulaire vide${b.totalManquants > 1 ? "s" : ""} ou à zéro, sur ${b.totalCellules}.</p>
        <ol>${manquants}</ol>
      </article>
      <article class="bilan-carte bilan-solutions" style="--i:2">
        <${hc}>Solutions proposées</${hc}>
        <ol>${solutions}</ol>
      </article>
    </div>
  </div>`;
}
