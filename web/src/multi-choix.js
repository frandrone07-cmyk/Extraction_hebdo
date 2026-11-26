// Liste déroulante à cases à cocher (régions, périodes, formulaires du panneau « Explorer les données »).
// L'élément hôte garde une valeur texte, comme une liste déroulante classique : les valeurs cochées séparées par
// « | » (ex. « DRS_Dakar|DRS_Thies »), ou la valeur « toutes » quand rien n'est restreint. Un événement « change »
// est émis à la validation (bouton « Appliquer », clic en dehors ou touche Échap), pas à chaque case cochée.
export const SEP = "|";

const echapper = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const valeursDe = (texte, tous = "") => (!texte || texte === tous ? [] : String(texte).split(SEP).filter(Boolean));

// Libellé résumé : « Toutes les régions », « Dakar », « Dakar, Thiès », « 4 régions sur 14 ».
export function resumeChoix(choisies, options, { tous, unite }) {
  if (!choisies.length || choisies.length === options.length) return tous;
  const libelles = choisies.map((v) => options.find((o) => o.value === v)?.label || v);
  return libelles.length <= 2 ? libelles.join(", ") : `${libelles.length} ${unite} sur ${options.length}`;
}

// hote : élément <div> ; options : [{ value, label }] ; valeur : texte courant ;
// reglages : { tous: "Toutes les régions", valeurTous: "" | "*", unite: "régions", etiquette: "Région" }
export function remplirMultiChoix(hote, options, valeur, reglages) {
  const { tous, valeurTous = "", unite, etiquette } = reglages;
  const choisies = valeursDe(valeur, valeurTous).filter((v) => options.some((o) => o.value === v));
  hote.value = choisies.length && choisies.length < options.length ? choisies.join(SEP) : valeurTous;
  hote.classList.add("mc");
  hote.setAttribute("role", "group");
  hote.setAttribute("aria-label", etiquette);
  const idPanneau = `${hote.id}-panneau`;
  hote.innerHTML = `<button type="button" class="mc-bouton" aria-haspopup="true" aria-expanded="false" aria-controls="${idPanneau}" title="${echapper(resumeChoix(choisies, options, { tous, unite }))}">${echapper(resumeChoix(choisies, options, { tous, unite }))}</button>
    <div class="mc-panneau" id="${idPanneau}" hidden>
      ${options.length > 8 ? `<input type="search" class="mc-recherche" placeholder="Rechercher…" aria-label="Rechercher dans ${echapper(etiquette)}">` : ""}
      <div class="mc-actions"><button type="button" data-mc="tout">Tout cocher</button><button type="button" data-mc="rien">Tout décocher</button></div>
      <div class="mc-liste">${options.map((o) => `<label data-nom="${echapper(o.label.toLowerCase())}"><input type="checkbox" value="${echapper(o.value)}" ${!choisies.length || choisies.includes(o.value) ? "checked" : ""}> ${echapper(o.label)}</label>`).join("")}</div>
      <div class="mc-pied"><button type="button" class="mc-appliquer" data-mc="appliquer">Appliquer</button></div>
    </div>`;
  hote.dataset.valeurTous = valeurTous;
  if (hote.dataset.branche) return;
  hote.dataset.branche = "1";
  const panneau = () => hote.querySelector(".mc-panneau");
  const bouton = () => hote.querySelector(".mc-bouton");
  const fermer = (valider) => {
    if (panneau().hidden) return;
    panneau().hidden = true;
    bouton().setAttribute("aria-expanded", "false");
    if (!valider) return;
    const coches = [...hote.querySelectorAll(".mc-liste input:checked")].map((c) => c.value);
    const total = hote.querySelectorAll(".mc-liste input").length;
    const nouvelle = coches.length && coches.length < total ? coches.join(SEP) : hote.dataset.valeurTous || "";
    if (nouvelle !== hote.value) {
      hote.value = nouvelle;
      hote.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
  hote.addEventListener("click", (e) => {
    const cible = e.target.closest("button");
    if (!cible) return;
    if (cible.classList.contains("mc-bouton")) {
      const afficher = panneau().hidden;
      document.querySelectorAll(".mc .mc-panneau:not([hidden])").forEach((p) => { if (p !== panneau()) p.closest(".mc").dispatchEvent(new CustomEvent("mc:fermer")); });
      panneau().hidden = !afficher;
      bouton().setAttribute("aria-expanded", String(afficher));
      if (afficher) (hote.querySelector(".mc-recherche") || hote.querySelector(".mc-liste input"))?.focus();
      else fermer(true);
      return;
    }
    if (cible.dataset.mc === "tout" || cible.dataset.mc === "rien") {
      hote.querySelectorAll(".mc-liste label:not([hidden]) input").forEach((c) => { c.checked = cible.dataset.mc === "tout"; });
    } else if (cible.dataset.mc === "appliquer") { fermer(true); bouton().focus(); }
  });
  // Les cases cochées émettent un « change » natif : on l'arrête (phase de capture) pour que seul le « change »
  // de validation de la liste parvienne au tableau de bord.
  hote.addEventListener("change", (e) => { if (e.target !== hote) e.stopPropagation(); }, true);
  hote.addEventListener("input", (e) => {
    if (!e.target.classList.contains("mc-recherche")) return;
    const q = e.target.value.trim().toLowerCase();
    hote.querySelectorAll(".mc-liste label").forEach((l) => { l.hidden = Boolean(q) && !l.dataset.nom.includes(q); });
  });
  hote.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panneau().hidden) { e.stopPropagation(); fermer(true); bouton().focus(); } });
  hote.addEventListener("mc:fermer", () => fermer(true));
  document.addEventListener("click", (e) => { if (!hote.contains(e.target)) fermer(true); });
}
