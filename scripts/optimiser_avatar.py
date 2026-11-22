"""Allège le modèle VRM : réduit les textures PNG trop lourdes sans toucher à la géométrie ni aux os.

Usage : python scripts/optimiser_avatar.py <source.vrm> <sortie.vrm>
La peau et la robe sont recolorées par le code (sokhnaci-3d.js) ; 512 px suffisent pour le reste.
"""
import io, json, struct, sys
from PIL import Image

MAX_PAR_DEFAUT = 512
MAX_VISAGE = 1024
SEUIL_OCTETS = 40_000


def lire_glb(chemin):
    d = open(chemin, "rb").read()
    n = struct.unpack_from("<I", d, 12)[0]
    j = json.loads(d[20:20 + n])
    debut = 20 + n
    taille_bin = struct.unpack_from("<I", d, debut)[0]
    return j, d[debut + 8: debut + 8 + taille_bin]


def cible(nom):
    nom = nom or ""
    if nom == "Thumbnail":
        return 128
    if "Face_00" in nom and "nml" not in nom and "out" not in nom:
        return MAX_VISAGE
    return MAX_PAR_DEFAUT


def reduire(octets, maxi):
    image = Image.open(io.BytesIO(octets))
    image.load()
    if max(image.size) > maxi:
        facteur = maxi / max(image.size)
        image = image.resize((max(1, round(image.width * facteur)), max(1, round(image.height * facteur))), Image.LANCZOS)
    sortie = io.BytesIO()
    image.save(sortie, "PNG", optimize=True)
    return sortie.getvalue()


def main(source, sortie):
    j, bin_ = lire_glb(source)
    vues = j["bufferViews"]
    remplacements = {}
    for image in j["images"]:
        vue = vues[image["bufferView"]]
        brut = bin_[vue.get("byteOffset", 0): vue.get("byteOffset", 0) + vue["byteLength"]]
        if len(brut) > SEUIL_OCTETS:
            nouveau = reduire(brut, cible(image.get("name")))
            if len(nouveau) < len(brut):
                remplacements[image["bufferView"]] = nouveau
    ordre = sorted(range(len(vues)), key=lambda i: vues[i].get("byteOffset", 0))
    morceaux, position = [], 0
    for i in ordre:
        vue = vues[i]
        octets = remplacements.get(i, bin_[vue.get("byteOffset", 0): vue.get("byteOffset", 0) + vue["byteLength"]])
        remplissage = (-position) % 4
        morceaux.append(b"\0" * remplissage)
        position += remplissage
        vue["byteOffset"] = position
        vue["byteLength"] = len(octets)
        morceaux.append(octets)
        position += len(octets)
    nouveau_bin = b"".join(morceaux) + b"\0" * ((-position) % 4)
    j["buffers"][0]["byteLength"] = len(nouveau_bin)
    texte = json.dumps(j, separators=(",", ":")).encode("utf-8")
    texte += b" " * ((-len(texte)) % 4)
    total = 12 + 8 + len(texte) + 8 + len(nouveau_bin)
    with open(sortie, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<I4s", len(texte), b"JSON") + texte)
        f.write(struct.pack("<I4s", len(nouveau_bin), b"BIN\0") + nouveau_bin)
    print(f"{len(open(source, 'rb').read()) / 1e6:.1f} Mo -> {total / 1e6:.1f} Mo ({len(remplacements)} textures réduites)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
