// Compétences de Sokhna Ci AI : comparaison, recherche, statistiques, définitions, visualisations,
// rapports et points d'attention. Tout provient des données affichées (extractions DHIS2) :
// aucune statistique n'est inventée ni estimée.
import { analyser, ecartType, mediane, moyenne } from "./sokhnaci-analyse.js";
import { normaliserTexte } from "./sokhnaci-actions.js";
import { D, E, P, T, cadreDonnees, emotionPour, labelRegion, liste, niveau, nomFormulaire, periodeTexte, reponse, segment, toutesDistricts, variationPhrase } from "./sokhnaci-dialogue.js";

const arrondi = (x) => Math.round(x * 10) / 10;
let niveauExplication = "simple";
export function definirNiveauExplication(valeur) { niveauExplication = valeur === "expert" ? "expert" : "simple"; }
export function lireNiveauExplication() { return niveauExplication; }

export function sourcesPour(model, supplement = []) {
  return [
    `Extraction DHIS2 du ${D(model.semaineCle)}`,
    `Période affichée : ${periodeTexte(model)}`,
    `Seuils : critique < ${model.seuils.critique} %, conforme ≥ ${model.seuils.conforme} %`,
    "Calculs : moyenne simple des taux, réalisés par Sokhna Ci à partir des données affichées",
    ...supplement,
  ];
}

const contientVerbeCreation = (q) => /\b(fais|fait|genere|generer|cree|creer|trace|tracer|affiche|afficher|donne|produis|dessine|je veux|peux tu)\b/.test(q);
const MOTS_VISUELS = /\b(graphique|graphiques|diagramme|camembert|histogramme|courbe|classement|tableau|visualis\w*|barres)\b/;
export function estDemandeVisuelle(question) {
  const q = normaliserTexte(question);
  return MOTS_VISUELS.test(q) && (contientVerbeCreation(q) || /\b(un|une|des)\b/.test(q));
}

// ---------- repérage d'éléments cités (régions, districts) ----------
function elementsCites(question, model) {
  const q = ` ${normaliserTexte(question)} `;
  const candidats = [];
  for (const region of model.toutesRegions || []) {
    candidats.push({ type: "region", nom: labelRegion(region.nom), cle: normaliserTexte(labelRegion(region.nom)), objet: region });
    for (const district of region.districts) candidats.push({ type: "district", nom: district.nom, cle: normaliserTexte(district.nom), objet: district });
  }
  const trouves = [];
  for (const candidat of candidats.sort((a, b) => b.cle.length - a.cle.length)) {
    if (candidat.cle.length < 3) continue;
    const position = q.indexOf(` ${candidat.cle} `);
    if (position < 0) continue;
    const fin = position + candidat.cle.length + 1;
    if (trouves.some((t) => position < t.fin && fin > t.debut)) continue;
    trouves.push({ ...candidat, debut: position, fin });
  }
  return trouves.sort((a, b) => a.debut - b.debut);
}

// ---------- comparaison ----------
const MOIS = { janvier: "01", fevrier: "02", mars: "03", avril: "04", mai: "05", juin: "06", juillet: "07", aout: "08", septembre: "09", octobre: "10", novembre: "11", decembre: "12" };

export function comparer(question, model) {
  const q = normaliserTexte(question);
  if (!/\b(compar\w*|versus|vs|difference|ecart entre|entre .* et|face a)\b/.test(q)) return null;
  const seuils = model.seuils;
  const cadre = cadreDonnees(model);
  // comparaison de mois
  const moisCites = Object.keys(MOIS).filter((mois) => q.includes(mois));
  if (moisCites.length >= 2) {
    const series = (model.evolution?.parPeriode || []).filter((serie) => moisCites.some((mois) => normaliserTexte(serie.periode).startsWith(mois)));
    const valeurs = series.map((serie) => ({ nom: serie.periode, taux: [...serie.valeurs].reverse().find((v) => v !== null && v !== undefined) ?? null })).filter((x) => x.taux !== null);
    if (valeurs.length >= 2) {
      const [premier, second] = [...valeurs].sort((a, b) => b.taux - a.taux);
      return {
        ...reponse("encourageante", [
          segment(`${cadre}, ${premier.nom} est à ${T(arrondi(premier.taux))}, contre ${T(arrondi(second.taux))} pour ${second.nom}.`, "pointer_ecran"),
          segment("Un mois récent est encore en rattrapage : les rapports en retard continuent d’arriver.", "hochement_tete"),
        ], "Voulez-vous la courbe de ces mois ?"),
        visuel: { type: "bar", titre: "Taux moyen par mois (dernière extraction)", labels: valeurs.map((x) => x.nom), valeurs: valeurs.map((x) => arrondi(x.taux)) },
        suggestions: ["fais un graphique de l'évolution des mois"],
      };
    }
  }
  const cites = elementsCites(question, model);
  const memeType = cites.filter((c) => c.type === (cites[0]?.type));
  if (memeType.length < 2) return null;
  const lignes = memeType.slice(0, 4);
  const classes = [...lignes].filter((l) => l.objet.tauxMoyen !== null && l.objet.tauxMoyen !== undefined).sort((a, b) => b.objet.tauxMoyen - a.objet.tauxMoyen);
  if (classes.length < 2) return null;
  const [meilleur, dernier] = [classes[0], classes.at(-1)];
  const ecart = arrondi(meilleur.objet.tauxMoyen - dernier.objet.tauxMoyen);
  const phraseEcart = ecart < 1 ? `${meilleur.nom} et ${dernier.nom} sont au même niveau, autour de ${T(arrondi(meilleur.objet.tauxMoyen))}.`
    : `${meilleur.nom} devance ${dernier.nom} de ${P(ecart)} : ${T(arrondi(meilleur.objet.tauxMoyen))} contre ${T(arrondi(dernier.objet.tauxMoyen))}.`;
  const segments = [segment(`${cadre}, ${liste(classes.map((c) => c.nom))} sont comparés.`, "pointer_ecran"), segment(phraseEcart, "compter_doigts")];
  const ecarts = classes.map((c) => ({ nom: c.nom, variation: c.objet.variation })).filter((c) => c.variation !== null && c.variation !== undefined);
  if (ecarts.length >= 2) {
    const progresse = [...ecarts].sort((a, b) => b.variation - a.variation)[0];
    segments.push(segment(`Depuis l’extraction de comparaison, ${progresse.nom} progresse le plus (${progresse.variation >= 0 ? "+" : "−"}${P(progresse.variation)}).`, "hochement_tete"));
  }
  const estRegion = classes[0].type === "region";
  return {
    ...reponse(emotionPour(moyenne(classes.map((c) => c.objet.tauxMoyen)), seuils), segments, "Voulez-vous le détail d'un des éléments ?"),
    visuel: {
      type: "table",
      titre: "Comparaison",
      colonnes: [estRegion ? "Région" : "District", "Taux moyen", "Écart vs comparaison", estRegion ? "Districts en rouge" : "Statut"],
      lignes: classes.map((c) => [c.nom, `${arrondi(c.objet.tauxMoyen)} %`, c.objet.variation === null || c.objet.variation === undefined ? "—" : `${c.objet.variation > 0 ? "+" : ""}${c.objet.variation} pt`, estRegion ? `${c.objet.nbCritique}/${c.objet.districts.length}` : (c.objet.statut || "—")]),
      barres: { labels: classes.map((c) => c.nom), valeurs: classes.map((c) => arrondi(c.objet.tauxMoyen)) },
    },
    suggestions: [`détaille ${meilleur.nom}`, `détaille ${dernier.nom}`],
  };
}

// ---------- recherche ----------
export function rechercher(question, model) {
  const q = normaliserTexte(question);
  const declencheur = q.match(/^(cherche|recherche|trouve|retrouve|ou se trouve|ou est|existe t il|y a t il)\b\s*(.*)$/);
  if (!declencheur) return null;
  const mots = declencheur[2].split(" ").filter((mot) => mot.length >= 3 && !["les", "des", "dans", "pour", "une", "tout", "tous", "toutes", "district", "districts", "region", "regions", "formulaire", "formulaires"].includes(mot));
  if (!mots.length) return reponse("neutre", [segment("Que dois-je chercher ? Donnez-moi un nom de district, de région ou de formulaire.", "inclinaison_ecoute")], "Que chercher ?");
  const resultats = [];
  for (const region of model.toutesRegions || []) {
    const nomRegion = normaliserTexte(labelRegion(region.nom));
    if (mots.every((mot) => nomRegion.includes(mot))) resultats.push({ type: "Région", nom: labelRegion(region.nom), taux: region.tauxMoyen, contexte: `${region.districts.length} districts` });
    for (const district of region.districts) {
      const cible = normaliserTexte(`${district.nom} ${labelRegion(region.nom)}`);
      if (mots.every((mot) => cible.includes(mot))) resultats.push({ type: "District", nom: district.nom, taux: district.tauxMoyen, contexte: labelRegion(region.nom) });
    }
  }
  for (const formulaire of model.tousFormulaires || []) {
    if (mots.every((mot) => normaliserTexte(formulaire.nom).includes(mot))) resultats.push({ type: "Formulaire", nom: nomFormulaire(formulaire.nom), taux: formulaire.tauxMoyen, contexte: "national" });
  }
  if (!resultats.length) {
    return reponse("neutre", [segment(`Je n’ai rien trouvé pour « ${mots.join(" ")} » dans les données affichées.`, "geste_rassurant"), segment("Essayez un autre mot, ou demandez-moi la liste des régions.", "inclinaison_ecoute")], "Autre recherche ?");
  }
  const premiers = resultats.slice(0, 3).map((r) => `${r.nom} (${r.type.toLowerCase()}), à ${T(arrondi(r.taux ?? 0))}`);
  return {
    ...reponse("encourageante", [
      segment(`J’ai trouvé ${E(resultats.length)} résultat${resultats.length > 1 ? "s" : ""} pour « ${mots.join(" ")} ».`, "pointer_ecran"),
      segment(`Les premiers : ${liste(premiers)}.`, "compter_doigts"),
    ], "Quel résultat détailler ?"),
    visuel: { type: "table", titre: "Résultats de la recherche", colonnes: ["Type", "Nom", "Taux moyen", "Contexte"], lignes: resultats.slice(0, 12).map((r) => [r.type, r.nom, r.taux === null || r.taux === undefined ? "—" : `${arrondi(r.taux)} %`, r.contexte]) },
    sourcesSupplement: ["Recherche limitée aux régions, districts et formulaires de l'extraction affichée"],
  };
}

// ---------- statistiques ----------
export function statistiques(question, model) {
  const q = normaliserTexte(question);
  if (!/\b(statistiques?|dispersion|mediane|ecart type|quartiles?|distribution|repartition|stats)\b/.test(q)) return null;
  const districts = toutesDistricts(model).filter((d) => d.tauxMoyen !== null && d.tauxMoyen !== undefined);
  if (!districts.length) return null;
  const taux = districts.map((d) => d.tauxMoyen).sort((a, b) => a - b);
  const quartile = (rang) => taux[Math.min(taux.length - 1, Math.floor((taux.length - 1) * rang))];
  const moy = moyenne(taux);
  const med = mediane(taux);
  const sd = ecartType(taux);
  const rouges = districts.filter((d) => d.tauxMoyen < model.seuils.critique).length;
  const oranges = districts.filter((d) => d.tauxMoyen >= model.seuils.critique && d.tauxMoyen < model.seuils.conforme).length;
  const verts = districts.length - rouges - oranges;
  const pire = districts.reduce((a, b) => (a.tauxMoyen <= b.tauxMoyen ? a : b));
  const meilleur = districts.reduce((a, b) => (a.tauxMoyen >= b.tauxMoyen ? a : b));
  const asymetrie = Math.abs(moy - med) >= 3
    ? `La moyenne (${T(arrondi(moy))}) s’écarte de la médiane (${T(arrondi(med))}) : quelques districts très hauts ou très bas tirent le résultat.`
    : `La moyenne et la médiane sont proches, autour de ${T(arrondi(med))} : la distribution est assez équilibrée.`;
  const simple = niveauExplication === "simple" ? [segment("En clair : la médiane est la valeur du district du milieu quand on les classe du plus bas au plus haut.", "hochement_tete")] : [segment(`L’écart-type est de ${P(arrondi(sd ?? 0))} : plus il est grand, plus les districts sont inégaux.`, "hochement_tete")];
  return {
    ...reponse("encourageante", [segment(`${cadreDonnees(model)}, ${E(districts.length)} districts sont analysés.`, "pointer_ecran"), segment(asymetrie, "compter_doigts"), ...simple], "Voulez-vous la répartition en graphique ?"),
    visuel: {
      type: "table",
      titre: "Statistiques descriptives (districts)",
      colonnes: ["Indicateur", "Valeur"],
      lignes: [
        ["Districts analysés", String(districts.length)], ["Taux moyen", `${arrondi(moy)} %`], ["Médiane", `${arrondi(med)} %`], ["Écart-type", `${arrondi(sd ?? 0)} pts`],
        ["Minimum", `${arrondi(pire.tauxMoyen)} % (${pire.nom})`], ["Maximum", `${arrondi(meilleur.tauxMoyen)} % (${meilleur.nom})`],
        ["1er quartile", `${arrondi(quartile(0.25))} %`], ["3e quartile", `${arrondi(quartile(0.75))} %`],
        ["En rouge / orange / vert", `${rouges} / ${oranges} / ${verts}`],
      ],
      doughnut: { labels: ["Conforme", "À surveiller", "Critique"], valeurs: [verts, oranges, rouges] },
    },
    suggestions: ["fais un diagramme circulaire des statuts"],
  };
}

// ---------- définitions (explication pédagogique) ----------
const GLOSSAIRE = [
  { motif: /(promptitude|a temps)/, titre: "Taux de promptitude", simple: "C’est la part des rapports attendus qui sont arrivés dans les délais.", expert: "Promptitude (reporting rate on time DHIS2) = rapports reçus à temps ÷ rapports attendus, par formulaire ; le taux moyen est la moyenne simple des formulaires." },
  { motif: /(exhaustivite|cases remplies)/, titre: "Exhaustivité", simple: "C’est la part des cases réellement remplies dans les rapports envoyés.", expert: "Exhaustivité = cases numériques remplies ÷ cases des rapports reçus, dans les structures qui ont envoyé le formulaire. DHIS2 n’enregistre pas les zéros : c’est donc un minimum." },
  { motif: /(completude|taux de completude|reporting rate)/, titre: "Taux de complétude", simple: "C’est la part des rapports attendus qui ont bien été envoyés. 100 % veut dire que tout le monde a rapporté.", expert: "Taux de complétude (reporting rate DHIS2) = rapports reçus ÷ rapports attendus, par formulaire, district et période. La moyenne affichée est une moyenne simple, non pondérée." },
  { motif: /(seuil|critique|rouge)/, titre: "Seuils", simple: "Rouge : moins de 70 %, c’est prioritaire. Orange : entre 70 et 90 %, à surveiller. Vert : 90 % et plus, conforme.", expert: "Seuils configurables : critique < 70 %, à surveiller de 70 % à moins de 90 %, conforme ≥ 90 %. Ils s’appliquent aux districts, régions et formulaires." },
  { motif: /(ecart|variation)/, titre: "Écart", simple: "C’est la différence en points entre l’extraction choisie et celle de comparaison. Un écart positif veut dire que ça progresse.", expert: "Écart = taux de l’extraction choisie − taux de l’extraction de comparaison, calculé sur les mois présents dans les deux extractions." },
  { motif: /(mediane)/, titre: "Médiane", simple: "C’est la valeur du milieu quand on classe les districts du plus bas au plus haut.", expert: "Médiane : 50e percentile de la distribution des taux de districts, moins sensible aux valeurs extrêmes que la moyenne." },
  { motif: /(mois commun|mois communs|rattrapage)/, titre: "Mois communs et rattrapage", simple: "Un mois continue de monter après sa fin, car certaines structures envoient leurs rapports en retard. Pour comparer, on utilise les mois présents dans toutes les extractions.", expert: "Le taux d’un mois est révisé à la hausse à chaque extraction (rapports tardifs). Les tendances sont calculées sur les mois présents dans toutes les extractions visibles." },
  { motif: /(extraction|lundi)/, titre: "Extraction", simple: "Chaque lundi à minuit, les données sont récupérées automatiquement dans DHIS2. Chaque extraction est une photographie de ce moment.", expert: "Une extraction par semaine ISO (clé = lundi), conservée dans l’historique ; en cas de doublon la dernière de la semaine fait foi." },
  { motif: /(dhis2|dhis 2)/, titre: "DHIS2", simple: "C’est le logiciel où les structures de santé saisissent leurs rapports.", expert: "DHIS2 : système d’information sanitaire dont l’API Analytics fournit les taux de rapportage utilisés ici." },
  { motif: /(district)/, titre: "District", simple: "C’est une zone sanitaire. Chaque région médicale en regroupe plusieurs.", expert: "District sanitaire : unité d’analyse principale ; le taux d’une région est la moyenne simple de ses districts." },
];
export function definir(question) {
  const q = normaliserTexte(question);
  if (!/\b(c est quoi|qu est ce que|qu est ce qu|que veut dire|que signifie|definition|definis|defini|explique moi (le|la|les|l)|ca veut dire)\b/.test(q)) return null;
  const entree = GLOSSAIRE.find((element) => element.motif.test(q));
  if (!entree) return null;
  const texte = entree[niveauExplication];
  return {
    ...reponse("souriante", [segment(`${entree.titre}. ${texte}`, "geste_ouvert"), segment(niveauExplication === "simple" ? "Voulez-vous une explication plus technique ?" : "Voulez-vous la version simple ?", "inclinaison_ecoute")], "Autre définition ?"),
    suggestions: ["c'est quoi un seuil critique", "c'est quoi un mois commun"],
  };
}

// ---------- visualisations ----------
export function visualiser(question, model) {
  const q = normaliserTexte(question);
  if (!MOTS_VISUELS.test(q)) return null;
  const seuils = model.seuils;
  const regions = (model.toutesRegions || []).filter((r) => r.tauxMoyen !== null && r.tauxMoyen !== undefined);
  const districts = toutesDistricts(model).filter((d) => d.tauxMoyen !== null && d.tauxMoyen !== undefined);
  const cadre = cadreDonnees(model);
  if (/\b(evolution|courbe|tendance|temps)\b/.test(q) || /\b(mois|periodes?)\b/.test(q)) {
    const parMois = /\b(mois|periodes?)\b/.test(q);
    const labels = (model.evolution?.semaines || []).map((semaine) => semaine);
    if (parMois && model.evolution?.parPeriode?.length) {
      return { ...reponse("encourageante", [segment("Voici l’évolution de chaque mois, extraction après extraction : les courbes qui montent reflètent le rattrapage des rapports en retard.", "pointer_ecran")], "Voulez-vous l'évolution nationale ?"), visuel: { type: "line", titre: "Taux de chaque mois par extraction", labels, series: model.evolution.parPeriode.map((s) => ({ label: s.periode, data: s.valeurs })) } };
    }
    if (/\bregions?\b/.test(q)) {
      return { ...reponse("encourageante", [segment("Voici l’évolution de chaque région au fil des extractions.", "pointer_ecran")]), visuel: { type: "line", titre: "Évolution par région", labels, series: (model.evolution?.par_region || []).map((s) => ({ label: labelRegion(s.region), data: s.valeurs })) } };
    }
    const serie = (model.evolution?.moyenne_generale || []).filter((v) => v !== null && v !== undefined);
    const gain = serie.length >= 2 ? arrondi(serie.at(-1) - serie[0]) : null;
    return {
      ...reponse("encourageante", [segment(gain === null ? "Voici l’évolution du taux moyen." : `Voici l’évolution du taux moyen : ${gain >= 0 ? "+" : "−"}${P(gain)} depuis la première extraction.`, "pointer_ecran")], "Voulez-vous l'analyse ?"),
      visuel: { type: "line", titre: "Taux moyen national par extraction", labels, series: [{ label: "Taux moyen", data: model.evolution?.moyenne_generale || [] }] },
    };
  }
  if (/\b(camembert|circulaire|statuts?|repartition)\b/.test(q)) {
    const rouges = districts.filter((d) => d.tauxMoyen < seuils.critique).length;
    const oranges = districts.filter((d) => d.tauxMoyen >= seuils.critique && d.tauxMoyen < seuils.conforme).length;
    return { ...reponse("neutre", [segment(`${cadre}, ${E(rouges)} districts sont en rouge, ${E(oranges)} en orange et ${E(districts.length - rouges - oranges)} en vert.`, "pointer_ecran")]), visuel: { type: "doughnut", titre: "Répartition des districts par statut", labels: ["Conforme", "À surveiller", "Critique"], valeurs: [districts.length - rouges - oranges, oranges, rouges] } };
  }
  if (/\bformulaires?\b/.test(q)) {
    const formulaires = [...(model.tousFormulaires || [])].filter((f) => f.tauxMoyen !== null && f.tauxMoyen !== undefined).sort((a, b) => a.tauxMoyen - b.tauxMoyen);
    return { ...reponse("neutre", [segment(`Voici le taux moyen par formulaire : « ${nomFormulaire(formulaires[0].nom)} » est le plus en retard, à ${T(arrondi(formulaires[0].tauxMoyen))}.`, "pointer_ecran")]), visuel: { type: "bar", titre: "Taux moyen par formulaire", labels: formulaires.map((f) => nomFormulaire(f.nom).slice(0, 42)), valeurs: formulaires.map((f) => arrondi(f.tauxMoyen)), horizontal: true } };
  }
  if (/\b(districts?)\b/.test(q) || /\bclassement\b/.test(q) || /\btableau\b/.test(q)) {
    const meilleurs = /\b(meilleurs?|top|performants?)\b/.test(q);
    const tries = [...districts].sort((a, b) => (meilleurs ? b.tauxMoyen - a.tauxMoyen : a.tauxMoyen - b.tauxMoyen)).slice(0, 10);
    const visuel = /\b(tableau|classement)\b/.test(q)
      ? { type: "table", titre: meilleurs ? "Les 10 meilleurs districts" : "Les 10 districts à accompagner", colonnes: ["Rang", "District", "Région", "Taux", "Écart"], lignes: tries.map((d, i) => [String(i + 1), d.nom, labelRegion(d.region), `${arrondi(d.tauxMoyen)} %`, d.variation === null || d.variation === undefined ? "—" : `${d.variation > 0 ? "+" : ""}${d.variation} pt`]) }
      : { type: "bar", titre: meilleurs ? "Les 10 meilleurs districts" : "Les 10 districts à accompagner", labels: tries.map((d) => d.nom), valeurs: tries.map((d) => arrondi(d.tauxMoyen)), horizontal: true };
    return { ...reponse(meilleurs ? "felicitations" : "preoccupee", [segment(`${cadre}, voici ${meilleurs ? "les dix meilleurs" : "les dix districts à accompagner en priorité"} : ${tries[0].nom} est ${meilleurs ? "en tête" : "le plus en retard"}, à ${T(arrondi(tries[0].tauxMoyen))}.`, "pointer_ecran")]), visuel };
  }
  const tries = [...regions].sort((a, b) => b.tauxMoyen - a.tauxMoyen);
  return { ...reponse("neutre", [segment(`${cadre}, ${labelRegion(tries[0].nom)} est en tête à ${T(arrondi(tries[0].tauxMoyen))} et ${labelRegion(tries.at(-1).nom)} ferme la marche à ${T(arrondi(tries.at(-1).tauxMoyen))}.`, "pointer_ecran")], "Voulez-vous l'analyse territoriale ?"), visuel: { type: "bar", titre: "Taux moyen par région", labels: tries.map((r) => labelRegion(r.nom)), valeurs: tries.map((r) => arrondi(r.tauxMoyen)) } };
}

// ---------- rapports ----------
export function demandeRapport(question) {
  const q = normaliserTexte(question);
  if (!/\b(rapport|exporte|exporter|exportation|telecharge|telecharger|word|pdf|excel|xlsx)\b/.test(q)) return null;
  const format = /\bword|docx?\b/.test(q) ? "word" : /\bpdf\b/.test(q) ? "pdf" : /\b(excel|xlsx|tableur)\b/.test(q) ? "excel" : null;
  const libelle = { word: "Word", pdf: "PDF", excel: "Excel" }[format];
  return {
    ...reponse("encourageante", [segment(format ? `Je prépare le rapport au format ${libelle}. Il contient la synthèse, les priorités, l’analyse et les sources.` : "Je peux générer le rapport en Word, en PDF ou en Excel. Choisissez le format avec les boutons.", "geste_ouvert")], "Quel format ?"),
    action: { type: "rapport", format },
  };
}

// ---------- points d'attention proactifs ----------
export function pointsAttention(model) {
  const a = analyser(model);
  const points = [];
  const seuils = model.seuils;
  const regions = model.toutesRegions || [];
  if (a.regionsToutesRouges.length) {
    points.push({ gravite: "critique", titre: `${a.regionsToutesRouges.length} régions entièrement en rouge`, detail: `Tous les districts de ${liste(a.regionsToutesRouges.slice(0, 3).map((r) => labelRegion(r.nom)))} sont sous ${seuils.critique} %.`, question: "fais une analyse territoriale" });
  }
  const baisses = regions.filter((r) => r.variation !== null && r.variation !== undefined && r.variation <= -seuils.baisse).sort((x, y) => x.variation - y.variation);
  if (baisses.length) points.push({ gravite: "critique", titre: `${labelRegion(baisses[0].nom)} recule`, detail: `${baisses[0].variation} points depuis l’extraction de comparaison.`, question: `détaille ${labelRegion(baisses[0].nom)}` });
  if (a.globaux.length) points.push({ gravite: "attention", titre: `${a.globaux.length} districts en retard sur presque tous les formulaires`, detail: "Probable problème de transmission global plutôt que d’un formulaire.", question: "fais une analyse des résultats" });
  if (a.systemiques.length) points.push({ gravite: "attention", titre: "Un formulaire est bas partout", detail: `« ${nomFormulaire(a.systemiques[0].nom)} » : ${arrondi(a.systemiques[0].moyenne)} % en moyenne.`, question: "fais un graphique des formulaires" });
  if (a.atypiques.length && a.atypiques[0].ecart < 0) points.push({ gravite: "attention", titre: `${a.atypiques[0].district.nom} est atypique`, detail: `${Math.abs(a.atypiques[0].ecart)} points sous la médiane de sa région.`, question: `détaille ${a.atypiques[0].district.nom}` });
  if (a.zeros > 0) points.push({ gravite: "info", titre: `${a.zeros} valeurs à zéro`, detail: "Aucun rapport reçu, ou formulaire non applicable : à vérifier.", question: "fais une analyse des résultats" });
  if (a.rythme !== null && a.nbExtractions >= 3) points.push({ gravite: "info", titre: `Rythme : ${a.rythme > 0 ? "+" : ""}${a.rythme} pt par extraction`, detail: a.stagnantes.length ? `${liste(a.stagnantes.slice(0, 3).map((r) => labelRegion(r.nom)))} stagne${a.stagnantes.length > 1 ? "nt" : ""}.` : "Progression régulière.", question: "comment ça évolue" });
  return points.slice(0, 6);
}
