"""Génération de l'Excel de complétude stylé (seuils rouge/orange/vert)."""
from __future__ import annotations

import pandas as pd
from openpyxl import load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

COULEUR_ENTETE = "1F4E78"
COULEUR_LIGNE_ALTERNE = "F2F7F4"
COULEUR_CRITIQUE = "FF0000"
COULEUR_SURVEILLER = "FFC000"
COULEUR_CONFORME = "00B050"


def _police(**kwargs) -> Font:
    return Font(name="Segoe UI", **kwargs)


def _remplissage(couleur: str) -> PatternFill:
    return PatternFill(start_color=couleur, end_color=couleur, fill_type="solid")


def _bordure() -> Border:
    cote = Side(style="thin", color="D9D9D9")
    return Border(left=cote, right=cote, top=cote, bottom=cote)


def ecrire_excel(
    par_region: dict[str, pd.DataFrame],
    chemin_sortie: str,
    seuil_critique: float,
    seuil_conforme: float,
) -> None:
    with pd.ExcelWriter(chemin_sortie, engine="openpyxl") as writer:
        for nom_region, df in par_region.items():
            df.to_excel(writer, sheet_name=nom_region[:31], index=False)

    classeur = load_workbook(chemin_sortie)
    for feuille in classeur.worksheets:
        nb_lignes, nb_colonnes = feuille.max_row, feuille.max_column
        feuille.sheet_view.showGridLines = False
        feuille.sheet_view.zoomScale = 90
        feuille.sheet_properties.tabColor = "16845B"
        feuille.freeze_panes = "C2"
        feuille.auto_filter.ref = feuille.dimensions
        feuille.sheet_properties.pageSetUpPr.fitToPage = True
        feuille.page_setup.orientation = "landscape"
        feuille.page_setup.fitToWidth = 1
        feuille.page_setup.fitToHeight = 0
        feuille.print_title_rows = "1:1"
        feuille.row_dimensions[1].height = 34

        for c in range(1, nb_colonnes + 1):
            cellule = feuille.cell(1, c)
            cellule.font = _police(size=11, bold=True, color="FFFFFF")
            cellule.fill = _remplissage(COULEUR_ENTETE)
            cellule.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cellule.border = _bordure()

        for r in range(2, nb_lignes + 1):
            feuille.row_dimensions[r].height = 20
            for c in range(1, nb_colonnes + 1):
                cellule = feuille.cell(r, c)
                cellule.font = _police(size=10)
                cellule.border = _bordure()
                if r % 2 == 0 and c < 3:
                    cellule.fill = _remplissage(COULEUR_LIGNE_ALTERNE)
                cellule.alignment = Alignment(
                    horizontal="left" if c == 1 else "center",
                    vertical="center",
                    wrap_text=(c == 1),
                )
                if c >= 3 and isinstance(cellule.value, (int, float)):
                    cellule.number_format = "0.0"
                    if cellule.value < seuil_critique:
                        cellule.fill = _remplissage(COULEUR_CRITIQUE)
                        cellule.font = _police(size=10, bold=True, color="FFFFFF")
                    elif cellule.value < seuil_conforme:
                        cellule.fill = _remplissage(COULEUR_SURVEILLER)
                        cellule.font = _police(size=10, bold=True, color="000000")
                    else:
                        cellule.fill = _remplissage(COULEUR_CONFORME)
                        cellule.font = _police(size=10, bold=True, color="FFFFFF")

        for c in range(1, nb_colonnes + 1):
            largeur_max = max(len(str(feuille.cell(r, c).value or "")) for r in range(1, nb_lignes + 1))
            feuille.column_dimensions[get_column_letter(c)].width = min(max(largeur_max + 4, 14), 34)

    classeur.save(chemin_sortie)
