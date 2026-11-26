// Sokhna Ci répond sur la QUALITÉ DES DONNÉES et les INDICATEURS FARS à partir des données DHIS2 en temps réel
// (mêmes filtres globaux que les onglets). Les réponses sont composées ici, sans modèle de langage : chaque chiffre
// vient de DHIS2 ; une valeur absente est dite « non disponible », jamais inventée.
import { libellePeriode } from "./filtres-globaux.js";
import { libelleMiseAJour } from "./dhis2-client.js";

export const normaliser = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, " ").replace(/[^a-z0-9%]+/g, " ").trim();
const VIDES = new Set(["les", "des", "de", "du", "la", "le", "et", "en", "un", "une", "par", "pour", "avec", "dans", "sur", "aux", "au", "taux", "pourcentage", "proportion", "nombre", "cas", "quel", "quelle", "quels", "est", "sont", "comment", "combien", "situation", "valeur", "donne", "moi", "indicateur", "indicateurs", "fars", "mis", "place", "ayant", "qui", "que", "fait"]);
const mots = (t) => normaliser(t).split(" ").filter((m) => m.length >= 2 && !VIDES.has(m));

const QUALITE = /\b(qualite|validation|violations?|regles?|promptitude|a temps|aberrant\w*|valeurs? negatives?|rapports? manquants?)\b/;
const FARS = /\b(fars|indicateurs?|cibles?|performance|programmes?|srmnia|pev|mnt|mtn|sante com\w*|tuberculose|realisation|ecarts?)\b/;

// Vrai si la question porte sur la qualité des données ou les indicateurs FARS (données DHIS2 en direct).
// Les questions habituelles sur la complétude hebdomadaire (« districts en retard »…) restent aux autres compétences.
export function estQuestionTempsReel(question) {
  const q = normaliser(question);
  if (/\bcompletude\b/.test(q) && !/\b(fars|validation|violations?|promptitude|qualite)\b/.test(q)) return false;
  return QUALITE.test(q) || FARS.test(q);
}
export const sujet = (question) => {
  const q = normaliser(question);
  if (QUALITE.test(q) && !/\b(fars|indicateurs?|cibles?|performance)\b/.test(q)) return "qualite";
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
  const total = donnees.synthese.reduce((s, f) => ({ a: s.a + (f.attendus ?? 0), r: s.r + (f.recus ?? 0), t: s.t + (f.aTemps ?? 0) }), { a: 0, r: 0, t: 0 });
  const completude = total.a ? Math.round((total.r / total.a) * 1000) / 10 : null;
  const promptitude = total.a ? Math.round((total.t / total.a) * 1000) / 10 : null;
  const parUnite = new Map();
  for (const l of donnees.lignes) {
    if (l.attendus === null || l.recus === null) continue;
    const u = parUnite.get(l.unite) || { a: 0, r: 0, t: 0 };
    u.a += l.attendus; u.r += l.recus; u.t += l.aTemps ?? 0;
    parUnite.set(l.unite, u);
  }
  const unites = [...parUnite].filter(([, u]) => u.a > 0).map(([nom, u]) => ({ nom: regionCourte(nom), completude: Math.round((u.r / u.a) * 1000) / 10, promptitude: Math.round((u.t / u.a) * 1000) / 10 })).sort((a, b) => a.completude - b.completude);
  const formulaires = donnees.synthese.filter((f) => f.promptitude !== null).sort((a, b) => a.promptitude - b.promptitude);
  if (/\b(validation|violations?|regles?)\b/.test(q)) {
    const v = donnees.violationsDetail;
    if (!v) return { emotion: "neutre", segments: [seg(`Le contrôle des règles de validation se lance automatiquement dans l’onglet « Qualité des données » (une région après l’autre, environ une minute). Ouvrez cet onglet, puis reposez-moi la question : je vous donnerai le nombre de violations par règle, par région et par district.`)], sources, suggestions: ["qualité des données", "unités en retard"] };
    const phrases = [`Sur ${periode}, le contrôle DHIS2 relève ${nb(v.total, 0)} violation${v.total > 1 ? "s" : ""} des règles de validation.`];
    if (v.parRegle[0]) phrases.push(`La règle la plus souvent violée : « ${v.parRegle[0].nom} » (${v.parRegle[0].nombre} fois).`);
    if (v.parRegion.length) phrases.push(`Régions les plus concernées : ${v.parRegion.slice(0, 3).map((r) => `${regionCourte(r.nom)} (${r.nombre})`).join(", ")}.`);
    if (v.parDistrict.length) phrases.push(`Districts les plus concernés : ${v.parDistrict.slice(0, 3).map((d) => `${d.nom} (${d.nombre})`).join(", ")}.`);
    return { emotion: v.total ? "preoccupee" : "felicitations", segments: phrases.map((p) => seg(p)), visuel: v.parRegion.length ? { type: "table", titre: `Violations des règles de validation par région (${periode})`, colonnes: ["Région", "Violations"], lignes: v.parRegion.map((r) => [regionCourte(r.nom), String(r.nombre)]) } : undefined, sources, suggestions: ["qualité des données", "indicateurs FARS loin de la cible"] };
  }
  const phrases = [`Sur ${periode}, pour les ${donnees.synthese.length} formulaires suivis : complétude ${pc(completude)}, promptitude ${pc(promptitude)}${total.a ? `, soit ${nb(total.a - total.r, 0)} rapports manquants sur ${nb(total.a, 0)} attendus` : ""}.`];
  if (unites.length >= 2) {
    phrases.push(`Les plus faibles : ${unites.slice(0, 3).map((u) => `${u.nom} (${pc(u.completude)})`).join(", ")}.`);
    phrases.push(`Les meilleures : ${unites.slice(-2).reverse().map((u) => `${u.nom} (${pc(u.completude)})`).join(" et ")}.`);
  }
  if (formulaires[0]) phrases.push(`Le formulaire le plus en retard est « ${formulaires[0].formulaire} », avec ${pc(formulaires[0].promptitude)} de rapports reçus à temps.`);
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
