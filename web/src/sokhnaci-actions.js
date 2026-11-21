// Ordres donnés à Sokhna Ci (voix ou clavier) : reconnaissance de la commande et phrase qui l'accompagne.

export function normaliserTexte(texte) {
  return String(texte ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Ordre de priorité : le premier motif qui correspond l'emporte.
const COMMANDES = [
  { action: "stop", motif: /\b(arrete( toi)?|stop|stoppe|ne bouge plus|immobilise( toi)?|ne bouge pas)\b/ },
  { action: "rentre", motif: /\b(rentre|retourne (dans|a) ta (carte|place)|va te reposer|remonte)\b/ },
  { action: "danse", motif: /\b(danse|fais (une |un petit )?danse|quelques pas de danse)\b/ },
  { action: "suis", motif: /\b(suis moi|suis nous|accompagne moi)\b/ },
  { action: "viens", motif: /\b(viens( ici| vers moi)?|approche( toi)?|rapproche( toi)?|avance vers moi|reviens( vers moi| ici)?)\b/ },
  { action: "ecoute", motif: /\b(ecoute( moi)?|ecoutez moi|tends l oreille)\b/ },
  { action: "sourire", motif: /\b(souris|fais un sourire|montre ton sourire)\b/ },
  { action: "salut", motif: /\b(fais moi (un )?signe|signe de la main|salue|dis bonjour|fais un coucou|coucou)\b/ },
  { action: "assis", motif: /\b(assieds toi|assois toi|assis toi|prends un siege|repose toi)\b/ },
  { action: "debout", motif: /\b(leve toi|releve toi|debout)\b/ },
  { action: "tourne", motif: /\b(tourne( toi)? a (gauche|droite)|va a (gauche|droite)|vers la (gauche|droite))\b/ },
  { action: "demitour", motif: /\b(retourne toi|fais demi tour|demi tour|tourne toi)\b/ },
  { action: "recule", motif: /\b(recule|va en arriere|marche en arriere)\b/ },
  { action: "marche", motif: /(^marche$|\b(commence a marcher|marche un peu|promene toi|balade toi|marche dans)\b)/ },
  { action: "avance", motif: /\b(avance|va en avant|fais quelques pas|marche devant)\b/ },
  { action: "presente", motif: /\b(presente( moi)? les resultats|presente la situation|fais la presentation|presente les indicateurs)\b/ },
  { action: "montre", motif: /\b(montre( moi)?|designe|indique|pointe)\b/ },
];

const CIBLES = [
  { motif: /\bcarte\b/, selecteur: "#carte", libelle: "la carte" },
  { motif: /\b(evolution|courbe|graphique)\b/, selecteur: "#ch-evo-globale", libelle: "la courbe d’évolution" },
  { motif: /\b(chiffres|indicateurs?)\b/, selecteur: ".grid-kpi", libelle: "les chiffres clés" },
];

export function detecterCommande(question) {
  const texte = normaliserTexte(question);
  if (!texte || texte.split(" ").length > 9) return null;
  for (const { action, motif } of COMMANDES) {
    if (!motif.test(texte)) continue;
    if (action === "montre" && (!CIBLES.some((cible) => cible.motif.test(texte)) || texte.split(" ").length > 5)) continue;
    const commande = { action };
    const direction = texte.match(/\b(gauche|droite)\b/);
    if (direction) commande.direction = direction[1] === "gauche" ? -1 : 1;
    if (action === "montre") commande.cible = CIBLES.find((cible) => cible.motif.test(texte)) || null;
    return commande;
  }
  return null;
}

const aleatoire = (options) => options[Math.floor(Math.random() * options.length)];

// Réponse parlée (segments) + émotion pour chaque ordre.
export function phraseAction(commande) {
  const s = (texte, geste = null) => ({ langue: "fr", texte, geste, audio: null });
  switch (commande.action) {
    case "stop": return { emotion: "neutre", segments: [s(aleatoire(["D’accord, je m’arrête.", "Je m’immobilise."]), "hochement_tete")] };
    case "rentre": return { emotion: "souriante", segments: [s("Je retourne à ma place. Appelez-moi si besoin !", "salut_main")] };
    case "danse": return { emotion: "felicitations", segments: [s(aleatoire(["Allons-y, un petit pas de danse !", "Avec plaisir, regardez !"]), "geste_ouvert")] };
    case "suis": return { emotion: "souriante", segments: [s("D’accord, je vous suis.", "hochement_tete")] };
    case "viens": return { emotion: "souriante", segments: [s(aleatoire(["J’arrive !", "Me voici, je viens vers vous."]), "salut_main")] };
    case "ecoute": return { emotion: "neutre", segments: [s("Je vous écoute.", "inclinaison_ecoute")] };
    case "sourire": return { emotion: "souriante", segments: [s("Avec plaisir !", "sourire")] };
    case "salut": return { emotion: "souriante", segments: [s(aleatoire(["Salaamalekum ! Content de vous voir.", "Coucou ! Comment allez-vous ?"]), "salut_main")] };
    case "assis": return { emotion: "neutre", segments: [s("Je m’assois. Je reste à votre écoute.", "geste_rassurant")] };
    case "debout": return { emotion: "souriante", segments: [s("Me voilà debout !", "sourire")] };
    case "tourne": return { emotion: "neutre", segments: [s(commande.direction < 0 ? "Je me tourne vers la gauche." : "Je me tourne vers la droite.", "hochement_tete")] };
    case "demitour": return { emotion: "neutre", segments: [s("Je fais demi-tour.", "hochement_tete")] };
    case "recule": return { emotion: "neutre", segments: [s("Je recule un peu.", "geste_rassurant")] };
    case "avance": return { emotion: "neutre", segments: [s("J’avance.", "hochement_tete")] };
    case "marche": return { emotion: "souriante", segments: [s(aleatoire(["Je vais me promener un peu.", "D’accord, je marche."]), "hochement_tete")] };
    case "presente": return { emotion: "encourageante", segments: [s("Je vous présente les points importants, un par un.", "pointer_ecran")] };
    case "montre": return { emotion: "encourageante", segments: [s(commande.cible ? `Regardez, voici ${commande.cible.libelle}.` : "Regardez ici.", "pointer_ecran")] };
    default: return null;
  }
}
