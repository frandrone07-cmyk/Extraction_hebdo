// Écran de configuration des indicateurs FARS : recherche dans /api/indicators ou par groupe d'indicateurs,
// regroupement par programme, cibles. Enregistré côté serveur (Cloudflare KV, code PIN). Rien n'est écrit dans DHIS2.
import { enregistrerConfiguration, lireDhis2 } from "./dhis2-client.js";
import { echapper, erreurHtml, metadonnees, viderMemoire } from "./pages-live.js";

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

export async function ouvrirConfigurationFars(apresEnregistrement) {
  document.getElementById("dlg-fars")?.remove();
  const dialogue = document.createElement("dialog");
  dialogue.id = "dlg-fars";
  dialogue.className = "live-dialogue";
  dialogue.setAttribute("aria-labelledby", "dlg-fars-titre");
  dialogue.innerHTML = `<form method="dialog" class="live-dialogue-corps">
    <header><h2 id="dlg-fars-titre">Configurer les indicateurs FARS</h2><button type="button" class="icon-button" data-fermer aria-label="Fermer">×</button></header>
    <div id="dlg-fars-contenu"><p class="live-chargement">Chargement des groupes d’indicateurs DHIS2…</p></div></form>`;
  document.body.appendChild(dialogue);
  dialogue.addEventListener("close", () => dialogue.remove());
  dialogue.querySelector("[data-fermer]").addEventListener("click", () => dialogue.close());
  dialogue.showModal();
  const contenu = dialogue.querySelector("#dlg-fars-contenu");

  let meta;
  let groupes;
  try {
    meta = await metadonnees();
    const r = await lireDhis2("indicatorGroups.json", { fields: "id,displayName", paging: "false" });
    groupes = (r.donnees?.indicatorGroups || []).sort((a, b) => a.displayName.localeCompare(b.displayName, "fr"));
  } catch (erreur) {
    contenu.innerHTML = erreurHtml(erreur);
    return;
  }
  const fars = meta.config.fars || {};
  let choisis = (fars.indicateurs || []).map((i) => ({ ...i, cible: fars.cibles?.[i.uid] ?? "" }));
  let resultats = [];

  contenu.innerHTML = `<p class="note">Choisissez les indicateurs DHIS2 qui composent le FARS, puis indiquez pour chacun son programme (ex. « Paludisme », « Santé de la mère ») et, si elle existe, sa cible.</p>
    <div class="dlg-f-grille">
      <section><h3>Rechercher dans DHIS2</h3>
        <label class="fg-champ">Groupe d’indicateurs <select id="dlg-fars-groupe"><option value="">— Choisir un groupe —</option>${groupes.map((g) => `<option value="${g.id}" ${fars.groupe === g.displayName ? "selected" : ""}>${echapper(g.displayName)}</option>`).join("")}</select></label>
        <label class="fg-champ">ou par nom <input type="search" id="dlg-fars-recherche" placeholder="Au moins 2 lettres…"></label>
        <div class="fg-liste dlg-f-liste" id="dlg-fars-resultats" role="group" aria-label="Indicateurs DHIS2"><small>Choisissez un groupe ou tapez un nom.</small></div></section>
      <section><h3>Indicateurs FARS retenus</h3><div class="table-scroll"><table class="dlg-fars-table"><thead><tr><th>Indicateur</th><th>Programme</th><th>Cible</th><th>Actions</th></tr></thead><tbody id="dlg-fars-choisis"></tbody></table></div>
        <datalist id="dlg-fars-programmes"></datalist></section>
    </div>
    <footer class="dlg-f-pied"><label>Code PIN <input type="password" id="dlg-fars-pin" inputmode="numeric" autocomplete="off"></label>
      <button type="button" class="live-actualiser" id="dlg-fars-enregistrer">Enregistrer</button><span id="dlg-fars-message" role="status"></span></footer>`;

  const dessinerResultats = () => {
    contenu.querySelector("#dlg-fars-resultats").innerHTML = resultats.length
      ? resultats.map((i) => `<label><input type="checkbox" name="dlg-fars-ind" value="${i.id}" data-nom="${echapper(i.displayName)}" ${choisis.some((c) => c.uid === i.id) ? "checked" : ""}> ${echapper(i.displayName)}</label>`).join("")
      : "<small>Aucun indicateur trouvé.</small>";
  };
  const dessinerChoisis = () => {
    contenu.querySelector("#dlg-fars-programmes").innerHTML = [...new Set(choisis.map((c) => c.programme).filter(Boolean))].map((p) => `<option value="${echapper(p)}">`).join("");
    contenu.querySelector("#dlg-fars-choisis").innerHTML = choisis.length ? choisis.map((c, i) => `<tr>
        <td><input type="text" value="${echapper(c.nom)}" data-champ="nom" data-i="${i}" aria-label="Nom affiché"></td>
        <td><input type="text" value="${echapper(c.programme || "")}" list="dlg-fars-programmes" data-champ="programme" data-i="${i}" aria-label="Programme de ${echapper(c.nom)}"></td>
        <td><input type="text" inputmode="decimal" value="${echapper(c.cible)}" data-champ="cible" data-i="${i}" aria-label="Cible de ${echapper(c.nom)}" size="6"></td>
        <td><button type="button" data-retirer="${i}" aria-label="Retirer ${echapper(c.nom)}">Retirer</button></td></tr>`).join("")
      : `<tr><td colspan="4" class="note">Aucun indicateur retenu.</td></tr>`;
  };
  dessinerChoisis();

  let minuterie = null;
  contenu.querySelector("#dlg-fars-recherche").addEventListener("input", (e) => {
    clearTimeout(minuterie);
    const q = e.target.value.trim();
    if (q.length < 2) return;
    minuterie = setTimeout(async () => {
      try {
        const r = await lireDhis2("indicators.json", { fields: "id,displayName", filter: `displayName:ilike:${q}`, pageSize: 50 });
        resultats = r.donnees?.indicators || [];
        dessinerResultats();
      } catch (erreur) { contenu.querySelector("#dlg-fars-resultats").innerHTML = erreurHtml(erreur); }
    }, 350);
  });
  contenu.querySelector("#dlg-fars-groupe").addEventListener("change", async (e) => {
    if (!e.target.value) return;
    try {
      const r = await lireDhis2(`indicatorGroups/${e.target.value}.json`, { fields: "indicators[id,displayName]" });
      resultats = (r.donnees?.indicators || []).sort((a, b) => a.displayName.localeCompare(b.displayName, "fr"));
      dessinerResultats();
    } catch (erreur) { contenu.querySelector("#dlg-fars-resultats").innerHTML = erreurHtml(erreur); }
  });
  contenu.addEventListener("change", (e) => {
    if (e.target.name === "dlg-fars-ind") {
      choisis = e.target.checked ? [...choisis, { uid: e.target.value, nom: e.target.dataset.nom, programme: "", cible: "" }] : choisis.filter((c) => c.uid !== e.target.value);
      dessinerChoisis();
    } else if (e.target.dataset.champ) {
      choisis[Number(e.target.dataset.i)][e.target.dataset.champ] = e.target.value;
      if (e.target.dataset.champ === "programme") dessinerChoisis();
    }
  });
  contenu.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.retirer) { choisis.splice(Number(b.dataset.retirer), 1); dessinerChoisis(); dessinerResultats(); return; }
    if (b.id !== "dlg-fars-enregistrer") return;
    const message = contenu.querySelector("#dlg-fars-message");
    const pin = contenu.querySelector("#dlg-fars-pin").value.trim();
    if (!pin) { message.textContent = "Saisissez le code PIN."; return; }
    message.textContent = "Enregistrement…";
    const groupe = contenu.querySelector("#dlg-fars-groupe");
    try {
      await enregistrerConfiguration({ ...meta.config, fars: { groupe: groupe.value ? groupe.selectedOptions[0].textContent : fars.groupe || null, ...nettoyerIndicateurs(choisis) } }, pin);
      viderMemoire();
      dialogue.close();
      apresEnregistrement?.();
    } catch (erreur) { message.textContent = erreur.message; }
  });
}
