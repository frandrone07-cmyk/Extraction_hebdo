"""Chargement de la configuration (config/config.yml) et des identifiants (.env)."""
from __future__ import annotations

import os
from dataclasses import dataclass

import yaml


@dataclass
class ConfigSeuils:
    critique: float
    conforme: float
    baisse: float


@dataclass
class Config:
    dhis2_urls_candidates: list[str]
    dhis2_verify_ssl: bool
    chemin_gabarit: str
    chemin_sortie_dir: str
    chemin_historique: str
    chemin_geo_cache: str
    chemin_geo_local: str
    chemin_geo_final: str
    chemin_latest_json: str
    chemin_evolution_json: str
    seuils: ConfigSeuils
    nb_mois_fenetre: int
    nb_extractions_detail: int
    dates_a_exclure: list[str]

    @property
    def dhis2_username(self) -> str:
        return _env_requis("DHIS2_USER")

    @property
    def dhis2_password(self) -> str:
        return _env_requis("DHIS2_PASSWORD")


def _env_requis(nom: str) -> str:
    valeur = os.environ.get(nom)
    if not valeur:
        raise RuntimeError(
            f"Variable d'environnement {nom} manquante. "
            "Copier .env.example en .env et la renseigner, ou la définir en secret CI."
        )
    return valeur


def charger_config(chemin_yaml: str) -> Config:
    with open(chemin_yaml, encoding="utf-8") as fh:
        brut = yaml.safe_load(fh)

    verify_ssl_env = os.environ.get("DHIS2_VERIFY_SSL")
    verify_ssl = (
        verify_ssl_env.lower() not in ("false", "0", "non")
        if verify_ssl_env is not None
        else bool(brut["dhis2"].get("verify_ssl", True))
    )

    return Config(
        dhis2_urls_candidates=brut["dhis2"]["urls_candidates"],
        dhis2_verify_ssl=verify_ssl,
        chemin_gabarit=brut["chemins"]["gabarit"],
        chemin_sortie_dir=brut["chemins"]["sortie_dir"],
        chemin_historique=brut["chemins"]["historique"],
        chemin_geo_cache=brut["chemins"]["geo_cache"],
        chemin_geo_local=brut["chemins"]["geo_local"],
        chemin_geo_final=brut["chemins"]["geo_final"],
        chemin_latest_json=brut["chemins"]["latest_json"],
        chemin_evolution_json=brut["chemins"]["evolution_json"],
        seuils=ConfigSeuils(**brut["seuils"]),
        nb_mois_fenetre=int(brut["extraction"]["nb_mois_fenetre"]),
        nb_extractions_detail=int(brut["dashboard"]["nb_extractions_detail"]),
        dates_a_exclure=list(brut["extraction"].get("dates_a_exclure") or []),
    )
