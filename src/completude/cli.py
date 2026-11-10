"""Point d'entrée CLI : `python -m completude.cli <sous-commande> --config ...`."""
from __future__ import annotations

import argparse
import json
import logging
import os
from datetime import datetime

from .config import charger_config
from .dashboarddata import construire_evolution, construire_latest
from .dhis2 import Dhis2Client
from .excel import ecrire_excel
from .extract import detecter_niveau_organisation_unit, extraire
from .geo import charger_contours
from .history import (
    importer_anciennes,
    iso_monday,
    lire_historique,
    migrer_historique_legacy,
    nettoyer_hist,
    purger_dates,
    semaine_presente,
    upsert_week,
)

logger = logging.getLogger("completude")


def _ajouter_argument_config(sous_parser: argparse.ArgumentParser) -> None:
    sous_parser.add_argument("--config", default="config/config.yml", help="Chemin du fichier de configuration YAML")


def _commande_extract(args: argparse.Namespace) -> int:
    config = charger_config(args.config)
    date_reference = datetime.now().date()

    if args.dry_run:
        logger.info(
            "Dry-run : aucun appel réseau réel ne sera fait "
            "(cette option nécessite des fixtures, non encore branchées)."
        )
        logger.info("Configuration chargée depuis %s : seuils=%s", args.config, config.seuils)
        return 0

    client = Dhis2Client.connecter(
        urls_candidates=config.dhis2_urls_candidates,
        username=config.dhis2_username,
        password=config.dhis2_password,
        verify_ssl=config.dhis2_verify_ssl,
    )
    resultat = extraire(
        client=client,
        chemin_gabarit=config.chemin_gabarit,
        nb_mois_fenetre=args.mois or config.nb_mois_fenetre,
        date_reference=date_reference,
    )

    os.makedirs(config.chemin_sortie_dir, exist_ok=True)
    nom_fichier = f"Situation_completude_par_region_{date_reference.strftime('%Y-%m-%d')}.xlsx"
    chemin_sortie = os.path.join(config.chemin_sortie_dir, nom_fichier)
    ecrire_excel(resultat.par_region, chemin_sortie, config.seuils.critique, config.seuils.conforme)
    logger.info("Excel écrit : %s", chemin_sortie)

    if resultat.formulaires_non_resolus:
        logger.warning("Formulaires sans correspondance DHIS2 : %s", sorted(resultat.formulaires_non_resolus))
    if resultat.districts_non_resolus:
        logger.warning("Districts non reconnus dans DHIS2 : %s", sorted(resultat.districts_non_resolus))

    hist, remplacees = upsert_week(resultat.par_region, resultat.uid_district, date_reference, config.chemin_historique)
    if remplacees:
        logger.info("Historique : %d ligne(s) de la semaine courante remplacées (pas de doublon)", remplacees)

    date_str = date_reference.isoformat()
    hist = purger_dates(hist, config.dates_a_exclure, date_courante=date_str)
    hist = importer_anciennes(
        hist, config.chemin_sortie_dir, resultat.uid_district, date_str, set(config.dates_a_exclure)
    )
    hist = nettoyer_hist(hist)
    hist.to_csv(config.chemin_historique, index=False, encoding="utf-8-sig")
    logger.info(
        "Historique mis à jour : %d semaine(s) en mémoire (%d lignes) -> %s",
        hist["semaine_cle"].nunique(), len(hist), config.chemin_historique,
    )

    return 0


def _commande_check_week(args: argparse.Namespace) -> int:
    """Code de sortie 0 si la semaine courante est déjà dans l'historique (rien à faire),
    1 sinon (la Phase 3 l'utilise pour décider si le rattrapage du mardi doit s'exécuter)."""
    config = charger_config(args.config)
    hist = lire_historique(config.chemin_historique)
    semaine_courante = iso_monday(datetime.now().date()).isoformat()
    if semaine_presente(hist, semaine_courante):
        logger.info("Semaine %s déjà présente dans l'historique : rien à faire.", semaine_courante)
        return 0
    logger.warning("Semaine %s absente de l'historique : extraction nécessaire.", semaine_courante)
    return 1


def _commande_build_json(args: argparse.Namespace) -> int:
    config = charger_config(args.config)
    hist = lire_historique(config.chemin_historique)

    latest = construire_latest(hist, config.seuils)
    evolution = construire_evolution(hist)

    for chemin, payload in ((config.chemin_latest_json, latest), (config.chemin_evolution_json, evolution)):
        os.makedirs(os.path.dirname(chemin) or ".", exist_ok=True)
        with open(chemin, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))

    logger.info(
        "data/latest.json (semaine %s, %d region(s)) et data/evolution.json (%d semaine(s)) ecrits",
        latest["semaine_cle"], len(latest["regions"]), len(evolution["semaines"]),
    )
    return 0


def _commande_build_geo(args: argparse.Namespace) -> int:
    config = charger_config(args.config)
    hist = lire_historique(config.chemin_historique)
    if hist.empty:
        logger.error(
            "Historique vide (%s) : lancer `extract` au moins une fois avant build-geo.",
            config.chemin_historique,
        )
        return 1

    client = Dhis2Client.connecter(
        urls_candidates=config.dhis2_urls_candidates,
        username=config.dhis2_username,
        password=config.dhis2_password,
        verify_ssl=config.dhis2_verify_ssl,
    )
    niveau, _ = detecter_niveau_organisation_unit(client, set(hist["district"].unique()))
    contours = charger_contours(
        client, niveau, hist, config.chemin_geo_cache, config.chemin_geo_local,
        forcer_rechargement=args.recharger,
    )

    os.makedirs(os.path.dirname(config.chemin_geo_final) or ".", exist_ok=True)
    districts_enrichis = contours.districts.to_dict("records")
    features = []
    for feature in contours.features:
        d = districts_enrichis[feature["properties"]["d"]]
        features.append({
            "type": "Feature",
            "properties": {"region": d["region"], "district": d["district"], "uid_district": d["uid_district"]},
            "geometry": feature["geometry"],
        })
    with open(config.chemin_geo_final, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh, ensure_ascii=False, separators=(",", ":"))

    logger.info(
        "%s écrit : %d/%d districts avec contour (%d sans contour)",
        config.chemin_geo_final, len(features), len(contours.districts), len(contours.districts_sans_contour),
    )
    return 0


def _commande_migrate_history(args: argparse.Namespace) -> int:
    migre = migrer_historique_legacy(args.input)
    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    migre.to_csv(args.output, index=False, encoding="utf-8-sig")
    logger.info(
        "Historique migré : %d semaine(s), %d lignes -> %s",
        migre["semaine_cle"].nunique(), len(migre), args.output,
    )
    return 0


def construire_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m completude.cli")
    sous_commandes = parser.add_subparsers(dest="commande", required=True)

    cmd_extract = sous_commandes.add_parser(
        "extract", help="Extrait la complétude depuis DHIS2, écrit l'Excel et met à jour l'historique"
    )
    _ajouter_argument_config(cmd_extract)
    cmd_extract.add_argument("--dry-run", action="store_true", help="N'effectue aucun appel réseau réel")
    cmd_extract.add_argument(
        "--mois", type=int, default=None,
        help="Nombre de mois a extraire (mois courant + precedents), surcharge nb_mois_fenetre de la config",
    )
    cmd_extract.set_defaults(func=_commande_extract)

    cmd_check_week = sous_commandes.add_parser(
        "check-week", help="Code de sortie 1 si la semaine courante manque dans l'historique"
    )
    _ajouter_argument_config(cmd_check_week)
    cmd_check_week.set_defaults(func=_commande_check_week)

    cmd_build_json = sous_commandes.add_parser(
        "build-json", help="Génère data/latest.json et data/evolution.json depuis l'historique (pas de réseau)"
    )
    _ajouter_argument_config(cmd_build_json)
    cmd_build_json.set_defaults(func=_commande_build_json)

    cmd_build_geo = sous_commandes.add_parser(
        "build-geo", help="Génère data/geo/districts.geojson (contours), ponctuel, nécessite DHIS2"
    )
    _ajouter_argument_config(cmd_build_geo)
    cmd_build_geo.add_argument(
        "--recharger", action="store_true", help="Force le retéléchargement des contours même si un cache existe"
    )
    cmd_build_geo.set_defaults(func=_commande_build_geo)

    cmd_migrate = sous_commandes.add_parser(
        "migrate-history", help="Convertit un Historique_extractions.csv legacy vers le format semaine_cle"
    )
    cmd_migrate.add_argument("--input", required=True, help="Chemin du CSV legacy (format sans semaine_cle)")
    cmd_migrate.add_argument("--output", required=True, help="Chemin du CSV migré à écrire")
    cmd_migrate.set_defaults(func=_commande_migrate_history)

    return parser


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    parser = construire_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
