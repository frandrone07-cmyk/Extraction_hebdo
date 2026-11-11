const CLE_VOIX = "completude-sokhnaci-voice";
let widget = null;
let currentText = "";
let voiceEnabled = true;
let utterance = null;

function pct(value) { return value === null || value === undefined ? "non disponible" : `${Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} pour cent`; }
function points(value) { return `${Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} point${Math.abs(value) === 1 ? "" : "s"} de pourcentage`; }
function labelRegion(nom) { return nom.replace(/^DRS[_ ]/, ""); }
function moyenne(values) {
  const usable = values.filter((value) => value !== null && value !== undefined);
  return usable.length ? usable.reduce((a, b) => a + b, 0) / usable.length : null;
}

// Tendance sur les 3 dernieres semaines disponibles (pas seulement la
// comparaison a 1 semaine) : permet de distinguer une simple fluctuation
// d'une vraie stagnation ou d'une progression soutenue.
function tendanceRecente(serie) {
  const valeurs = serie.filter((value) => value !== null && value !== undefined);
  if (valeurs.length < 3) return null;
  const [a, b, c] = valeurs.slice(-3);
  const d1 = b - a;
  const d2 = c - b;
  if (d1 <= -1 && d2 <= -1) return "baisse";
  if (d1 >= 1 && d2 >= 1) return "hausse";
  if (Math.abs(d1) < 1 && Math.abs(d2) < 1) return "stagnation";
  return null;
}

function contexteFiltres(model) {
  const morceaux = [];
  if (model.selection.region !== "Toutes les régions") morceaux.push(`région ${model.selection.region}`);
  if (model.selection.formulaire !== "Tous les formulaires") morceaux.push(`formulaire « ${model.selection.formulaire} »`);
  if (model.selection.periode !== "Toutes les périodes") morceaux.push(`période ${model.selection.periode}`);
  return morceaux;
}

function creerTopo(model) {
  const date = model.semaineCle ? new Date(`${model.semaineCle}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "la dernière extraction";
  if (!model.districts.length) return `Bonjour, je suis Sokhnaci. Aucun résultat n’est disponible pour les filtres sélectionnés. Élargissez la sélection pour poursuivre l’analyse.`;

  const rate = moyenne(model.districts.map((district) => district.tauxMoyen));
  const previous = moyenne(model.districts.map((district) => district.tauxPrecedent));
  const difference = rate === null || previous === null ? null : Math.round((rate - previous) * 10) / 10;
  const critical = model.districts.filter((district) => district.statut === "critique");
  const regionsValides = [...model.regions].filter((region) => region.tauxMoyen !== null);
  const best = regionsValides.length ? regionsValides.sort((a, b) => b.tauxMoyen - a.tauxMoyen)[0] : null;
  const needsHelp = regionsValides.length ? regionsValides.sort((a, b) => a.tauxMoyen - b.tauxMoyen)[0] : null;
  const formulairesValides = [...(model.formulaires || [])].filter((formulaire) => formulaire.tauxMoyen !== null);
  const formulaireFaible = formulairesValides.length ? formulairesValides.sort((a, b) => a.tauxMoyen - b.tauxMoyen)[0] : null;
  const tendance = tendanceRecente(model.evolution?.moyenne_generale || []);
  const contexte = contexteFiltres(model);

  const parts = [];
  const introContexte = contexte.length ? ` (${contexte.join(", ")})` : "";
  parts.push(`Bonjour, je suis Sokhnaci. Pour l’extraction du ${date}${introContexte}, le taux moyen des districts sélectionnés est de ${pct(rate)}.`);

  if (difference !== null) {
    if (difference >= model.seuils.baisse) parts.push(`C’est une progression de ${points(difference)} par rapport au lundi précédent.`);
    else if (difference <= -model.seuils.baisse) parts.push(`C’est un recul de ${points(Math.abs(difference))} par rapport au lundi précédent — un point à examiner rapidement.`);
    else parts.push("Le niveau reste proche de celui de l’extraction de comparaison.");
  }

  if (tendance === "baisse") parts.push("Attention : la tendance nationale est à la baisse depuis trois semaines consécutives, ce n’est pas un accident isolé.");
  else if (tendance === "hausse") parts.push("Bonne nouvelle : la tendance nationale progresse depuis trois semaines consécutives.");
  else if (tendance === "stagnation" && rate !== null && rate < model.seuils.conforme) parts.push("La situation stagne depuis trois semaines sans réelle amélioration.");

  if (critical.length === 0) parts.push(`Aucun des ${model.districts.length} districts affichés n’est sous le seuil critique.`);
  else {
    const pire = critical.sort((a, b) => (a.tauxMoyen ?? 101) - (b.tauxMoyen ?? 101))[0];
    parts.push(`${critical.length} district${critical.length > 1 ? "s" : ""} ${critical.length > 1 ? "sont" : "est"} sous le seuil critique de ${model.seuils.critique} pour cent. Le plus faible est ${pire.nom}, à ${pct(pire.tauxMoyen)}.`);
  }

  if (best && needsHelp && best.nom !== needsHelp.nom) {
    parts.push(`${labelRegion(best.nom)} présente le taux régional le plus élevé (${pct(best.tauxMoyen)}) ; ${labelRegion(needsHelp.nom)} mérite le suivi le plus rapproché (${pct(needsHelp.tauxMoyen)}).`);
  }

  if (formulaireFaible && formulairesValides.length > 1 && formulaireFaible.tauxMoyen < model.seuils.conforme) {
    parts.push(`Le formulaire le moins bien renseigné est « ${formulaireFaible.nom} », à ${pct(formulaireFaible.tauxMoyen)} en moyenne — un point d’appui possible pour la prochaine relance.`);
  }

  if (model.districtsNonResolus?.length) {
    parts.push(`${model.districtsNonResolus.length} district${model.districtsNonResolus.length > 1 ? "s" : ""} du gabarit n’${model.districtsNonResolus.length > 1 ? "ont" : "a"} pas de correspondance DHIS2 reconnue : vérifiez l’orthographe dans l’onglet Qualité et méthode.`);
  }

  parts.push("Consultez les priorités et la fiche district pour préparer les actions de suivi.");
  return parts.join(" ");
}

function svgMarkup() {
  return `<svg class="sokhnaci-svg" viewBox="0 0 112 112" role="img" aria-label="Sokhnaci, guide du tableau de bord">
    <path class="tree-trunk" d="M51 63c-4 12-8 18-16 26 10-2 17-6 22-14 4 9 11 13 21 14-8-8-12-16-14-26z"/>
    <ellipse class="canopy canopy-a" cx="32" cy="38" rx="19" ry="20"/><ellipse class="canopy canopy-b" cx="54" cy="27" rx="23" ry="23"/><ellipse class="canopy canopy-c" cx="79" cy="39" rx="18" ry="20"/><ellipse class="canopy canopy-d" cx="42" cy="53" rx="20" ry="16"/><ellipse class="canopy canopy-e" cx="70" cy="53" rx="21" ry="17"/>
    <path class="leaf-line" d="M17 42c7-8 12-10 20-11m7-13c2 10 1 17-2 23m29-26c-3 9-5 15-11 20m35 8c-8-6-14-8-21-8M26 60c7-7 12-9 20-9m35 11c-7-7-13-10-22-10"/>
    <ellipse class="face" cx="56" cy="53" rx="19" ry="15"/><circle class="eye" cx="49" cy="52" r="2.2"/><circle class="eye" cx="63" cy="52" r="2.2"/><path class="brow" d="M45 46l7-1m7 0 7 1"/><path class="mouth-smile" d="M49 59q7 7 14 0"/><ellipse class="mouth-oh" cx="56" cy="60" rx="3" ry="4"/><path class="mouth-flat" d="M50 60h12"/>
    <path class="root" d="M26 91c10-5 19-6 30-4 12-2 21-1 30 4-8 3-17 5-30 4-13 1-22-1-30-4z"/>
    <path class="tiny-flag-green" d="M85 25V7"/><path class="tiny-flag" d="M86 8h15l-5 5 5 5H86z"/>
  </svg>`;
}

function parler() {
  if (!voiceEnabled || !currentText || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  utterance = new SpeechSynthesisUtterance(currentText);
  utterance.lang = "fr-FR";
  utterance.rate = 0.94;
  utterance.pitch = 1.02;
  utterance.onstart = () => widget?.classList.add("speaking");
  utterance.onend = utterance.onerror = () => widget?.classList.remove("speaking");
  window.speechSynthesis.speak(utterance);
}

function humeur(model) {
  const rate = moyenne(model.districts.map((district) => district.tauxMoyen));
  const previous = moyenne(model.districts.map((district) => district.tauxPrecedent));
  const critical = model.districts.filter((district) => district.statut === "critique").length;
  const tendance = tendanceRecente(model.evolution?.moyenne_generale || []);
  if (rate !== null && rate < model.seuils.critique) return "alerte";
  if (tendance === "baisse") return "alerte";
  if (previous !== null && rate !== null && rate - previous >= model.seuils.baisse) return "content";
  if (critical > 0) return "vigilant";
  if (rate !== null && rate >= model.seuils.conforme) return "serein";
  return "attentif";
}

function render(model, { speak = false } = {}) {
  currentText = creerTopo(model);
  const mood = humeur(model);
  const bubble = widget.querySelector(".sokhnaci-bubble");
  bubble.textContent = currentText;
  bubble.setAttribute("aria-label", currentText);
  widget.querySelector(".sokhnaci-svg").setAttribute("data-mood", mood);
  widget.querySelector(".sokhnaci-state").textContent = ({ alerte: "Point d’attention", vigilant: "À surveiller", attentif: "Analyse en cours", content: "En progression", serein: "Situation conforme" })[mood];
  if (speak) parler();
}

function majBoutonVoix(bouton) {
  const etat = voiceEnabled ? "activée" : "coupée";
  bouton.textContent = `Voix : ${etat}`;
  bouton.setAttribute("aria-pressed", String(voiceEnabled));
  bouton.setAttribute("aria-label", `Voix : ${etat}, cliquer pour ${voiceEnabled ? "désactiver" : "activer"}`);
}

export function replierSokhnaci() {
  if (!widget || widget.classList.contains("collapsed")) return;
  widget.classList.add("collapsed");
  widget.querySelector(".sokhnaci-launcher").hidden = false;
}

export function initSokhnaci(model) {
  if (widget) { render(model); return; }
  try { voiceEnabled = localStorage.getItem(CLE_VOIX) !== "false"; } catch { voiceEnabled = true; }
  widget = document.createElement("section");
  widget.className = "sokhnaci-widget";
  widget.setAttribute("aria-label", "Sokhnaci, synthèse vocale du tableau de bord");
  widget.innerHTML = `<div class="sokhnaci-card"><div class="sokhnaci-top"><div><p class="eyebrow">VOTRE GUIDE</p><strong>Sokhnaci</strong><span class="sokhnaci-state"></span></div><button class="sokhnaci-collapse" type="button" aria-label="Réduire Sokhnaci">−</button></div><div class="sokhnaci-content"><div class="sokhnaci-character">${svgMarkup()}</div><p class="sokhnaci-bubble" tabindex="0"></p><div class="sokhnaci-actions"><button class="sokhnaci-speak" type="button">▶ Écouter le résumé</button><button class="sokhnaci-voice" type="button" aria-pressed="true"></button></div></div></div><button class="sokhnaci-launcher" type="button" aria-label="Ouvrir le résumé Sokhnaci" hidden><span class="sokhnaci-mini" aria-hidden="true"></span><span>Sokhnaci</span></button>`;
  document.body.appendChild(widget);
  widget.querySelector(".sokhnaci-collapse").addEventListener("click", replierSokhnaci);
  widget.querySelector(".sokhnaci-launcher").addEventListener("click", () => {
    widget.classList.remove("collapsed");
    widget.querySelector(".sokhnaci-launcher").hidden = true;
  });
  widget.querySelector(".sokhnaci-speak").addEventListener("click", parler);
  widget.querySelector(".sokhnaci-voice").addEventListener("click", (event) => {
    voiceEnabled = !voiceEnabled;
    try { localStorage.setItem(CLE_VOIX, String(voiceEnabled)); } catch { /* stockage facultatif */ }
    majBoutonVoix(event.currentTarget);
    if (voiceEnabled) parler(); else window.speechSynthesis?.cancel();
  });
  majBoutonVoix(widget.querySelector(".sokhnaci-voice"));
  render(model, { speak: voiceEnabled });
  return widget;
}

export function mettreAJourSokhnaci(model) {
  if (widget) render(model);
}
