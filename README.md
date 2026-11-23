# Complétude DHIS2 — Sénégal

Plateforme de suivi hebdomadaire des rapports DHIS2 par région, district, période et formulaire, pour la Division du Système d’Information Sanitaire et Sociale du Ministère de la Santé et de l’Hygiène publique.

**Tableau de bord public :** [frandrone07-cmyk.github.io/Extraction_hebdo](https://frandrone07-cmyk.github.io/Extraction_hebdo/)

## Tableau de bord

- Vues : aperçu national, régions et formulaires, évolution, districts, **Qualité des données**, **Indicateurs FARS**, Sokhna Ci AI.
- Filtres liés pour l’extraction du lundi, la comparaison, la région, la période DHIS2 et le formulaire. Les sélections sont partageables dans l’URL.
- Carte des districts, classement top/flop, synthèses, carte thermique, export CSV, fiche district, impression PDF et thèmes clair/sombre.
- Mode diaporama à huit scènes, raccourcis clavier, plein écran, Wake Lock, choix des scènes avec `?scenes=synth,carte,evo` et démarrage partageable avec `#tv=0`.
- Guide Goorgui : synthèse déterministe en français, humeurs liées aux seuils et lecture vocale réglée sur le français.

Les fichiers servis par GitHub Pages sont assemblés à partir de `web/` et `data/`. Les géométries des districts et des régions sont versionnées dans `data/geo/`; les contours régionaux sont dissous depuis ceux des districts. Les historiques détaillés servant aux filtres sont produits dans `data/snapshots.json` sous forme compacte.

## Extraction et publication

Le workflow [extraction.yml](.github/workflows/extraction.yml) effectue l’extraction le lundi à 06 h (heure de Dakar), avec un rattrapage conditionnel le mardi. Chaque run remplace la semaine ISO correspondante au lieu de créer un doublon. `build-json` reconstruit les snapshots et les séries du tableau de bord, puis le workflow publie les nouveaux fichiers. Le workflow [deploy-pages.yml](.github/workflows/deploy-pages.yml) met ensuite à jour GitHub Pages.

Les identifiants `DHIS2_USER` et `DHIS2_PASSWORD` doivent rester dans les secrets GitHub Actions ou dans un fichier `.env` local non committé. Aucun identifiant DHIS2 ni jeton GitHub n’est présent dans le front-end.

Le bouton web de lancement manuel est activé après le déploiement du Worker décrit dans [docs/declenchement-manuel.md](docs/declenchement-manuel.md) et le renseignement de `TRIGGER_API_URL` dans `web/src/trigger-config.js`. Le site n’expose jamais le jeton GitHub.

## Pages en temps réel (Qualité des données, Indicateurs FARS)

Ces deux pages lisent DHIS2 **en direct**, en lecture seule, par un serveur intermédiaire : le Worker Cloudflare [dhis2-proxy/](dhis2-proxy/) (`https://dhis2-proxy.sokhnaci-completude-sn.workers.dev`).

- Les identifiants DHIS2 ne sont **jamais** dans le dépôt ni dans le navigateur : ce sont des secrets Cloudflare, l’équivalent du fichier `.env`. En local, `npx wrangler dev` les lit dans `dhis2-proxy/.dev.vars`, ignoré par git ; le modèle est `.dev.vars.example`.
- Le proxy ne relaie que des lectures (`analytics`, `dataSets`, `indicators`, `organisationUnits`, `validationRules`, `outlierDetection`…). Les deux seules requêtes POST sont des analyses : la validation et les valeurs aberrantes. Elles sont envoyées avec `persist=false`, donc rien n’est enregistré dans DHIS2.
- Les réponses sont mises en cache 10 minutes pour analytics et 5 minutes pour les métadonnées. Chaque page affiche « Mis à jour le JJ/MM/AAAA à HH:MM » et un bouton **Actualiser**, qui contourne le cache.
- Aucune donnée n’est simulée. Une valeur absente s’affiche « Donnée non disponible ». Si la connexion échoue, la page affiche un message clair et aucun chiffre.
- La version de DHIS2 est lue via `/api/system/info`. Le code qui en dépend est marqué « DÉPEND DE LA VERSION DE DHIS2 » : `outlierDetection` à partir de 2.36, liens vers l’application *Aggregate Data Entry* à partir de 2.39.

### Installation du proxy, une seule fois

```powershell
cd dhis2-proxy
npx wrangler secret put DHIS2_URL     # ex. https://senegal.dhis2.org/dhis
npx wrangler secret put DHIS2_USER    # compte DHIS2 en lecture seule, recommandé
npx wrangler secret put DHIS2_PASS
python ..\trigger-worker\generer_secrets.py   # choisit le code PIN d'administration, affiche PIN_SALT et PIN_HASH
npx wrangler secret put PIN_SALT
npx wrangler secret put PIN_HASH
npx wrangler deploy
```

Si l’adresse à ouvrir dans le navigateur diffère de `DHIS2_URL`, ajoutez le secret facultatif `DHIS2_PUBLIC_URL`. Les origines autorisées sont dans `ALLOWED_ORIGIN`, fichier `wrangler.toml`.

### Configuration depuis l’interface

La configuration est stockée dans Cloudflare KV. La modifier demande le code PIN.

- **Ajouter un formulaire** (page Qualité des données) : liste des formulaires DHIS2 avec recherche. On peut cocher, renommer, ordonner et retirer. Ces formulaires servent au calcul de la complétude, de la promptitude, des rapports manquants, des règles de validation, des valeurs aberrantes et négatives, et aux exports.
- **Configurer les indicateurs FARS** : recherche par groupe d’indicateurs DHIS2 ou par nom. Pour chaque indicateur, on indique son programme et, si elle existe, sa cible. La page FARS affiche ensuite :
  - la valeur, le numérateur et le dénominateur ;
  - l’évolution par période ;
  - la comparaison entre régions ou districts ;
  - la variation par rapport à la période précédente, avec une flèche ;
  - les désagrégations des éléments de données de l’indicateur ;
  - le statut par rapport à la cible : atteinte, proche (au moins 80 % de la cible) ou loin.

### Filtres globaux

Ces filtres sont communs aux deux pages, conservés d’un onglet à l’autre et enregistrés dans l’adresse (lien partageable) :

- années ;
- mois, avec « Tout sélectionner » et « Tout désélectionner » ;
- périodicité : mensuelle, trimestrielle ou annuelle ;
- niveau : pays, région ou district, avec choix des unités et recherche ;
- désagrégations ;
- bouton Réinitialiser.

Les tableaux s’exportent en Excel (.xlsx, bibliothèque SheetJS chargée à la demande) ou en CSV, avec les filtres appliqués.

Sokhna Ci reçoit un résumé calculé de la sélection en cours, jamais de tableau brut :

- complétude et promptitude moyennes ;
- les 3 unités les plus faibles et les 2 meilleures ;
- le formulaire et l’indicateur les plus en retard ;
- le nombre de violations des règles de validation ;
- la date de mise à jour.

## Développement local

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:PYTHONPATH = "src"
python -m completude.cli build-json
```

Pour servir la version déployée localement, copier `web/` dans un dossier de prévisualisation, puis y ajouter `data/latest.json`, `data/evolution.json`, `data/snapshots.json`, `data/export.json` et les deux GeoJSON de `data/geo/`. Démarrer ensuite un serveur HTTP depuis ce dossier ; le dashboard utilise `fetch()` et ne se charge pas correctement via `file://`.

Les tests Python sont lancés avec `python -m pytest -q`, et le contrôle de style avec `python -m ruff check src tests`. Les tests navigateur et JavaScript sont lancés avec `npx playwright test`. Ils couvrent le proxy, les filtres, les calculs de qualité et FARS, et les pages servies par un proxy simulé. Les réponses DHIS2 simulées n’existent que dans `tests/`.

## Arborescence

```text
config/             configuration DHIS2, seuils et gabarit Excel
src/completude/     connexion, extraction, historique, Excel et données web
web/                interface statique, graphiques, carte, Goorgui et diaporama
data/               historique hebdomadaire, fichiers web, géométrie et Excel
trigger-worker/     passerelle PIN vers GitHub Actions, déployée séparément
dhis2-proxy/        serveur intermédiaire DHIS2 en lecture seule (Cloudflare Worker), cache et configuration
.github/workflows/  extraction, déploiement Pages, connectivité et CI
legacy/             notebook Colab et dashboard d’origine conservés en référence
docs/               décisions et procédures d’exploitation
```
