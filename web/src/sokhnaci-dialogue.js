// Dialogue de Sokhna Ci : textes originaux, courts et oraux, construits uniquement
// à partir des données du modèle (jamais de chiffre inventé).
// Les nombres sont écrits sous forme de marqueurs « T:12.5 » (taux), « E:7 » (entier),
// « P:2.5 » (points), « D:2026-11-16 » (date) : affichage en chiffres, voix en lettres.

const MARQUEUR = /«([TEPD]):([^»]+)»/g;
const UNITES = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
const DIZAINES = { 20: "vingt", 30: "trente", 40: "quarante", 50: "cinquante", 60: "soixante" };
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const ABREVIATIONS = [
  [/\bEPS\b/g, "établissement public de santé"], [/\bPS\b/g, "poste de santé"], [/\bCS\b/g, "centre de santé"],
  [/\bPEC\b/g, "prise en charge"], [/\bPEV\b/g, "programme élargi de vaccination"], [/\bVIH\b/g, "V I H"],
  [/\bPTME\b/g, "P T M E"], [/\bMTN\b/g, "M T N"], [/\bIST\b/g, "I S T"], [/\bDRS\b/g, "région médicale"],
];
const derniers = new Map();

function moinsDeCent(n) {
  if (n < 20) return UNITES[n];
  if (n < 70) {
    const dizaine = Math.floor(n / 10) * 10;
    const unite = n % 10;
    if (unite === 0) return DIZAINES[dizaine];
    return unite === 1 ? `${DIZAINES[dizaine]} et un` : `${DIZAINES[dizaine]}-${UNITES[unite]}`;
  }
  if (n < 80) return n === 71 ? "soixante et onze" : `soixante-${UNITES[n - 60]}`;
  return n === 80 ? "quatre-vingts" : `quatre-vingt-${UNITES[n - 80]}`;
}
export function entierEnLettres(n) {
  const valeur = Math.abs(Math.round(n));
  if (valeur < 100) return moinsDeCent(valeur);
  const centaines = Math.floor(valeur / 100);
  const reste = valeur % 100;
  const base = centaines === 1 ? "cent" : `${UNITES[centaines]} cent${reste ? "" : "s"}`;
  return reste ? `${base} ${moinsDeCent(reste)}` : base;
}
function decimalEnLettres(x) {
  const arrondi = Math.round(Math.abs(x) * 10) / 10;
  const entier = Math.floor(arrondi);
  const dixiemes = Math.round((arrondi - entier) * 10);
  return dixiemes ? `${entierEnLettres(entier)} virgule ${UNITES[dixiemes]}` : entierEnLettres(entier);
}
function formaterFr(x) { return Number(x).toLocaleString("fr-FR", { maximumFractionDigits: 1 }); }
function dateParties(iso) {
  const [annee, mois, jour] = iso.split("-").map(Number);
  return { annee, mois, jour };
}

const T = (x) => (x === null || x === undefined ? "une valeur non disponible" : `«T:${x}»`);
const E = (x) => `«E:${x}»`;
const P = (x) => `«P:${Math.abs(x)}»`;
const D = (iso) => `«D:${iso}»`;

export function versAffichage(texte) {
  return texte.replace(MARQUEUR, (_, type, valeur) => {
    if (type === "T") return `${formaterFr(valeur)} %`;
    if (type === "P") return `${formaterFr(valeur)} point${Math.abs(valeur) > 1 ? "s" : ""}`;
    if (type === "D") { const d = dateParties(valeur); return `${d.jour} ${MOIS[d.mois - 1]} ${d.annee}`; }
    return String(valeur);
  });
}
export function versOral(texte) {
  let sortie = texte.replace(MARQUEUR, (_, type, valeur) => {
    if (type === "T") return `${decimalEnLettres(Number(valeur))} pour cent`;
    if (type === "P") return `${decimalEnLettres(Number(valeur))} point${Math.abs(valeur) > 1 ? "s" : ""}`;
    if (type === "D") { const d = dateParties(valeur); return `${d.jour === 1 ? "premier" : entierEnLettres(d.jour)} ${MOIS[d.mois - 1]}`; }
    return entierEnLettres(Number(valeur));
  });
  for (const [motif, remplacement] of ABREVIATIONS) sortie = sortie.replace(motif, remplacement);
  sortie = sortie.replace(/\b20(\d{2})\b/g, (_, fin) => (Number(fin) === 0 ? "deux mille" : `deux mille ${entierEnLettres(Number(fin))}`));
  return sortie.replace(/[_]/g, " ").replace(/\s+/g, " ").trim();
}

function choisir(cle, options) {
  let index = Math.floor(Math.random() * options.length);
  if (options.length > 1 && index === derniers.get(cle)) index = (index + 1) % options.length;
  derniers.set(cle, index);
  return options[index];
}
function segment(texte, geste = null, langue = "fr") { return { langue, texte, geste }; }
function moyenne(valeurs) {
  const utiles = valeurs.filter((v) => v !== null && v !== undefined);
  return utiles.length ? utiles.reduce((a, b) => a + b, 0) / utiles.length : null;
}
const labelRegion = (nom) => String(nom).replace(/^DRS[_ ]/, "");
const normaliser = (texte) => String(texte ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function niveau(taux, seuils) {
  if (taux === null || taux === undefined) return "sans niveau";
  if (taux < seuils.critique) return "en rouge, donc prioritaire";
  if (taux < seuils.conforme) return "en orange, à surveiller";
  return "en vert, conforme";
}
function emotionPour(taux, seuils) {
  if (taux === null || taux === undefined) return "neutre";
  if (taux < seuils.critique) return "preoccupee";
  if (taux >= seuils.conforme) return "felicitations";
  return "encourageante";
}
function nomFormulaire(nom) { return String(nom).replace(/^R\d+_/, "").replace(/_/g, " "); }
function liste(elements) {
  if (elements.length <= 1) return elements.join("");
  return `${elements.slice(0, -1).join(", ")} et ${elements.at(-1)}`;
}
function toutesDistricts(model) { return (model.toutesRegions || []).flatMap((region) => region.districts); }
function periodeTexte(model) {
  const periode = model.selection?.periode;
  return !periode || periode === "Toutes les périodes" ? "tous les mois suivis" : periode;
}
function cadreDonnees(model) {
  return `Selon l’extraction du ${D(model.semaineCle)}, pour ${periodeTexte(model)}`;
}
function joursDepuis(iso) {
  const date = new Date(`${iso}T12:00:00`);
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

export function creerSituation(model) {
  const seuils = model.seuils;
  const districts = toutesDistricts(model).length ? toutesDistricts(model) : model.districts;
  if (!model.districts?.length) {
    return { etat: "parle", emotion: "neutre", segments: [segment("Salaamalekum ! Aucun résultat pour ces filtres. Élargissez la sélection, et je referai le point avec vous.", "geste_ouvert")], suivi: null };
  }
  const taux = moyenne(model.districts.map((district) => district.tauxMoyen));
  const comparable = moyenne(model.districts.map((district) => district.tauxComparable));
  const precedent = moyenne(model.districts.map((district) => district.tauxPrecedent));
  const ecart = comparable === null || precedent === null ? null : Math.round((comparable - precedent) * 10) / 10;
  const comparaison = model.comparaisonCle ? `l’extraction du ${D(model.comparaisonCle)}` : "l’extraction précédente";
  const emotion = emotionPour(taux, seuils);
  const segments = [];

  segments.push(segment(choisir("salut", ["Salaamalekum !", "Salaamalekum ! Nanga def ?", "Salaamalekum, bienvenue !"]), "salut_main", "wo"));
  segments.push(segment(choisir("presentation", [
    "Je suis Sokhna Ci, votre assistante pour suivre les rapports.",
    "Moi, c’est Sokhna Ci : je vous guide dans la complétude des rapports.",
    "Sokhna Ci, à votre service pour faire le point sur la complétude.",
  ]), "sourire"));
  if (joursDepuis(model.semaineCle) > 10) segments.push(segment("Attention, les données ne semblent pas à jour.", "geste_rassurant"));
  segments.push(segment(choisir("cadre", [
    `Voici le point au ${D(model.semaineCle)}, pour ${periodeTexte(model)}.`,
    `Les données datent du ${D(model.semaineCle)}, pour ${periodeTexte(model)}.`,
    `Mise à jour du ${D(model.semaineCle)} : ${periodeTexte(model)}.`,
  ]), "pointer_ecran"));

  const couleur = niveau(taux, seuils);
  if (ecart !== null && ecart >= seuils.baisse) {
    segments.push(segment(choisir("hausse", [
      `Le taux moyen national est de ${T(taux)}, ${couleur}, avec ${P(ecart)} de mieux que ${comparaison}.`,
      `Bonne dynamique : ${T(taux)} en moyenne, ${couleur}, soit ${P(ecart)} de plus que ${comparaison}.`,
    ]), "pointer_ecran"));
  } else if (ecart !== null && ecart <= -seuils.baisse) {
    segments.push(segment(choisir("baisse", [
      `Le taux moyen national recule à ${T(taux)}, ${couleur}, soit ${P(ecart)} de moins que ${comparaison}.`,
      `Le taux moyen tombe à ${T(taux)}, ${couleur}, avec ${P(ecart)} de perdus depuis ${comparaison}.`,
    ]), "geste_rassurant"));
  } else {
    segments.push(segment(choisir("stable", [
      `Le taux moyen national est stable, autour de ${T(taux)}, ${couleur}.`,
      `Côté national, on reste autour de ${T(taux)}, ${couleur}, sans grand mouvement.`,
    ]), "pointer_ecran"));
  }

  const critiques = [...model.districts].filter((d) => d.statut === "critique").sort((a, b) => (a.tauxMoyen ?? 101) - (b.tauxMoyen ?? 101)).slice(0, 3);
  if (critiques.length) {
    const cites = liste(critiques.map((d) => `${d.nom}, à ${T(d.tauxMoyen)}`));
    const plusieurs = critiques.length > 1;
    segments.push(segment(choisir("alerte", plusieurs ? [
      `Les ${critiques.length === 3 ? "trois" : "deux"} districts les plus en retard sont ${cites}.`,
      `Il faut relancer en priorité : ${cites}.`,
      `Côté alerte, regardez ${cites}.`,
    ] : [`Le district le plus en retard est ${cites}.`, `Une relance prioritaire pour ${cites}.`]), "compter_doigts"));
  }

  const meilleurs = [...model.districts].filter((d) => d.tauxMoyen !== null && d.tauxMoyen !== undefined).sort((a, b) => b.tauxMoyen - a.tauxMoyen).slice(0, 2);
  if (meilleurs.length && meilleurs[0].tauxMoyen >= seuils.conforme) {
    const cites = liste(meilleurs.filter((d) => d.tauxMoyen >= seuils.conforme).map((d) => `${d.nom}, ${T(d.tauxMoyen)}`));
    segments.push(segment(choisir("bravo", [
      `Bravo aux équipes de ${cites} !`,
      `Félicitations à ${cites}, un travail sérieux.`,
      `Belle performance à ${cites}, merci pour l’effort.`,
    ]), "pouce_leve"));
  } else if (meilleurs.length && meilleurs[0].tauxMoyen >= seuils.critique) {
    segments.push(segment(`Meilleur niveau pour l’instant : ${meilleurs[0].nom}, à ${T(meilleurs[0].tauxMoyen)}. À encourager !`, "sourire"));
  }

  const formulaires = (model.tousFormulaires || model.formulaires || []).filter((f) => f.tauxMoyen !== null && f.tauxMoyen !== undefined);
  if (formulaires.length > 1) {
    const faible = [...formulaires].sort((a, b) => a.tauxMoyen - b.tauxMoyen)[0];
    segments.push(segment(choisir("indicateur", [
      `L’indicateur le plus en retard est ${nomFormulaire(faible.nom)}, à ${T(faible.tauxMoyen)}.`,
      `Côté formulaires, c’est « ${nomFormulaire(faible.nom)} » qui traîne, à ${T(faible.tauxMoyen)}.`,
    ]), "pointer_ecran"));
  }

  segments.push(segment(choisir("fin", [
    "Que voulez-vous savoir ?",
    "Dites-moi : une région, un district, un formulaire ?",
    "Que voulez-vous voir en détail ?",
  ]), "inclinaison_ecoute"));
  while (segments.length > 8) segments.splice(segments.length - 2, 1);
  return { etat: "attente", emotion, segments, suivi: "Que voulez-vous savoir ?" };
}

function jetons(nom) {
  return normaliser(nom).split(" ").filter((mot) => mot.length >= 4 && !["rapport", "mensuel", "reporting", "rate", "centre", "poste", "sante", "global", "prevention", "charge", "maladie", "morbidite", "mortalite"].includes(mot));
}
function formulairesCites(question, model) {
  const mots = ` ${question} `;
  return (model.tousFormulaires || []).filter((f) => jetons(f.nom).some((mot) => mots.includes(` ${mot}`)));
}
function entiteCitee(liste_, question, cle) {
  const trouves = liste_.filter((item) => {
    const nom = normaliser(cle(item));
    return nom.length >= 3 && ` ${question} `.includes(` ${nom} `);
  });
  return trouves.sort((a, b) => normaliser(cle(b)).length - normaliser(cle(a)).length)[0] || null;
}
function reponse(emotion, segments, suivi = null) { return { etat: "parle", emotion, segments, suivi }; }
function variationPhrase(variation, comparaison) {
  if (variation === null || variation === undefined) return null;
  if (variation >= 0.5) return `C’est ${P(variation)} de mieux que ${comparaison}.`;
  if (variation <= -0.5) return `C’est ${P(variation)} de moins que ${comparaison}.`;
  return `C’est stable par rapport à ${comparaison}.`;
}

export function repondre(questionBrute, model) {
  const question = normaliser(questionBrute);
  const seuils = model.seuils;
  const districts = toutesDistricts(model);
  const comparaison = model.comparaisonCle ? `l’extraction du ${D(model.comparaisonCle)}` : "l’extraction précédente";
  if (!question) return reponse("neutre", [segment("Pardon, pouvez-vous répéter ?", "inclinaison_ecoute"), segment("Baal ma, mën nga ko waxaat ?", null, "wo")]);
  if (/\b(merci|jerejef)\b/.test(question)) return reponse("souriante", [segment(choisir("merci", ["Jërëjëf à vous ! C’est un plaisir de vous accompagner.", "Avec plaisir ! Je reste là si vous avez d’autres questions."]), "main_sur_coeur")]);
  if (/\b(humain|humaine|robot|vraie personne|qui es tu|tu es qui|qui etes vous)\b/.test(question)) return reponse("souriante", [segment("Je suis Sokhna Ci, une assistante virtuelle. Je lis les chiffres du tableau de bord pour vous aider à agir.", "sourire")]);
  if (/\b(politique|election|president|diagnostic|malade|maladie|medicament|traitement|symptome|grossesse|vaccin pour)\b/.test(question)) {
    return reponse("neutre", [segment("Je suis là pour la complétude des rapports, pas pour cela. Voulez-vous que je vous donne la situation d’une région ?", "geste_ouvert")]);
  }

  const district = entiteCitee(districts, question, (d) => d.nom);
  const region = entiteCitee(model.toutesRegions || [], question, (r) => labelRegion(r.nom));
  const formulairesTrouves = formulairesCites(question, model);
  const cadre = cadreDonnees(model);

  if (district && !(region && normaliser(labelRegion(region.nom)) === normaliser(district.nom))) {
    const faibles = district.formulaires.filter((f) => f.valeur !== null && f.valeur !== undefined).sort((a, b) => a.valeur - b.valeur);
    const segments = [segment(`${cadre}, ${district.nom} affiche ${T(district.tauxMoyen)}, ${niveau(district.tauxMoyen, seuils)}.`, "pointer_ecran")];
    const variation = variationPhrase(district.variation, comparaison);
    if (variation) segments.push(segment(variation, "hochement_tete"));
    if (faibles.length) segments.push(segment(`Son formulaire le plus faible est ${nomFormulaire(faibles[0].nom)}, à ${T(faibles[0].valeur)}.`, "pointer_ecran"));
    segments.push(segment("Voulez-vous le détail par formulaire ?", "inclinaison_ecoute"));
    return reponse(emotionPour(district.tauxMoyen, seuils), segments, "Détail par formulaire ?");
  }
  if (region) {
    const faibles = [...region.districts].filter((d) => d.tauxMoyen !== null && d.tauxMoyen !== undefined).sort((a, b) => a.tauxMoyen - b.tauxMoyen);
    const segments = [segment(`${cadre}, la région de ${labelRegion(region.nom)} est à ${T(region.tauxMoyen)}, ${niveau(region.tauxMoyen, seuils)}.`, "pointer_ecran")];
    segments.push(segment(`${E(region.nbCritique)} district${region.nbCritique > 1 ? "s" : ""} sur ${E(region.districts.length)} ${region.nbCritique > 1 ? "sont" : "est"} en rouge.`, "compter_doigts"));
    const variation = variationPhrase(region.variation, comparaison);
    if (variation) segments.push(segment(variation, "hochement_tete"));
    if (faibles.length) segments.push(segment(`À relancer d’abord : ${faibles[0].nom}, à ${T(faibles[0].tauxMoyen)}.`, "geste_rassurant"));
    return reponse(emotionPour(region.tauxMoyen, seuils), segments, "Détail par district ?");
  }
  if (formulairesTrouves.length === 1) {
    const formulaire = formulairesTrouves[0];
    const parRegion = (model.toutesRegions || []).map((r) => ({ nom: r.nom, taux: moyenne(r.districts.flatMap((d) => d.formulaires.filter((f) => f.nom === formulaire.nom).map((f) => f.valeur))) }))
      .filter((r) => r.taux !== null).sort((a, b) => a.taux - b.taux);
    const segments = [segment(`${cadre}, « ${nomFormulaire(formulaire.nom)} » est à ${T(formulaire.tauxMoyen)} au niveau national, ${niveau(formulaire.tauxMoyen, seuils)}.`, "pointer_ecran")];
    const variation = variationPhrase(formulaire.variation, comparaison);
    if (variation) segments.push(segment(variation, "hochement_tete"));
    if (parRegion.length > 1) segments.push(segment(`La région la plus en retard sur ce formulaire est ${labelRegion(parRegion[0].nom)}, à ${T(parRegion[0].taux)}.`, "geste_rassurant"));
    return reponse(emotionPour(formulaire.tauxMoyen, seuils), segments, "Une région en particulier ?");
  }
  if (formulairesTrouves.length > 1) {
    const famille = [...formulairesTrouves].filter((f) => f.tauxMoyen !== null && f.tauxMoyen !== undefined).sort((a, b) => a.tauxMoyen - b.tauxMoyen);
    const moyenneFamille = moyenne(famille.map((f) => f.tauxMoyen));
    return reponse(emotionPour(moyenneFamille, seuils), [
      segment(`${cadre}, ces ${E(famille.length)} formulaires sont en moyenne à ${T(moyenneFamille)}, ${niveau(moyenneFamille, seuils)}.`, "pointer_ecran"),
      segment(`Le plus en retard est ${nomFormulaire(famille[0].nom)}, à ${T(famille[0].tauxMoyen)}.`, "geste_rassurant"),
      segment("Voulez-vous celui-là en détail ?", "inclinaison_ecoute"),
    ], "Détail du formulaire le plus en retard ?");
  }
  if (/\b(meilleur|meilleurs|mieux|top|premier|bravo|champion)\b/.test(question)) {
    const parRegion = /\bregion/.test(question);
    const classes = (parRegion ? (model.toutesRegions || []).map((r) => ({ nom: labelRegion(r.nom), taux: r.tauxMoyen })) : districts.map((d) => ({ nom: d.nom, taux: d.tauxMoyen })))
      .filter((x) => x.taux !== null && x.taux !== undefined).sort((a, b) => b.taux - a.taux).slice(0, 3);
    return reponse("felicitations", [
      segment(`${cadre}, les meilleurs ${parRegion ? "résultats régionaux" : "districts"} sont ${liste(classes.map((x) => `${x.nom}, à ${T(x.taux)}`))}.`, "compter_doigts"),
      segment("Bravo à ces équipes !", "pouce_leve"),
    ], "Et les plus en retard ?");
  }
  if (/\b(pire|pires|faible|faibles|retard|critique|critiques|prioritaire|prioritaires|alerte|bas|difficile|probleme)\b/.test(question)) {
    const parRegion = /\bregion/.test(question);
    const classes = (parRegion ? (model.toutesRegions || []).map((r) => ({ nom: labelRegion(r.nom), taux: r.tauxMoyen })) : districts.map((d) => ({ nom: d.nom, taux: d.tauxMoyen })))
      .filter((x) => x.taux !== null && x.taux !== undefined).sort((a, b) => a.taux - b.taux).slice(0, 3);
    return reponse("preoccupee", [
      segment(`${cadre}, les plus en retard sont ${liste(classes.map((x) => `${x.nom}, à ${T(x.taux)}`))}.`, "compter_doigts"),
      segment("Une relance ciblée auprès de ces équipes serait utile.", "geste_rassurant"),
    ], "Voulez-vous le détail d’un district ?");
  }
  if (/\b(situation|point|resume|resumer|bilan|ou en est|vue d ensemble|ouverture)\b/.test(question)) return creerSituation(model);
  if (/\b(aide|aider|peux tu|que sais tu|que peux)\b/.test(question)) {
    return reponse("souriante", [segment("Demandez-moi la situation d’une région, d’un district ou d’un formulaire, ou bien les meilleurs et les plus en retard.", "geste_ouvert")]);
  }
  return reponse("neutre", [segment("Je n’ai pas bien saisi. De quelle région, quel district ou quel formulaire voulez-vous parler ?", "inclinaison_ecoute")], "Région, district ou formulaire ?");
}
