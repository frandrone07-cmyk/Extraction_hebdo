// Gestes de Sokhna Ci liés au CONTENU de chaque phrase et placés au moment où les mots sont prononcés.
// Le moteur vocal indique la progression (0 à 1) dans la phrase ; ce module dit quel geste faire à cet instant.
const sansAccent = (texte) => String(texte ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Ordre = priorité (le premier motif l'emporte si deux gestes tombent au même endroit).
const REGLES = [
  { geste: "salut_main", motif: /\b(salaamalekum|bonjour|bonsoir|salut|bienvenue|au revoir|a bientot)\b/g },
  { geste: "mains_jointes", motif: /\b(s'il vous plait|je vous en prie|a votre service|a votre disposition)\b/g },
  { geste: "main_sur_coeur", motif: /\b(merci|desolee?|heureuse|ravie|sincere\w*)\b/g },
  { geste: "pouce_leve", motif: /\b(bravo|felicitation\w*|excellent\w*|conforme\w*|meilleur\w*|progress\w*|amelior\w*|bonne dynamique|de mieux|en hausse|reussi\w*|stable)\b/g },
  { geste: "geste_rassurant", motif: /\b(critique\w*|retard\w*|alerte\w*|faible\w*|baisse|recule\w*|tombe\w*|probleme\w*|inquiet\w*|difficulte\w*|manque\w*|relanc\w*|accompagn\w*|prioritaire\w*|zero)\b/g },
  { geste: "compter_doigts", motif: /\b(premier|premiere|deuxieme|troisieme|d'abord|ensuite|enfin|d'une part|d'autre part)\b/g },
  { geste: "pointer_ecran", motif: /(\d+(?:[.,]\d+)?\s?(?:%|points?|districts?|regions?|formulaires?)|\bsur l'ecran\b|\bregardez\b|\bvoici\b|\bvoila\b|\bextraction\b|\bselon\b|\bles donnees\b)/g },
  { geste: "geste_ouvert", motif: /\b(voulez|souhaitez|pouvez|demandez|question\w*|eclaircissement\w*|precision\w*|ensemble|national\w*|tous|toutes|plusieurs|region\w*)\b/g },
  { geste: "hochement_tete", motif: /\b(oui|exactement|bien sur|d'accord|c'est cela)\b/g },
];
// Gestes d'un script qu'on conserve quand le texte n'en déclenche aucun (les autres étaient trop génériques).
const GESTES_SCRIPT_UTILES = new Set(["salut_main", "sourire", "inclinaison_ecoute", "hochement_tete", "geste_ouvert", "mains_jointes", "main_sur_coeur"]);
const ECART_MIN = 0.17;
const DUREE = 0.24;
const ANTICIPATION = 0.05;
const MAX_PAR_PHRASE = 4;

export function planifierGestes(texte, gesteScript = null) {
  const t = sansAccent(texte);
  const longueur = Math.max(1, t.length);
  const candidats = [];
  REGLES.forEach((regle, priorite) => {
    for (const m of t.matchAll(new RegExp(regle.motif.source, "g"))) candidats.push({ position: m.index / longueur, geste: regle.geste, priorite });
  });
  if (/\?\s*$/.test(String(texte ?? "").trim())) candidats.push({ position: 0.62, geste: "inclinaison_ecoute", priorite: -1 });
  candidats.sort((a, b) => a.position - b.position || a.priorite - b.priorite);
  const retenus = [];
  for (const c of candidats) {
    const dernier = retenus.at(-1);
    if (dernier && c.position - dernier.position < ECART_MIN) { if (c.priorite < dernier.priorite) retenus[retenus.length - 1] = c; continue; }
    retenus.push(c);
    if (retenus.length >= MAX_PAR_PHRASE) break;
  }
  if (!retenus.length && gesteScript && GESTES_SCRIPT_UTILES.has(gesteScript)) retenus.push({ position: 0.08, geste: gesteScript });
  return retenus.map((c, i) => {
    const debut = Math.max(0, c.position - ANTICIPATION);
    const suivant = retenus[i + 1] ? retenus[i + 1].position - ANTICIPATION : 1;
    return { debut, fin: Math.min(suivant, debut + DUREE + (c.geste === "inclinaison_ecoute" ? 0.2 : 0)), geste: c.geste };
  });
}

// Geste à faire quand la phrase est lue à `fraction` (0 = début, 1 = fin) ; "" = simple accompagnement de la voix.
export function gesteA(plan, fraction) {
  for (const etape of plan) if (fraction >= etape.debut && fraction < etape.fin) return etape.geste;
  return "";
}
