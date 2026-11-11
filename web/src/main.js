import { chargerDonnees, construireModele, optionsPour } from "./data.js";
import { ecrireEtatHash, lireEtatHash, lireTheme, appliquerTheme, basculerTheme } from "./state.js";
import { basculerThemeCarte } from "./map.js";
import { initDrawer } from "./drawer.js";
import { demarrerDiaporama } from "./slideshow.js";
import { initSokhnaci, mettreAJourSokhnaci, replierSokhnaci } from "./sokhnaci.js";
import { initTrigger } from "./trigger.js";
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
const SELECTORS = {
  extraction: "sel-extraction",
  comparaison: "sel-comparaison",
  region: "sel-region",
  periode: "sel-periode",
  formulaire: "sel-formulaire",
};

let donnees = null;
let modeleCourant = null;
let themeCourant = null;
let ongletCourant = "vue";
let stateCourant = {};
let toastTimer = null;
let sokhnaciInitialise = false;

function echapper(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}
function formaterDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}
function optionsSelect(select, items, selectedValue) {
  select.innerHTML = items.map(({ value, label }) => `<option value="${echapper(value)}">${echapper(label)}</option>`).join("");
  if (items.some((item) => item.value === selectedValue)) select.value = selectedValue;
  else select.value = items[0]?.value ?? "";
}
function weeksBefore(week) {
  const index = donnees.snapshot.semaines.indexOf(week);
  return donnees.snapshot.semaines.slice(0, index).reverse();
}
function filtresValides(week, requested) {
  const available = optionsPour(donnees.snapshot, week);
  const period = requested.periode === "*" ? "*"
    : available.periodes.some((item) => item.value === requested.periode) ? requested.periode : available.periodes.at(-1)?.value || "*";
  return {
    extraction: week,
    comparaison: requested.comparaison === "none" ? "none" : weeksBefore(week).includes(requested.comparaison) ? requested.comparaison : weeksBefore(week)[0] || "none",
    region: available.regions.some((item) => item.value === requested.region) ? requested.region : "",
    periode: period,
    formulaire: available.formulaires.some((item) => item.value === requested.formulaire) ? requested.formulaire : "",
  };
}
function remplirFiltres(filters) {
  const snapshot = donnees.snapshot;
  const weeks = [...snapshot.semaines].reverse();
  optionsSelect(document.getElementById(SELECTORS.extraction), weeks.map((week) => ({ value: week, label: formaterDate(week) })), filters.extraction);
  const comparisons = [{ value: "none", label: "Aucune comparaison" }, ...weeksBefore(filters.extraction).map((week) => ({ value: week, label: formaterDate(week) }))];
  optionsSelect(document.getElementById(SELECTORS.comparaison), comparisons, filters.comparaison);
  const options = optionsPour(snapshot, filters.extraction);
  optionsSelect(document.getElementById(SELECTORS.region), [{ value: "", label: "Toutes les régions" }, ...options.regions], filters.region);
  optionsSelect(document.getElementById(SELECTORS.periode), [{ value: "*", label: "Toutes les périodes" }, ...options.periodes], filters.periode);
  optionsSelect(document.getElementById(SELECTORS.formulaire), [{ value: "", label: "Tous les formulaires" }, ...options.formulaires], filters.formulaire);
}
function afficherOnglet(name) {
  const content = document.getElementById("contenu");
  const definition = RENDUS[name] || RENDUS.vue;
  ongletCourant = RENDUS[name] ? name : "vue";
  content.innerHTML = definition.render(modeleCourant);
  if (definition.apres) definition.apres(modeleCourant, themeCourant);
  if (ongletCourant !== "vue") replierSokhnaci();
  content.setAttribute("aria-busy", "false");
  document.querySelectorAll('[role="tab"][data-tab]').forEach((button) => {
    const active = button.dataset.tab === ongletCourant;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  ecrireEtatHash({ tab: ongletCourant });
}
function afficherToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("on"), 2300);
}
function mettreAJourEntete() {
  const week = modeleCourant.semaineCle;
  document.getElementById("sous-titre").textContent = week ? formaterDate(week) : "Aucune donnée disponible";
  document.getElementById("footer-genere").textContent = donnees.latest.genere_le
    ? new Date(donnees.latest.genere_le).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })
    : "—";
  const generatedAt = donnees.latest.genere_le ? new Date(donnees.latest.genere_le) : null;
  if (!generatedAt) return;
  const ageDays = (Date.now() - generatedAt.getTime()) / 86400000;
  const banner = document.getElementById("banniere-fraicheur");
  if (ageDays > 8) {
    banner.hidden = false;
    banner.textContent = `Les dernières données publiées datent du ${generatedAt.toLocaleDateString("fr-FR")}. Vérifiez l’exécution de l’extraction hebdomadaire.`;
  } else banner.hidden = true;
}
function verifierDependances() {
  const absentes = [];
  if (typeof Chart === "undefined") absentes.push("graphiques Chart.js");
  if (typeof L === "undefined") absentes.push("carte Leaflet");
  const banner = document.getElementById("banniere-dependances");
  banner.hidden = absentes.length === 0;
  if (absentes.length) banner.textContent = `Les ${absentes.join(" et ")} ne sont pas chargés. Vérifiez la connexion Internet pour afficher toutes les visualisations.`;
}
function rafraichir(filters, { writeHash = true } = {}) {
  const validated = filtresValides(filters.extraction || donnees.latest.semaine_cle, filters);
  remplirFiltres(validated);
  const selected = Object.fromEntries(Object.entries(SELECTORS).map(([key, id]) => [key, document.getElementById(id).value]));
  modeleCourant = construireModele(donnees.snapshot, selected.extraction, selected.comparaison, {
    region: selected.region,
    periode: selected.periode,
    formulaire: selected.formulaire,
  }, donnees.evolution, donnees.geo);
  stateCourant = { ...stateCourant, ...selected };
  mettreAJourEntete();
  if (sokhnaciInitialise) mettreAJourSokhnaci(modeleCourant);
  if (writeHash) ecrireEtatHash({ ...selected, tab: ongletCourant });
  afficherOnglet(ongletCourant);
}
function selectionInitiale() {
  const hash = lireEtatHash();
  const week = donnees.snapshot.semaines.includes(hash.extraction) ? hash.extraction : donnees.latest.semaine_cle;
  stateCourant = filtresValides(week, hash);
  ongletCourant = RENDUS[hash.tab] ? hash.tab : "vue";
  rafraichir(stateCourant, { writeHash: false });
}
function initTabs() {
  document.querySelectorAll('[role="tab"][data-tab]').forEach((button) => {
    button.addEventListener("click", () => { ongletCourant = button.dataset.tab; afficherOnglet(ongletCourant); });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...document.querySelectorAll('[role="tab"][data-tab]')];
      const index = buttons.indexOf(button);
      const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length;
      buttons[target].focus();
      buttons[target].click();
    });
  });
}
function initFilters() {
  Object.entries(SELECTORS).forEach(([key, id]) => {
    document.getElementById(id).addEventListener("change", () => {
      const requested = Object.fromEntries(Object.entries(SELECTORS).map(([name, selectorId]) => [name, document.getElementById(selectorId).value]));
      if (key === "extraction") {
        requested.comparaison = weeksBefore(requested.extraction)[0] || "none";
        requested.periode = "latest";
      }
      rafraichir(requested);
    });
  });
  document.getElementById("btn-reset").addEventListener("click", () => {
    ongletCourant = "vue";
    rafraichir({ extraction: donnees.latest.semaine_cle, comparaison: "none", region: "", periode: "latest", formulaire: "" });
  });
  window.addEventListener("completude:filter", (event) => {
    rafraichir({ ...stateCourant, ...event.detail });
  });
}
function initActions() {
  document.getElementById("btn-theme").addEventListener("click", () => {
    themeCourant = basculerTheme();
    const button = document.getElementById("btn-theme");
    const label = themeCourant === "dark" ? "Activer le thème clair" : "Activer le thème sombre";
    button.setAttribute("aria-label", label);
    button.title = label;
    basculerThemeCarte(themeCourant);
    afficherOnglet(ongletCourant);
  });
  document.getElementById("btn-imprimer").addEventListener("click", () => window.print());
  document.getElementById("btn-lien").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); afficherToast("Lien de partage copié."); }
    catch { afficherToast("Copiez l’adresse affichée dans votre navigateur."); }
  });
  document.getElementById("btn-tv").addEventListener("click", () => {
    demarrerDiaporama(modeleCourant, { refresh: actualiserPendantDiaporama, close: () => afficherOnglet(ongletCourant) });
  });
}
function synchroniserHash() {
  const hash = lireEtatHash();
  const week = donnees.snapshot.semaines.includes(hash.extraction) ? hash.extraction : donnees.latest.semaine_cle;
  stateCourant = filtresValides(week, hash);
  ongletCourant = RENDUS[hash.tab] ? hash.tab : "vue";
  rafraichir(stateCourant, { writeHash: false });
}

async function actualiserPendantDiaporama() {
  const previousLatest = donnees.latest.semaine_cle;
  const selectedWasLatest = stateCourant.extraction === previousLatest;
  const newData = await chargerDonnees();
  const requestedWeek = selectedWasLatest ? newData.latest.semaine_cle : stateCourant.extraction;
  const requestedFilters = { ...stateCourant, extraction: requestedWeek };
  if (selectedWasLatest && requestedWeek !== previousLatest) {
    requestedFilters.comparaison = previousLatest;
    requestedFilters.periode = "latest";
  }
  donnees = newData;
  stateCourant = filtresValides(requestedWeek, requestedFilters);
  remplirFiltres(stateCourant);
  const selected = Object.fromEntries(Object.entries(SELECTORS).map(([key, id]) => [key, document.getElementById(id).value]));
  stateCourant = { ...stateCourant, ...selected };
  modeleCourant = construireModele(donnees.snapshot, selected.extraction, selected.comparaison, {
    region: selected.region,
    periode: selected.periode,
    formulaire: selected.formulaire,
  }, donnees.evolution, donnees.geo);
  mettreAJourEntete();
  if (sokhnaciInitialise) mettreAJourSokhnaci(modeleCourant);
  ecrireEtatHash({ ...selected, tab: ongletCourant });
  return modeleCourant;
}

async function init() {
  themeCourant = appliquerTheme(lireTheme());
  const themeLabel = themeCourant === "dark" ? "Activer le thème clair" : "Activer le thème sombre";
  document.getElementById("btn-theme").setAttribute("aria-label", themeLabel);
  document.getElementById("btn-theme").title = themeLabel;
  initDrawer();
  initTabs();
  initActions();
  initTrigger();
  try {
    donnees = await chargerDonnees();
  } catch (error) {
    const content = document.getElementById("contenu");
    content.setAttribute("aria-busy", "false");
    content.innerHTML = `<section class="card"><h2>Les données ne sont pas disponibles</h2><p class="note">${echapper(error.message)}. Réessayez dans quelques instants.</p></section>`;
    return;
  }
  initFilters();
  selectionInitiale();
  verifierDependances();
  initSokhnaci(modeleCourant);
  sokhnaciInitialise = true;
  if (ongletCourant !== "vue") replierSokhnaci();
  const tvParams = new URLSearchParams(location.hash.slice(1));
  if (tvParams.has("tv")) {
    demarrerDiaporama(modeleCourant, {
      initialSlide: Number(tvParams.get("tv")) || 0,
      refresh: actualiserPendantDiaporama,
      close: () => afficherOnglet(ongletCourant),
    });
  }
  window.addEventListener("hashchange", synchroniserHash);
}

init();
