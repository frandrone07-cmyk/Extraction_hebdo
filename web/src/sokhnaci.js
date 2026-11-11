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
  return `<svg class="sokhnaci-svg" viewBox="0 0 112 112" role="img" aria-label="Bébé Sokhnaci, guide du tableau de bord">
    <ellipse class="baby-shadow" cx="56" cy="104" rx="29" ry="5"/>
    <g class="baby-arm baby-arm-left"><path class="baby-skin" d="M39 69c-7 1-11 6-13 13l-4 7c-2 4 2 7 5 4l8-7c5-3 8-7 10-12z"/><circle class="baby-skin" cx="23" cy="94" r="4"/></g>
    <g class="baby-arm baby-arm-right"><path class="baby-skin" d="M73 69c7 1 11 6 13 13l4 7c2 4-2 7-5 4l-8-7c-5-3-8-7-10-12z"/><circle class="baby-skin" cx="89" cy="94" r="4"/></g>
    <path class="baby-shirt" d="M37 69c6-5 12-7 19-7s13 2 19 7l7 27H30z"/>
    <path class="baby-shirt-collar" d="m47 66 9 8 9-8"/>
    <circle class="baby-ear baby-skin" cx="31" cy="43" r="7"/><circle class="baby-ear baby-skin" cx="81" cy="43" r="7"/>
    <ellipse class="baby-face baby-skin" cx="56" cy="43" rx="27" ry="29"/>
    <path class="baby-hair" d="M29 43c-3-17 8-31 25-32 19-1 31 12 29 31-4-4-7-9-8-15-6 6-15 9-24 8-7 0-13-2-18-6-1 5-2 10-4 14z"/>
    <path class="baby-tuft" d="M48 13c-2-7 3-11 8-8 3-6 10-3 9 3 6-1 8 5 4 9-7-3-14-4-21-4z"/>
    <path class="baby-brow" d="M42 40q5-4 10 0m8 0q5-4 10 0"/>
    <ellipse class="baby-eye" cx="47" cy="46" rx="2.2" ry="3"/><ellipse class="baby-eye" cx="65" cy="46" rx="2.2" ry="3"/>
    <ellipse class="baby-cheek" cx="39" cy="55" rx="5" ry="2.5"/><ellipse class="baby-cheek" cx="73" cy="55" rx="5" ry="2.5"/>
    <path class="baby-mouth-smile" d="M49 57q7 7 14 0"/><ellipse class="baby-mouth-open" cx="56" cy="59" rx="3.5" ry="4.5"/><path class="baby-mouth-flat" d="M51 59h10"/>
    <path class="baby-shirt-mark" d="M53 84h6m-3-3v6"/>
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
  widget.setAttribute("aria-label", "Bébé Sokhnaci, guide vocal du tableau de bord");
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
