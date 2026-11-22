// Déplacement d'un avatar (2D ou 3D) : il marche (jambes, balancement) jusqu'à une position horizontale, puis se
// remet de face. La position est écrite dans les variables CSS --x / --sens que lisent l'illustration et la 3D.
const REDUIT = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function creerMarcheur(element) {
  let position = 0;
  let animation = 0;
  const ecrire = (x) => { position = x; element.style.setProperty("--x", `${x.toFixed(1)}px`); };
  ecrire(0);
  element.style.setProperty("--sens", "1");
  element.style.setProperty("--echelle", "1");
  return {
    get position() { return position; },
    placer(x) { cancelAnimationFrame(animation); element.classList.remove("walking"); ecrire(x); },
    marcherVers(cible, duree = 1100) {
      cancelAnimationFrame(animation);
      if (REDUIT()) { ecrire(cible); return Promise.resolve(); }
      const depart = position;
      if (Math.abs(cible - depart) < 4) return Promise.resolve();
      const debut = performance.now();
      element.style.setProperty("--sens", cible < depart ? "-1" : "1");
      element.classList.add("walking");
      return new Promise((resolve) => {
        const pas = (maintenant) => {
          const k = Math.min(1, (maintenant - debut) / duree);
          const lisse = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
          ecrire(depart + (cible - depart) * lisse);
          if (k < 1 && element.isConnected) animation = requestAnimationFrame(pas);
          else { element.classList.remove("walking"); resolve(); }
        };
        animation = requestAnimationFrame(pas);
      });
    },
    // Quelques pas vers une autre position, sans sortir de ±amplitude.
    flaner(amplitude = 30, duree = 1000) {
      let cible = position;
      for (let essai = 0; essai < 6 && Math.abs(cible - position) < amplitude * 0.6; essai += 1) cible = Math.round((Math.random() * 2 - 1) * amplitude);
      return this.marcherVers(cible, duree);
    },
    arreter() { cancelAnimationFrame(animation); element.classList.remove("walking"); },
  };
}
