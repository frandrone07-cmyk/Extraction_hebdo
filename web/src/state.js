const CLE_THEME = "completude-theme";
const CLES_ETAT = ["tab", "extraction", "comparaison", "region", "periode", "formulaire", "district"];

export function lireEtatHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  return Object.fromEntries(CLES_ETAT.map((key) => [key, params.get(key) || ""]));
}

export function ecrireEtatHash(partiel) {
  const etat = { ...lireEtatHash(), ...partiel };
  const params = new URLSearchParams();
  for (const key of CLES_ETAT) if (etat[key]) params.set(key, etat[key]);
  const current = new URLSearchParams(location.hash.slice(1));
  if (current.has("tv")) params.set("tv", current.get("tv"));
  history.replaceState(null, "", params.size ? `#${params.toString()}` : location.pathname + location.search);
}

export function lireTheme() {
  try { return localStorage.getItem(CLE_THEME); } catch { return null; }
}

export function appliquerTheme(theme) {
  const cible = theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", cible);
  try { localStorage.setItem(CLE_THEME, cible); } catch { /* stockage indisponible */ }
  return cible;
}

export function basculerTheme() {
  return appliquerTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
}
