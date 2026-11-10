"""Historique des extractions, dédupliqué par semaine ISO (clé = lundi).

Remplace la logique de l'ancien notebook, qui dédupliquait par égalité
EXACTE de date calendaire (`date_extraction`) — deux runs dans la même
semaine mais à des jours différents créaient deux lignes distinctes. Ici,
`semaine_cle` (le lundi ISO de la semaine) est la clé de déduplication :
« un run = un remplacement de ce lundi », quel que soit le jour réel du run.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
from datetime import date, timedelta

import pandas as pd

from .extract import cols_districts_periode
from .periodes import libelle_periode, parse_periode

logger = logging.getLogger(__name__)

COLS_HIST = [
    "date_extraction", "semaine_cle", "region", "district", "uid_district",
    "periode_code", "periode", "formulaire", "valeur",
]


def iso_monday(d: date) -> date:
    """Le lundi de la semaine ISO contenant `d`."""
    return d - timedelta(days=d.weekday())


def nom_formulaire(col: str) -> str:
    return re.sub(r"\s*-\s*reporting rate\s*$", "", str(col), flags=re.I).strip()


def construire_lignes(
    par_region: dict[str, pd.DataFrame],
    uid_district: dict[tuple[str, str], str],
    date_extraction: date,
) -> pd.DataFrame:
    """Transforme {région: tableau} en lignes longues (district x période x formulaire)."""
    semaine_cle = iso_monday(date_extraction).isoformat()
    date_str = date_extraction.isoformat()
    lignes = []
    for region, df in par_region.items():
        cols_formulaires = [c for c in df.columns if c not in ("Districts", "Période")]
        for _, row in df.iterrows():
            p = parse_periode(row["Période"])
            code = f"{p[0]}{p[1]:02d}" if p else ""
            for col in cols_formulaires:
                valeur = row[col]
                lignes.append({
                    "date_extraction": date_str,
                    "semaine_cle": semaine_cle,
                    "region": region,
                    "district": row["Districts"],
                    "uid_district": uid_district.get((region, row["Districts"]), ""),
                    "periode_code": code,
                    "periode": libelle_periode(code),
                    "formulaire": nom_formulaire(col),
                    "valeur": None if pd.isna(valeur) else round(float(valeur), 2),
                })
    return pd.DataFrame(lignes, columns=COLS_HIST)


def nettoyer_hist(hist: pd.DataFrame) -> pd.DataFrame:
    """Corrige les colonnes-clé relues comme NaN/float, recalcule les libellés de période,
    et écarte les lignes sans période ou sans formulaire exploitable."""
    hist = hist.copy()
    colonnes_cle = (
        "date_extraction", "semaine_cle", "region", "district",
        "uid_district", "periode_code", "periode", "formulaire",
    )
    for c in colonnes_cle:
        hist[c] = hist[c].fillna("").astype(str).str.strip()
    hist["periode"] = hist["periode_code"].map(libelle_periode)
    valide = (hist["periode"] != "") & (hist["formulaire"] != "")
    rejetees = hist[~valide]
    if len(rejetees):
        logger.warning(
            "%d ligne(s) sans période/formulaire exploitable ignorées (dates : %s)",
            len(rejetees), sorted(rejetees["date_extraction"].unique()),
        )
    return hist[valide].reset_index(drop=True)


def lire_historique(chemin: str) -> pd.DataFrame:
    if not os.path.exists(chemin):
        return pd.DataFrame(columns=COLS_HIST)
    return pd.read_csv(
        chemin,
        dtype={c: str for c in COLS_HIST if c != "valeur"},
        encoding="utf-8-sig",
    )


def ecrire_historique(hist: pd.DataFrame, chemin: str) -> pd.DataFrame:
    hist = hist.copy()
    hist["uid_district"] = hist["uid_district"].fillna("")
    hist["periode_code"] = hist["periode_code"].fillna("")
    hist = hist.sort_values(
        ["semaine_cle", "region", "district", "periode_code", "formulaire"]
    ).reset_index(drop=True)
    os.makedirs(os.path.dirname(chemin) or ".", exist_ok=True)
    hist.to_csv(chemin, index=False, encoding="utf-8-sig")
    return hist


def upsert_week(
    par_region: dict[str, pd.DataFrame],
    uid_district: dict[tuple[str, str], str],
    date_extraction: date,
    chemin: str,
) -> tuple[pd.DataFrame, int]:
    """Remplace dans l'historique toutes les lignes de la semaine ISO de `date_extraction`
    par les nouvelles lignes — jamais de doublon, quel que soit le jour réel du run."""
    nouveau = construire_lignes(par_region, uid_district, date_extraction)
    semaine_cle = iso_monday(date_extraction).isoformat()

    ancien = lire_historique(chemin)
    lignes_remplacees = 0
    if not ancien.empty:
        shutil.copy(chemin, chemin.replace(".csv", "_sauvegarde.csv"))
        lignes_remplacees = int((ancien["semaine_cle"] == semaine_cle).sum())
        ancien = ancien[ancien["semaine_cle"] != semaine_cle]

    hist = pd.concat([ancien, nouveau], ignore_index=True) if not ancien.empty else nouveau
    return ecrire_historique(hist, chemin), lignes_remplacees


def semaine_presente(hist: pd.DataFrame, semaine_cle: str) -> bool:
    return not hist.empty and (hist["semaine_cle"] == semaine_cle).any()


def purger_dates(hist: pd.DataFrame, dates_a_exclure: list[str], date_courante: str) -> pd.DataFrame:
    """Retire de la mémoire les extractions listées (jamais la date du jour)."""
    a_retirer = [d for d in dates_a_exclure if d != date_courante]
    if not a_retirer:
        return hist
    masque = hist["date_extraction"].isin(a_retirer)
    if masque.any():
        logger.info("%d ligne(s) retirées (extractions exclues : %s)", int(masque.sum()), ", ".join(a_retirer))
    return hist[~masque].reset_index(drop=True)


_MODELE_FICHIER_DATE = re.compile(r"^Situation_completude_par_region_(\d{2})_(\d{2})_(\d{4})\.xlsx$", re.I)


def fichiers_datees(dossier: str) -> list[tuple[str, str]]:
    """(chemin, date AAAA-MM-JJ) des Excel datés trouvés dans `dossier` et ses sous-dossiers."""
    trouves = []
    for racine, sous_dossiers, noms in os.walk(dossier):
        sous_dossiers[:] = [s for s in sous_dossiers if s.lower() != "archives_dashboard"]
        for nom in sorted(noms):
            m = _MODELE_FICHIER_DATE.match(nom)
            if m:
                jj, mm, aaaa = m.groups()
                trouves.append((os.path.join(racine, nom), f"{aaaa}-{mm}-{jj}"))
    return trouves


def importer_anciennes(
    hist: pd.DataFrame,
    dossier: str,
    uid_district: dict[tuple[str, str], str],
    date_courante: str,
    dates_exclues: set[str] = frozenset(),
) -> pd.DataFrame:
    """Reprend les anciens fichiers Excel de sortie (déjà au format Districts/Période)
    non encore présents dans l'historique. Idempotent."""
    deja_connues = set(hist["date_extraction"]) if not hist.empty else set()
    ajouts, ignores = [], []
    for chemin_fichier, date_fichier in fichiers_datees(dossier):
        nom = os.path.relpath(chemin_fichier, dossier)
        if date_fichier in dates_exclues or date_fichier in deja_connues or date_fichier == date_courante:
            continue
        try:
            xl = pd.ExcelFile(chemin_fichier)
            par_region = {}
            for feuille in xl.sheet_names:
                df = pd.read_excel(xl, sheet_name=feuille)
                df.columns = [str(c).strip() for c in df.columns]
                col_districts, col_periode = cols_districts_periode(df, repli_positionnel=True)
                if col_districts is not None and col_periode is not None:
                    df = df.rename(columns={col_districts: "Districts", col_periode: "Période"})
                    df["Districts"] = df["Districts"].ffill()
                    par_region[feuille] = df.dropna(subset=["Districts"])
                else:
                    logger.warning("%s/%s : colonnes Districts/Période introuvables, feuille ignorée", nom, feuille)
            date_obj = date.fromisoformat(date_fichier)
            lignes = construire_lignes(par_region, uid_district, date_obj) if par_region else None
        except Exception:
            logger.warning("Import ignoré (%s)", nom, exc_info=True)
            continue
        if lignes is None or lignes["valeur"].notna().sum() == 0:
            ignores.append(nom)
            continue
        ajouts.append(lignes)
        deja_connues.add(date_fichier)
        logger.info("Ancienne extraction reprise : %s (%d valeurs)", nom, int(lignes["valeur"].notna().sum()))
    if ignores:
        logger.info("Fichiers sans valeur ignorés : %s", ", ".join(ignores))
    if not ajouts:
        return hist
    return pd.concat([hist] + ajouts, ignore_index=True) if not hist.empty else pd.concat(ajouts, ignore_index=True)


def migrer_historique_legacy(chemin_csv_legacy: str) -> pd.DataFrame:
    """Lit un Historique_extractions.csv au format d'origine (sans `semaine_cle`, dédupliqué
    par date_extraction exacte) et le convertit au nouveau format : ajoute `semaine_cle`,
    puis ne garde qu'une ligne par (semaine_cle, district, formulaire, periode_code) — en cas
    de plusieurs `date_extraction` dans la même semaine ISO, la plus récente l'emporte."""
    hist = pd.read_csv(chemin_csv_legacy, dtype=str, encoding="utf-8-sig")
    hist["semaine_cle"] = hist["date_extraction"].apply(
        lambda d: iso_monday(date.fromisoformat(d)).isoformat()
    )
    hist = hist.sort_values("date_extraction")
    hist = hist.drop_duplicates(
        subset=["semaine_cle", "district", "formulaire", "periode_code"], keep="last"
    )
    return nettoyer_hist(hist[COLS_HIST].reset_index(drop=True))
