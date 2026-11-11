"""Normalisation de texte et gestion des périodes (mois) en français.

Utilitaires partagés entre extract.py, history.py et topo.py — toujours
recalculer le libellé d'une période depuis son code AAAAMM plutôt que de
faire confiance à un texte libre, pour éviter les libellés incohérents.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime

import pandas as pd

MOIS_FR = {
    1: "Janvier", 2: "Février", 3: "Mars", 4: "Avril", 5: "Mai", 6: "Juin",
    7: "Juillet", 8: "Août", 9: "Septembre", 10: "Octobre", 11: "Novembre", 12: "Décembre",
}
_MOIS_PAR_NOM = {
    "janvier": 1, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6,
    "juillet": 7, "aout": 8, "septembre": 9, "octobre": 10, "novembre": 11, "decembre": 12,
}


def norm(s) -> str:
    """Minuscules, sans accents, sans ponctuation : pour comparer des libellés."""
    s = unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def parse_periode(v) -> tuple[int, int] | None:
    """'Juillet 2026', un datetime, ou une chaîne de date -> (année, mois)."""
    if v is None or (isinstance(v, float) and pd.isna(v)) or str(v).strip() == "":
        return None
    if isinstance(v, (datetime, pd.Timestamp, date)):
        return v.year, v.month
    tokens = norm(v).split()
    mois = next((_MOIS_PAR_NOM[t] for t in tokens if t in _MOIS_PAR_NOM), None)
    annee = next((int(t) for t in tokens if t.isdigit() and len(t) == 4), None)
    if mois and annee:
        return annee, mois
    d = pd.to_datetime(v, errors="coerce")
    return (d.year, d.month) if pd.notna(d) else None


def code_periode(annee: int, mois: int) -> str:
    return f"{annee}{mois:02d}"


def libelle_periode(code) -> str:
    """'202607' -> 'Juillet 2026'. Chaîne vide si le code n'est pas un AAAAMM valide."""
    code = str(code).strip()
    if re.fullmatch(r"\d{6}", code) and 1 <= int(code[4:6]) <= 12:
        return f"{MOIS_FR[int(code[4:6])]} {code[:4]}"
    return ""


def derniere_periode_disponible(date_ref: date) -> tuple[int, int]:
    """Dernière période mensuelle à extraire : mois courant à partir du 15, sinon le précédent."""
    annee, mois = date_ref.year, date_ref.month
    if date_ref.day < 15:
        mois -= 1
        if mois == 0:
            mois, annee = 12, annee - 1
    return annee, mois


def fenetre_mois(date_ref: date, nb_mois: int) -> list[tuple[int, int]]:
    """Les derniers mois disponibles, du plus ancien au plus récent."""
    mois_fenetre = []
    annee, mois = derniere_periode_disponible(date_ref)
    for _ in range(nb_mois):
        mois_fenetre.append((annee, mois))
        mois -= 1
        if mois == 0:
            mois, annee = 12, annee - 1
    return list(reversed(mois_fenetre))
