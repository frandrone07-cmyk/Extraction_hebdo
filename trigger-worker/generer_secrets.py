"""Génère un sel et le hash SHA-256 d'un PIN sans afficher le PIN."""
from __future__ import annotations

import getpass
import hashlib
import secrets


def main() -> None:
    pin = getpass.getpass("Choisir le PIN partagé (4 à 32 caractères) : ")
    confirmation = getpass.getpass("Confirmer le PIN : ")
    if pin != confirmation:
        raise SystemExit("Les deux saisies ne correspondent pas.")
    if not 4 <= len(pin) <= 32:
        raise SystemExit("Le PIN doit contenir entre 4 et 32 caractères.")
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt.encode("utf-8"), 310_000).hex()
    print(f"PIN_SALT={salt}")
    print(f"PIN_HASH={digest}")


if __name__ == "__main__":
    main()
