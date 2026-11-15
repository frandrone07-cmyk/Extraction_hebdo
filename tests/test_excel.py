import pandas as pd
from openpyxl import load_workbook

from completude.excel import ecrire_excel


def test_excel_preserves_decimal_status_colors_and_filterable_district_rows(tmp_path):
    output = tmp_path / "situation.xlsx"
    ecrire_excel(
        {
            "Dakar": pd.DataFrame([
                {"Districts": "Pikine", "Période": "Octobre 2026", "Formulaire A": 69.9, "Formulaire B": 70.0},
                {"Districts": "Pikine", "Période": "Septembre 2026", "Formulaire A": 89.9, "Formulaire B": 90.0},
            ])
        },
        str(output),
        seuil_critique=70,
        seuil_conforme=90,
    )

    sheet = load_workbook(output).active
    assert sheet["C2"].value == 69.9
    assert sheet["C2"].number_format == "0.0"
    assert sheet["C2"].fill.fgColor.rgb.endswith("FF0000")
    assert sheet["D2"].fill.fgColor.rgb.endswith("FFC000")
    assert sheet["C3"].fill.fgColor.rgb.endswith("FFC000")
    assert sheet["D3"].fill.fgColor.rgb.endswith("00B050")
    assert sheet["A2"].value == sheet["A3"].value == "Pikine"
    assert sheet.freeze_panes == "C2"
    assert sheet.auto_filter.ref == "A1:D3"
    assert not sheet.sheet_view.showGridLines
