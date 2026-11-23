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


## Performance, gestes et mode TV (22 novembre 2026)

**Rapidité**
- Cause principale de la lenteur : `moyennePour` (data.js) reparcourait toutes les lignes de la semaine pour chaque district, formulaire et période, soit environ 3 s de calcul bloquant au chargement et à chaque changement de filtre. Un index par district (`parDistrict`) ramène ce calcul à moins de 50 ms. Un test de non-régression (< 600 ms) protège ce point.
- Le modèle 3D passe de 17,5 Mo à 5,8 Mo : `scripts/optimiser_avatar.py` réduit les textures (la peau et la robe sont recolorées par le code). L'original reste dans l'historique git.
- Les modules sont préchargés (`modulepreload`) et les données revalidées (`no-cache`, réponse 304) au lieu d'être retéléchargées.
- La voix originale (gros téléchargement) ne démarre qu'après le chargement de la page et un court moment de calme. Une réponse n'attend plus la voix originale plus de 2,5 s : sinon elle est lue avec la voix de l'appareil et la suivante utilise la voix originale.
- Au repos, l'avatar 3D est dessiné à environ 24 images par seconde (pleine cadence quand il parle ou bouge).

**Avatar 3D**
- Défaut corrigé : la boucle d'animation pouvait calculer un pas de temps négatif quand une image arrivait en retard, ce qui faisait diverger les rotations (valeurs de l'ordre de 1e39) et figeait ou déformait l'avatar. Le pas de temps est désormais borné et toute valeur non finie est réinitialisée.
- Les gestes suivent le contenu de chaque phrase (`sokhnaci-gestes.js`) et se placent au moment où les mots sont prononcés : la progression est lue sur l'audio réel (ou sur les événements de la voix de l'appareil). La main et la tête marquent les mots appuyés d'après l'énergie de la voix.
- À la première visite de l'espace, Sokhna Ci entre en marchant.

**Robustesse de l'IA**
- Client : une seule nouvelle tentative, cache des réponses, coupe-circuit de 3 minutes après deux échecs, délai total de 9 s ; en cas de panne l'assistante répond par ses réponses intégrées.
- Worker : modèle de secours (`MODELE_SECOURS`, Granite 4.0 micro) essayé si le modèle principal échoue, et lecture des deux formats de réponse de Workers AI.

**Mode TV**
- Sokhna Ci (avatar 3D en buste) commente la situation de chaque diapositive à partir des données affichées, retient la diapositive pendant qu'elle parle, puis demande à la fin du cycle s'il y a des éclaircissements ou des questions.
- Questions : touche Q, champ de saisie, micro, ou écoute continue facultative (bouton « Attentive », mot « Sokhna » puis la question ; le micro n'est activé que sur demande et ignore sa propre voix). Les réponses utilisent les mêmes compétences que l'espace Sokhna Ci AI, avec le modèle de langage en repli.
- Automatisation de test : l'assistante TV est désactivée sauf si `window.__sokhnaciTV` est défini, pour ne pas changer le rythme des tests du diaporama.

**Navigation** : l'onglet Sokhna Ci AI est désormais le dernier, après Qualité et méthode.

## Voix originale en Web Worker, avatar enrichi, situation professionnelle (22 novembre 2026)

**Voix originale (Piper « siwis »)**
- Cause de la lenteur et des accrocs : la bibliothèque vits-web rechargeait, à CHAQUE phrase, le modèle de 60 Mo, recréait la session ONNX et réinstanciait le phonémiseur, sur le fil principal.
- Nouveau moteur `web/src/sokhnaci-voix-worker.js` (Web Worker) : ONNX Runtime Web 1.18 et le phonémiseur Piper sont chargés une seule fois ; le modèle est gardé dans le cache du navigateur (OPFS, même emplacement que vits-web, donc pas de nouveau téléchargement) ; toutes les phrases d'une réponse sont phonémisées en un seul passage ; une question passe toujours avant les phrases préparées à l'avance ; une lecture interrompue annule ses phrases en attente ; petit fondu pour éviter les clics.
- Les phrases longues sont découpées aux virgules en morceaux de taille croissante (environ 45, 60, 80, 110 caractères…) : chaque morceau est fabriqué pendant que le précédent est lu.
- Mesure locale : premier son 1,4 s après la question (9,2 s avant), lecture complète 17 s (26,5 s avant), aucune tâche bloquante pendant la synthèse.
- Repli inchangé : voix de l'appareil si le moteur ne répond pas.

**Avatar 3D**
- Regard : les yeux suivent l'utilisateur (three-vrm `lookAt`) avec de petites saccades ; vers l'écran quand elle le montre, vers le haut quand elle réfléchit ; la tête se tourne vers l'utilisateur quand elle marche de côté.
- Nouvelles actions (réglées à l'image) : applaudir, s'incliner, réfléchir (main au menton), automatiquement pendant qu'elle prépare une réponse.
- Animations VRMA : non retenues, faute de fichiers sous licence clairement libre ; l'animation reste procédurale (three-vrm).

**Réponses**
- Point de situation structuré : cadre (date, période), indicateur principal et tendance, répartition par seuil, territoires, priorités de relance, formulaire le moins renseigné, points positifs, recommandation.
- Corrections de précision : « combien de districts sont en rouge » donne le décompte ; « quel formulaire est le plus en retard » classe les formulaires ; les classements précisent s'il s'agit de régions ou de districts ; l'explication de l'évolution dépend du sens réel de la tendance.

**Conversation** : elle n'est plus enregistrée d'une visite à l'autre ; un rechargement (F5, Ctrl+F5) repart d'une conversation neuve. Elle reste conservée quand on change d'onglet.

## Mode TV : présentatrice en pied et diapositive de bilan (22 novembre 2026)

- Sur grand écran (≥ 1100 px), Sokhna Ci est une présentatrice en pied dans une colonne à droite des diapositives (cadrage 3D « pied ») : elle entre en marchant à chaque diapositive, fait quelques pas d'une phrase à l'autre en continuant ses gestes, et se tourne vers les diapositives quand elle les montre. Sur petit écran, la carte compacte (buste) est conservée. Les mouvements respectent « réduire les animations ».
- Nouvelle dernière diapositive « Situation globale et solutions » (`web/src/bilan.js`, source unique pour l'écran et pour la voix) :
  - situation globale : jauge annulaire du taux moyen et de sa tendance, répartition des districts par seuil, région la plus en retard et la mieux placée ;
  - formulaires sans données : part des cellules district × formulaire vides ou à zéro, par formulaire ;
  - solutions proposées (au plus cinq, avec priorité Immédiat / Cette semaine / Ce mois), déduites de l'analyse : districts en retard global, formulaires sans données, formulaires bas partout, régions entièrement en rouge, district atypique, valeurs à zéro, régions qui stagnent.
- Design de la diapositive : fond sombre en dégradé, cartes translucides en relief, icônes en volume, apparition échelonnée en perspective. Il a été réalisé directement en CSS : aucun outil Figma n'est connecté à ce projet.
- Gestes : sans mot déclencheur, le geste « parole » (accompagnement rythmé de la voix) remplace l'absence de geste.

## Suivi visuel de la parole et bilan dans le tableau de bord (22 novembre 2026)

- Chaque phrase de Sokhna Ci peut désigner la zone qu'elle commente (`cible`). Pendant la phrase, l'affichage défile jusqu'à cette zone et l'entoure d'un halo (`web/src/mise-en-avant.js`) : diapositives du mode TV (indicateurs, graphiques, ligne de la carte thermique, cartes du bilan, chaque solution) et vue d'ensemble quand la carte flottante lit le point de situation (synthèse, taux moyen, répartition, carte des régions, priorités, formulaires sans données, solutions).
- Le bilan « Situation globale et solutions » est affiché à l'identique dans la vue d'ensemble et dans le diaporama : un seul rendu (`bilanHtml` dans `bilan.js`), avec des identifiants propres à chaque emplacement.

## Présentatrice hors mode TV, solutions adaptées, gestes et robustesse (22 novembre 2026)

- Grand écran (≥ 1360 px) : la carte flottante devient la même présentatrice qu'en mode TV (colonne sombre à droite, avatar 3D en pied, phrase en cours mise en valeur, quelques pas pendant l'exposé). La page se décale pour ne rien masquer ; réduite, elle libère la place. En dessous de 1360 px, la carte compacte reste. Le déplacement est partagé dans `web/src/marche.js`.
- Solutions du bilan : moteur de règles pondérées. Chaque situation détectée (données anciennes, baisse récente, retard global, régions entièrement en rouge, formulaires vides, formulaire bas partout, district atypique, districts proches de la conformité ou juste au-dessus du seuil critique, valeurs à zéro, stagnation, progression, bonne situation, nette amélioration) propose une action avec un score ; les cinq plus importantes sont retenues, rangées par priorité. Testé sur trois scénarios (réel, bonne situation, baisse).
- Gestes : humeur du visage par phrase (bonne nouvelle, alerte), main qui rythme la parole alternée d'une phrase à l'autre, hochement de tête en fin d'affirmation.
- Robustesse : l'avatar 3D supporte la perte du contexte graphique et revient à l'illustration 2D après des erreurs répétées ; si le moteur de voix s'arrête en cours de route, il est relancé automatiquement et les phrases en attente passent à la voix de l'appareil.

## Sokhna Ci du tableau de bord identique à celle du mode TV (22 novembre 2026)

- La carte flottante reprend exactement la présentation de l'assistante du mode TV : carte sombre, scène avec l'avatar, nom et état, sous-titre de la phrase en cours, champ « Une question ? (touche Q) » et rangée de boutons-icônes (micro, envoyer, voix, écouter, arrêter, espace complet ; leur nom reste lu par les lecteurs d'écran). La touche Q ouvre la question, comme en mode TV.
- Même seuil que le mode TV : à partir de 1100 px, présentatrice en pied dans une colonne à droite (la page se décale) ; en dessous, carte compacte avec l'avatar en buste.
- Gestes : les mains ne restent plus raides. Doigts détendus au repos, index tendu pour montrer, poing pour le pouce levé, deux doigts pour énumérer, mains ouvertes pour les gestes d'ouverture ; la main qui rythme la parole s'ouvre sur les mots appuyés. Sens de flexion réglé à l'image (gauche négatif, droite positif).

## Mode TV : une diapositive dédiée à Sokhna Ci ; fermeture complète de la carte (22 novembre 2026)

- Mode TV : Sokhna Ci n'apparaît plus sur les diapositives ordinaires, qui défilent à leur rythme. Une dernière diapositive « Sokhna Ci : situation et questions » lui est consacrée : avatar en pied, phrase en cours en grand, historique des questions et réponses, champ de question. Elle y fait le point de situation (même exposé que dans le tableau de bord), demande s'il y a des éclaircissements ou des questions, écoute 45 secondes et répond (jusqu'à six phrases, mêmes compétences que l'espace Sokhna Ci AI, modèle de langage en repli). La touche Q, depuis n'importe quelle diapositive, rejoint cette diapositive pour poser une question. Sans assistante (automatisation), cette diapositive n'existe pas.
- Vue d'ensemble : le bloc « Situation globale et solutions » est placé tout en bas.
- Tableau de bord : le bouton « − » ferme complètement Sokhna Ci (aucune pastille ne reste) ; le choix est mémorisé. Elle se rouvre avec le bouton « ✦ Sokhna Ci » de l'en-tête ou la touche Q. Le simple changement d'onglet la réduit toujours en pastille, comme avant.

## Réponses précises, icône de réouverture, gestes au repos (23 novembre 2026)

- Nouveau module `web/src/sokhnaci-precision.js`, consulté avant les compétences générales : diagnostic d'un district (« pourquoi Kanel est en retard » : formulaires sous le seuil, à zéro, sans donnée, plus faibles, écart à la médiane régionale), évolution d'une région, district le plus en retard / liste des districts en rouge / formulaire le plus faible dans une région, dénombrement des régions et des formulaires, « X ou Y, qui fait mieux ? », région qui progresse ou recule le plus, « les N plus faibles », formulaires sans données, recommandations (solutions du bilan). Les noms partagés par une région et un district (Thiès, Matam, Kolda…) sont départagés par la formulation. Les faits envoyés au modèle de langage incluent désormais les solutions et les formulaires sans données.
- Fermée, Sokhna Ci laisse une petite icône ronde en bas à droite pour la rouvrir d'un clic (en plus du bouton de l'en-tête et de la touche Q).
- Avatar 3D : attitudes au repos (mains croisées devant, regard autour, changement d'appui), buste qui se penche légèrement sur les mots appuyés, doigt pointé et ouverture des bras amplifiés par l'énergie de la voix.
- Correctif : des expressions régulières écrites par un script contenaient des caractères de contrôle à la place de `\b` ; le fichier concerné a été nettoyé et vérifié.

## Mise à jour du lundi et ouverture de Sokhna Ci (23 novembre 2026)

- Extraction : l'exécution planifiée de lundi 00:00 du 16 novembre n'avait jamais démarré (GitHub retarde ou abandonne les tâches planifiées à minuit, heure de pointe) ; seul le rattrapage du mardi avait tourné. Le workflow ajoute des relances le lundi à 00:20, 02:00 et 05:00, puis le rattrapage du mardi ; toute exécution planifiée vérifie d'abord que la semaine manque (`check-week`), donc jamais de double extraction. Le déclenchement manuel s'exécute toujours.
- Tableau de bord : la page ouverte vérifie toutes les 5 minutes, et à chaque retour sur l'onglet, si une nouvelle extraction est publiée ; elle se met alors à jour seule (en suivant la nouvelle semaine si l'utilisateur regardait la plus récente), affiche un message, et Sokhna Ci s'ouvre pour présenter la nouvelle situation (« L'extraction de ce lundi … vient d'être publiée »).
- Sokhna Ci : la fermeture ne vaut que pour la visite en cours ; à chaque nouvelle visite, et à chaque nouvelle semaine de données, elle est ouverte avec le point de situation. Celui-ci annonce la prochaine mise à jour (« lundi …, à minuit ») ou signale clairement que l'extraction attendue n'est pas encore publiée.

## Extraction automatique fiable, mois ajouté le 16, Excel fusionné (23 novembre 2026)

- Extraction : tentative planifiée toutes les 15 minutes, toute la journée du lundi (dès 00:00 UTC = 00:00 Dakar), puis le 16 de chaque mois de 00:00 à 05:45, et un dernier rattrapage le mardi à 06:00. Le job `check-week` décide : extraction seulement si la semaine courante manque, ou si le mois qui vient d'ouvrir n'y figure pas encore ; si une extraction a déjà eu lieu le jour même sans ce mois (DHIS2 ne le renvoie pas encore), on ne relance pas en boucle. Une panne de GitHub ou de DHIS2 pendant quelques heures est donc rattrapée automatiquement, sans double extraction.
- Mois : le mois écoulé est ajouté à partir du 16 du mois suivant (ex. novembre à partir du 16 décembre ; avant : le 15). Règle dans `periodes.derniere_periode_disponible`, utilisée pour l'extraction et pour l'affichage.
- Excel : feuille « Synthèse » en premier (titre, date d'extraction, mois couverts, légende des seuils, tableau par région avec taux moyen coloré et nombre de districts par statut, ligne « Ensemble ») ; feuilles régionales avec le district fusionné sur toutes ses lignes de mois (ex. Bakel une seule fois de janvier à octobre), blocs de district alternés et séparés, couleurs des seuils modernisées, cases sans donnée grisées. L'en-tête reste en première ligne et la feuille « Synthèse » est ignorée par l'import automatique des anciens exports, qui recopie déjà le district sur les lignes fusionnées.

## Écran stable sur tous les appareils, lèvres guidées par le timbre (23 novembre 2026)

- La page ne « saute » plus au chargement : la colonne de Sokhna Ci est réservée dès le premier affichage par un court script en tête de `<body>` et la carte est créée directement dans sa forme finale ; la zone de contenu réserve sa hauteur pendant le chargement (le pied de page n'apparaît pas puis ne descend pas). Mesure (Cumulative Layout Shift) : 0,80 → 0,04 en 1920 px, ≤ 0,001 aux autres tailles, aucun débordement horizontal de 360 à 2560 px. Un test vérifie quatre tailles.
- Portables et écrans peu hauts : en-tête, titre et filtres plus compacts. Écrans de moins de 1100 px : carte compacte de Sokhna Ci plus petite, pour ne plus masquer les onglets.
- Avatar 3D : la forme des lèvres suit le timbre réel de la voix (centre de gravité du spectre) : sons graves → lèvres arrondies (o, ou), médium → ouvertes (a), aigus → étirées (i, é), en plus de l'ouverture qui suit l'énergie.

## Bande du drapeau fixe, situation automatique après rechargement (23 novembre 2026)

- La ligne aux couleurs du drapeau reste collée en haut de l'écran pendant le défilement, sur toute la largeur.
- Après un rechargement (F5, Ctrl+F5), Sokhna Ci est toujours ouverte et présente aussitôt la situation : le navigateur interdisant le son sans geste de l'utilisateur, elle commence en sous-titres (avatar animé, « Cliquez n'importe où pour entendre Sokhna Ci ») puis continue à voix haute, à partir de la phrase en cours, au premier clic ou à la première touche. Le point de situation se termine par « Avez-vous des questions, ou des éclaircissements à me demander ? » ; elle prend alors une posture d'écoute et le champ de question est mis en valeur. En mode TV, cette question est remplacée par celle de la diapositive (pas de doublon).
- Le bouton « − » range Sokhna Ci dans la petite icône ronde (avec une courte animation) ; elle ne reste plus fermée d'un chargement à l'autre.

## Cartes plus grandes, navigation par la voix, stabilité sans script (23 novembre 2026)

- Cartes : leur hauteur suit la largeur de leur cadre (requêtes de conteneur, environ la largeur, entre 600 et 900 px, au plus 85 % de la hauteur d'écran). Quand Sokhna Ci est réduite, la page s'élargit et les cartes s'agrandissent (ex. 600 → 755 px de haut en 1440×900). Leaflet se redessine dès que le cadre change de taille (ResizeObserver).
- Ordres de navigation (`web/src/sokhnaci-navigation.js`), depuis la carte flottante ou l'espace Sokhna Ci AI : « dirige-toi vers Évolution » (et les autres onglets), « zoome sur Dakar » (région, sur les deux cartes), « zoom sur le district de Bakel », « vue nationale » / « dézoome », « passe en mode TV ». Un verbe d'action précis est exigé (« va vers », « zoome », « centre sur »…) : « comment va Dakar Centre ? » ou « comment évolue Dakar » restent des questions.
- Stabilité : sur grand écran, la place de la colonne de Sokhna Ci est réservée par le CSS seul dès le premier affichage (classe `sans-presentatrice` posée seulement quand elle est réduite) ; le script de tête, parfois exécuté trop tard, est supprimé. Avec la colonne, les boutons de l'en-tête sont d'emblée sur leur propre ligne quand la place est juste : le chargement de la police ne les fait plus passer à la ligne.
