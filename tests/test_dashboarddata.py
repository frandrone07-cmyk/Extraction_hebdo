import pandas as pd

from completude.config import ConfigSeuils
from completude.dashboarddata import construire_evolution, construire_latest

SEUILS = ConfigSeuils(critique=70, conforme=90, baisse=5)


def _hist(lignes):
    colonnes = ["date_extraction", "semaine_cle", "region", "district", "uid_district", "periode_code", "periode", "formulaire", "valeur"]
    return pd.DataFrame(lignes, columns=colonnes)


def test_construire_latest_prend_la_semaine_la_plus_recente():
    hist = _hist([
        {"date_extraction": "2026-11-02", "semaine_cle": "2026-11-02", "region": "Dakar", "district": "Pikine",
         "uid_district": "OUA", "periode_code": "202610", "periode": "Octobre 2026", "formulaire": "PEV", "valeur": 50.0},
        {"date_extraction": "2026-11-09", "semaine_cle": "2026-11-09", "region": "Dakar", "district": "Pikine",
         "uid_district": "OUA", "periode_code": "202610", "periode": "Octobre 2026", "formulaire": "PEV", "valeur": 95.0},
    ])
    latest = construire_latest(hist, SEUILS)

    assert latest["semaine_cle"] == "2026-11-09"
    assert len(latest["regions"]) == 1
    district = latest["regions"][0]["districts"][0]
    assert district["nom"] == "Pikine"
    periode = district["formulaires"][0]["periodes"][0]
    assert periode["valeur"] == 95.0
    assert periode["statut"] == "conforme"


def test_construire_latest_ne_confond_pas_deux_periodes_du_meme_formulaire():
    # Une seule extraction couvre plusieurs mois (mois courant + precedents) :
    # les deux lignes doivent rester deux entrees "periodes" distinctes, pas
    # ecrasees/fusionnees sous le meme formulaire.
    hist = _hist([
        {"date_extraction": "2026-11-09", "semaine_cle": "2026-11-09", "region": "Dakar", "district": "Pikine",
         "uid_district": "OUA", "periode_code": "202609", "periode": "Septembre 2026", "formulaire": "PEV", "valeur": 60.0},
        {"date_extraction": "2026-11-09", "semaine_cle": "2026-11-09", "region": "Dakar", "district": "Pikine",
         "uid_district": "OUA", "periode_code": "202610", "periode": "Octobre 2026", "formulaire": "PEV", "valeur": 90.0},
    ])
    latest = construire_latest(hist, SEUILS)
    district = latest["regions"][0]["districts"][0]
    assert len(district["formulaires"]) == 1  # un seul formulaire "PEV"
    periodes = district["formulaires"][0]["periodes"]
    assert [p["periode_code"] for p in periodes] == ["202609", "202610"]  # triees, toutes presentes
    assert [p["valeur"] for p in periodes] == [60.0, 90.0]


def test_construire_latest_statuts_par_seuil():
    hist = _hist([
        {"date_extraction": "2026-11-09", "semaine_cle": "2026-11-09", "region": "Dakar", "district": "A",
         "uid_district": "OUA", "periode_code": "202610", "periode": "Octobre 2026", "formulaire": "PEV", "valeur": 50.0},
        {"date_extraction": "2026-11-09", "semaine_cle": "2026-11-09", "region": "Dakar", "district": "B",
         "uid_district": "OUB", "periode_code": "202610", "periode": "Octobre 2026", "formulaire": "PEV", "valeur": 80.0},
        {"date_extraction": "2026-11-09", "semaine_cle": "2026-11-09", "region": "Dakar", "district": "C",
         "uid_district": "OUC", "periode_code": "202610", "periode": "Octobre 2026", "formulaire": "PEV", "valeur": None},
    ])
    latest = construire_latest(hist, SEUILS)
    statuts = {d["nom"]: d["formulaires"][0]["periodes"][0]["statut"] for d in latest["regions"][0]["districts"]}
    assert statuts == {"A": "critique", "B": "surveiller", "C": "inconnu"}


def test_construire_latest_signale_districts_sans_uid():
    hist = _hist([
        {"date_extraction": "2026-11-09", "semaine_cle": "2026-11-09", "region": "Dakar", "district": "District fantome",
         "uid_district": "", "periode_code": "202610", "periode": "Octobre 2026", "formulaire": "PEV", "valeur": 50.0},
    ])
    latest = construire_latest(hist, SEUILS)
    assert latest["diagnostic"]["districts_non_resolus"] == ["District fantome"]


def test_construire_latest_historique_vide():
    latest = construire_latest(_hist([]), SEUILS)
    assert latest["semaine_cle"] is None
    assert latest["regions"] == []


def test_construire_evolution_moyenne_generale_par_semaine():
    hist = _hist([
        {"date_extraction": "2026-11-02", "semaine_cle": "2026-11-02", "region": "Dakar", "district": "Pikine",
         "uid_district": "OUA", "periode_code": "202610", "periode": "Octobre 2026", "formulaire": "PEV", "valeur": 50.0},
        {"date_extraction": "2026-11-02", "semaine_cle": "2026-11-02", "region": "Dakar", "district": "Pikine",
         "uid_district": "OUA", "periode_code": "202610", "periode": "Octobre 2026", "formulaire": "Paludisme", "valeur": 70.0},
        {"date_extraction": "2026-11-09", "semaine_cle": "2026-11-09", "region": "Dakar", "district": "Pikine",
         "uid_district": "OUA", "periode_code": "202610", "periode": "Octobre 2026", "formulaire": "PEV", "valeur": 90.0},
    ])
    evolution = construire_evolution(hist)
    assert evolution["semaines"] == ["2026-11-02", "2026-11-09"]
    assert evolution["moyenne_generale"] == [60.0, 90.0]  # (50+70)/2 puis 90


def test_construire_evolution_ne_confond_pas_deux_periodes():
    hist = _hist([
        {"date_extraction": "2026-11-09", "semaine_cle": "2026-11-09", "region": "Dakar", "district": "Pikine",
         "uid_district": "OUA", "periode_code": "202609", "periode": "Septembre 2026", "formulaire": "PEV", "valeur": 60.0},
        {"date_extraction": "2026-11-09", "semaine_cle": "2026-11-09", "region": "Dakar", "district": "Pikine",
         "uid_district": "OUA", "periode_code": "202610", "periode": "Octobre 2026", "formulaire": "PEV", "valeur": 90.0},
    ])
    evolution = construire_evolution(hist)
    series = evolution["par_region_formulaire_periode"]
    assert len(series) == 2  # une serie par periode, pas une serie fusionnee
    valeurs = {s["periode_code"]: s["valeurs"][0] for s in series}
    assert valeurs == {"202609": 60.0, "202610": 90.0}


def test_construire_evolution_semaine_sans_donnee_pour_une_serie_est_none():
    hist = _hist([
        {"date_extraction": "2026-11-02", "semaine_cle": "2026-11-02", "region": "Dakar", "district": "Pikine",
         "uid_district": "OUA", "periode_code": "202610", "periode": "Octobre 2026", "formulaire": "PEV", "valeur": 50.0},
        {"date_extraction": "2026-11-09", "semaine_cle": "2026-11-09", "region": "Dakar", "district": "Pikine",
         "uid_district": "OUA", "periode_code": "202610", "periode": "Octobre 2026", "formulaire": "Paludisme", "valeur": 80.0},
    ])
    evolution = construire_evolution(hist)
    serie_pev = next(s for s in evolution["par_region_formulaire_periode"] if s["formulaire"] == "PEV")
    assert serie_pev["valeurs"] == [50.0, None]


def test_construire_evolution_historique_vide():
    evolution = construire_evolution(_hist([]))
    assert evolution == {"semaines": [], "moyenne_generale": [], "par_region_formulaire_periode": []}
