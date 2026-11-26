// Sokhna Ci répond sur la QUALITÉ DES DONNÉES et les INDICATEURS FARS à partir des données DHIS2 en temps réel
// (mêmes filtres globaux que les onglets). Les réponses sont composées ici, sans modèle de langage : chaque chiffre
// vient de DHIS2 ; une valeur absente est dite « non disponible », jamais inventée.
import { libellePeriode } from "./filtres-globaux.js";
import { libelleMiseAJour } from "./dhis2-client.js";

export const normaliser = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, " ").replace(/[^a-z0-9%]+/g, " ").trim();
const VIDES = new Set(["les", "des", "de", "du", "la", "le", "et", "en", "un", "une", "par", "pour", "avec", "dans", "sur", "aux", "au", "taux", "pourcentage", "proportion", "nombre", "cas", "quel", "quelle", "quels", "est", "sont", "comment", "combien", "situation", "valeur", "donne", "moi", "indicateur", "indicateurs", "fars", "mis", "place", "ayant", "qui", "que", "fait"]);
const mots = (t) => normaliser(t).split(" ").filter((m) => m.length >= 2 && !VIDES.has(m));

const QUALITE = /\b(qualite|validation|violations?|regles?|promptitude|exhaustivite|a temps|aberrant\w*|valeurs? negatives?|rapports? manquants?|cases? remplies?)\b/;
const METHODE = /\b(comment|calcul\w*|definition|signifie|c est quoi|qu est ce|methode|formule|veut dire)\b/;
const FARS = /\b(fars|indicateurs?|cibles?|performance|programmes?|srmnia|pev|mnt|mtn|sante com\w*|tuberculose|realisation|ecarts?)\b/;

// Vrai si la question porte sur la qualité des données ou les indicateurs FARS (données DHIS2 en direct).
// Les questions habituelles sur la complétude hebdomadaire (« districts en retard »…) restent aux autres compétences.
export function estQuestionTempsReel(question) {
  const q = normaliser(question);
  if (METHODE.test(q) && /\b(taux moyen|moyenne des formulaires|exhaustivite|promptitude)\b/.test(q)) return true;
  if (/\bcompletude\b/.test(q) && !/\b(fars|validation|violations?|promptitude|exhaustivite|qualite)\b/.test(q)) return false;
  return QUALITE.test(q) || FARS.test(q);
}
export const sujet = (question) => {
  const q = normaliser(question);
  if ((QUALITE.test(q) || /\b(taux moyen|moyenne des formulaires)\b/.test(q)) && !/\b(fars|indicateurs?|cibles?|performance)\b/.test(q)) return "qualite";
  return "fars";
};

const nb = (v, d = 1) => (v === null || v === undefined ? "non disponible" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d }));
const pc = (v) => (v === null || v === undefined ? "non disponible" : `${nb(v)} %`);
const periodeTexte = (periodes) => (periodes?.length ? `${libellePeriode(periodes[0])}${periodes.length > 1 ? ` à ${libellePeriode(periodes.at(-1))}` : ""}` : "la période choisie");
const seg = (texte, geste = "pointer_ecran") => ({ langue: "fr", texte, geste });
const LIBELLE = { conforme: "cible atteinte", surveiller: "proche de la cible", critique: "loin de la cible", inconnu: "sans donnée" };
const cibleTexte = (t) => (t.cible === null || t.cible === undefined ? "sans cible" : `${t.sens === "bas" ? "au plus " : ""}${nb(t.cible)}`);
const regionCourte = (nom) => String(nom || "").replace(/^DRS[_ ]/, "");

// Indicateur FARS le plus proche de la question (mots communs), ou null.
export function indicateurCite(question, tableau) {
  const q = new Set(mots(question));
  let meilleur = null;
  for (const t of tableau) {
    const m = mots(t.nom);
    const communs = m.filter((x) => q.has(x)).length;
    const score = communs / Math.max(3, m.length);
    if (communs >= 1 && (!meilleur || score > meilleur.score)) meilleur = { t, score, communs };
  }
  return meilleur && (meilleur.communs >= 2 || meilleur.score >= 0.3) ? meilleur.t : null;
}

const tableauVisuel = (titre, lignes) => ({
  type: "table", titre,
  colonnes: ["Programme", "Indicateur", "Cible", "Réalisation", "Écart", "Statut"],
  lignes: lignes.map((t) => [t.programme, t.nom, cibleTexte(t), t.valeur === null || t.valeur === undefined ? "non disponible" : nb(t.valeur), t.ecart === null || t.ecart === undefined ? "—" : `${t.ecart > 0 ? "+" : ""}${nb(t.ecart)}`, LIBELLE[t.statut] || "—"]),
});

// Réponse sur les indicateurs FARS (donnees : { tableau, periodes, misAJour }).
export function reponseFars(question, donnees) {
  const q = normaliser(question);
  const periode = periodeTexte(donnees.periodes);
  const maj = libelleMiseAJour(donnees.misAJour);
  const avecValeur = donnees.tableau.filter((t) => t.valeur !== null && t.valeur !== undefined);
  const sources = [`DHIS2 en temps réel, ${periode}`, maj].filter(Boolean);
  const ind = indicateurCite(question, donnees.tableau);
  if (ind) {
    if (ind.valeur === null || ind.valeur === undefined) {
      return { emotion: "neutre", segments: [seg(`Pour « ${ind.nom} » (${ind.programme}), la donnée n’est pas disponible dans DHIS2 sur ${periode}${ind.uid ? "" : " : cet indicateur n’est pas encore associé à DHIS2 dans l’onglet Indicateurs FARS"}.`)], sources, suggestions: ["situation des indicateurs FARS", "indicateurs FARS loin de la cible"] };
    }
    const phrases = [`« ${ind.nom} » (${ind.programme}) : réalisation ${nb(ind.valeur)} sur ${periode}${ind.trimestriel ? " (rapport trimestriel)" : ""}, pour une cible ${cibleTexte(ind)}.`];
    if (ind.ecart !== null && ind.ecart !== undefined) phrases.push(`L’écart à la cible est de ${ind.ecart > 0 ? "+" : ""}${nb(ind.ecart)} : ${LIBELLE[ind.statut]}.`);
    if (ind.numerateur !== null && ind.numerateur !== undefined && ind.denominateur) phrases.push(`Calcul DHIS2 : ${nb(ind.numerateur, 0)} sur ${nb(ind.denominateur, 0)}.`);
    if (ind.variation?.sens) phrases.push(`D’un mois sur l’autre, la valeur est en ${ind.variation.sens === "hausse" ? "hausse" : ind.variation.sens === "baisse" ? "baisse" : "stabilité"} (${ind.variation.ecart > 0 ? "+" : ""}${nb(ind.variation.ecart)}).`);
    return { emotion: ind.statut === "critique" ? "preoccupee" : ind.statut === "conforme" ? "felicitations" : "neutre", segments: phrases.map((p) => seg(p)), sources, suggestions: ["situation des indicateurs FARS", `indicateurs du programme ${ind.programme}`] };
  }
  const programmes = [...new Set(donnees.tableau.map((t) => t.programme))];
  const programme = programmes.find((p) => q.includes(normaliser(p)) || (normaliser(p) === "sante com" && /\bsante communautaire\b/.test(q)));
  const liste = programme ? donnees.tableau.filter((t) => t.programme === programme) : donnees.tableau;
  const mesures = liste.filter((t) => t.valeur !== null && t.valeur !== undefined && t.cible);
  const compte = (s) => mesures.filter((t) => t.statut === s).length;
  const ratio = (t) => (t.sens === "bas" ? t.cible / Math.max(t.valeur, 0.0001) : t.valeur / t.cible);
  const enRetard = [...mesures].filter((t) => t.statut !== "conforme").sort((a, b) => ratio(a) - ratio(b));
  const reussis = [...mesures].filter((t) => t.statut === "conforme").sort((a, b) => ratio(b) - ratio(a));
  const veutRetard = /\b(loin|retard|faibles?|mauvais|critiques?|rouges?|pas atteint\w*|non atteint\w*)\b/.test(q);
  const veutReussite = /\b(atteint\w*|meilleurs?|reussi\w*|bons?|verts?)\b/.test(q) && !veutRetard;
  const cadre = programme ? `Pour le programme ${programme}` : "Pour les indicateurs FARS suivis";
  const phrases = [`${cadre}, sur ${periode} : ${compte("conforme")} indicateur${compte("conforme") > 1 ? "s ont" : " a"} atteint la cible, ${compte("surveiller")} ${compte("surveiller") > 1 ? "sont proches" : "est proche"} et ${compte("critique")} ${compte("critique") > 1 ? "sont loin" : "est loin"} de la cible.`];
  const sansDonnee = liste.length - avecValeur.filter((t) => liste.includes(t)).length;
  if (!veutReussite && enRetard.length) phrases.push(`Les plus en retard : ${enRetard.slice(0, 3).map((t) => `« ${t.nom} » à ${nb(t.valeur)} pour une cible ${cibleTexte(t)}`).join(" ; ")}.`);
  if (!veutRetard && reussis.length) phrases.push(`Les meilleurs résultats : ${reussis.slice(0, 3).map((t) => `« ${t.nom} » à ${nb(t.valeur)} (cible ${cibleTexte(t)})`).join(" ; ")}.`);
  if (sansDonnee) phrases.push(`${sansDonnee} indicateur${sansDonnee > 1 ? "s n’ont" : " n’a"} pas de donnée DHIS2 sur cette période.`);
  const visuelLignes = veutRetard ? enRetard : veutReussite ? reussis : liste;
  return {
    emotion: compte("critique") > compte("conforme") ? "preoccupee" : "encourageante",
    segments: phrases.map((p) => seg(p)),
    visuel: tableauVisuel(`${veutRetard ? "Indicateurs à accompagner" : veutReussite ? "Indicateurs ayant atteint la cible" : "Situation des indicateurs de performance"}${programme ? ` — ${programme}` : ""} (${periode})`, visuelLignes),
    sources,
    suggestions: ["indicateurs FARS loin de la cible", "qualité des données", ...(programme ? [] : ["indicateurs du programme PEV"])],
  };
}

// Réponse sur la qualité des données (donnees : { lignes, synthese, periodes, misAJour, violations?, violationsDetail? }).
export function reponseQualite(question, donnees) {
  const q = normaliser(question);
  const periode = periodeTexte(donnees.periodes);
  const sources = [`DHIS2 en temps réel, ${periode}`, libelleMiseAJour(donnees.misAJour)].filter(Boolean);
  const k = indicateursQualite(donnees);
  const { completude, promptitude, unites } = k;
  const formulaires = k.formulaires;
  if (METHODE.test(q) && /\b(promptitude|exhaustivite|completude|taux moyen|moyenne|taux)\b/.test(q)) return explicationCalculs(q, donnees, k, periode, sources);
  if (/\b(validation|violations?|regles?)\b/.test(q)) {
    const v = donnees.violationsDetail;
    if (!v) return { emotion: "neutre", segments: [seg(`Le contrôle des règles de validation se lance automatiquement dans l’onglet « Qualité des données » (une région après l’autre, environ une minute). Ouvrez cet onglet, puis reposez-moi la question : je vous donnerai le nombre de violations par règle, par région et par district.`)], sources, suggestions: ["qualité des données", "unités en retard"] };
    const phrases = [`Sur ${periode}, le contrôle DHIS2 relève ${nb(v.total, 0)} violation${v.total > 1 ? "s" : ""} des règles de validation.`];
    if (v.parRegle[0]) phrases.push(`La règle la plus souvent violée : « ${v.parRegle[0].nom} » (${v.parRegle[0].nombre} fois).`);
    if (v.parRegion.length) phrases.push(`Régions les plus concernées : ${v.parRegion.slice(0, 3).map((r) => `${regionCourte(r.nom)} (${r.nombre})`).join(", ")}.`);
    if (v.parDistrict.length) phrases.push(`Districts les plus concernés : ${v.parDistrict.slice(0, 3).map((d) => `${d.nom} (${d.nombre})`).join(", ")}.`);
    return { emotion: v.total ? "preoccupee" : "felicitations", segments: phrases.map((p) => seg(p)), visuel: v.parRegion.length ? { type: "table", titre: `Violations des règles de validation par région (${periode})`, colonnes: ["Région", "Violations"], lignes: v.parRegion.map((r) => [regionCourte(r.nom), String(r.nombre)]) } : undefined, sources, suggestions: ["qualité des données", "indicateurs FARS loin de la cible"] };
  }
  const phrases = [`Sur ${periode}, pour les ${donnees.synthese.length} formulaires suivis (taux moyens, chaque formulaire compte pour un) : complétude ${pc(completude)}, promptitude ${pc(promptitude)}${k.exhaustivite !== null ? `, exhaustivité ${pc(k.exhaustivite)}` : ""}${k.attendus ? `, soit ${nb(k.manquants, 0)} rapports manquants sur ${nb(k.attendus, 0)} attendus` : ""}.`];
  if (/\bexhaustivite\b/.test(q)) return reponseExhaustivite(donnees, k, periode, sources);
  if (unites.length >= 2) {
    // Jamais la même unité dans les deux listes : 3 plus faibles et 2 meilleures à partir de 5 unités, sinon moins.
    const nbFaibles = Math.min(3, Math.ceil(unites.length / 2));
    const nbMeilleures = Math.min(2, unites.length - nbFaibles);
    phrases.push(`${nbFaibles > 1 ? "Les plus faibles" : "La plus faible"} : ${unites.slice(0, nbFaibles).map((u) => `${u.nom} (${pc(u.completude)})`).join(", ")}.`);
    if (nbMeilleures) phrases.push(`${nbMeilleures > 1 ? "Les meilleures" : "La meilleure"} : ${unites.slice(-nbMeilleures).reverse().map((u) => `${u.nom} (${pc(u.completude)})`).join(" et ")}.`);
  }
  if (formulaires[0]) phrases.push(`Le formulaire le plus en retard est « ${formulaires[0].formulaire} », avec ${pc(formulaires[0].promptitude)} de rapports reçus à temps.`);
  if (k.moinsExhaustif) phrases.push(`Le formulaire le moins bien rempli est « ${k.moinsExhaustif.formulaire} » : ${pc(k.moinsExhaustif.taux)} des cases renseignées.`);
  if (donnees.violations !== null && donnees.violations !== undefined) phrases.push(`Le contrôle des règles de validation relève ${nb(donnees.violations, 0)} violation${donnees.violations > 1 ? "s" : ""}.`);
  return {
    emotion: completude !== null && completude < 70 ? "preoccupee" : "encourageante",
    segments: phrases.map((p) => seg(p)),
    visuel: unites.length ? { type: "bar", titre: `Complétude par unité (${periode})`, labels: unites.map((u) => u.nom), valeurs: unites.map((u) => u.completude), horizontal: true } : undefined,
    sources,
    suggestions: ["règles de validation", "indicateurs FARS loin de la cible", "situation des indicateurs FARS"],
  };
}

// Point d'entrée : charge les données (ou réutilise celles des onglets) puis compose la réponse.
export async function repondreTempsReel(question) {
  const { donneesFars, donneesQualite } = await import("./donnees-live.js");
  try {
    if (sujet(question) === "qualite") {
      const d = await donneesQualite();
      if (!d) return { emotion: "neutre", segments: [seg("Aucune période ou aucun formulaire n’est sélectionné dans les filtres de l’onglet Qualité des données.")], sources: [], suggestions: [] };
      const { dernieresDonneesQualite } = await import("./page-qualite.js");
      const page = dernieresDonneesQualite();
      return reponseQualite(question, page && page.violationsDetail ? { ...d, violations: page.violations, violationsDetail: page.violationsDetail } : d);
    }
    const d = await donneesFars();
    if (!d) return { emotion: "neutre", segments: [seg("Aucune période n’est sélectionnée dans les filtres de l’onglet Indicateurs FARS.")], sources: [], suggestions: [] };
    return reponseFars(question, d);
  } catch (erreur) {
    return { emotion: "neutre", segments: [seg(`Je n’arrive pas à lire DHIS2 pour le moment : ${erreur?.message || "connexion impossible"}. Je ne donne aucun chiffre tant que la connexion ne fonctionne pas.`)], sources: [], suggestions: ["réessayer plus tard"] };
  }
}

// ---------------------------------------------------------------- commentaires automatiques des pages
// Quand une page finit de charger, Sokhna Ci la commente : phrases variées (jamais deux fois la même tournure
// d'affilée), gestes choisis selon le sens (pouce levé, index levé, balance pour comparer…), et une liste de
// points clés affichée dans la carte « Lecture de Sokhna Ci ». Tout vient des données reçues ; rien n'est inventé.
const dejaDit = new Map();
export function varier(cle, options, alea = Math.random) {
  let i = Math.floor(alea() * options.length);
  if (options.length > 1 && i === dejaDit.get(cle)) i = (i + 1) % options.length;
  dejaDit.set(cle, i);
  return options[i];
}
const remplir = (modele, valeurs) => modele.replace(/\{(\w+)\}/g, (_, k) => valeurs[k] ?? "");
const point = (ton, texte) => ({ ton, texte });

const moyenneSimple = (valeurs) => { const v = valeurs.filter((x) => x !== null && x !== undefined && !Number.isNaN(x)); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };
const taux = (n, d) => (d ? (n / d) * 100 : null);

// Taux moyens = moyenne simple des taux des formulaires (chaque formulaire compte pour un), comme la page et
// l'extraction hebdomadaire. Complétude = reçus ÷ attendus ; promptitude = à temps ÷ attendus.
export function indicateursQualite(donnees) {
  const total = donnees.synthese.reduce((s, f) => ({ a: s.a + (f.attendus ?? 0), r: s.r + (f.recus ?? 0), t: s.t + (f.aTemps ?? 0) }), { a: 0, r: 0, t: 0 });
  const parFormulaire = donnees.synthese.map((f) => ({ ...f, completude: taux(f.recus, f.attendus), promptitude: f.attendus ? taux(f.aTemps ?? 0, f.attendus) : null }));
  const parUnite = new Map();
  for (const l of donnees.lignes) {
    if (l.attendus === null || l.recus === null || l.attendus === undefined || !l.attendus) continue;
    const u = parUnite.get(l.unite) || { c: [], p: [] };
    u.c.push(taux(l.recus, l.attendus)); u.p.push(taux(l.aTemps ?? 0, l.attendus));
    parUnite.set(l.unite, u);
  }
  const exh = donnees.exhaustivite instanceof Map ? donnees.synthese.map((f) => ({ formulaire: f.formulaire, taux: donnees.exhaustivite.get(f.formulaireUid)?.taux ?? null })).filter((x) => x.taux !== null) : [];
  return {
    attendus: total.a,
    recus: total.r,
    aTemps: total.t,
    manquants: total.a - total.r,
    completude: moyenneSimple(parFormulaire.map((f) => f.completude)),
    promptitude: moyenneSimple(parFormulaire.map((f) => f.promptitude)),
    exhaustivite: exh.length ? moyenneSimple(exh.map((x) => x.taux)) : null,
    exhaustiviteParFormulaire: exh.sort((a, b) => a.taux - b.taux),
    moinsExhaustif: exh.length >= 2 ? exh[0] : null,
    nbFormulaires: parFormulaire.filter((f) => f.completude !== null).length,
    unites: [...parUnite].map(([nom, u]) => ({ nom: regionCourte(nom), completude: moyenneSimple(u.c), promptitude: moyenneSimple(u.p) })).sort((a, b) => a.completude - b.completude),
    formulaires: parFormulaire.filter((f) => f.promptitude !== null).map((f) => ({ ...f, promptitude: Math.round(f.promptitude * 10) / 10 })).sort((a, b) => a.promptitude - b.promptitude),
  };
}

// Exhaustivité (cases remplies ÷ cases des rapports reçus), calculée dans l'onglet Qualité des données.
function reponseExhaustivite(donnees, k, periode, sources) {
  if (k.exhaustivite === null) {
    return { emotion: "neutre", segments: [seg("L’exhaustivité se calcule automatiquement dans l’onglet « Qualité des données », formulaire par formulaire (quelques secondes chacun). Ouvrez cet onglet, attendez la fin du calcul, puis reposez-moi la question.")], sources, suggestions: ["comment est calculée l’exhaustivité ?", "qualité des données"] };
  }
  const l = k.exhaustiviteParFormulaire;
  const phrases = [`L’exhaustivité moyenne des ${l.length} formulaires est de ${pc(k.exhaustivite)} : c’est la part des cases numériques remplies dans les rapports reçus.`];
  if (l.length >= 2) {
    phrases.push(`Le moins bien rempli : « ${l[0].formulaire} » (${pc(l[0].taux)}), alors que le mieux rempli est « ${l.at(-1).formulaire} » (${pc(l.at(-1).taux)}).`);
  }
  phrases.push("Attention : DHIS2 n’enregistre pas les zéros, donc une case laissée vide parce que la valeur vaut 0 compte comme non remplie ; ce taux est un minimum.");
  return {
    emotion: k.exhaustivite < 70 ? "preoccupee" : "encourageante",
    segments: phrases.map((p) => seg(p)),
    visuel: { type: "bar", titre: `Exhaustivité par formulaire (${periodeTexte(donnees.exhaustivitePeriodes || donnees.periodes)})`, labels: l.map((x) => x.formulaire), valeurs: l.map((x) => x.taux), horizontal: true },
    sources,
    suggestions: ["comment est calculée l’exhaustivité ?", "qualité des données", "règles de validation"],
  };
}

// Explication des calculs, illustrée avec les vrais chiffres de la sélection.
function explicationCalculs(q, donnees, k, periode, sources) {
  const phrases = [];
  const tous = !/\b(promptitude|exhaustivite|completude)\b/.test(q);
  if (tous || /\bcompletude\b/.test(q)) phrases.push(`La complétude d’un formulaire, c’est le nombre de rapports reçus divisé par le nombre de rapports attendus. Sur ${periode}, tous formulaires confondus : ${nb(k.recus, 0)} reçus pour ${nb(k.attendus, 0)} attendus.`);
  if (tous || /\bpromptitude\b/.test(q)) phrases.push(`La promptitude, c’est le nombre de rapports reçus à temps divisé par le nombre de rapports attendus, comme le « Reporting rate on time » de DHIS2 : ici ${nb(k.aTemps, 0)} à temps pour ${nb(k.attendus, 0)} attendus.`);
  if (tous || /\bexhaustivite\b/.test(q)) phrases.push(`L’exhaustivité, c’est le nombre de cases numériques remplies divisé par le nombre de cases des rapports reçus, en ne comptant que les structures qui ont envoyé le formulaire${k.exhaustivite !== null ? ` : ${pc(k.exhaustivite)} en moyenne` : ""}. DHIS2 n’enregistrant pas les zéros, c’est un minimum.`);
  phrases.push(`Les taux moyens affichés sont des moyennes simples des ${k.nbFormulaires} formulaires : chaque formulaire compte pour un, comme le taux moyen de l’extraction du lundi. Résultat : complétude ${pc(k.completude)}, promptitude ${pc(k.promptitude)}${k.exhaustivite !== null ? `, exhaustivité ${pc(k.exhaustivite)}` : ""}.`);
  return { emotion: "souriante", segments: phrases.map((p) => seg(p, "geste_ouvert")), sources, suggestions: ["analyse la qualité des données", "exhaustivité par formulaire", "règles de validation"] };
}

export function commentaireQualite(donnees, alea = Math.random) {
  const k = indicateursQualite(donnees);
  const p = periodeTexte(donnees.periodes);
  const segments = [];
  const points = [];
  segments.push(seg(remplir(varier("q-ouv", [
    "Voici ma lecture de la qualité des données sur {p}.",
    "Faisons le point sur la qualité des données, {p}.",
    "J’ai passé en revue les rapports DHIS2 de {p}.",
    "Petit tour d’horizon de la qualité des rapports pour {p}.",
  ], alea), { p }), "geste_ouvert"));
  if (k.completude === null) {
    segments.push(seg("Aucun rapport n’est attendu sur cette sélection : la complétude n’est pas disponible.", "geste_rassurant"));
    points.push(point("info", "Complétude non disponible : aucun rapport attendu sur la sélection."));
    return { emotion: "neutre", segments, points };
  }
  const v = { c: pc(k.completude), t: pc(k.promptitude), m: nb(k.manquants, 0), a: nb(k.attendus, 0) };
  const niveauC = k.completude >= 90 ? "bien" : k.completude >= 70 ? "moyen" : "faible";
  segments.push(seg(remplir(varier(`q-c-${niveauC}`, {
    bien: ["Bonne nouvelle : la complétude atteint {c}, au-dessus de l’objectif de 90 %.", "La complétude est solide, à {c} : bravo aux équipes.", "Avec {c} de complétude, l’objectif de 90 % est atteint."],
    moyen: ["La complétude est de {c} : correcte, mais encore sous l’objectif de 90 %.", "On est à {c} de complétude ; il reste un effort à faire pour passer la barre des 90 %.", "Complétude à {c} : la dynamique est là, il faut la consolider."],
    faible: ["Attention : la complétude n’est que de {c}, sous le seuil critique de 70 %.", "La complétude reste faible, à {c} : c’est la priorité du moment.", "Point d’alerte : {c} de complétude seulement, avec {m} rapports manquants."],
  }[niveauC], alea), v)));
  points.push(point(niveauC === "bien" ? "bien" : niveauC === "faible" ? "alerte" : "info", `Complétude ${v.c} : ${v.m} rapports manquants sur ${v.a} attendus.`));
  if (k.promptitude !== null) {
    const ecart = Math.round((k.completude - k.promptitude) * 10) / 10;
    segments.push(seg(remplir(ecart >= 10
      ? varier("q-p-ecart", ["En revanche, seulement {t} des rapports arrivent à temps : beaucoup sont saisis en retard.", "La promptitude, à {t}, est nettement en dessous de la complétude : les rapports arrivent, mais tard."], alea)
      : varier("q-p", ["Côté promptitude, {t} des rapports sont arrivés dans les délais.", "La promptitude suit, à {t}."], alea), v)));
    points.push(point(k.promptitude >= 90 ? "bien" : k.promptitude < 70 ? "alerte" : "info", `Promptitude ${v.t}${ecart >= 10 ? ` (${nb(ecart)} points sous la complétude : saisies tardives)` : ""}.`));
  }
  if (k.unites.length >= 2) {
    const faibles = k.unites.slice(0, Math.min(2, k.unites.length - 1));
    const meilleure = k.unites.at(-1);
    segments.push(seg(remplir(varier("q-faibles", [
      "Je vous conseille d’accompagner en priorité {f}.",
      "Les unités à relancer d’abord : {f}.",
      "Surtout, gardons un œil sur {f}.",
    ], alea), { f: faibles.map((u) => `${u.nom} (${pc(u.completude)})`).join(" et ") }), "doigt_leve"));
    segments.push(seg(remplir(varier("q-meilleure", ["À saluer : {n}, en tête avec {c}.", "Mention spéciale pour {n}, à {c}.", "{n} montre l’exemple, avec {c}."], alea), { n: meilleure.nom, c: pc(meilleure.completude) }), "pouce_leve"));
    points.push(point("alerte", `Plus faibles : ${faibles.map((u) => `${u.nom} (${pc(u.completude)})`).join(", ")}.`));
    points.push(point("bien", `Meilleure : ${meilleure.nom} (${pc(meilleure.completude)}).`));
  }
  if (k.exhaustivite !== null) {
    segments.push(seg(`L’exhaustivité moyenne, c’est-à-dire la part des cases remplies, est de ${pc(k.exhaustivite)}${k.moinsExhaustif ? ` ; « ${k.moinsExhaustif.formulaire} » est le moins bien rempli` : ""}.`, k.exhaustivite < 70 ? "geste_rassurant" : "pointer_ecran"));
    points.push(point(k.exhaustivite >= 90 ? "bien" : k.exhaustivite < 70 ? "alerte" : "info", `Exhaustivité ${pc(k.exhaustivite)}.`));
  }
  if (k.formulaires.length >= 2) {
    const f = k.formulaires[0];
    segments.push(seg(`Le formulaire le plus en retard est « ${f.formulaire} », avec ${pc(f.promptitude)} de rapports à temps.`));
    points.push(point(f.promptitude < 70 ? "alerte" : "info", `Formulaire le plus en retard : ${f.formulaire} (${pc(f.promptitude)} à temps).`));
  }
  const vd = donnees.violationsDetail;
  if (vd) {
    segments.push(seg(vd.total
      ? `Le contrôle des règles de validation relève ${nb(vd.total, 0)} violation${vd.total > 1 ? "s" : ""}${vd.parRegle[0] ? `, surtout « ${vd.parRegle[0].nom} »` : ""}.`
      : "Aucune règle de validation n’est violée : c’est remarquable.", vd.total ? "geste_rassurant" : "pouce_leve"));
    points.push(point(vd.total ? "alerte" : "bien", vd.total ? `${nb(vd.total, 0)} violation${vd.total > 1 ? "s" : ""} des règles de validation${vd.parRegion[0] ? ` (surtout ${regionCourte(vd.parRegion[0].nom)})` : ""}.` : "Aucune violation des règles de validation."));
  }
  segments.push(seg(varier("q-fin", [
    "Posez-moi une question sur un district ou un formulaire pour aller plus loin.",
    "Je reste à votre disposition pour le détail d’une région.",
    "Vous pouvez cliquer sur « Ouvrir dans DHIS2 » pour corriger directement.",
  ], alea), "mains_jointes"));
  return { emotion: niveauC === "faible" ? "preoccupee" : niveauC === "bien" ? "felicitations" : "encourageante", segments, points };
}

const ratioCible = (t) => (t.sens === "bas" ? t.cible / Math.max(t.valeur, 0.0001) : t.valeur / t.cible);
const valeurSuspecte = (t) => /\b(taux|pourcentage|proportion|couverture)\b/i.test(t.nom) && t.valeur > 105;
const progresse = (t) => t.variation?.sens && t.variation.sens !== "stable" && ((t.sens !== "bas" && t.variation.sens === "hausse") || (t.sens === "bas" && t.variation.sens === "baisse"));

export function commentaireFars(donnees, alea = Math.random) {
  const p = periodeTexte(donnees.periodes);
  const mesures = donnees.tableau.filter((t) => t.valeur !== null && t.valeur !== undefined && t.cible);
  const compte = (s) => mesures.filter((t) => t.statut === s).length;
  const segments = [seg(remplir(varier("f-ouv", [
    "Voici où en sont les indicateurs FARS sur {p}.",
    "Regardons ensemble la performance des programmes, {p}.",
    "J’ai comparé chaque indicateur à sa cible, sur {p}.",
    "Faisons le bilan des indicateurs de performance pour {p}.",
  ], alea), { p }), "geste_ouvert")];
  const points = [];
  if (!mesures.length) {
    segments.push(seg("Aucun indicateur suivi n’a encore de valeur DHIS2 sur cette période.", "geste_rassurant"));
    points.push(point("info", "Aucune valeur DHIS2 sur la période pour les indicateurs suivis."));
    return { emotion: "neutre", segments, points };
  }
  const a = compte("conforme");
  const part = Math.round((a / mesures.length) * 100);
  const valeurs = { a: String(a), n: String(mesures.length), s: String(compte("surveiller")), c: String(compte("critique")), pc: `${part} %` };
  const modeles = part >= 60
    ? ["Bravo : {a} indicateurs sur {n} atteignent leur cible, soit {pc}.", "Belle performance : {pc} des indicateurs mesurés sont à la cible ({a} sur {n})."]
    : part >= 35
      ? ["{a} indicateurs sur {n} atteignent leur cible ; {s} s’en approchent et {c} en sont encore loin.", "Le bilan est mitigé : {a} sur {n} à la cible, {c} loin derrière."]
      : ["Attention : seulement {a} indicateurs sur {n} atteignent leur cible, alors que {c} en sont loin.", "Le chemin est encore long : {c} indicateurs sur {n} sont loin de la cible."];
  segments.push(seg(remplir(varier(`f-bilan-${part >= 60 ? "bien" : part >= 35 ? "moyen" : "faible"}`, modeles, alea), valeurs)));
  points.push(point(part >= 60 ? "bien" : part < 35 ? "alerte" : "info", `${a} indicateur${a > 1 ? "s" : ""} sur ${mesures.length} à la cible (${part} %) · ${compte("surveiller")} proche${compte("surveiller") > 1 ? "s" : ""} · ${compte("critique")} loin.`));
  // Programmes : le plus avancé et le plus en retard (part d'indicateurs à la cible).
  const parProgramme = [...new Set(mesures.map((t) => t.programme))].map((nom) => {
    const l = mesures.filter((t) => t.programme === nom);
    return { nom, part: l.filter((t) => t.statut === "conforme").length / l.length, n: l.length };
  }).filter((x) => x.n >= 2);
  if (parProgramme.length >= 2) {
    parProgramme.sort((x, y) => y.part - x.part);
    const haut = parProgramme[0];
    const bas = parProgramme.at(-1);
    if (haut.part > bas.part) {
      segments.push(seg(remplir(varier("f-prog", ["Le programme {h} est le plus avancé, alors que {b} a le plus de retard.", "En comparant les programmes : {h} tient ses cibles, tandis que {b} doit accélérer."], alea), { h: haut.nom, b: bas.nom }), "balance_mains"));
      points.push(point("info", `Programme le plus avancé : ${haut.nom} (${Math.round(haut.part * 100)} % à la cible) ; le plus en retard : ${bas.nom} (${Math.round(bas.part * 100)} %).`));
    }
  }
  const retard = mesures.filter((t) => t.statut === "critique").sort((x, y) => ratioCible(x) - ratioCible(y));
  if (retard[0]) {
    const t = retard[0];
    segments.push(seg(remplir(varier("f-retard", ["Je vous conseille de suivre de près « {n} » : {v} pour une cible {c}.", "Point d’attention : « {n} », à {v} pour une cible {c}.", "Surtout, « {n} » reste loin du compte : {v} contre une cible {c}."], alea), { n: t.nom, v: nb(t.valeur), c: cibleTexte(t) }), "doigt_leve"));
    points.push(point("alerte", `Le plus loin de la cible : ${t.nom} (${nb(t.valeur)} pour une cible ${cibleTexte(t)}).`));
  }
  // Pourcentages au-delà de 100 % (souvent un dénominateur sous-estimé) : signalés, jamais présentés comme exploit.
  const suspects = mesures.filter(valeurSuspecte);
  if (suspects.length) {
    segments.push(seg(`Attention : ${suspects.length} indicateur${suspects.length > 1 ? "s dépassent" : " dépasse"} 100 %, à vérifier dans DHIS2, par exemple « ${suspects[0].nom} » à ${nb(suspects[0].valeur)} %.`, "doigt_leve"));
    points.push(point("alerte", `À vérifier (au-delà de 100 %) : ${suspects.slice(0, 3).map((t) => `${t.nom} (${nb(t.valeur)})`).join(", ")}.`));
  }
  const reussi = mesures.filter((t) => t.statut === "conforme" && !valeurSuspecte(t)).sort((x, y) => ratioCible(y) - ratioCible(x));
  if (reussi[0]) {
    segments.push(seg(remplir(varier("f-reussi", ["À saluer : « {n} », à {v} pour une cible {c}.", "Excellent résultat pour « {n} » : {v}, pour une cible {c}."], alea), { n: reussi[0].nom, v: nb(reussi[0].valeur), c: cibleTexte(reussi[0]) }), "pouce_leve"));
    points.push(point("bien", `Meilleur résultat : ${reussi[0].nom} (${nb(reussi[0].valeur)}, cible ${cibleTexte(reussi[0])}).`));
  }
  const enProgres = donnees.tableau.filter(progresse);
  if (enProgres.length) {
    segments.push(seg(`D’un mois sur l’autre, ${enProgres.length} indicateur${enProgres.length > 1 ? "s progressent" : " progresse"}, dont « ${enProgres[0].nom} ».`, "pouce_leve"));
    points.push(point("bien", `En progrès sur le dernier mois : ${enProgres.slice(0, 3).map((t) => t.nom).join(", ")}.`));
  }
  const sansDonnee = donnees.tableau.length - donnees.tableau.filter((t) => t.valeur !== null && t.valeur !== undefined).length;
  if (sansDonnee) points.push(point("info", `${sansDonnee} indicateur${sansDonnee > 1 ? "s" : ""} sans donnée DHIS2 ou à associer.`));
  segments.push(seg(varier("f-fin", [
    "Demandez-moi un indicateur précis, par exemple la CPN1, pour le détail.",
    "Je peux aussi vous détailler un programme : il suffit de me le demander.",
    "Cliquez sur une ligne du tableau pour voir son évolution et la comparaison par région.",
  ], alea), "mains_jointes"));
  return { emotion: retard.length > a ? "preoccupee" : part >= 60 ? "felicitations" : "encourageante", segments, points };
}
