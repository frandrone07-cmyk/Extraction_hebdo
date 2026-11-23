from datetime import date

from completude.periodes import (
    code_periode,
    derniere_periode_disponible,
    fenetre_mois,
    libelle_periode,
    norm,
    parse_periode,
    periodes_cumulatives,
)


def test_norm_enleve_accents_et_ponctuation():
    assert norm("Région de Dakar !") == "region de dakar"


def test_parse_periode_texte_francais():
    assert parse_periode("Juillet 2026") == (2026, 7)
    assert parse_periode("  Août   2026 ") == (2026, 8)


def test_parse_periode_vide_ou_absente():
    assert parse_periode(None) is None
    assert parse_periode("") is None
    assert parse_periode(float("nan")) is None


def test_libelle_periode_recalcule_depuis_le_code():
    assert libelle_periode(code_periode(2026, 7)) == "Juillet 2026"
    assert libelle_periode("202612") == "Décembre 2026"


def test_libelle_periode_code_invalide_renvoie_chaine_vide():
    assert libelle_periode("abc123") == ""
    assert libelle_periode("202613") == ""  # mois 13 inexistant


def test_periode_precedente_disponible_a_partir_du_16():
    assert derniere_periode_disponible(date(2026, 10, 15)) == (2026, 8)
    assert derniere_periode_disponible(date(2026, 10, 16)) == (2026, 9)
    assert derniere_periode_disponible(date(2026, 11, 15)) == (2026, 9)
    assert derniere_periode_disponible(date(2026, 11, 16)) == (2026, 10)
    assert derniere_periode_disponible(date(2026, 12, 15)) == (2026, 10)
    assert derniere_periode_disponible(date(2026, 12, 16)) == (2026, 11)  # novembre ajouté le 16 décembre
    assert derniere_periode_disponible(date(2027, 1, 16)) == (2026, 12)


def test_periodes_cumulatives_de_janvier_au_mois_disponible():
    assert periodes_cumulatives(date(2026, 11, 15)) == [(2026, mois) for mois in range(1, 10)]
    assert periodes_cumulatives(date(2026, 11, 16)) == [(2026, mois) for mois in range(1, 11)]
    assert periodes_cumulatives(date(2026, 12, 16)) == [(2026, mois) for mois in range(1, 12)]  # novembre à partir du 16 décembre


def test_fenetre_mois_exclut_le_mois_courant_avant_le_16():
    assert fenetre_mois(date(2026, 10, 15), 3) == [(2026, 6), (2026, 7), (2026, 8)]
    assert fenetre_mois(date(2026, 10, 16), 3) == [(2026, 7), (2026, 8), (2026, 9)]


def test_fenetre_mois_traverse_le_changement_d_annee():
    assert fenetre_mois(date(2026, 1, 15), 3) == [(2025, 9), (2025, 10), (2025, 11)]
    assert fenetre_mois(date(2026, 1, 16), 3) == [(2025, 10), (2025, 11), (2025, 12)]
