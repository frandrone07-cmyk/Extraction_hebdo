# 0001 — Connectivité des runners GitHub Actions vers DHIS2

**Statut : tranché — runners cloud GitHub-hosted retenus.**

## Contexte

Avant de figer l'architecture du cron hebdomadaire (Phase 3), il faut savoir
si les runners `ubuntu-latest` hébergés par GitHub (IP cloud dynamiques,
US/EU) peuvent atteindre `https://senegal.dhis2.org` — un pare-feu côté
DHIS2 limité à des IP connues bloquerait silencieusement ces appels.

## Comment obtenir la réponse

1. Configurer les secrets du dépôt : `Settings → Secrets and variables →
   Actions` → ajouter `DHIS2_USER` et `DHIS2_PASSWORD`.
2. Lancer manuellement le workflow `Test de connectivite DHIS2`
   (`.github/workflows/connectivity-check.yml`) depuis l'onglet **Actions**.
3. Lire le tableau produit dans le résumé du run (code HTTP + latence pour
   chaque combinaison URL × SSL).

## Lecture du résultat

- **Code 200** sur au moins une combinaison → les runners GitHub-hosted
  joignent DHIS2 ; l'architecture peut rester 100% cloud (Phase 3 telle que
  planifiée).
- **Code 401/403** → le serveur est bien atteint (pas de blocage réseau),
  mais les identifiants sont refusés — vérifier les secrets, pas un problème
  de connectivité.
- **Code 000 / timeout / aucune réponse** sur toutes les combinaisons →
  blocage réseau probable. Décision à prendre : mettre en place un runner
  auto-hébergé (machine sous contrôle du MSHP ou du prestataire, enregistrée
  sur ce dépôt privé) exécutant les mêmes workflows YAML (seul `runs-on:`
  change).

## Décision

**Testé le 10/11/2026** (run `42826849306`, dépôt `frandrone07-cmyk/Extraction_hebdo`) :

| URL | SSL | Code HTTP | Latence |
|---|---|---|---|
| `https://senegal.dhis2.org/dhis` | stricte | **200** | 0,61 s |
| `https://senegal.dhis2.org/dhis` | désactivée | 200 | 0,55 s |
| `https://senegal.dhis2.org` | stricte | 404 | 0,37 s |
| `https://senegal.dhis2.org` | désactivée | 404 | 0,37 s |

Les runners `ubuntu-latest` GitHub-hosted joignent DHIS2 sans aucun blocage
réseau, en vérification SSL **stricte**, via l'URL de base
`https://senegal.dhis2.org/dhis` (le second candidat sans `/dhis` renvoie
404 : routes API non exposées à cette racine, confirme juste qu'il faut
garder `/dhis`).

**Décision : architecture 100% cloud retenue.** Aucun runner auto-hébergé
nécessaire. `DHIS2_VERIFY_SSL=true` reste la valeur par défaut en
production — la désactivation SSL n'a montré aucun avantage ici et ne doit
pas être activée sans raison concrète.
