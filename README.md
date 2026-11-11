# Complétude DHIS2 — Sénégal

Plateforme de suivi hebdomadaire des rapports DHIS2 par région, district, période et formulaire, pour la Division du Système d’Information Sanitaire et Sociale du Ministère de la Santé et de l’Hygiène publique.

**Tableau de bord public :** [frandrone07-cmyk.github.io/Extraction_hebdo](https://frandrone07-cmyk.github.io/Extraction_hebdo/)

## Tableau de bord

- Cinq vues : aperçu national, régions et formulaires, évolution, districts, qualité et méthode.
- Filtres liés pour l’extraction du lundi, la comparaison, la région, la période DHIS2 et le formulaire. Les sélections sont partageables dans l’URL.
- Carte des districts, classement top/flop, synthèses, carte thermique, export CSV, fiche district, impression PDF et thèmes clair/sombre.
- Mode diaporama à huit scènes, raccourcis clavier, plein écran, Wake Lock, choix des scènes avec `?scenes=synth,carte,evo` et démarrage partageable avec `#tv=0`.
- Guide Goorgui : synthèse déterministe en français, humeurs liées aux seuils et lecture vocale réglée sur le français.

Les fichiers servis par GitHub Pages sont assemblés à partir de `web/` et `data/`. La géométrie des districts reste dans `data/geo/districts.geojson`; les historiques détaillés servant aux filtres sont produits dans `data/snapshots.json` sous forme compacte.

## Extraction et publication

Le workflow [extraction.yml](.github/workflows/extraction.yml) effectue l’extraction le lundi à 06 h (heure de Dakar), avec un rattrapage conditionnel le mardi. Chaque run remplace la semaine ISO correspondante au lieu de créer un doublon. `build-json` reconstruit les snapshots et les séries du tableau de bord, puis le workflow publie les nouveaux fichiers. Le workflow [deploy-pages.yml](.github/workflows/deploy-pages.yml) met ensuite à jour GitHub Pages.

Les identifiants `DHIS2_USER` et `DHIS2_PASSWORD` doivent rester dans les secrets GitHub Actions ou dans un fichier `.env` local non committé. Aucun identifiant DHIS2 ni jeton GitHub n’est présent dans le front-end.

Le bouton web de lancement manuel est activé après le déploiement du Worker décrit dans [docs/declenchement-manuel.md](docs/declenchement-manuel.md) et le renseignement de `TRIGGER_API_URL` dans `web/src/trigger-config.js`. Le site n’expose jamais le jeton GitHub.

## Développement local

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:PYTHONPATH = "src"
python -m completude.cli build-json
```

Pour servir la version déployée localement, copier `web/` dans un dossier de prévisualisation, puis y ajouter `data/latest.json`, `data/evolution.json`, `data/snapshots.json` et `data/geo/districts.geojson`. Démarrer ensuite un serveur HTTP depuis ce dossier ; le dashboard utilise `fetch()` et ne se charge pas correctement via `file://`.

Les tests Python sont lancés avec `python -m pytest -q`, et le contrôle de style avec `python -m ruff check src tests`.

## Arborescence

```text
config/             configuration DHIS2, seuils et gabarit Excel
src/completude/     connexion, extraction, historique, Excel et données web
web/                interface statique, graphiques, carte, Goorgui et diaporama
data/               historique hebdomadaire, fichiers web, géométrie et Excel
trigger-worker/     passerelle PIN vers GitHub Actions, déployée séparément
.github/workflows/  extraction, déploiement Pages, connectivité et CI
legacy/             notebook Colab et dashboard d’origine conservés en référence
docs/               décisions et procédures d’exploitation
```
