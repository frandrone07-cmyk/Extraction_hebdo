# 0004 — Architecture de Sokhna Ci AI

## Contexte

Le tableau de bord est un site statique (GitHub Pages) alimenté chaque lundi par une extraction DHIS2
automatique. Sokhna Ci devait devenir une plateforme d'assistante virtuelle complète. Contraintes posées
par le projet : **aucun service payant**, aucune clé secrète dans le navigateur, données métier préservées.

## Décisions

| Sujet demandé | Décision | Raison |
|---|---|---|
| React, TypeScript, Next.js, Tailwind, Framer Motion | **Non retenu** : JavaScript natif (modules ES) et CSS à variables | L'application existante n'a ni compilation ni serveur ; la réécrire détruirait des fonctions opérationnelles et ajouterait une chaîne de build sans gain pour les utilisateurs. Les animations utilisent CSS. |
| Interface premium (verre dépoli, cartes flottantes, thèmes clair/sombre, responsive) | **Fait** : onglet « Sokhna Ci AI » | Vérifié automatiquement : accessibilité WCAG A/AA en clair et en sombre, aucun débordement sur mobile et tablette. |
| Avatar 3D photoréaliste (Unreal Engine 5, capture faciale, Three.js) | **Non réalisé** | Un humain numérique photoréaliste exige des outils de studio, un modèle sous licence et un rendu serveur. Ce n'est pas faisable gratuitement dans une page statique. L'avatar actuel est une illustration vectorielle animée, avec scène en profondeur, 4 tenues, marche, gestes, respiration et bouche synchronisée sur le son. |
| Reconnaissance vocale | **Navigateur (Web Speech)**, français | Gratuit, sans clé. Chrome et Edge uniquement ; le wolof n'est pas reconnu. |
| Synthèse vocale naturelle | **Piper « siwis » dans le navigateur** (voix féminine française), repli sur la voix de l'appareil | Gratuit, mis en cache après le premier téléchargement. Wolof : enregistrements réels déposés dans `web/audio/wo/`. |
| WebRTC | **Non retenu** | Utile seulement pour un flux audio vers un serveur ; il n'y en a pas. |
| Modèle conversationnel | **Moteur local déterministe** + **option** `assistant-worker/` (Cloudflare Workers AI, offre gratuite) | Le moteur local couvre analyse, comparaison, recherche, statistiques, définitions, visualisations, rapports. Le Worker n'est appelé que si la question n'est pas comprise ; sa réponse est **rejetée si elle contient un chiffre absent des faits** transmis. |
| Backend sécurisé | **Worker Cloudflare** (même modèle que `trigger-worker/`) | Aucune clé dans le navigateur ; origine autorisée unique ; limite de débit ; taille de requête bornée. |
| Rapports Word, PDF, Excel | **Fait**, générés dans le navigateur | Word = document HTML ouvert par Word ; PDF = impression ; Excel = feuille par tableau (repli CSV si la bibliothèque est injoignable). |
| Recherche dans les documents | **Données de l'extraction + fichiers joints** (CSV, Excel, JSON) | Traitement local ; rien n'est envoyé. |
| Images | **Acceptées mais non interprétées** | Aucun modèle de vision gratuit et fiable côté navigateur ; l'assistante le dit clairement. |

## Règles de fiabilité appliquées

- Toute valeur provient de l'extraction DHIS2 affichée ; la source (date, période, seuils, méthode) accompagne chaque réponse.
- Le taux moyen est une moyenne simple, non pondérée par l'effectif des districts (limite documentée).
- Les mois récents progressent encore (rapports tardifs) : les tendances utilisent les mois communs à toutes les extractions.
- L'historique de conversation reste dans `localStorage` de l'appareil et peut être effacé.

## Suite possible (décisions à prendre)

1. **Déployer `assistant-worker/`** (compte Cloudflare gratuit), puis renseigner `web/src/assistant-config.js`.
2. **Avatar 3D stylisé** : bibliothèque libre de personnage parlant en Three.js ; nécessite un fichier d'avatar fourni (licence claire).
3. **Voix wolof** : faire enregistrer 5 phrases par une locutrice consentante (`web/audio/wo/`).
