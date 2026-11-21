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
| Avatar 3D (Three.js) | **Fait, en version stylisée** : modèle VRM libre « HairSample_Female » (CC0), animé de façon procédurale (three.js + three-vrm, MIT, hébergés dans `web/vendor/`) | Un humain photoréaliste (Unreal Engine, capture faciale) exige des outils de studio et des licences : non faisable gratuitement. Le modèle CC0 donne un vrai personnage 3D avec squelette et expressions du visage : peau, tenue (wax, Ankara, bazin, professionnelle) et foulard sont recolorés par le code ; marche, gestes, assise, danse, clignements et bouche synchronisée sur le son. Repli automatique sur l'illustration 2D (pas de WebGL, économie de données, échec de chargement). Licence et origine : `web/assets/avatar/LICENCE.txt`. |
| Reconnaissance vocale | **Navigateur (Web Speech)**, français | Gratuit, sans clé. Chrome et Edge uniquement ; le wolof n'est pas reconnu. |
| Synthèse vocale naturelle | **Piper « siwis » dans le navigateur** (voix féminine française), repli sur la voix de l'appareil | Gratuit, mis en cache après le premier téléchargement. Wolof : seule la salutation « Salaamalekum » est dite en wolof (enregistrement facultatif dans `web/audio/wo/`). |
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
2. **Avatar 3D plus réaliste** : remplacer `web/assets/avatar/sokhna.vrm` par un autre modèle VRM sous licence claire (mêmes noms d'expressions : aa, ih, ou, ee, oh, blink, happy, sad).
3. **Salutation wolof** : faire enregistrer « Salaamalekum » par une locutrice consentante (`web/audio/wo/`).


## Mise en service du Worker (21 novembre 2026)

- Worker `sokhna-ci-assistant` déployé sur le compte Cloudflare gratuit, sous-domaine `sokhnaci-completude-sn` : `https://sokhna-ci-assistant.sokhnaci-completude-sn.workers.dev` (renseigné dans `web/src/assistant-config.js`).
- Modèle : `@cf/meta/llama-3.2-3b-instruct` (variable `MODELE`, modifiable dans `wrangler.toml`). Le précédent `llama-3.1-8b-instruct` a été retiré par Cloudflare le 30 mai 2026. Comparé à Granite 4.0 micro et GLM 4.7 flash : Llama 3.2 3B est le plus fidèle aux faits et applique le refus exact quand la donnée manque.
- Les petits modèles se trompent sur les comparaisons (ils ont désigné la meilleure région comme prioritaire) : le client pré-calcule donc la région au taux le plus bas et le plus élevé dans les faits envoyés, et la consigne rappelle qu'un taux bas est le problème.
- Le client rejette de toute façon toute réponse contenant un nombre absent des faits.
- Offre gratuite : environ 10 000 neurones par jour ; au-delà, le site retombe sur les réponses scriptées.
- Déploiement : `wrangler deploy` depuis un dossier dont le nom est un sous-domaine workers.dev valide (le dossier `assistant-worker/` ne peut pas servir de sous-domaine).
