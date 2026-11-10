from datetime import date

import pandas as pd

from completude.history import (
    construire_lignes,
    fichiers_datees,
    importer_anciennes,
    iso_monday,
    migrer_historique_legacy,
    nettoyer_hist,
    purger_dates,
    semaine_presente,
    upsert_week,
)


def _par_region(district="District de Pikine", periode="Juillet 2026", valeur=92.3):
    return {"Dakar": pd.DataFrame([{"Districts": district, "Période": periode, "Paludisme - Reporting rate": valeur}])}


UID_DISTRICT = {("Dakar", "District de Pikine"): "OUA"}


def test_iso_monday():
    # Mardi 10 novembre 2026 -> lundi 9 novembre 2026
    assert iso_monday(date(2026, 11, 10)) == date(2026, 11, 9)
    # Un lundi reste lui-même
    assert iso_monday(date(2026, 11, 9)) == date(2026, 11, 9)


def test_construire_lignes_calcule_la_semaine_cle():
    lignes = construire_lignes(_par_region(), UID_DISTRICT, date(2026, 11, 10))
    assert (lignes["semaine_cle"] == "2026-11-09").all()
    assert lignes.iloc[0]["uid_district"] == "OUA"
    assert lignes.iloc[0]["periode"] == "Juillet 2026"


def test_upsert_week_un_run_mardi_remplace_le_lundi_precedent_sans_doublon(tmp_path):
    chemin = tmp_path / "history.csv"

    # Run du lundi 9 novembre
    upsert_week(_par_region(valeur=70.0), UID_DISTRICT, date(2026, 11, 9), str(chemin))
    # Run du mardi 10 novembre, même semaine ISO, valeur corrigée
    hist, remplacees = upsert_week(_par_region(valeur=75.0), UID_DISTRICT, date(2026, 11, 10), str(chemin))

    assert remplacees == 1  # la ligne du lundi a bien été remplacée, pas dupliquée
    assert len(hist) == 1
    assert hist.iloc[0]["valeur"] == "75.0" or float(hist.iloc[0]["valeur"]) == 75.0
    assert hist.iloc[0]["semaine_cle"] == "2026-11-09"


def test_rattrapage_quand_le_lundi_est_absent(tmp_path):
    chemin = tmp_path / "history.csv"
    # Semaine précédente déjà en mémoire
    upsert_week(_par_region(), UID_DISTRICT, date(2026, 11, 2), str(chemin))
    hist_avant = pd.read_csv(chemin, dtype=str, encoding="utf-8-sig")

    semaine_courante = iso_monday(date(2026, 11, 10)).isoformat()
    assert not semaine_presente(hist_avant, semaine_courante)  # le lundi 9/11 manque -> rattrapage nécessaire

    hist_apres, remplacees = upsert_week(_par_region(), UID_DISTRICT, date(2026, 11, 10), str(chemin))
    assert remplacees == 0  # rien à remplacer, c'est un ajout
    assert semaine_presente(hist_apres, semaine_courante)
    assert hist_apres["semaine_cle"].nunique() == 2  # les deux semaines coexistent


def test_purger_dates_ne_retire_jamais_la_date_du_jour():
    lignes = construire_lignes(_par_region(), UID_DISTRICT, date(2026, 11, 6))
    hist = purger_dates(lignes, ["2026-11-06"], date_courante="2026-11-06")
    assert len(hist) == 1  # protégée car c'est la date du jour

    hist = purger_dates(lignes, ["2026-11-06"], date_courante="2026-11-07")
    assert len(hist) == 0  # retirée car ce n'est plus la date du jour


def test_fichiers_datees_reconnait_le_motif_et_ignore_archives_dashboard(tmp_path):
    (tmp_path / "Situation_completude_par_region_19_10_2026.xlsx").write_bytes(b"")
    (tmp_path / "autre_fichier.xlsx").write_bytes(b"")
    sous_dossier = tmp_path / "Archives_dashboard"
    sous_dossier.mkdir()
    (sous_dossier / "Situation_completude_par_region_18_10_2026.xlsx").write_bytes(b"")

    trouves = fichiers_datees(str(tmp_path))
    dates = {d for _, d in trouves}
    assert dates == {"2026-10-19"}


def test_migrer_historique_legacy_dedoublonne_par_semaine_iso(tmp_path):
    # Historique legacy : deux runs dans la MÊME semaine ISO (lundi 9 et mercredi 11 nov 2026)
    chemin_legacy = tmp_path / "Historique_extractions.csv"
    pd.DataFrame([
        {"date_extraction": "2026-11-09", "region": "Dakar", "district": "District de Pikine",
         "uid_district": "OUA", "periode_code": "202607", "periode": "Juillet 2026",
         "formulaire": "Paludisme", "valeur": "70.0"},
        {"date_extraction": "2026-11-11", "region": "Dakar", "district": "District de Pikine",
         "uid_district": "OUA", "periode_code": "202607", "periode": "Juillet 2026",
         "formulaire": "Paludisme", "valeur": "92.3"},
    ]).to_csv(chemin_legacy, index=False, encoding="utf-8-sig")

    migre = migrer_historique_legacy(str(chemin_legacy))

    assert len(migre) == 1  # une seule ligne conservée pour cette semaine ISO
    assert migre.iloc[0]["semaine_cle"] == "2026-11-09"
    assert float(migre.iloc[0]["valeur"]) == 92.3  # la plus récente (11/11) l'emporte sur celle du 9/11


def test_nettoyer_hist_ecarte_les_lignes_sans_periode_exploitable():
    hist = pd.DataFrame([
        {"date_extraction": "2026-11-09", "semaine_cle": "2026-11-09", "region": "Dakar",
         "district": "District de Pikine", "uid_district": "OUA", "periode_code": "",
         "periode": "", "formulaire": "Paludisme", "valeur": "70.0"},
        {"date_extraction": "2026-11-09", "semaine_cle": "2026-11-09", "region": "Dakar",
         "district": "District de Pikine", "uid_district": "OUA", "periode_code": "invalide",
         "periode": "", "formulaire": "Paludisme", "valeur": "70.0"},
    ])
    nettoye = nettoyer_hist(hist)
    assert len(nettoye) == 0


def test_importer_anciennes_tolere_des_entetes_completement_differents(tmp_path):
    # Reproduit un vieil export DHIS2 reel : en-tetes "organisationunitname" /
    # "periodname" au lieu de "Districts" / "Periode" -> doit quand meme
    # s'importer grace au repli positionnel (colonne 0 = districts).
    import openpyxl

    chemin = tmp_path / "Situation_completude_par_region_21_09_2026.xlsx"
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    feuille.title = "DRS Dakar"
    feuille.append(["organisationunitname", "periodname", "Paludisme - Reporting rate"])
    feuille.append(["Dakar Centre", pd.Timestamp("2026-06-01"), 88.89])
    classeur.save(chemin)

    hist_vide = pd.DataFrame(columns=[
        "date_extraction", "semaine_cle", "region", "district", "uid_district",
        "periode_code", "periode", "formulaire", "valeur",
    ])
    resultat = importer_anciennes(hist_vide, str(tmp_path), {}, date_courante="2026-11-10")

    assert len(resultat) == 1
    assert resultat.iloc[0]["district"] == "Dakar Centre"
    assert resultat.iloc[0]["date_extraction"] == "2026-09-21"
    assert float(resultat.iloc[0]["valeur"]) == 88.89
