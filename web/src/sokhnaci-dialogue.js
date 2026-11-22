// Dialogue de Sokhna Ci : textes originaux, courts et oraux, construits uniquement
// à partir des données du modèle (jamais de chiffre inventé).
// Les nombres sont écrits sous forme de marqueurs « T:12.5 » (taux), « E:7 » (entier),
// « P:2.5 » (points), « D:2026-11-16 » (date) : affichage en chiffres, voix en lettres.

import { analyser } from "./sokhnaci-analyse.js";

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

export const T = (x) => (x === null || x === undefined ? "une valeur non disponible" : `«T:${x}»`);
export const E = (x) => `«E:${x}»`;
export const P = (x) => `«P:${Math.abs(x)}»`;
export const D = (iso) => `«D:${iso}»`;

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
export function segment(texte, geste = null, langue = "fr", audio = null) { return { langue, texte, geste, audio }; }
function moyenne(valeurs) {
  const utiles = valeurs.filter((v) => v !== null && v !== undefined);
  return utiles.length ? utiles.reduce((a, b) => a + b, 0) / utiles.length : null;
}
export const labelRegion = (nom) => String(nom).replace(/^DRS[_ ]/, "");
const normaliser = (texte) => String(texte ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function niveau(taux, seuils) {
  if (taux === null || taux === undefined) return "sans niveau";
  if (taux < seuils.critique) return "en rouge, donc prioritaire";
  if (taux < seuils.conforme) return "en orange, à surveiller";
  return "en vert, conforme";
}
export function emotionPour(taux, seuils) {
  if (taux === null || taux === undefined) return "neutre";
  if (taux < seuils.critique) return "preoccupee";
  if (taux >= seuils.conforme) return "felicitations";
  return "encourageante";
}
export function nomFormulaire(nom) {
  const net = String(nom).replace(/^R\d+_/, "").replace(/_/g, " ");
  if (net.length <= 70) return net;
  const coupe = net.slice(0, 70);
  return `${coupe.slice(0, coupe.lastIndexOf(" "))}…`;
}
export function liste(elements) {
  if (elements.length <= 1) return elements.join("");
  return `${elements.slice(0, -1).join(", ")} et ${elements.at(-1)}`;
}
export function toutesDistricts(model) { return (model.toutesRegions || []).flatMap((region) => region.districts); }
export function periodeTexte(model) {
  const periode = model.selection?.periode;
  return !periode || periode === "Toutes les périodes" ? "tous les mois suivis" : periode;
}
export function cadreDonnees(model) {
  return `Selon l’extraction du ${D(model.semaineCle)}, pour ${periodeTexte(model)}`;
}
function joursDepuis(iso) {
  const date = new Date(`${iso}T12:00:00`);
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

// Point de situation : un exposé structuré et professionnel, toujours dans le même ordre (cadre, indicateur
// principal, répartition, territoires, priorités, formulaire, recommandation). Chaque chiffre vient du modèle.
export function creerSituation(model) {
  const seuils = model.seuils;
  if (!model.districts?.length) {
    return { etat: "parle", emotion: "neutre", segments: [segment("Salaamalekum.", "salut_main", "wo", "salaamalekum"), segment("Aucun résultat pour ces filtres. Élargissez la sélection et je referai le point de situation.", "geste_ouvert")], suivi: null };
  }
  const avecTaux = model.districts.filter((d) => d.tauxMoyen !== null && d.tauxMoyen !== undefined);
  const taux = moyenne(avecTaux.map((d) => d.tauxMoyen));
  const comparable = moyenne(model.districts.map((d) => d.tauxComparable));
  const precedent = moyenne(model.districts.map((d) => d.tauxPrecedent));
  const ecart = comparable === null || precedent === null ? null : Math.round((comparable - precedent) * 10) / 10;
  const emotion = emotionPour(taux, seuils);
  const un = (x) => Math.round(x * 10) / 10;
  const segments = [];

  segments.push(segment("Salaamalekum.", "salut_main", "wo", "salaamalekum"));
  segments.push(segment("Je suis Sokhna Ci, votre assistante de suivi des rapports.", "main_sur_coeur"));
  segments.push(segment(`Voici le point de situation de la complétude des rapports DHIS2 au ${D(model.semaineCle)}, pour ${periodeTexte(model)}.`, "pointer_ecran"));
  if (joursDepuis(model.semaineCle) > 10) segments.push(segment("Attention : ces données datent de plus de dix jours, l’extraction hebdomadaire est à vérifier.", "geste_rassurant"));

  // 1. Indicateur principal et tendance
  let tendance = "";
  if (ecart !== null && model.comparaisonCle) {
    tendance = Math.abs(ecart) < 0.5
      ? `, stable par rapport à l’extraction du ${D(model.comparaisonCle)}`
      : `, ${ecart > 0 ? "en hausse" : "en baisse"} de ${P(ecart)} par rapport à l’extraction du ${D(model.comparaisonCle)}`;
  }
  segments.push(segment(`Le taux moyen de complétude des districts est de ${T(un(taux))}${tendance} : il est ${niveau(taux, seuils)}.`, "pointer_ecran"));

  // 2. Répartition des districts selon les seuils
  const rouges = avecTaux.filter((d) => d.tauxMoyen < seuils.critique).length;
  const verts = avecTaux.filter((d) => d.tauxMoyen >= seuils.conforme).length;
  const oranges = avecTaux.length - rouges - verts;
  segments.push(segment(`Sur ${E(avecTaux.length)} districts analysés, ${E(rouges)} ${rouges > 1 ? "sont" : "est"} sous le seuil critique de ${T(seuils.critique)}, ${E(oranges)} à surveiller et ${E(verts)} ${verts > 1 ? "sont conformes" : "est conforme"}.`, "compter_doigts"));

  // 3. Territoires : écart entre la région la plus en retard et la mieux placée
  const regions = (model.regions?.length > 1 ? model.regions : []).filter((r) => r.tauxMoyen !== null && r.tauxMoyen !== undefined).sort((a, b) => a.tauxMoyen - b.tauxMoyen);
  if (regions.length > 1) {
    const pire = regions[0];
    const meilleure = regions.at(-1);
    segments.push(segment(`La région la plus en retard est ${labelRegion(pire.nom)}, à ${T(un(pire.tauxMoyen))} ; la mieux placée est ${labelRegion(meilleure.nom)}, à ${T(un(meilleure.tauxMoyen))}.`, "geste_ouvert"));
  }

  // 4. Priorités de relance
  const critiques = avecTaux.filter((d) => d.statut === "critique").sort((a, b) => a.tauxMoyen - b.tauxMoyen).slice(0, 3);
  if (critiques.length) {
    segments.push(segment(`Priorités de relance : ${liste(critiques.map((d) => `${d.nom}, à ${T(un(d.tauxMoyen))}`))}.`, "geste_rassurant"));
  }

  // 5. Formulaire le plus en retard
  const formulaires = (model.formulaires?.length ? model.formulaires : model.tousFormulaires || []).filter((f) => f.tauxMoyen !== null && f.tauxMoyen !== undefined);
  const faible = formulaires.length > 1 ? [...formulaires].sort((a, b) => a.tauxMoyen - b.tauxMoyen)[0] : null;
  if (faible) segments.push(segment(`Le formulaire le moins renseigné est « ${nomFormulaire(faible.nom)} », à ${T(un(faible.tauxMoyen))}.`, "pointer_ecran"));

  // 6. Points positifs (sans les inventer : seulement s'ils existent)
  const meilleurs = [...avecTaux].sort((a, b) => b.tauxMoyen - a.tauxMoyen).filter((d) => d.tauxMoyen >= seuils.conforme).slice(0, 2);
  if (meilleurs.length) segments.push(segment(`À saluer : ${liste(meilleurs.map((d) => `${d.nom}, à ${T(un(d.tauxMoyen))}`))}.`, "pouce_leve"));

  // 7. Recommandation
  if (critiques.length || faible) {
    const actions = [];
    if (critiques.length) actions.push(`relancer d’abord ${critiques.length > 1 ? "les équipes de ces districts" : "l’équipe de ce district"}`);
    if (faible && faible.tauxMoyen < seuils.critique) actions.push(`vérifier la saisie de « ${nomFormulaire(faible.nom)} »`);
    if (actions.length) segments.push(segment(`Ma recommandation : ${liste(actions)}.`, "geste_ouvert"));
  }
  segments.push(segment("Je reste à votre disposition pour le détail d’une région, d’un district ou d’un formulaire.", "mains_jointes"));
  return { etat: "attente", emotion, segments, suivi: "Que voulez-vous savoir ?" };
}

function jetons(nom) {
  return normaliser(nom).split(" ").filter((mot) => mot.length >= 4 && !["rapport", "mensuel", "reporting", "rate", "centre", "poste", "sante", "global", "prevention", "charge", "maladie", "morbidite", "mortalite"].includes(mot));
}
function formulairesCites(question, model) {
  const mots = ` ${question} `;
  return (model.tousFormulaires || []).filter((f) => jetons(f.nom).some((mot) => mots.includes(` ${mot}`)));
}
function distance(a, b) {
  const lignes = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) lignes[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      lignes[i][j] = Math.min(lignes[i - 1][j] + 1, lignes[i][j - 1] + 1, lignes[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return lignes[a.length][b.length];
}
const MOTS_COURANTS = new Set(["pour", "point", "comment", "situation", "region", "regions", "district", "districts", "taux", "plus", "meilleur", "faible", "bonjour", "merci", "quel", "quelle", "quels", "quelles", "dans", "avec", "donne", "dites", "voir", "etre", "cette", "cette", "mois"]);
// Renvoie { item, approx } : correspondance exacte d'abord, sinon la plus proche (nom mal prononcé ou mal transcrit).
function entiteCitee(liste_, question, cle) {
  const exact = liste_.filter((item) => {
    const nom = normaliser(cle(item));
    return nom.length >= 3 && ` ${question} `.includes(` ${nom} `);
  }).sort((a, b) => normaliser(cle(b)).length - normaliser(cle(a)).length)[0];
  if (exact) return { item: exact, approx: false };
  const mots = question.split(" ").filter(Boolean);
  let meilleur = null;
  for (const item of liste_) {
    const nom = normaliser(cle(item));
    if (nom.length < 5) continue;
    const taille = nom.split(" ").length;
    const tolerance = Math.floor(nom.length / 4);
    for (let debut = 0; debut + taille <= mots.length; debut += 1) {
      const groupe = mots.slice(debut, debut + taille).join(" ");
      if (MOTS_COURANTS.has(groupe)) continue;
      const ecart = distance(nom, groupe);
      if (ecart <= tolerance && (!meilleur || ecart < meilleur.ecart)) meilleur = { item, approx: true, ecart };
    }
  }
  return meilleur;
}
export function reponse(emotion, segments, suivi = null) { return { etat: "parle", emotion, segments, suivi }; }
export function variationPhrase(variation, comparaison) {
  if (variation === null || variation === undefined) return null;
  if (variation >= 0.5) return `C’est ${P(variation)} de mieux que ${comparaison}.`;
  if (variation <= -0.5) return `C’est ${P(variation)} de moins que ${comparaison}.`;
  return `C’est stable par rapport à ${comparaison}.`;
}

export function interpreter(model) {
  const seuils = model.seuils;
  const a = analyser(model);
  const cadre = cadreDonnees(model);
  const segments = [];
  if (!a.critiques.length) {
    segments.push(segment(`${cadre}, aucun district n’est sous le seuil critique de ${E(seuils.critique)} pour cent : la situation est saine.`, "pouce_leve"));
  } else if (a.regionsToutesRouges.length) {
    const nb = a.regionsToutesRouges.length;
    const cites = liste(a.regionsToutesRouges.slice(0, 3).map((r) => labelRegion(r.nom)));
    segments.push(segment(nb > 3
      ? `${cadre}, le retard est d’abord territorial : dans ${E(nb)} régions, tous les districts sont en rouge, notamment ${cites}.`
      : `${cadre}, le retard est d’abord territorial : tous les districts de ${cites} sont en rouge.`, "pointer_ecran"));
  } else if (a.principales.length) {
    segments.push(segment(`${cadre}, ${E(a.critiques.length)} districts sont en rouge, dont ${T(Math.round(a.partPrincipales))} dans ${liste(a.principales.map((r) => labelRegion(r.nom)))}.`, "pointer_ecran"));
  }
  if (a.globaux.length) {
    const cites = a.globaux.sort((x, y) => x.tauxMoyen - y.tauxMoyen).slice(0, 2).map((d) => d.nom);
    segments.push(segment(`${E(a.globaux.length)} district${a.globaux.length > 1 ? "s sont" : " est"} en retard sur presque tous les formulaires, notamment ${liste(cites)} : c’est un problème de transmission global, pas d’un formulaire.`, "compter_doigts"));
  } else if (a.cibles.length) {
    segments.push(segment("Chez les districts en rouge, le retard touche surtout certains formulaires : une relance ciblée suffira.", "hochement_tete"));
  }
  const systemique = a.systemiques[0];
  const local = a.locaux[0];
  if (systemique) {
    segments.push(segment(`« ${nomFormulaire(systemique.nom)} » est bas partout, autour de ${T(Math.round(systemique.moyenne * 10) / 10)} : c’est un problème d’organisation national, pas local.`, "geste_rassurant"));
  } else if (local) {
    segments.push(segment(`« ${nomFormulaire(local.nom)} » varie fortement selon les régions, de ${T(Math.round(local.min * 10) / 10)} à ${T(Math.round(local.max * 10) / 10)} : le retard est local.`, "pointer_ecran"));
  }
  if (a.atypiques.length && a.atypiques[0].ecart < 0) {
    const cas = a.atypiques[0];
    const memeNom = normaliser(cas.district.nom) === normaliser(labelRegion(cas.region.nom));
    segments.push(segment(`${cas.district.nom} est ${P(cas.ecart)} sous la médiane de sa région${memeNom ? "" : `, ${labelRegion(cas.region.nom)}`} : une situation à vérifier en priorité.`, "geste_rassurant"));
  }
  if (a.zeros > 0) {
    segments.push(segment(`${E(a.zeros)} valeur${a.zeros > 1 ? "s" : ""} district par formulaire ${a.zeros > 1 ? "sont" : "est"} à zéro : aucun rapport reçu, ou formulaire non applicable.`, "geste_rassurant"));
  }
  if (a.rythme !== null && a.nbExtractions >= 3) {
    const phrase = a.rythme > 0.2 ? `Le taux progresse de ${P(a.rythme)} par extraction en moyenne` : a.rythme < -0.2 ? `Le taux recule de ${P(a.rythme)} par extraction en moyenne` : "Le taux est quasiment stable d’une extraction à l’autre";
    const stagne = a.stagnantes.length ? `, mais ${liste(a.stagnantes.slice(0, 3).map((r) => labelRegion(r.nom)))} ${a.stagnantes.length > 1 ? "stagnent" : "stagne"}` : "";
    segments.push(segment(`${phrase}${stagne}.`, "hochement_tete"));
  }
  segments.push(segment("Voulez-vous que je détaille un de ces points ?", "inclinaison_ecoute"));
  while (segments.length > 6) segments.splice(segments.length - 2, 1);
  return { etat: "parle", emotion: a.critiques.length > toutesDistricts(model).length / 2 ? "preoccupee" : "encourageante", segments, suivi: "Quel point détailler ?" };
}

// ---- compréhension tolérante : similarité de trigrammes avec des exemples de questions ----
const EXEMPLES = {
  analyse: ["fais une analyse des résultats", "analyse la situation", "interprète les chiffres", "pourquoi les taux sont bas", "quelle est la cause du retard", "explique moi la situation", "qu'est ce qui ne va pas", "que dois je comprendre", "donne ton avis", "que me conseilles tu", "quelles actions prioritaires", "que faut il faire", "quels sont les problèmes"],
  pire: ["quels districts sont en difficulté", "où est le problème", "les plus mauvais résultats", "qui a le plus de retard", "les zones à risque", "qui est en rouge"],
  meilleur: ["quels sont les meilleurs", "qui réussit le mieux", "les bons élèves", "qui a les meilleurs taux", "les districts conformes"],
  evolution: ["comment ça évolue", "est ce que ça progresse", "la tendance depuis le début", "ça monte ou ça descend", "par rapport à la semaine dernière"],
  periode: ["à quelle date sont les données", "quand est la dernière mise à jour", "quel mois est affiché", "les données sont elles récentes"],
  situation: ["donne moi la situation", "fais le point", "où en est on", "quel est le taux national", "résume moi tout"],
};
function trigrammes(texte) {
  const base = `  ${normaliser(texte)} `;
  const sac = new Map();
  for (let i = 0; i < base.length - 2; i += 1) sac.set(base.slice(i, i + 3), (sac.get(base.slice(i, i + 3)) || 0) + 1);
  return sac;
}
function cosinus(a, b) {
  let produit = 0;
  let na = 0;
  let nb = 0;
  for (const [cle, v] of a) { na += v * v; produit += v * (b.get(cle) || 0); }
  for (const v of b.values()) nb += v * v;
  return na && nb ? produit / Math.sqrt(na * nb) : 0;
}
const EXEMPLES_VECTEURS = Object.entries(EXEMPLES).map(([intention_, phrases]) => [intention_, phrases.map(trigrammes)]);
export function intentionProche(question) {
  const vecteur = trigrammes(question);
  const classes = EXEMPLES_VECTEURS.map(([nom, exemples]) => ({ nom, score: Math.max(...exemples.map((e) => cosinus(vecteur, e))) })).sort((x, y) => y.score - x.score);
  return classes[0].score >= 0.42 && classes[0].score - (classes[1]?.score ?? 0) >= 0.03 ? classes[0].nom : null;
}

const contexte = { type: null, nom: null, region: null };
const INTENTIONS = {
  analyse: ["analys", "interpret", "pourquoi", "cause", "explique", "comprend", "conseil", "avis", "que faire", "que faut", "quoi faire", "action", "probleme principal", "synthese", "diagnostic de"],
  pire: ["retard", "faible", "critique", "rouge", "urgent", "grave", "probleme", "mauvais", "bas ", "pire", "difficult", "difficile", "alerte", "inquiet", "inquietant", "souci", "prioritaire", "manque", "pas bon", "mal", "aider", "relancer", "relance"],
  meilleur: ["meilleur", "bien", "bon ", "vert", "conforme", "reussi", "bravo", "top", "performant", "champion", "felicit", "reussite", "avance"],
  evolution: ["evolu", "progress", "baisse", "hausse", "tendance", "compar", "avant", "depuis", "ecart", "semaine", "derniere", "change", "monte", "descend", "amelior"],
  periode: ["quand", "date", "mise a jour", "periode", "mois", "extraction", "actualis", "frais", "recent"],
  situation: ["situation", "point", "resume", "bilan", "global", "general", "national", "pays", "senegal", "ensemble", "comment", "taux", "moyenne", "chiffre", "complet", "ca va", "ou en"],
};
function intention(question) {
  let meilleur = null;
  for (const [nom, mots] of Object.entries(INTENTIONS)) {
    const score = mots.filter((mot) => ` ${question} `.includes(mot.endsWith(" ") ? mot : ` ${mot}`) || question.includes(mot.trim())).length;
    if (score > 0 && (!meilleur || score > meilleur.score)) meilleur = { nom, score };
  }
  return meilleur?.nom || null;
}
function retenir(type, nom, region = null) { contexte.type = type; contexte.nom = nom; contexte.region = region; }
function prefixeApprox(approx, nom) { return approx ? [segment(`Je pense que vous parlez de ${nom}.`, "sourire")] : []; }

function suiteContexte(model, seuils) {
  const cadre = cadreDonnees(model);
  if (contexte.type === "district") {
    const district = toutesDistricts(model).find((d) => d.nom === contexte.nom && (!contexte.region || d.region === contexte.region));
    const faibles = (district?.formulaires || []).filter((f) => f.valeur !== null && f.valeur !== undefined).sort((a, b) => a.valeur - b.valeur).slice(0, 3);
    if (faibles.length) return reponse("encourageante", [segment(`${cadre}, à ${district.nom}, les formulaires à relancer sont ${liste(faibles.map((f) => `${nomFormulaire(f.nom)}, à ${T(f.valeur)}`))}.`, "compter_doigts"), segment("Contactez d’abord la structure qui n’a pas transmis ces rapports.", "geste_rassurant")]);
  }
  if (contexte.type === "region") {
    const region = (model.toutesRegions || []).find((r) => r.nom === contexte.nom);
    const faibles = [...(region?.districts || [])].filter((d) => d.tauxMoyen !== null && d.tauxMoyen !== undefined).sort((a, b) => a.tauxMoyen - b.tauxMoyen).slice(0, 3);
    if (faibles.length) return reponse("encourageante", [segment(`${cadre}, dans la région de ${labelRegion(region.nom)}, les districts à relancer sont ${liste(faibles.map((d) => `${d.nom}, à ${T(d.tauxMoyen)}`))}.`, "compter_doigts")]);
  }
  if (contexte.type === "formulaire") {
    const formulaire = (model.tousFormulaires || []).find((f) => f.nom === contexte.nom);
    const parRegion = (model.toutesRegions || []).map((r) => ({ nom: r.nom, taux: moyenne(r.districts.flatMap((d) => d.formulaires.filter((f) => f.nom === contexte.nom).map((f) => f.valeur))) }))
      .filter((r) => r.taux !== null).sort((a, b) => a.taux - b.taux).slice(0, 3);
    if (formulaire && parRegion.length) return reponse("encourageante", [segment(`Pour « ${nomFormulaire(formulaire.nom)} », les régions les plus en retard sont ${liste(parRegion.map((r) => `${labelRegion(r.nom)}, à ${T(r.taux)}`))}.`, "compter_doigts")]);
  }
  return null;
}

export function repondre(questionBrute, model) {
  const question = normaliser(questionBrute);
  const seuils = model.seuils;
  const districts = toutesDistricts(model);
  const comparaison = model.comparaisonCle ? `l’extraction du ${D(model.comparaisonCle)}` : "l’extraction précédente";
  const cadre = cadreDonnees(model);
  if (!question) return reponse("neutre", [segment("Pardon, pouvez-vous répéter ?", "inclinaison_ecoute")]);
  if (/\b(merci|remercie)\b/.test(question)) return reponse("souriante", [segment(choisir("merci", ["Avec plaisir, c’est un plaisir de vous accompagner.", "Je vous en prie. Je reste là si vous avez d’autres questions."]), "main_sur_coeur")]);
  if (/\b(salaamalekum|salam|bonjour|bonsoir|salut|nanga def|hello|coucou)\b/.test(question)) {
    return reponse("souriante", [segment("Salaamalekum !", "salut_main", "wo", "salaamalekum"), segment("Que voulez-vous savoir sur la complétude des rapports ?", "inclinaison_ecoute")]);
  }
  if (/\b(humain|humaine|robot|vraie personne|qui es tu|tu es qui|qui etes vous|ton nom|tu t appelles)\b/.test(question)) return reponse("souriante", [segment("Je suis Sokhna Ci, une assistante virtuelle. Je lis les chiffres du tableau de bord pour vous aider à agir.", "sourire")]);
  if (/\b(politique|election|president|diagnostic medical|malade|maladie|medicament|traitement|symptome|grossesse|vaccin pour)\b/.test(question)) {
    return reponse("neutre", [segment("Je suis là pour la complétude des rapports, pas pour cela. Voulez-vous que je vous donne la situation d’une région ?", "geste_ouvert")]);
  }

  const suite = question.split(" ").length <= 4 && /^(oui|ok|d accord|vas y|detail|details|continue|ensuite|et apres|plus de details|et le detail|le detail)/.test(question);
  const districtTrouve = entiteCitee(districts, question, (d) => d.nom);
  const regionTrouvee = entiteCitee(model.toutesRegions || [], question, (r) => labelRegion(r.nom));
  const formulairesTrouves = formulairesCites(question, model);
  const district = districtTrouve?.item || null;
  const region = regionTrouvee?.item || null;
  const memeNom = district && region && normaliser(labelRegion(region.nom)) === normaliser(district.nom);

  if (suite && !district && !region && !formulairesTrouves.length) {
    const reponseSuite = suiteContexte(model, seuils);
    if (reponseSuite) return reponseSuite;
  }

  if (district && !memeNom && (!region || !districtTrouve.approx)) {
    const faibles = district.formulaires.filter((f) => f.valeur !== null && f.valeur !== undefined).sort((a, b) => a.valeur - b.valeur);
    const segments = [...prefixeApprox(districtTrouve.approx, district.nom), segment(`${cadre}, ${district.nom} affiche ${T(district.tauxMoyen)}, ${niveau(district.tauxMoyen, seuils)}.`, "pointer_ecran")];
    const variation = variationPhrase(district.variation, comparaison);
    if (variation) segments.push(segment(variation, "hochement_tete"));
    if (faibles.length) segments.push(segment(`Son formulaire le plus faible est ${nomFormulaire(faibles[0].nom)}, à ${T(faibles[0].valeur)}.`, "pointer_ecran"));
    segments.push(segment("Voulez-vous le détail par formulaire ?", "inclinaison_ecoute"));
    retenir("district", district.nom, district.region);
    return reponse(emotionPour(district.tauxMoyen, seuils), segments, "Détail par formulaire ?");
  }
  if (region) {
    const faibles = [...region.districts].filter((d) => d.tauxMoyen !== null && d.tauxMoyen !== undefined).sort((a, b) => a.tauxMoyen - b.tauxMoyen);
    const segments = [...prefixeApprox(regionTrouvee.approx, labelRegion(region.nom)), segment(`${cadre}, la région de ${labelRegion(region.nom)} est à ${T(region.tauxMoyen)}, ${niveau(region.tauxMoyen, seuils)}.`, "pointer_ecran")];
    segments.push(segment(`${E(region.nbCritique)} district${region.nbCritique > 1 ? "s" : ""} sur ${E(region.districts.length)} ${region.nbCritique > 1 ? "sont" : "est"} en rouge.`, "compter_doigts"));
    const variation = variationPhrase(region.variation, comparaison);
    if (variation) segments.push(segment(variation, "hochement_tete"));
    if (faibles.length) segments.push(segment(`À relancer d’abord : ${faibles[0].nom}, à ${T(faibles[0].tauxMoyen)}.`, "geste_rassurant"));
    retenir("region", region.nom);
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
    retenir("formulaire", formulaire.nom);
    return reponse(emotionPour(formulaire.tauxMoyen, seuils), segments, "Une région en particulier ?");
  }
  if (formulairesTrouves.length > 1) {
    const famille = [...formulairesTrouves].filter((f) => f.tauxMoyen !== null && f.tauxMoyen !== undefined).sort((a, b) => a.tauxMoyen - b.tauxMoyen);
    const moyenneFamille = moyenne(famille.map((f) => f.tauxMoyen));
    retenir("formulaire", famille[0].nom);
    return reponse(emotionPour(moyenneFamille, seuils), [
      segment(`${cadre}, ces ${E(famille.length)} formulaires sont en moyenne à ${T(moyenneFamille)}, ${niveau(moyenneFamille, seuils)}.`, "pointer_ecran"),
      segment(`Le plus en retard est ${nomFormulaire(famille[0].nom)}, à ${T(famille[0].tauxMoyen)}.`, "geste_rassurant"),
      segment("Voulez-vous celui-là en détail ?", "inclinaison_ecoute"),
    ], "Détail du formulaire le plus en retard ?");
  }

  if (/\b(aide|peux tu|que sais tu|que peux|comment ca marche)\b/.test(question)) {
    return reponse("souriante", [segment("Demandez-moi la situation d’une région, d’un district ou d’un formulaire, ou bien les meilleurs et les plus en retard. Vous pouvez aussi me donner des ordres : viens ici, suis-moi, assieds-toi, danse.", "geste_ouvert")]);
  }
  // Questions de dénombrement : « combien de districts sont en rouge / à surveiller / conformes ? »
  if (/\bcombien\b/.test(question) && /\b(district|rouge|critique|orange|surveill|vert|conforme|retard)/.test(question)) {
    const avecTaux = districts.filter((d) => d.tauxMoyen !== null && d.tauxMoyen !== undefined);
    const rouges = avecTaux.filter((d) => d.tauxMoyen < seuils.critique).length;
    const verts = avecTaux.filter((d) => d.tauxMoyen >= seuils.conforme).length;
    const oranges = avecTaux.length - rouges - verts;
    const part = (n) => (avecTaux.length ? Math.round((n / avecTaux.length) * 1000) / 10 : 0);
    return reponse(rouges ? "preoccupee" : "felicitations", [
      segment(`${cadre}, sur ${E(avecTaux.length)} districts analysés, ${E(rouges)} ${rouges > 1 ? "sont" : "est"} en rouge (sous ${T(seuils.critique)}), soit ${T(part(rouges))} des districts.`, "compter_doigts"),
      segment(`${E(oranges)} ${oranges > 1 ? "sont" : "est"} à surveiller et ${E(verts)} ${verts > 1 ? "sont conformes" : "est conforme"} (au moins ${T(seuils.conforme)}).`, "pointer_ecran"),
    ], "Voulez-vous la liste des districts en rouge ?");
  }
  const but = intention(question) || intentionProche(question);
  // « Quel formulaire est le plus en retard / le mieux rempli ? » : le classement porte sur les formulaires.
  if ((but === "pire" || but === "meilleur") && /\bformulaire|\bindicateur|\brapport/.test(question)) {
    const formulaires = (model.tousFormulaires || model.formulaires || []).filter((f) => f.tauxMoyen !== null && f.tauxMoyen !== undefined)
      .sort((a, b) => (but === "pire" ? a.tauxMoyen - b.tauxMoyen : b.tauxMoyen - a.tauxMoyen)).slice(0, 3);
    if (formulaires.length) {
      retenir("formulaire", formulaires[0].nom);
      return reponse(but === "pire" ? "preoccupee" : "felicitations", [
        segment(`${cadre}, les formulaires ${but === "pire" ? "les plus en retard" : "les mieux renseignés"} sont ${liste(formulaires.map((f) => `« ${nomFormulaire(f.nom)} », à ${T(f.tauxMoyen)}`))}.`, "compter_doigts"),
        segment(but === "pire" ? "Une vérification de la saisie de ces formulaires est recommandée."
          : formulaires[0].tauxMoyen >= seuils.conforme ? "Ces formulaires peuvent servir d’exemple aux autres."
            : `Même le mieux renseigné reste sous le seuil de conformité de ${T(seuils.conforme)}.`, but === "pire" ? "geste_rassurant" : "pointer_ecran"),
      ], "Voulez-vous le détail du premier ?");
    }
  }
  if (but === "analyse") return interpreter(model);
  if (but === "meilleur") {
    const parRegion = /\bregion/.test(question);
    const classes = (parRegion ? (model.toutesRegions || []).map((r) => ({ nom: labelRegion(r.nom), taux: r.tauxMoyen })) : districts.map((d) => ({ nom: d.nom, taux: d.tauxMoyen })))
      .filter((x) => x.taux !== null && x.taux !== undefined).sort((a, b) => b.taux - a.taux).slice(0, 3);
    return reponse("felicitations", [
      segment(`${cadre}, les ${parRegion ? "régions les mieux placées" : "meilleurs districts"} sont ${liste(classes.map((x) => `${x.nom}, à ${T(x.taux)}`))}.`, "compter_doigts"),
      segment("Bravo à ces équipes !", "pouce_leve"),
    ], "Et les plus en retard ?");
  }
  if (but === "pire") {
    const parRegion = /\bregion/.test(question);
    const classes = (parRegion ? (model.toutesRegions || []).map((r) => ({ nom: labelRegion(r.nom), taux: r.tauxMoyen })) : districts.map((d) => ({ nom: d.nom, taux: d.tauxMoyen })))
      .filter((x) => x.taux !== null && x.taux !== undefined).sort((a, b) => a.taux - b.taux).slice(0, 3);
    return reponse("preoccupee", [
      segment(`${cadre}, les ${parRegion ? "régions" : "districts"} les plus en retard sont ${liste(classes.map((x) => `${x.nom}, à ${T(x.taux)}`))}.`, "compter_doigts"),
      segment("Une relance ciblée auprès de ces équipes serait utile.", "geste_rassurant"),
    ], "Voulez-vous le détail d’un district ?");
  }
  if (but === "evolution") {
    const serie = (model.evolution?.moyenne_generale || []).filter((v) => v !== null && v !== undefined);
    const nb = model.evolution?.semaines?.length || 0;
    if (serie.length >= 2) {
      const gain = Math.round((serie.at(-1) - serie[0]) * 10) / 10;
      return reponse(gain >= 0 ? "encourageante" : "preoccupee", [
        segment(`Sur les ${E(nb)} extractions suivies, le taux des mois comparables est passé de ${T(Math.round(serie[0] * 10) / 10)} à ${T(Math.round(serie.at(-1) * 10) / 10)}.`, "pointer_ecran"),
        segment(gain > 0
          ? "Une partie de cette hausse vient des rapports saisis après la fin du mois : la complétude d’un même mois progresse d’une extraction à l’autre."
          : gain < 0 ? "La tendance est à la baisse : c’est un signal à surveiller." : "Le niveau est resté stable sur la période.", "hochement_tete"),
      ], "Voulez-vous l’évolution d’une région ?");
    }
  }
  if (but === "periode") {
    return reponse("neutre", [
      segment(`Les données datent de l’extraction du ${D(model.semaineCle)}, pour ${periodeTexte(model)}.`, "pointer_ecran"),
      segment("Une nouvelle extraction est faite chaque lundi à minuit.", "hochement_tete"),
    ]);
  }
  if (but === "situation") return creerSituation(model);
  if (suite) { const reponseSuite = suiteContexte(model, seuils); if (reponseSuite) return reponseSuite; }

  // Question trop vague : je donne le point national en une phrase, puis UNE précision.
  const national = moyenne(model.districts.map((d) => d.tauxMoyen));
  return { incomprise: true, ...reponse("neutre", [
    segment(`Je n’ai pas bien saisi, mais voici l’essentiel : le taux moyen est de ${T(national)}, ${niveau(national, seuils)}.`, "pointer_ecran"),
    segment("Parlez-vous d’une région, d’un district ou d’un formulaire ?", "inclinaison_ecoute"),
  ], "Région, district ou formulaire ?") };
}
