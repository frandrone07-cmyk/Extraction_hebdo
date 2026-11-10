"""Chargement des contours (GeoJSON) des districts pour la carte.

Priorité : fichier local versionné > cache téléchargé > API DHIS2
(organisationUnits.geojson, puis organisationUnits.json avec geometry).
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass

import pandas as pd

from .dhis2 import Dhis2Client
from .periodes import norm

logger = logging.getLogger(__name__)


def _arrondir(coords, decimales: int = 4):
    if isinstance(coords, (int, float)):
        return round(coords, decimales)
    return [_arrondir(c, decimales) for c in coords]


def _nom_feature(proprietes: dict) -> str:
    for cle in ("name", "displayName", "NAME", "Name", "NOM", "nom", "district", "District", "ADM2_FR", "ADM2_EN"):
        if proprietes.get(cle):
            return str(proprietes[cle])
    return ""


def _brut_depuis_dhis2(client: Dhis2Client, niveau: int) -> list[dict]:
    features: list[dict] = []
    try:
        reponse = client.session.get(
            f"{client.base_url}/api/organisationUnits.geojson",
            params={"level": niveau, "paging": "false"},
            timeout=240,
        )
        if reponse.status_code == 200:
            for f in reponse.json().get("features", []):
                proprietes, geometrie = f.get("properties", {}) or {}, f.get("geometry")
                if geometrie and geometrie.get("type"):
                    features.append({
                        "id": proprietes.get("id") or f.get("id") or "",
                        "name": _nom_feature(proprietes),
                        "geometry": geometrie,
                    })
    except Exception:
        logger.warning("Endpoint organisationUnits.geojson indisponible", exc_info=True)

    if features:
        return features

    try:
        reponse = client.session.get(
            f"{client.base_url}/api/organisationUnits.json",
            params={"fields": "id,displayName,geometry", "level": niveau, "paging": "false"},
            timeout=240,
        )
        if reponse.status_code == 200:
            for ou in reponse.json().get("organisationUnits", []):
                geometrie = ou.get("geometry")
                if isinstance(geometrie, dict) and geometrie.get("type"):
                    features.append({"id": ou["id"], "name": ou.get("displayName", ""), "geometry": geometrie})
    except Exception:
        logger.warning("Lecture organisationUnits.json avec geometry impossible", exc_info=True)
    return features


@dataclass
class ContoursCharges:
    districts: pd.DataFrame  # colonnes region, district, uid_district
    features: list[dict]     # GeoJSON Feature, properties.d = index dans `districts`
    districts_sans_contour: list[str]


def charger_contours(
    client: Dhis2Client,
    niveau: int,
    historique: pd.DataFrame,
    chemin_cache: str,
    chemin_local: str,
    forcer_rechargement: bool = False,
) -> ContoursCharges:
    districts = (
        historique[["region", "district", "uid_district"]]
        .drop_duplicates(["region", "district"])
        .reset_index(drop=True)
    )

    brut: list[dict] = []
    chemins_a_essayer = [chemin_local] if os.path.exists(chemin_local) else []
    if not forcer_rechargement:
        chemins_a_essayer = chemins_a_essayer + [chemin_cache]
    for chemin in chemins_a_essayer:
        if os.path.exists(chemin):
            try:
                with open(chemin, encoding="utf-8") as fh:
                    geojson = json.load(fh)
                for f in geojson.get("features", []):
                    proprietes = f.get("properties", {}) or {}
                    if f.get("geometry"):
                        brut.append({
                            "id": proprietes.get("id") or proprietes.get("uid") or "",
                            "name": _nom_feature(proprietes),
                            "geometry": f["geometry"],
                        })
                if brut:
                    logger.info("Contours lus depuis %s (%d entités)", chemin, len(brut))
                    break
            except Exception:
                logger.warning("Contours illisibles dans %s", chemin, exc_info=True)

    if not brut:
        brut = _brut_depuis_dhis2(client, niveau)
        if brut:
            for b in brut:
                b["geometry"]["coordinates"] = _arrondir(b["geometry"]["coordinates"])
            os.makedirs(os.path.dirname(chemin_cache) or ".", exist_ok=True)
            with open(chemin_cache, "w", encoding="utf-8") as fh:
                json.dump(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "properties": {"id": b["id"], "name": b["name"]},
                                "geometry": b["geometry"],
                            }
                            for b in brut
                        ],
                    },
                    fh,
                    ensure_ascii=False,
                )
            logger.info(
                "Contours téléchargés depuis DHIS2 (%d entités), mis en cache dans %s",
                len(brut), chemin_cache,
            )

    par_uid = {uid: i for i, uid in enumerate(districts["uid_district"]) if uid}
    comptes_noms = districts["district"].map(norm).value_counts()
    par_nom = {norm(n): i for i, n in enumerate(districts["district"]) if comptes_noms[norm(n)] == 1}

    features, vus = [], set()
    for b in brut:
        i = par_uid.get(b["id"], par_nom.get(norm(b["name"])))
        if i is None or i in vus:
            continue
        vus.add(i)
        geometrie = {"type": b["geometry"]["type"], "coordinates": _arrondir(b["geometry"]["coordinates"])}
        features.append({"type": "Feature", "properties": {"d": int(i)}, "geometry": geometrie})

    districts_sans_contour = [districts.loc[i, "district"] for i in range(len(districts)) if i not in vus]
    logger.info("%d/%d districts reliés à un contour", len(features), len(districts))
    if districts_sans_contour:
        logger.warning("Districts sans contour : %s", ", ".join(sorted(districts_sans_contour)))

    return ContoursCharges(districts, features, districts_sans_contour)
