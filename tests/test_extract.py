from datetime import date

import openpyxl
import pandas as pd
import pytest

from completude.extract import UidResolver, cols_districts_periode, extraire

# ----------------------------- UidResolver -----------------------------

@pytest.fixture
def resolveur():
    return UidResolver(
        datasets_par_nom={"paludisme": "DS1", "pev": "DS2"},
        districts_par_nom={"district de pikine": "OUA", "district de guediawaye": "OUB"},
        niveau_organisation_unit=3,
    )


def test_resoudre_formulaire_correspondance_exacte(resolveur):
    assert resolveur.resoudre_formulaire("Paludisme - Reporting rate") == "DS1.REPORTING_RATE"


def test_resoudre_formulaire_avec_prefixe_r_num(resolveur):
    assert resolveur.resoudre_formulaire("R12_PEV - Reporting rate") == "DS2.REPORTING_RATE"


def test_resoudre_formulaire_sous_chaine_approchante(resolveur):
    assert resolveur.resoudre_formulaire("Paludisme simple - Reporting rate") == "DS1.REPORTING_RATE"


def test_resoudre_formulaire_sans_correspondance_renvoie_none(resolveur):
    assert resolveur.resoudre_formulaire("Tuberculose - Reporting rate") is None


def test_resoudre_district_correspondance_exacte(resolveur):
    assert resolveur.resoudre_district("District de Pikine") == "OUA"


def test_resoudre_district_ambigu_renvoie_none():
    # "Pikine" matcherait deux districts à la fois -> refus, pas de choix arbitraire.
    r = UidResolver(
        datasets_par_nom={},
        districts_par_nom={"district de pikine": "OUA", "pikine nord": "OUB"},
        niveau_organisation_unit=3,
    )
    assert r.resoudre_district("Pikine") is None


def test_cols_districts_periode_detecte_les_entetes():
    df = pd.DataFrame(columns=["Districts", "Période", "Paludisme - Reporting rate"])
    assert cols_districts_periode(df) == ("Districts", "Période")


# ----------------------------- extraire() (intégration) -----------------------------

class FakeDhis2Client:
    """Double de Dhis2Client : pas de réseau, réponses DHIS2 canned."""

    def __init__(self):
        self.appels_analytics = []

    def api(self, path, **params):
        if path == "dataSets.json":
            return {"dataSets": [
                {"id": "DS1", "displayName": "Paludisme"},
                {"id": "DS2", "displayName": "PEV"},
            ]}
        if path == "organisationUnits.json":
            niveau = params["level"]
            if niveau == 3:
                return {"organisationUnits": [
                    {"id": "OUA", "displayName": "District de Pikine"},
                    {"id": "OUB", "displayName": "District de Guediawaye"},
                ]}
            return {"organisationUnits": []}
        if path == "analytics.json":
            self.appels_analytics.append(params)
            return {
                "headers": [{"name": "dx"}, {"name": "ou"}, {"name": "pe"}, {"name": "value"}],
                "rows": [
                    ["DS1.REPORTING_RATE", "OUA", "202607", "92.3"],
                    ["DS2.REPORTING_RATE", "OUA", "202607", "88.0"],
                    ["DS1.REPORTING_RATE", "OUB", "202607", "55.5"],
                    # PEV manquant pour Guediawaye : simule une case non renseignée
                ],
            }
        raise AssertionError(f"Appel API inattendu : {path}")


def _ecrire_gabarit(chemin):
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    feuille.title = "Dakar"
    feuille.append(["Districts", "Période", "Paludisme - Reporting rate", "PEV - Reporting rate"])
    feuille.append(["District de Pikine", "Juillet 2026", None, None])
    feuille.append(["District de Guediawaye", "Juillet 2026", None, None])
    classeur.save(chemin)


def _ecrire_gabarit_periodes(chemin, periodes):
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    feuille.title = "Dakar"
    feuille.append(["Districts", "Période", "Paludisme - Reporting rate"])
    for periode in periodes:
        feuille.append(["District de Pikine", periode, None])
    classeur.save(chemin)


def test_extraire_remplit_les_valeurs_et_signale_les_cases_manquantes(tmp_path):
    chemin_gabarit = tmp_path / "gabarit.xlsx"
    _ecrire_gabarit(chemin_gabarit)
    client = FakeDhis2Client()

    resultat = extraire(
        client=client,
        chemin_gabarit=str(chemin_gabarit),
        nb_mois_fenetre=3,
        date_reference=date(2026, 7, 15),
    )

    df = resultat.par_region["Dakar"]
    pikine = df[df["Districts"] == "District de Pikine"].iloc[0]
    assert pikine["Paludisme - Reporting rate"] == 92.3
    assert pikine["PEV - Reporting rate"] == 88.0
    assert pikine["Période"] == "Juillet 2026"

    guediawaye = df[df["Districts"] == "District de Guediawaye"].iloc[0]
    assert guediawaye["Paludisme - Reporting rate"] == 55.5
    assert pd.isna(guediawaye["PEV - Reporting rate"])  # case non renseignée côté DHIS2, pas une erreur

    assert resultat.formulaires_non_resolus == set()
    assert resultat.districts_non_resolus == set()
    assert resultat.uid_district[("Dakar", "District de Pikine")] == "OUA"
    assert len(resultat.diagnostics) == 1
    assert resultat.diagnostics[0].valeurs_recuperees == 3


def test_extraire_ajoute_la_periode_courante_a_partir_du_15(tmp_path):
    chemin_gabarit = tmp_path / "gabarit.xlsx"
    _ecrire_gabarit_periodes(chemin_gabarit, ["Septembre 2026", "Octobre 2026"])

    avant_le_15 = extraire(
        client=FakeDhis2Client(),
        chemin_gabarit=str(chemin_gabarit),
        nb_mois_fenetre=3,
        date_reference=date(2026, 10, 14),
    )
    a_partir_du_15 = extraire(
        client=FakeDhis2Client(),
        chemin_gabarit=str(chemin_gabarit),
        nb_mois_fenetre=3,
        date_reference=date(2026, 10, 15),
    )

    periodes_avant = set(avant_le_15.par_region["Dakar"]["Période"])
    periodes_apres = set(a_partir_du_15.par_region["Dakar"]["Période"])
    assert periodes_avant == {"Septembre 2026"}
    assert periodes_apres == {"Septembre 2026", "Octobre 2026"}


def test_extraire_rattrape_les_mois_disponibles_absents_du_gabarit(tmp_path):
    chemin_gabarit = tmp_path / "gabarit.xlsx"
    _ecrire_gabarit_periodes(chemin_gabarit, ["Septembre 2026", "Novembre 2026"])

    resultat = extraire(
        client=FakeDhis2Client(),
        chemin_gabarit=str(chemin_gabarit),
        nb_mois_fenetre=3,
        date_reference=date(2026, 12, 15),
    )

    assert set(resultat.par_region["Dakar"]["Période"]) == {
        "Septembre 2026", "Octobre 2026", "Novembre 2026", "Décembre 2026",
    }


def test_extraire_colonne_sans_formulaire_correspondant_est_signalee(tmp_path):
    chemin_gabarit = tmp_path / "gabarit.xlsx"
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    feuille.title = "Dakar"
    feuille.append(["Districts", "Période", "Tuberculose - Reporting rate"])
    feuille.append(["District de Pikine", "Juillet 2026", None])
    classeur.save(chemin_gabarit)

    resultat = extraire(
        client=FakeDhis2Client(),
        chemin_gabarit=str(chemin_gabarit),
        nb_mois_fenetre=3,
        date_reference=date(2026, 7, 15),
    )

    assert "Tuberculose - Reporting rate" in resultat.formulaires_non_resolus
    # Aucune formule DHIS2 résolue -> aucun appel Analytics n'a dû être tenté
    assert resultat.diagnostics[0].valeurs_recuperees == 0
