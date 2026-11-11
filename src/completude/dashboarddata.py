"""Construit les fichiers JSON légers consommés par le front-end (`fetch()`),
à partir de l'historique CSV — jamais la géométrie des districts, qui vit à
part dans `data/geo/districts.geojson` (régénérée séparément, rarement).
"""
from __future__ import annotations

from datetime import UTC, datetime

import pandas as pd

from .config import ConfigSeuils


def _statut(valeur: float | None, seuils: ConfigSeuils) -> str:
    if valeur is None or pd.isna(valeur):
        return "inconnu"
    if valeur < seuils.critique:
        return "critique"
    if valeur < seuils.conforme:
        return "surveiller"
    return "conforme"


def construire_latest(hist: pd.DataFrame, seuils: ConfigSeuils) -> dict:
    """Snapshot de la semaine la plus récente : régions -> districts ->
    formulaires -> valeurs par période (une extraction couvre plusieurs mois,
    ne jamais les confondre sous un même "formulaire")."""
    if hist.empty:
        return {
            "genere_le": datetime.now(UTC).isoformat(),
            "semaine_cle": None,
            "seuils": vars(seuils),
            "regions": [],
            "diagnostic": {"formulaires_non_resolus": [], "districts_non_resolus": []},
        }

    semaine_cle = sorted(hist["semaine_cle"].unique())[-1]
    courante = hist[hist["semaine_cle"] == semaine_cle]

    regions = []
    for nom_region in sorted(courante["region"].unique()):
        bloc_region = courante[courante["region"] == nom_region]
        districts = []
        for nom_district in sorted(bloc_region["district"].unique()):
            bloc_district = bloc_region[bloc_region["district"] == nom_district]
            uid = bloc_district["uid_district"].iloc[0] or None
            formulaires = []
            for nom_formulaire in sorted(bloc_district["formulaire"].unique()):
                bloc_formulaire = bloc_district[bloc_district["formulaire"] == nom_formulaire]
                valeurs_periodes = []
                for _, ligne in bloc_formulaire.sort_values("periode_code").iterrows():
                    valeur = None if ligne["valeur"] == "" or pd.isna(ligne["valeur"]) else float(ligne["valeur"])
                    valeurs_periodes.append({
                        "periode_code": ligne["periode_code"],
                        "periode": ligne["periode"],
                        "valeur": valeur,
                        "statut": _statut(valeur, seuils),
                    })
                formulaires.append({"nom": nom_formulaire, "periodes": valeurs_periodes})
            districts.append({"uid": uid, "nom": nom_district, "formulaires": formulaires})
        regions.append({"nom": nom_region, "districts": districts})

    districts_non_resolus = sorted(
        courante.loc[courante["uid_district"].isin(["", None]), "district"].unique()
    )

    return {
        "genere_le": datetime.now(UTC).isoformat(),
        "semaine_cle": semaine_cle,
        "seuils": vars(seuils),
        "regions": regions,
        "diagnostic": {"formulaires_non_resolus": [], "districts_non_resolus": districts_non_resolus},
    }


def construire_snapshots(hist: pd.DataFrame) -> dict:
    """Encode l'historique détaillé en tables compactes pour les filtres web.

    Les libellés sont stockés une seule fois et chaque valeur référence les
    semaines, districts, formulaires et périodes par index. Cela permet au
    tableau de bord de comparer deux lundis sans embarquer un gros JSON répété.
    """
    if hist.empty:
        return {"semaines": [], "regions": [], "districts": [], "formulaires": [], "periodes": [], "lignes": []}

    semaines = sorted(hist["semaine_cle"].dropna().astype(str).unique())
    regions = sorted(hist["region"].dropna().astype(str).unique())
    formulaires = sorted(hist["formulaire"].dropna().astype(str).unique())
    periodes = (
        hist[["periode_code", "periode"]]
        .dropna(subset=["periode_code"])
        .astype({"periode_code": str, "periode": str})
        .drop_duplicates()
        .sort_values("periode_code")
    )
    districts_source = hist[["region", "district", "uid_district"]].dropna(subset=["region", "district"]).copy()
    districts_source["region"] = districts_source["region"].astype(str)
    districts_source["district"] = districts_source["district"].astype(str)
    districts_source["uid_district"] = districts_source["uid_district"].fillna("").astype(str)
    districts_source = districts_source.sort_values(["region", "district", "uid_district"])
    districts = []
    district_index = {}
    for region, district, uid in districts_source.itertuples(index=False, name=None):
        key = (region, district)
        if key not in district_index:
            district_index[key] = len(districts)
            districts.append([regions.index(region), district, uid or None])
        elif uid and not districts[district_index[key]][2]:
            districts[district_index[key]][2] = uid

    semaine_index = {value: i for i, value in enumerate(semaines)}
    formulaire_index = {value: i for i, value in enumerate(formulaires)}
    periode_index = {value: i for i, value in enumerate(periodes["periode_code"].tolist())}
    region_index = {value: i for i, value in enumerate(regions)}
    district_index = {(regions[item[0]], item[1]): i for i, item in enumerate(districts)}
    lignes = []
    for row in hist.itertuples(index=False):
        semaine = str(getattr(row, "semaine_cle"))
        region = str(getattr(row, "region"))
        district = str(getattr(row, "district"))
        formulaire = str(getattr(row, "formulaire"))
        periode_code = str(getattr(row, "periode_code"))
        if any((
            semaine not in semaine_index,
            region not in region_index,
            formulaire not in formulaire_index,
            periode_code not in periode_index,
        )):
            continue
        raw_value = getattr(row, "valeur")
        valeur = None if raw_value == "" or pd.isna(raw_value) else float(raw_value)
        lignes.append([
            semaine_index[semaine],
            district_index[(region, district)],
            formulaire_index[formulaire],
            periode_index[periode_code],
            valeur,
        ])

    return {
        "genere_le": datetime.now(UTC).isoformat(),
        "semaines": semaines,
        "regions": regions,
        "districts": districts,
        "formulaires": formulaires,
        "periodes": periodes[["periode_code", "periode"]].values.tolist(),
        "lignes": lignes,
    }


def _serie_par_semaine(valeurs_par_semaine: dict, semaines: list[str]) -> list[float | None]:
    return [None if pd.isna(valeurs_par_semaine.get(s)) else valeurs_par_semaine.get(s) for s in semaines]


def construire_evolution(hist: pd.DataFrame) -> dict:
    """Séries pour les graphiques d'évolution par lundi :
    - `moyenne_generale` : taux moyen tous indicateurs confondus, par semaine
      (la courbe "évolution du taux moyen" de la vue d'ensemble).
    - `taux_remplissage` : % de cases (district x période x formulaire) avec
      une valeur non vide, par semaine — sert à l'onglet Qualité pour
      détecter une extraction partielle (ex. DHIS2 indisponible pour
      certaines régions ce jour-là).
    - `par_region` : une série par région (moyenne tous formulaires/périodes
      confondus), pour le graphique "Évolution par région".
    - `par_region_formulaire_periode` : une série par (région, formulaire,
      période) — jamais deux mois différents mélangés dans une même série,
      sinon la tendance affichée n'aurait aucun sens.
    """
    if hist.empty:
        return {
            "semaines": [], "moyenne_generale": [], "taux_remplissage": [],
            "par_region": [], "par_region_formulaire_periode": [],
        }

    hist = hist.copy()
    hist["valeur_num"] = pd.to_numeric(hist["valeur"], errors="coerce")
    semaines = sorted(hist["semaine_cle"].unique())

    moyenne_par_semaine = hist.groupby("semaine_cle")["valeur_num"].mean().round(1)
    moyenne_generale = _serie_par_semaine(moyenne_par_semaine, semaines)

    remplissage_par_semaine = (hist.groupby("semaine_cle")["valeur_num"].apply(lambda s: s.notna().mean() * 100).round(1))
    taux_remplissage = _serie_par_semaine(remplissage_par_semaine, semaines)

    agrege_region = hist.groupby(["region", "semaine_cle"])["valeur_num"].mean().round(1).reset_index()
    par_region = []
    for region, groupe in agrege_region.groupby("region"):
        serie = dict(zip(groupe["semaine_cle"], groupe["valeur_num"]))
        par_region.append({"region": region, "valeurs": _serie_par_semaine(serie, semaines)})

    agrege = (
        hist.groupby(["region", "formulaire", "periode_code", "periode", "semaine_cle"])["valeur_num"]
        .mean()
        .round(1)
        .reset_index()
    )
    par_region_formulaire_periode = []
    for (region, formulaire, periode_code, periode), groupe in agrege.groupby(
        ["region", "formulaire", "periode_code", "periode"]
    ):
        serie = dict(zip(groupe["semaine_cle"], groupe["valeur_num"]))
        par_region_formulaire_periode.append({
            "region": region,
            "formulaire": formulaire,
            "periode_code": periode_code,
            "periode": periode,
            "valeurs": _serie_par_semaine(serie, semaines),
        })

    return {
        "semaines": semaines,
        "moyenne_generale": moyenne_generale,
        "taux_remplissage": taux_remplissage,
        "par_region": par_region,
        "par_region_formulaire_periode": par_region_formulaire_periode,
    }
