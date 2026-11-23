import pandas as pd
from openpyxl import load_workbook

from completude.excel import ecrire_excel
from completude.history import importer_anciennes, lire_historique


def _ecrire(output):
    ecrire_excel(
        {
            "DRS_Tambacounda": pd.DataFrame([
                {"Districts": "Bakel", "Période": "Janvier 2026", "Formulaire A": 69.9, "Formulaire B": 70.0},
                {"Districts": "Bakel", "Période": "Février 2026", "Formulaire A": 89.9, "Formulaire B": 90.0},
                {"Districts": "Bakel", "Période": "Mars 2026", "Formulaire A": 95.0, "Formulaire B": None},
                {"Districts": "Goudiry", "Période": "Janvier 2026", "Formulaire A": 10.0, "Formulaire B": 20.0},
            ])
        },
        str(output),
        seuil_critique=70,
        seuil_conforme=90,
    )


def test_excel_fusionne_les_districts_et_colore_les_taux(tmp_path):
    output = tmp_path / "situation.xlsx"
    _ecrire(output)
    classeur = load_workbook(output)
    sheet = classeur["DRS_Tambacounda"]
    # Bakel apparaît une seule fois, fusionné sur ses trois mois ; Goudiry (un seul mois) n'est pas fusionné.
    assert "A2:A4" in {str(plage) for plage in sheet.merged_cells.ranges}
    assert sheet["A2"].value == "Bakel"
    assert sheet["A5"].value == "Goudiry"
    assert sheet["C2"].value == 69.9
    assert sheet["C2"].number_format == "0.0"
    assert sheet["C2"].fill.fgColor.rgb.endswith("E74C3C")  # critique
    assert sheet["D2"].fill.fgColor.rgb.endswith("F4C20D")  # à surveiller
    assert sheet["D3"].fill.fgColor.rgb.endswith("27AE60")  # conforme
    assert sheet["D4"].value is None  # case non renseignée : grisée, sans valeur
    assert sheet["A4"].border.bottom.style == "medium"  # trait de séparation entre deux districts
    assert sheet.freeze_panes == "C2"
    assert not sheet.sheet_view.showGridLines


def test_excel_commence_par_une_synthese_par_region(tmp_path):
    output = tmp_path / "situation.xlsx"
    _ecrire(output)
    classeur = load_workbook(output)
    assert classeur.sheetnames[0] == "Synthèse"
    synthese = classeur["Synthèse"]
    assert "Complétude des rapports" in synthese["A1"].value
    assert synthese["A6"].value == "Tambacounda"
    assert synthese["B6"].value == 2  # deux districts
    assert synthese["A7"].value == "Ensemble"


def test_excel_fusionne_reste_relisible_par_l_import_automatique(tmp_path):
    dossier = tmp_path / "exports"
    dossier.mkdir()
    _ecrire(dossier / "Situation_completude_par_region_19_10_2026.xlsx")
    hist = importer_anciennes(lire_historique(str(tmp_path / "absent.csv")), str(dossier), {}, "2026-11-23")
    bakel = hist.loc[hist["district"] == "Bakel"]
    assert sorted(bakel["periode"].unique()) == ["Février 2026", "Janvier 2026", "Mars 2026"]
    assert set(hist["region"]) == {"DRS_Tambacounda"}  # la feuille Synthèse est ignorée
