from datetime import date

import pandas as pd

from completude.cli import construire_parser
from completude.history import fichiers_datees, upsert_week


def test_nom_fichier_extract_reconnu_par_fichiers_datees(tmp_path):
    # Regression : extract écrivait autrefois en AAAA-MM-JJ (ISO) alors que
    # fichiers_datees() n'attend que JJ_MM_AAAA -> les exports produits
    # chaque semaine n'étaient jamais ré-importables automatiquement.
    nom = f"Situation_completude_par_region_{date(2026, 11, 10):%d_%m_%Y}.xlsx"
    (tmp_path / nom).write_bytes(b"")
    trouves = fichiers_datees(str(tmp_path))
    assert trouves == [(str(tmp_path / nom), "2026-11-10")]


def _config_minimal(tmp_path, chemin_historique):
    chemin = tmp_path / "config.yml"
    chemin.write_text(
        f"""
dhis2:
  urls_candidates: ["https://example.invalid"]
  verify_ssl: true
chemins:
  gabarit: "config/gabarit.xlsx"
  sortie_dir: "{(tmp_path / 'exports').as_posix()}"
  historique: "{chemin_historique.as_posix()}"
  geo_cache: "{(tmp_path / 'geo_cache.geojson').as_posix()}"
  geo_local: "{(tmp_path / 'geo_local.geojson').as_posix()}"
  geo_final: "{(tmp_path / 'districts.geojson').as_posix()}"
  latest_json: "{(tmp_path / 'latest.json').as_posix()}"
  evolution_json: "{(tmp_path / 'evolution.json').as_posix()}"
seuils:
  critique: 70
  conforme: 90
  baisse: 5
extraction:
  nb_mois_fenetre: 3
  dates_a_exclure: []
dashboard:
  nb_extractions_detail: 8
""",
        encoding="utf-8",
    )
    return str(chemin)


def test_check_week_code_1_si_semaine_absente(tmp_path, monkeypatch):
    chemin_historique = tmp_path / "history.csv"
    chemin_config = _config_minimal(tmp_path, chemin_historique)

    parser = construire_parser()
    args = parser.parse_args(["check-week", "--config", chemin_config])
    assert args.func(args) == 1  # pas d'historique du tout -> semaine absente


def test_check_week_code_0_si_semaine_presente(tmp_path):
    chemin_historique = tmp_path / "history.csv"
    chemin_config = _config_minimal(tmp_path, chemin_historique)

    par_region = {"Dakar": pd.DataFrame([
        {"Districts": "District de Pikine", "Période": "Juillet 2026", "Paludisme - Reporting rate": 90.0}
    ])}
    upsert_week(par_region, {("Dakar", "District de Pikine"): "OUA"}, date.today(), str(chemin_historique))

    parser = construire_parser()
    args = parser.parse_args(["check-week", "--config", chemin_config])
    assert args.func(args) == 0


def test_migrate_history_commande(tmp_path):
    chemin_legacy = tmp_path / "legacy.csv"
    pd.DataFrame([
        {"date_extraction": "2026-11-09", "region": "Dakar", "district": "District de Pikine",
         "uid_district": "OUA", "periode_code": "202607", "periode": "Juillet 2026",
         "formulaire": "Paludisme", "valeur": "70.0"},
    ]).to_csv(chemin_legacy, index=False, encoding="utf-8-sig")
    chemin_sortie = tmp_path / "migre.csv"

    parser = construire_parser()
    args = parser.parse_args(["migrate-history", "--input", str(chemin_legacy), "--output", str(chemin_sortie)])
    assert args.func(args) == 0
    assert chemin_sortie.exists()

    migre = pd.read_csv(chemin_sortie)
    assert migre.iloc[0]["semaine_cle"] == "2026-11-09"
