// Choix de l'utilisateur gardés dans son navigateur : indicateurs FARS et formulaires suivis. Ajouter ou retirer ne
// demande aucun code PIN. Si le navigateur refuse le stockage (navigation privée…), la liste par défaut s'applique.
import { FARS_DEFAUT, FORMULAIRES_DEFAUT } from "./fars-defaut.js";

const CLES = { fars: "suivi-fars-v1", formulaires: "suivi-formulaires-v1" };
const copie = (x) => JSON.parse(JSON.stringify(x));

function lire(cle) {
  try { const v = JSON.parse(localStorage.getItem(cle) || "null"); return Array.isArray(v) ? v : null; } catch { return null; }
}
function ecrire(cle, valeur) {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); return true; } catch { return false; }
}
function effacer(cle) { try { localStorage.removeItem(cle); } catch { /* stockage indisponible */ } }

const uidValide = (v) => typeof v === "string" && /^[A-Za-z0-9]{11}$/.test(v);

export function indicateursSuivis() {
  const lu = lire(CLES.fars);
  if (!lu) return copie(FARS_DEFAUT);
  return lu.filter((i) => i && typeof i.nom === "string" && (i.uid === null || uidValide(i.uid)))
    .map((i, n) => ({ id: i.uid || i.id || `a-associer-${n}`, uid: i.uid, nom: i.nom.slice(0, 200), programme: String(i.programme || "Autres").slice(0, 60), cible: Number.isFinite(i.cible) ? i.cible : null, sens: i.sens === "bas" ? "bas" : "haut" }));
}
export const enregistrerIndicateurs = (liste) => ecrire(CLES.fars, liste);
export const reinitialiserIndicateurs = () => effacer(CLES.fars);
export const indicateursPersonnalises = () => lire(CLES.fars) !== null;

export function formulairesSuivis() {
  const lu = lire(CLES.formulaires);
  if (!lu) return copie(FORMULAIRES_DEFAUT);
  return lu.filter((f) => f && uidValide(f.uid)).map((f, ordre) => ({ uid: f.uid, nom: String(f.nom || f.uid).slice(0, 120), ordre }));
}
export const enregistrerFormulaires = (liste) => ecrire(CLES.formulaires, liste);
export const reinitialiserFormulaires = () => effacer(CLES.formulaires);
