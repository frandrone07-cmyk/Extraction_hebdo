import json

import pandas as pd

from completude.geo import charger_contours


class FakeClient:
    """Double minimal : seul `session.get` est utilisé par _brut_depuis_dhis2."""

    def __init__(self, features):
        self.base_url = "https://example.invalid"
        self.session = _FakeSession(features)


class _FakeSession:
    def __init__(self, features):
        self.features = features

    def get(self, url, params=None, timeout=None):
        return _FakeResponse(200, {"type": "FeatureCollection", "features": self.features})


class _FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _hist():
    return pd.DataFrame([
        {"region": "Dakar", "district": "District de Pikine", "uid_district": "OUA"},
        {"region": "Dakar", "district": "District de Guediawaye", "uid_district": "OUB"},
    ])


def test_charger_contours_cree_le_dossier_du_cache_si_absent(tmp_path):
    chemin_cache = tmp_path / "geo" / "cache_dhis2.geojson"  # dossier "geo" n'existe pas encore
    assert not chemin_cache.parent.exists()

    features = [{
        "type": "Feature",
        "properties": {"id": "OUA", "name": "District de Pikine"},
        "geometry": {"type": "Point", "coordinates": [1.23456789, 2.34567891]},
    }]
    client = FakeClient(features)

    resultat = charger_contours(client, 3, _hist(), str(chemin_cache), str(tmp_path / "inexistant.geojson"))

    assert chemin_cache.exists()  # le dossier a bien ete cree avant l'ecriture
    assert len(resultat.features) == 1


def test_charger_contours_relie_par_uid_puis_par_nom(tmp_path):
    chemin_cache = tmp_path / "cache.geojson"
    geom_a = {"type": "Point", "coordinates": [1, 2]}
    geom_b = {"type": "Point", "coordinates": [3, 4]}
    features = [
        {"type": "Feature", "properties": {"id": "OUA", "name": "Autre nom"}, "geometry": geom_a},
        {"type": "Feature", "properties": {"id": "", "name": "District de Guediawaye"}, "geometry": geom_b},
    ]
    client = FakeClient(features)

    resultat = charger_contours(client, 3, _hist(), str(chemin_cache), str(tmp_path / "inexistant.geojson"))

    assert len(resultat.features) == 2
    assert resultat.districts_sans_contour == []


def test_charger_contours_signale_les_districts_sans_contour(tmp_path):
    chemin_cache = tmp_path / "cache.geojson"
    client = FakeClient([])  # aucune geometrie renvoyee par DHIS2

    resultat = charger_contours(client, 3, _hist(), str(chemin_cache), str(tmp_path / "inexistant.geojson"))

    assert resultat.features == []
    assert sorted(resultat.districts_sans_contour) == ["District de Guediawaye", "District de Pikine"]


def test_charger_contours_priorite_au_fichier_local(tmp_path):
    chemin_local = tmp_path / "local.geojson"
    chemin_local.write_text(json.dumps({
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "properties": {"id": "OUA"}, "geometry": {"type": "Point", "coordinates": [9, 9]}}],
    }), encoding="utf-8")
    client = FakeClient([])  # ne doit jamais etre appele puisque le fichier local existe

    resultat = charger_contours(client, 3, _hist(), str(tmp_path / "cache.geojson"), str(chemin_local))

    assert len(resultat.features) == 1
    assert resultat.features[0]["geometry"]["coordinates"] == [9, 9]
