// Orchestration : décide si une entrée est un ordre (mouvement) ou une question, route vers la bonne
// compétence, puis ajoute les sources et les suggestions à la réponse.
import { detecterCommande, normaliserTexte } from "./sokhnaci-actions.js";
import { repondre } from "./sokhnaci-dialogue.js";
import { comparer, definir, demandeRapport, estDemandeVisuelle, rechercher, sourcesPour, statistiques, visualiser } from "./sokhnaci-competences.js";

const SUGGESTIONS_PAR_DEFAUT = ["fais une analyse des résultats", "les meilleurs districts", "comment ça évolue", "fais un graphique des régions"];

function finaliser(dialogue, model, question) {
  if (!dialogue) return dialogue;
  const q = normaliserTexte(question);
  let resultat = dialogue;
  if (!resultat.visuel && /\b(territor\w*|geograph\w*)\b/.test(q)) {
    const complement = visualiser("graphique des regions", model);
    if (complement?.visuel) resultat = { ...resultat, visuel: complement.visuel };
  }
  return {
    ...resultat,
    sources: sourcesPour(model, resultat.sourcesSupplement || []),
    suggestions: (resultat.suggestions?.length ? resultat.suggestions : SUGGESTIONS_PAR_DEFAUT).slice(0, 4),
  };
}

export function repondreComplet(question, model) {
  for (const competence of [demandeRapport, definir, comparer, rechercher, statistiques, visualiser]) {
    const resultat = competence(question, model);
    if (resultat) return finaliser(resultat, model, question);
  }
  return finaliser(repondre(question, model), model, question);
}

// Renvoie { commande } pour un ordre de mouvement, sinon { dialogue }.
export function interpreterEntree(question, model) {
  if (estDemandeVisuelle(question)) {
    const visuel = visualiser(question, model);
    if (visuel) return { dialogue: finaliser(visuel, model, question) };
  }
  const commande = detecterCommande(question);
  if (commande) return { commande };
  return { dialogue: repondreComplet(question, model) };
}
