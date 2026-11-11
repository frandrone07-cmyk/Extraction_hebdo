"""Extraction de la complétude DHIS2 à partir du gabarit Excel.

Porte la logique de résolution dynamique UID (aucune table de correspondance
manuelle : normalisation + correspondance exacte puis sous-chaîne) et
l'extraction Analytics par région, telles qu'elles existaient dans le
notebook d'origine (legacy/extraction_completude.ipynb).
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import date

import pandas as pd

from .dhis2 import Dhis2Client
from .periodes import MOIS_FR, code_periode, derniere_periode_disponible, fenetre_mois, norm, parse_periode

logger = logging.getLogger(__name__)


def cols_districts_periode(
    df: pd.DataFrame, repli_positionnel: bool = False
) -> tuple[str | None, str | None]:
    """Devine quelle colonne du gabarit est « Districts » et laquelle est « Période »,
    en tolérant les variantes/fautes de frappe d'en-tête.

    `repli_positionnel` : si aucune colonne ne correspond par son nom (en-têtes
    totalement différents comme "organisationunitname"/"DRS/DISTRICTS" dans de
    vieux exports), utilise la position (colonne 0 = districts, colonne 1 =
    période) en dernier recours. Réservé à l'import de fichiers historiques
    hétérogènes — jamais utilisé sur le gabarit en production, pour ne jamais
    risquer de mal interpréter sa structure."""
    df.columns = df.columns.astype(str).str.strip()
    col_districts = next((c for c in df.columns if c.lower().startswith("dis")), None)
    col_periode = next(
        (c for c in df.columns if c.lower().startswith("per") or "per" in c.lower()), None
    )
    if not col_periode:
        col_periode = next(
            (c for c in df.columns if "p" in c.lower() and "ri" in c.lower()), None
        )
    if repli_positionnel and len(df.columns) >= 2:
        if not col_districts:
            col_districts = df.columns[0]
        if not col_periode:
            col_periode = df.columns[1]
    return col_districts, col_periode


def detecter_niveau_organisation_unit(
    client: Dhis2Client, noms_districts_connus: set[str]
) -> tuple[int, dict[str, str]]:
    """Essaie les niveaux DHIS2 2/3/4 et garde celui qui reconnaît le plus de noms
    de districts du gabarit (correspondance exacte après normalisation)."""
    meilleur_score, meilleure_table, meilleur_niveau = -1, {}, 0
    for niveau in (2, 3, 4):
        unites = client.api(
            "organisationUnits.json", fields="id,displayName", paging="false", level=niveau
        )["organisationUnits"]
        table = {norm(u["displayName"]): u["id"] for u in unites}
        score = sum(1 for d in noms_districts_connus if norm(d) in table)
        if score > meilleur_score:
            meilleur_score, meilleure_table, meilleur_niveau = score, table, niveau
    logger.info(
        "Niveau des districts détecté : %s (%d/%d reconnus)",
        meilleur_niveau, meilleur_score, len(noms_districts_connus),
    )
    return meilleur_niveau, meilleure_table


@dataclass
class UidResolver:
    """Résout dynamiquement les en-têtes de colonnes (formulaires) et les noms de
    districts du gabarit vers des UID DHIS2, sans aucune table manuelle."""

    datasets_par_nom: dict[str, str]
    districts_par_nom: dict[str, str]
    niveau_organisation_unit: int

    @classmethod
    def depuis_client(cls, client: Dhis2Client, noms_districts_connus: set[str]) -> UidResolver:
        datasets = {
            norm(d["displayName"]): d["id"]
            for d in client.api("dataSets.json", fields="id,displayName", paging="false")["dataSets"]
        }
        niveau, table = detecter_niveau_organisation_unit(client, noms_districts_connus)
        return cls(datasets, table, niveau)

    def resoudre_formulaire(self, nom_colonne: str) -> str | None:
        nom = re.sub(r"\s*-\s*reporting rate\s*$", "", nom_colonne, flags=re.I).strip()
        nom_sans_prefixe = re.sub(r"^R\d+_", "", nom).strip()
        n_nom, n_sans = norm(nom), norm(nom_sans_prefixe)
        if n_nom in self.datasets_par_nom:
            return self.datasets_par_nom[n_nom] + ".REPORTING_RATE"
        if n_sans in self.datasets_par_nom:
            return self.datasets_par_nom[n_sans] + ".REPORTING_RATE"
        for cle, uid in self.datasets_par_nom.items():
            if n_sans and (n_sans in cle or cle in n_sans):
                return uid + ".REPORTING_RATE"
        return None

    def resoudre_district(self, nom_district: str) -> str | None:
        n = norm(nom_district)
        if n in self.districts_par_nom:
            return self.districts_par_nom[n]
        candidats = [cle for cle in self.districts_par_nom if n and (n in cle or cle in n)]
        return self.districts_par_nom[candidats[0]] if len(candidats) == 1 else None


@dataclass
class DiagnosticRegion:
    region: str
    valeurs_recuperees: int
    cases_attendues: int


@dataclass
class ResultatExtraction:
    par_region: dict[str, pd.DataFrame] = field(default_factory=dict)
    uid_district: dict[tuple[str, str], str] = field(default_factory=dict)
    formulaires_non_resolus: set[str] = field(default_factory=set)
    districts_non_resolus: set[str] = field(default_factory=set)
    diagnostics: list[DiagnosticRegion] = field(default_factory=list)
    niveau_organisation_unit: int = 0


def _lire_gabarit(chemin_gabarit: str) -> dict[str, pd.DataFrame]:
    xl = pd.ExcelFile(chemin_gabarit)
    feuilles = {nom: pd.read_excel(chemin_gabarit, sheet_name=nom) for nom in xl.sheet_names}
    for df in feuilles.values():
        df.columns = [c.replace("\u0000", "") for c in df.columns.astype(str)]
    return feuilles


def _lignes_generees(
    df_orig: pd.DataFrame,
    col_districts: str,
    mois_fenetre: list[tuple[int, int]],
    annee_ref: int,
    col_periode: str | None = None,
) -> pd.DataFrame:
    """Génère une ligne par district et période, valeurs vides à remplir depuis DHIS2."""
    cols_indicateurs = [
        c for c in df_orig.columns
        if c not in (col_districts, col_periode) and not c.startswith("Unnamed:")
    ]
    districts_uniques = df_orig[col_districts].ffill().dropna().unique()
    lignes = []
    for dist in districts_uniques:
        for annee, mois in mois_fenetre:
            ligne = {"Districts": dist, "Période": f"{MOIS_FR[mois]} {annee}"}
            for col in cols_indicateurs:
                ligne[col] = None
            lignes.append(ligne)
    return pd.DataFrame(lignes)


def _periodes_du_gabarit(
    df: pd.DataFrame,
    col_periode: str,
    date_reference: date,
) -> list[tuple[int, int]]:
    dernier_mois = derniere_periode_disponible(date_reference)
    periodes = sorted({
        periode for valeur in df[col_periode]
        if (periode := parse_periode(valeur)) is not None and periode <= dernier_mois
    })
    if not periodes:
        return []

    debut_annee, debut_mois = periodes[0]
    periodes_existantes = set(periodes)
    periodes_completes = []
    annee, mois = debut_annee, debut_mois
    while (annee, mois) <= dernier_mois:
        if (annee, mois) not in periodes_existantes:
            periodes_completes.append((annee, mois))
        mois += 1
        if mois == 13:
            annee, mois = annee + 1, 1
    return sorted(periodes_existantes | set(periodes_completes))


def extraire(
    client: Dhis2Client,
    chemin_gabarit: str,
    nb_mois_fenetre: int,
    date_reference: date,
) -> ResultatExtraction:
    feuilles = _lire_gabarit(chemin_gabarit)

    tous_districts: set[str] = set()
    for df in feuilles.values():
        col_districts, _ = cols_districts_periode(df)
        if col_districts:
            tous_districts |= set(df[col_districts].ffill().dropna().astype(str))

    resolveur = UidResolver.depuis_client(client, tous_districts)
    mois_fenetre = fenetre_mois(date_reference, nb_mois_fenetre)

    resultat = ResultatExtraction(niveau_organisation_unit=resolveur.niveau_organisation_unit)

    for region, df_orig in feuilles.items():
        col_districts, col_periode = cols_districts_periode(df_orig)
        if not col_districts:
            logger.warning("%s : colonne Districts introuvable, région ignorée", region)
            continue

        if not col_periode or col_periode not in df_orig.columns:
            df = _lignes_generees(df_orig, col_districts, mois_fenetre, date_reference.year)
        else:
            periodes_gabarit = [parse_periode(value) for value in df_orig[col_periode]]
            if not any(periode is not None for periode in periodes_gabarit):
                df = _lignes_generees(df_orig, col_districts, mois_fenetre, date_reference.year, col_periode)
            else:
                periodes = _periodes_du_gabarit(df_orig, col_periode, date_reference)
                if not periodes:
                    logger.warning("%s : aucune période du gabarit n'est encore disponible", region)
                    continue
                df = _lignes_generees(df_orig, col_districts, periodes, date_reference.year, col_periode)

        periodes = [parse_periode(v) for v in df["Période"]]
        valides = [p is not None for p in periodes]
        df = df.loc[valides].reset_index(drop=True)
        periodes = [p for p, v in zip(periodes, valides) if v]
        if df.empty:
            logger.warning("%s : aucune ligne avec période exploitable", region)
            continue

        cols_formulaires = [c for c in df.columns if c not in ("Districts", "Période")]
        dx = {c: resolveur.resoudre_formulaire(c) for c in cols_formulaires}
        ou = {d: resolveur.resoudre_district(d) for d in df["Districts"].dropna().unique()}
        resultat.uid_district.update({(region, d): u for d, u in ou.items() if u})
        resultat.formulaires_non_resolus |= {c for c, u in dx.items() if not u}
        resultat.districts_non_resolus |= {d for d, u in ou.items() if not u}

        pe = sorted({code_periode(annee, mois) for annee, mois in periodes})
        dx_ids = sorted({u for u in dx.values() if u})
        ou_ids = sorted({u for u in ou.values() if u})

        valeurs: dict[tuple[str, str, str], float] = {}
        cases_attendues = len(df) * len(cols_formulaires)
        if dx_ids and ou_ids and pe:
            try:
                reponse = client.api(
                    "analytics.json",
                    dimension=[f"dx:{';'.join(dx_ids)}", f"ou:{';'.join(ou_ids)}", f"pe:{';'.join(pe)}"],
                    skipMeta="true",
                )
                entetes = [h["name"] for h in reponse["headers"]]
                for ligne in reponse["rows"]:
                    r = dict(zip(entetes, ligne))
                    valeurs[(r["dx"], r["ou"], r["pe"])] = float(r["value"])
            except Exception:
                logger.exception("%s : erreur lors de l'appel Analytics", region)

        for col in cols_formulaires:
            df[col] = pd.Series(
                [
                    valeurs.get((dx[col], ou.get(d), code_periode(*p))) if dx[col] and ou.get(d) else None
                    for d, p in zip(df["Districts"], periodes)
                ],
                dtype="float64",
            )
        df["Période"] = [f"{MOIS_FR[mois]} {annee}" for annee, mois in periodes]

        resultat.par_region[region] = df
        resultat.diagnostics.append(DiagnosticRegion(region, len(valeurs), cases_attendues))
        logger.info(
            "%s : %d valeurs récupérées sur %d cases attendues", region, len(valeurs), cases_attendues
        )

    if not resultat.par_region:
        raise RuntimeError(
            "Aucune feuille exploitable dans le gabarit (pas de période valide trouvée)."
        )

    return resultat
