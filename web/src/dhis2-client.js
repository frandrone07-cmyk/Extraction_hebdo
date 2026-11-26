// Client du serveur intermédiaire DHIS2 : toutes les données « temps réel » passent par lui (lecture seule).
// Aucune valeur n'est inventée : en cas d'erreur, une exception porte un message clair à afficher.
import { PROXY_URL } from "./proxy-config.js";

export function urlProxy() {
  // Surcharge réservée aux tests automatisés (serveur simulé).
  if (navigator.webdriver && window.__PROXY_URL__) return window.__PROXY_URL__;
  return PROXY_URL;
}

export class ErreurDhis2 extends Error {}

async function appel(chemin, { params = null, methode = "GET", corps = null, actualiser = false, pin = null, delaiMs = 45000 } = {}) {
  const base = urlProxy();
  if (!base) throw new ErreurDhis2("Le serveur intermédiaire DHIS2 n’est pas configuré.");
  const recherche = new URLSearchParams();
  if (params) for (const [cle, valeur] of Object.entries(params)) {
    for (const v of Array.isArray(valeur) ? valeur : [valeur]) if (v !== undefined && v !== null && v !== "") recherche.append(cle, v);
  }
  if (actualiser) recherche.set("actualiser", "1");
  const controle = new AbortController();
  const minuterie = setTimeout(() => controle.abort(), delaiMs);
  let reponse;
  try {
    reponse = await fetch(`${base}/${chemin}${recherche.toString() ? `?${recherche}` : ""}`, {
      method: methode,
      headers: { ...(corps ? { "Content-Type": "application/json" } : {}), ...(pin ? { "X-Pin": pin } : {}) },
      body: corps ? JSON.stringify(corps) : undefined,
      signal: controle.signal,
    });
  } catch (erreur) {
    if (erreur?.name === "AbortError") throw new ErreurDhis2(`DHIS2 met trop de temps à répondre (plus de ${Math.round(delaiMs / 1000)} secondes). Réduisez la sélection (une région ou un district, moins de mois) puis réessayez.`);
    throw new ErreurDhis2("Connexion impossible au serveur DHIS2. Vérifiez votre connexion Internet puis réessayez.");
  } finally {
    clearTimeout(minuterie);
  }
  let donnees = null;
  try { donnees = await reponse.json(); } catch { donnees = null; }
  if (!reponse.ok) throw new ErreurDhis2(donnees?.erreur || `Le serveur DHIS2 a répondu ${reponse.status}.`);
  return { donnees, misAJour: reponse.headers.get("X-Mis-A-Jour") || new Date().toISOString() };
}

export const etatService = () => appel("sante", { delaiMs: 20000 }).then((r) => r.donnees);
export const lireDhis2 = (chemin, params, options = {}) => appel(`api/${chemin}`, { params, ...options });
// Analyses longues côté DHIS2 (règles de validation, valeurs aberrantes) : jusqu'à 2 min 30 d'attente.
export const analyserDhis2 = (chemin, corps, options = {}) => appel(`api/${chemin}`, { methode: "POST", corps, delaiMs: 150000, ...options });
export const lireConfiguration = () => appel("config").then((r) => r.donnees);
export const enregistrerConfiguration = (config, pin) => appel("config", { methode: "PUT", corps: config, pin }).then((r) => r.donnees);

// « Mis à jour le JJ/MM/AAAA à HH:MM »
export function libelleMiseAJour(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const deux = (n) => String(n).padStart(2, "0");
  return `Mis à jour le ${deux(d.getDate())}/${deux(d.getMonth() + 1)}/${d.getFullYear()} à ${deux(d.getHours())}:${deux(d.getMinutes())}`;
}
