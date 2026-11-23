// Ajout (ou association) d'un indicateur FARS : recherche dans tous les indicateurs DHIS2 (par nom ou par groupe),
// choix du programme, de la cible et du sens. Le choix est gardé dans le navigateur (aucun code PIN, rien n'est
// écrit dans DHIS2).
import { lireDhis2 } from "./dhis2-client.js";
import { echapper, erreurHtml } from "./pages-live.js";

// Nettoie une liste saisie (UID valides, sans doublon, cible numérique « 80,5 » acceptée).
export function nettoyerIndicateurs(liste) {
  const indicateurs = [];
  const cibles = {};
  for (const i of liste) {
    if (!/^[A-Za-z0-9]{11}$/.test(i.uid) || indicateurs.some((x) => x.uid === i.uid)) continue;
    indicateurs.push({ uid: i.uid, nom: String(i.nom || "").trim().slice(0, 120) || i.uid, programme: String(i.programme || "").trim().slice(0, 60) || "Autres" });
    const cible = String(i.cible ?? "").replace(",", ".").trim();
    if (cible !== "" && Number.isFinite(Number(cible))) cibles[i.uid] = Number(cible);
  }
  return { indicateurs, cibles };
}

// options : { programmes: [..], modele: indicateur existant à associer (nom, programme, cible, sens) ou null }
// surValidation({ uid, nom, programme, cible, sens })
export async function ouvrirAjoutIndicateur({ programmes = [], modele = null } = {}, surValidation) {
  document.getElementById("dlg-fars")?.remove();
  const dialogue = document.createElement("dialog");
  dialogue.id = "dlg-fars";
  dialogue.className = "live-dialogue";
  dialogue.setAttribute("aria-labelledby", "dlg-fars-titre");
  const titre = modele ? `Associer « ${modele.nom} » à un indicateur DHIS2` : "Ajouter un indicateur FARS";
  dialogue.innerHTML = `<form method="dialog" class="live-dialogue-corps">
    <header><h2 id="dlg-fars-titre">${echapper(titre)}</h2><button type="button" class="icon-button" data-fermer aria-label="Fermer">×</button></header>
    <div class="dlg-f-grille">
      <section><h3>1. Choisir l’indicateur dans DHIS2</h3>
        <label class="fg-champ">Rechercher par nom <input type="search" id="dlg-fars-recherche" placeholder="Au moins 2 lettres, ex. CPN1, RR 1, MILDA…" value="${echapper(modele ? modele.nom.split(/[(,]/)[0].slice(0, 40) : "")}"></label>
        <label class="fg-champ">ou par groupe d’indicateurs <select id="dlg-fars-groupe"><option value="">— Chargement… —</option></select></label>
        <div class="fg-liste dlg-f-liste" id="dlg-fars-resultats" role="radiogroup" aria-label="Indicateurs DHIS2"><small>Tapez un nom ou choisissez un groupe.</small></div></section>
      <section><h3>2. Programme et cible</h3>
        <label class="fg-champ">Programme <input type="text" id="dlg-fars-programme" list="dlg-fars-programmes" value="${echapper(modele?.programme || "")}" placeholder="ex. PEV, Paludisme…"></label>
        <datalist id="dlg-fars-programmes">${programmes.map((p) => `<option value="${echapper(p)}">`).join("")}</datalist>
        <label class="fg-champ">Nom affiché <input type="text" id="dlg-fars-nom" value="${echapper(modele?.nom || "")}" placeholder="repris de DHIS2 si vide"></label>
        <label class="fg-champ">Cible (facultative) <input type="text" inputmode="decimal" id="dlg-fars-cible" value="${modele?.cible ?? ""}" placeholder="ex. 90"></label>
        <label class="fg-champ">La cible est <select id="dlg-fars-sens"><option value="haut" ${modele?.sens !== "bas" ? "selected" : ""}>un minimum à atteindre (plus c’est haut, mieux c’est)</option><option value="bas" ${modele?.sens === "bas" ? "selected" : ""}>un maximum à ne pas dépasser (ex. taux de décès)</option></select></label>
      </section>
    </div>
    <footer class="dlg-f-pied"><button type="button" class="live-actualiser" id="dlg-fars-valider">${modele ? "Associer" : "Ajouter au suivi"}</button><span id="dlg-fars-message" role="status"></span></footer>
  </form>`;
  document.body.appendChild(dialogue);
  dialogue.addEventListener("close", () => dialogue.remove());
  dialogue.querySelector("[data-fermer]").addEventListener("click", () => dialogue.close());
  dialogue.showModal();

  const $ = (sel) => dialogue.querySelector(sel);
  const resultatsZone = $("#dlg-fars-resultats");
  const afficher = (liste) => {
    resultatsZone.innerHTML = liste.length
      ? liste.map((i) => `<label><input type="radio" name="dlg-fars-ind" value="${i.id}" data-nom="${echapper(i.displayName)}"> ${echapper(i.displayName)}</label>`).join("")
      : "<small>Aucun indicateur trouvé.</small>";
  };
  const chercher = async (q) => {
    if (q.length < 2) return;
    try {
      const r = await lireDhis2("indicators.json", { fields: "id,displayName", filter: `displayName:ilike:${q}`, pageSize: 60, order: "displayName:asc" });
      afficher(r.donnees?.indicators || []);
    } catch (erreur) { resultatsZone.innerHTML = erreurHtml(erreur); }
  };
  lireDhis2("indicatorGroups.json", { fields: "id,displayName", paging: "false" }).then((r) => {
    const groupes = (r.donnees?.indicatorGroups || []).sort((a, b) => a.displayName.localeCompare(b.displayName, "fr"));
    $("#dlg-fars-groupe").innerHTML = `<option value="">— Choisir un groupe —</option>${groupes.map((g) => `<option value="${g.id}">${echapper(g.displayName)}</option>`).join("")}`;
  }).catch(() => { $("#dlg-fars-groupe").innerHTML = `<option value="">Groupes indisponibles</option>`; });
  if ($("#dlg-fars-recherche").value.trim()) chercher($("#dlg-fars-recherche").value.trim());

  let minuterie = null;
  $("#dlg-fars-recherche").addEventListener("input", (e) => { clearTimeout(minuterie); minuterie = setTimeout(() => chercher(e.target.value.trim()), 350); });
  $("#dlg-fars-groupe").addEventListener("change", async (e) => {
    if (!e.target.value) return;
    try {
      const r = await lireDhis2(`indicatorGroups/${e.target.value}.json`, { fields: "indicators[id,displayName]" });
      afficher((r.donnees?.indicators || []).sort((a, b) => a.displayName.localeCompare(b.displayName, "fr")));
    } catch (erreur) { resultatsZone.innerHTML = erreurHtml(erreur); }
  });
  $("#dlg-fars-valider").addEventListener("click", () => {
    const choisi = dialogue.querySelector('input[name="dlg-fars-ind"]:checked');
    const message = $("#dlg-fars-message");
    if (!choisi) { message.textContent = "Choisissez un indicateur dans la liste."; return; }
    const cibleTexte = $("#dlg-fars-cible").value.replace(",", ".").trim();
    if (cibleTexte && !Number.isFinite(Number(cibleTexte))) { message.textContent = "La cible doit être un nombre (ex. 90 ou 93,5)."; return; }
    surValidation({
      uid: choisi.value,
      nom: $("#dlg-fars-nom").value.trim() || choisi.dataset.nom,
      programme: $("#dlg-fars-programme").value.trim() || "Autres",
      cible: cibleTexte ? Number(cibleTexte) : null,
      sens: $("#dlg-fars-sens").value === "bas" ? "bas" : "haut",
    });
    dialogue.close();
  });
}
