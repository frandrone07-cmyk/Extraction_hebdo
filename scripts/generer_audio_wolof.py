"""Genere les phrases wolof de Sokhnaci avec le modele libre abdazizsall/wolof-pocket-tts.

Preparation (une seule fois, gratuite) :
  1. Creer un compte Hugging Face gratuit, ouvrir https://huggingface.co/abdazizsall/wolof-pocket-tts
     et accepter les conditions d'acces (modele CC-BY-SA-4.0).
  2. pip install pocket-tts==4.0.1 soundfile pyyaml huggingface_hub
  3. huggingface-cli login   (saisir votre propre jeton : ne le partagez avec personne)

Voix : le modele copie la voix d'un court extrait (3 a 10 secondes, WAV propre, sans musique).
Utilisez UNIQUEMENT la voix d'une femme qui a donne son accord par ecrit, ou l'un des
exemples du dossier "voices" du modele si vous avez verifie a l'oreille que la voix est feminine.

Usage :
  python scripts/generer_audio_wolof.py --voix chemin/vers/voix_femme.wav
Les fichiers .wav sont ecrits dans web/audio/wo/ (Sokhnaci les joue automatiquement).
"""
import argparse
import subprocess
import sys
from pathlib import Path

PHRASES = {
    "salaamalekum": "Salaamalekum !",
    "nanga-def": "Nanga def ?",
    "maa-ngi-fi-rekk": "Maa ngi fi rekk !",
    "jerejef": "Jërëjëf !",
    "baal-ma-waxaat": "Baal ma, mën nga ko waxaat ?",
}


def main() -> int:
    parseur = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parseur.add_argument("--voix", required=True, help="WAV de 3 a 10 s d'une femme consentante")
    parseur.add_argument("--sortie", default="web/audio/wo", help="dossier de sortie")
    args = parseur.parse_args()

    voix = Path(args.voix).resolve()
    if not voix.is_file():
        print(f"Voix introuvable : {voix}", file=sys.stderr)
        return 1
    sortie = Path(args.sortie).resolve()
    sortie.mkdir(parents=True, exist_ok=True)

    from huggingface_hub import snapshot_download

    dossier = Path(snapshot_download("abdazizsall/wolof-pocket-tts"))
    for nom, texte in PHRASES.items():
        cible = sortie / f"{nom}.wav"
        resultat = subprocess.run(
            [sys.executable, "speak.py", texte, "--voice", str(voix), "--out", str(cible)],
            cwd=dossier,
            check=False,
        )
        if resultat.returncode != 0 or not cible.is_file():
            print(f"Echec pour « {texte} »", file=sys.stderr)
            return 1
        print(f"OK  {cible.name}  <-  {texte}")
    print("Ecoutez chaque fichier avant publication : si une phrase est mal prononcee, supprimez-la, Sokhnaci reprendra la voix francaise.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
