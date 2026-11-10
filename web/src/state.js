// État partageable : onglet courant dans location.hash (via URLSearchParams,
// plus robuste que le parsing fait main de l'ancien dashboard), thème dans
// localStorage.

const CLE_THEME = "completude-theme";

export function lireEtatHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  return {
    tab: params.get("tab") || "vue",
    district: params.get("district") || null,
  };
}

export function ecrireEtatHash(partiel) {
  const etat = { ...lireEtatHash(), ...partiel };
  const params = new URLSearchParams();
  if (etat.tab) params.set("tab", etat.tab);
  if (etat.district) params.set("district", etat.district);
  history.replaceState(null, "", "#" + params.toString());
}

export function lireTheme() {
  try {
    return localStorage.getItem(CLE_THEME);
  } catch {
    return null;
  }
}

export function appliquerTheme(theme) {
  const cible = theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", cible);
  try {
    if (theme) localStorage.setItem(CLE_THEME, theme);
  } catch {
    /* stockage indisponible (navigation privée) : on continue sans persister */
  }
  return cible;
}

export function basculerTheme() {
  const actuel = document.documentElement.getAttribute("data-theme");
  const suivant = actuel === "dark" ? "light" : "dark";
  return appliquerTheme(suivant);
}
