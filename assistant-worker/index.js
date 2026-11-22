// Reformulation par un modèle de langage, uniquement à partir des faits fournis par le tableau de bord.
// Ce Worker ne contient et n'expose aucune clé : l'IA est liée par le binding « AI » de Cloudflare.
const CONSIGNE = `Tu es Sokhna Ci, assistante virtuelle du tableau de bord de complétude des rapports DHIS2 du Sénégal.
Tu réponds en français, avec chaleur et professionnalisme, en 4 phrases maximum, sans markdown.
Règles absolues :
- Tu n'utilises QUE les faits du bloc FAITS. Tu n'inventes, n'estimes ni ne déduis jamais un chiffre.
- Si l'information n'est pas dans FAITS, tu réponds exactement : « Cette donnée n'est pas disponible dans le tableau de bord. »
- Tu cites la période et la date des données quand tu donnes un chiffre.
- Hors sujet (politique, diagnostic médical, santé individuelle) : tu rappelles poliment que tu parles de complétude des rapports.
- Un taux de complétude BAS est un problème : la région ou le district à aider en priorité est celui dont le taux est le plus bas. Ne confonds jamais un bon taux avec une situation critique.
- Tu ne parles jamais de maladie, de prévalence ni de santé des patients : seulement de la complétude des rapports.
- Tu parles de rapports manquants, jamais de personnes.`;

function reponse(corps, statut, origine) {
  const entetes = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Vary: "Origin" };
  if (origine) {
    entetes["Access-Control-Allow-Origin"] = origine;
    entetes["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    entetes["Access-Control-Allow-Headers"] = "Content-Type";
    entetes["Access-Control-Max-Age"] = "600";
  }
  return new Response(statut === 204 ? null : JSON.stringify(corps), { status: statut, headers: entetes });
}

export default {
  async fetch(requete, env) {
    const origine = requete.headers.get("Origin") === env.ALLOWED_ORIGIN ? env.ALLOWED_ORIGIN : null;
    if (requete.method === "OPTIONS") return reponse(null, 204, origine);
    if (!origine) return reponse({ erreur: "origine non autorisée" }, 403, null);
    if (requete.method !== "POST") return reponse({ erreur: "méthode non autorisée" }, 405, origine);
    if (env.ASSISTANT_RATE_LIMIT) {
      const cle = requete.headers.get("CF-Connecting-IP") || "inconnu";
      const { success } = await env.ASSISTANT_RATE_LIMIT.limit({ key: cle });
      if (!success) return reponse({ erreur: "trop de demandes, réessayez dans une minute" }, 429, origine);
    }
    const brut = await requete.text();
    if (brut.length > 12000) return reponse({ erreur: "requête trop volumineuse" }, 413, origine);
    let donnees;
    try { donnees = JSON.parse(brut); } catch { return reponse({ erreur: "JSON invalide" }, 400, origine); }
    const question = String(donnees.question || "").slice(0, 300).trim();
    const faits = donnees.faits && typeof donnees.faits === "object" ? JSON.stringify(donnees.faits).slice(0, 9000) : "";
    if (!question || !faits) return reponse({ erreur: "question et faits requis" }, 400, origine);
    const messages = [
      { role: "system", content: CONSIGNE },
      { role: "user", content: `FAITS (seule source autorisée) :
${faits}

QUESTION : ${question}` },
    ];
    // Modèle principal, puis modèle de secours si Cloudflare le retire ou le sature.
    const modeles = [env.MODELE, env.MODELE_SECOURS].filter(Boolean);
    for (const modele of modeles) {
      try {
        const sortie = await env.AI.run(modele, { messages, max_tokens: 300, temperature: 0.2 });
        const texte = String(sortie?.response ?? sortie?.choices?.[0]?.message?.content ?? "").trim().slice(0, 1200);
        if (texte) return reponse({ texte }, 200, origine);
      } catch { /* on essaie le modèle suivant */ }
    }
    return reponse({ erreur: "modèle indisponible" }, 502, origine);
  },
};
