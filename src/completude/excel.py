"""Génération de l'Excel de complétude : une feuille de synthèse puis une feuille par région.

Feuilles régionales : en-tête sur la première ligne (format relu par history.importer_anciennes), districts
fusionnés sur toutes leurs lignes de mois (ex. « Bakel » une seule fois de janvier à octobre), blocs de district
séparés, taux colorés selon les seuils (rouge < critique, orange < conforme, vert sinon).
"""
from __future__ import annotations

from datetime import date

import pandas as pd
from openpyxl import load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

FEUILLE_SYNTHESE = "Synthèse"
COULEUR_ENTETE = "0F4C5C"
COULEUR_TITRE = "0B3B47"
COULEUR_BLOC_A = "F3F8F6"
COULEUR_BLOC_B = "FFFFFF"
COULEUR_SEPARATEUR = "2F6B5D"
COULEUR_CRITIQUE = "E74C3C"
COULEUR_SURVEILLER = "F4C20D"  # jaune (texte sombre posé dessus)
COULEUR_CONFORME = "27AE60"
COULEUR_VIDE = "ECEFF1"
TEXTE_SOMBRE = "1F2D2B"


def _police(**kwargs) -> Font:
    return Font(name="Segoe UI", **kwargs)


def _remplissage(couleur: str) -> PatternFill:
    return PatternFill(start_color=couleur, end_color=couleur, fill_type="solid")


def _bordure(bas: Side | None = None) -> Border:
    cote = Side(style="thin", color="D5DDDA")
    return Border(left=cote, right=cote, top=cote, bottom=bas or cote)


def _statut(valeur: float, seuil_critique: float, seuil_conforme: float) -> tuple[str, str]:
    """(couleur de fond, couleur du texte) selon les seuils."""
    if valeur < seuil_critique:
        return COULEUR_CRITIQUE, "FFFFFF"
    if valeur < seuil_conforme:
        return COULEUR_SURVEILLER, TEXTE_SOMBRE
    return COULEUR_CONFORME, "FFFFFF"


def _colorer_taux(cellule, seuil_critique: float, seuil_conforme: float, taille: int = 10) -> None:
    cellule.number_format = "0.0"
    fond, texte = _statut(cellule.value, seuil_critique, seuil_conforme)
    cellule.fill = _remplissage(fond)
    cellule.font = _police(size=taille, bold=True, color=texte)


def _mettre_en_forme_region(feuille, seuil_critique: float, seuil_conforme: float) -> None:
    nb_lignes, nb_colonnes = feuille.max_row, feuille.max_column
    feuille.sheet_view.showGridLines = False
    feuille.sheet_view.zoomScale = 90
    feuille.sheet_properties.tabColor = "16845B"
    feuille.freeze_panes = "C2"
    feuille.sheet_properties.pageSetUpPr.fitToPage = True
    feuille.page_setup.orientation = "landscape"
    feuille.page_setup.fitToWidth = 1
    feuille.page_setup.fitToHeight = 0
    feuille.print_title_rows = "1:1"
    feuille.row_dimensions[1].height = 66

    for c in range(1, nb_colonnes + 1):
        cellule = feuille.cell(1, c)
        cellule.font = _police(size=10, bold=True, color="FFFFFF")
        cellule.fill = _remplissage(COULEUR_ENTETE)
        cellule.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cellule.border = _bordure()

    # Blocs de lignes consécutives d'un même district : fusionnés dans la colonne A.
    blocs, debut = [], 2
    for r in range(3, nb_lignes + 2):
        if r > nb_lignes or feuille.cell(r, 1).value != feuille.cell(debut, 1).value:
            blocs.append((debut, r - 1))
            debut = r
    separateur = Side(style="medium", color=COULEUR_SEPARATEUR)
    for numero, (premiere, derniere) in enumerate(blocs):
        fond = COULEUR_BLOC_A if numero % 2 == 0 else COULEUR_BLOC_B
        # Fusion d'abord : openpyxl recopie les bordures au moment de la fusion, le trait de séparation vient après.
        if derniere > premiere:
            feuille.merge_cells(start_row=premiere, start_column=1, end_row=derniere, end_column=1)
        for r in range(premiere, derniere + 1):
            feuille.row_dimensions[r].height = 20
            bas = separateur if r == derniere else None
            for c in range(1, nb_colonnes + 1):
                cellule = feuille.cell(r, c)
                # Cellule fusionnée du district : Excel dessine le bord extérieur d'après la première cellule.
                cellule.border = _bordure(separateur if (c == 1 and derniere > premiere) else bas)
                if c <= 2:
                    cellule.fill = _remplissage(fond)
                    cellule.font = _police(size=10, bold=(c == 1), color=TEXTE_SOMBRE)
                    cellule.alignment = Alignment(horizontal="left" if c == 1 else "center", vertical="center", wrap_text=(c == 1))
                elif isinstance(cellule.value, (int, float)) and not pd.isna(cellule.value):
                    cellule.alignment = Alignment(horizontal="center", vertical="center")
                    _colorer_taux(cellule, seuil_critique, seuil_conforme)
                else:
                    cellule.value = None
                    cellule.fill = _remplissage(COULEUR_VIDE)

    feuille.column_dimensions["A"].width = 26
    feuille.column_dimensions["B"].width = 16
    for c in range(3, nb_colonnes + 1):
        feuille.column_dimensions[get_column_letter(c)].width = 15


def _moyennes_districts(df: pd.DataFrame) -> pd.Series:
    """Taux moyen de chaque district (tous mois et formulaires confondus)."""
    valeurs = df.iloc[:, 2:].apply(pd.to_numeric, errors="coerce")
    return valeurs.groupby(df.iloc[:, 0]).apply(lambda bloc: bloc.stack().mean()).dropna()


def _ecrire_synthese(
    classeur, par_region: dict[str, pd.DataFrame], seuil_critique: float, seuil_conforme: float, date_extraction: date | None
) -> None:
    feuille = classeur.create_sheet(FEUILLE_SYNTHESE, 0)
    feuille.sheet_view.showGridLines = False
    feuille.sheet_properties.tabColor = COULEUR_TITRE
    for colonne, largeur in zip("ABCDEF", (26, 12, 16, 18, 16, 14)):
        feuille.column_dimensions[colonne].width = largeur

    feuille.merge_cells("A1:F1")
    titre = feuille["A1"]
    titre.value = "Complétude des rapports DHIS2 · situation par région"
    titre.font = _police(size=18, bold=True, color="FFFFFF")
    titre.fill = _remplissage(COULEUR_TITRE)
    titre.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    feuille.row_dimensions[1].height = 42

    periodes = [p for df in par_region.values() for p in df.iloc[:, 1].dropna().astype(str).unique()]
    mois = f"{periodes[0]} à {periodes[-1]}" if periodes else "—"
    feuille.merge_cells("A2:F2")
    feuille["A2"].value = (
        f"Extraction du {date_extraction:%d/%m/%Y} · mois couverts : {mois}" if date_extraction else f"Mois couverts : {mois}"
    )
    feuille["A2"].font = _police(size=11, color="4A5F5A")
    feuille["A2"].alignment = Alignment(horizontal="left", vertical="center", indent=1)
    feuille.row_dimensions[2].height = 24

    legendes = [
        (f"< {seuil_critique:g} % : critique", COULEUR_CRITIQUE, "FFFFFF"),
        (f"{seuil_critique:g} à {seuil_conforme:g} % : à surveiller", COULEUR_SURVEILLER, TEXTE_SOMBRE),
        (f"≥ {seuil_conforme:g} % : conforme", COULEUR_CONFORME, "FFFFFF"),
    ]
    for (texte, fond, couleur), (debut, fin) in zip(legendes, (("A", "B"), ("C", "D"), ("E", "F"))):
        feuille.merge_cells(f"{debut}3:{fin}3")
        cellule = feuille[f"{debut}3"]
        cellule.value = texte
        cellule.fill = _remplissage(fond)
        cellule.font = _police(size=10, bold=True, color=couleur)
        cellule.alignment = Alignment(horizontal="center", vertical="center")
    feuille.row_dimensions[3].height = 22

    entetes = ["Région", "Districts", "Taux moyen des mois couverts (%)", "Districts critiques", "À surveiller", "Conformes"]
    for c, texte in enumerate(entetes, start=1):
        cellule = feuille.cell(5, c, texte)
        cellule.font = _police(size=10, bold=True, color="FFFFFF")
        cellule.fill = _remplissage(COULEUR_ENTETE)
        cellule.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cellule.border = _bordure()
    feuille.row_dimensions[5].height = 32

    ligne = 6
    toutes = []
    for nom_region, df in par_region.items():
        moyennes = _moyennes_districts(df)
        toutes.extend(moyennes.tolist())
        valeurs = [
            nom_region.replace("DRS_", "").replace("_", " "),
            len(moyennes),
            round(float(moyennes.mean()), 1) if len(moyennes) else None,
            int((moyennes < seuil_critique).sum()),
            int(((moyennes >= seuil_critique) & (moyennes < seuil_conforme)).sum()),
            int((moyennes >= seuil_conforme).sum()),
        ]
        fond = COULEUR_BLOC_A if ligne % 2 == 0 else COULEUR_BLOC_B
        for c, valeur in enumerate(valeurs, start=1):
            cellule = feuille.cell(ligne, c, valeur)
            cellule.border = _bordure()
            cellule.alignment = Alignment(horizontal="left" if c == 1 else "center", vertical="center")
            cellule.font = _police(size=10, bold=(c == 1), color=TEXTE_SOMBRE)
            cellule.fill = _remplissage(fond)
        if valeurs[2] is not None:
            _colorer_taux(feuille.cell(ligne, 3), seuil_critique, seuil_conforme)
        feuille.row_dimensions[ligne].height = 20
        ligne += 1

    if toutes:
        serie = pd.Series(toutes)
        total = ["Ensemble", len(serie), round(float(serie.mean()), 1), int((serie < seuil_critique).sum()),
                 int(((serie >= seuil_critique) & (serie < seuil_conforme)).sum()), int((serie >= seuil_conforme).sum())]
        for c, valeur in enumerate(total, start=1):
            cellule = feuille.cell(ligne, c, valeur)
            cellule.font = _police(size=11, bold=True, color="FFFFFF")
            cellule.fill = _remplissage(COULEUR_TITRE)
            cellule.alignment = Alignment(horizontal="left" if c == 1 else "center", vertical="center")
            cellule.border = _bordure()
        _colorer_taux(feuille.cell(ligne, 3), seuil_critique, seuil_conforme, taille=11)
        feuille.row_dimensions[ligne].height = 24
    feuille.freeze_panes = "A6"
    feuille.page_setup.orientation = "portrait"
    feuille.sheet_properties.pageSetUpPr.fitToPage = True


def ecrire_excel(
    par_region: dict[str, pd.DataFrame],
    chemin_sortie: str,
    seuil_critique: float,
    seuil_conforme: float,
    date_extraction: date | None = None,
) -> None:
    with pd.ExcelWriter(chemin_sortie, engine="openpyxl") as writer:
        for nom_region, df in par_region.items():
            df.to_excel(writer, sheet_name=nom_region[:31], index=False)

    classeur = load_workbook(chemin_sortie)
    for feuille in classeur.worksheets:
        _mettre_en_forme_region(feuille, seuil_critique, seuil_conforme)
    _ecrire_synthese(classeur, par_region, seuil_critique, seuil_conforme, date_extraction)
    classeur.active = 0
    classeur.save(chemin_sortie)
