import { chargerDonnees } from "./data.js";
import { ecrireEtatHash, lireEtatHash, lireTheme, appliquerTheme, basculerTheme } from "./state.js";
import { basculerThemeCarte } from "./map.js";
import { initDrawer } from "./drawer.js";
import {
  renderVue, apresRenduVue,
  renderRegions, apresRenduRegions,
  renderEvolution, apresRenduEvolution,
  renderDistricts, apresRenduDistricts,
  renderQualite, apresRenduQualite,
} from "./tabs.js";

const RENDUS = {
  vue: { render: renderVue, apres: apresRenduVue },
  regions: { render: renderRegions, apres: apresRenduRegions },
  evolution: { render: renderEvolution, apres: apresRenduEvolution },
  districts: { render: renderDistricts, apres: apresRenduDistricts },
  qualite: { render: renderQualite, apres: apresRenduQualite },
};

let modeleCourant = null;
let themeCourant = null;

function afficherOnglet(nomOnglet) {
  const contenu = document.getElementById("contenu");
  const def = RENDUS[nomOnglet] || RENDUS.vue;
  contenu.innerHTML = def.render(modeleCourant);
  if (def.apres) def.apres(modeleCourant, themeCourant);

  document.querySelectorAll('nav.tabs button').forEach((btn) => {
    const actif = btn.dataset.tab === nomOnglet;
    btn.setAttribute("aria-selected", String(actif));
  });
  ecrireEtatHash({ tab: nomOnglet });
}

function verifierFraicheur(modele) {
  const banniere = document.getElementById("banniere-fraicheur");
  if (!modele.genereLe) return;
  const ageJours = (Date.now() - new Date(modele.genereLe).getTime()) / 86400000;
  if (ageJours > 8) {
    banniere.hidden = false;
    banniere.textContent = `Les données affichées datent de plus de 8 jours (générées le ${new Date(modele.genereLe).toLocaleDateString("fr-FR")}). Vérifier que l'extraction automatique du lundi s'est bien exécutée.`;
  }
}

async function init() {
  themeCourant = appliquerTheme(lireTheme());
  initDrawer();

  document.getElementById("btn-theme").addEventListener("click", () => {
    themeCourant = basculerTheme();
    basculerThemeCarte(themeCourant);
  });
  document.getElementById("btn-imprimer").addEventListener("click", () => window.print());
  document.getElementById("btn-lien").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      const btn = document.getElementById("btn-lien");
      const texteOriginal = btn.textContent;
      btn.textContent = "✓ Copié";
      setTimeout(() => (btn.textContent = texteOriginal), 1500);
    } catch {
      /* clipboard indisponible : rien a faire, le lien reste dans la barre d'adresse */
    }
  });

  document.querySelectorAll('nav.tabs button').forEach((btn) => {
    btn.addEventListener("click", () => afficherOnglet(btn.dataset.tab));
  });

  try {
    modeleCourant = await chargerDonnees();
  } catch (e) {
    document.getElementById("contenu").innerHTML = `<p class="note">Impossible de charger les données (${e.message}). Vérifiez que data/latest.json existe.</p>`;
    return;
  }

  document.getElementById("sous-titre").textContent = modeleCourant.semaineCle
    ? `Semaine du ${new Date(modeleCourant.semaineCle).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`
    : "Aucune donnée disponible";
  document.getElementById("footer-genere").textContent = modeleCourant.genereLe
    ? new Date(modeleCourant.genereLe).toLocaleString("fr-FR")
    : "—";

  verifierFraicheur(modeleCourant);

  const { tab } = lireEtatHash();
  afficherOnglet(RENDUS[tab] ? tab : "vue");
}

init();
