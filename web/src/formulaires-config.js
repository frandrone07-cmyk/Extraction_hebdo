// « Ajouter un formulaire » : choix des formulaires DHIS2 suivis (liste /api/dataSets avec recherche), renommage,
// ordre, retrait. La liste est enregistrée côté serveur (Cloudflare KV, protégée par le code PIN) et sert à la
// complétude, à la qualité des données et aux exports. Rien n'est écrit dans DHIS2.
import { enregistrerConfiguration, lireDhis2 } from "./dhis2-client.js";
import { echapper, erreurHtml, metadonnees, viderMemoire } from "./pages-live.js";

export function nettoyerFormulaires(liste) {
  return liste.filter((f) => /^[A-Za-z0-9]{11}$/.test(f.uid)).map((f, ordre) => ({ uid: f.uid, nom: String(f.nom || "").trim().slice(0, 120) || f.uid, ordre }));
}

export async function ouvrirGestionFormulaires(apresEnregistrement) {
  document.getElementById("dlg-formulaires")?.remove();
  const dialogue = document.createElement("dialog");
  dialogue.id = "dlg-formulaires";
  dialogue.className = "live-dialogue";
  dialogue.setAttribute("aria-labelledby", "dlg-formulaires-titre");
  dialogue.innerHTML = `<form method="dialog" class="live-dialogue-corps">
    <header><h2 id="dlg-formulaires-titre">Formulaires suivis</h2><button type="button" class="icon-button" data-fermer aria-label="Fermer">×</button></header>
    <div id="dlg-f-contenu"><p class="live-chargement">Chargement de la liste des formulaires DHIS2…</p></div>
  </form>`;
  document.body.appendChild(dialogue);
  dialogue.addEventListener("close", () => dialogue.remove());
  dialogue.querySelector("[data-fermer]").addEventListener("click", () => dialogue.close());
  dialogue.showModal();

  const contenu = dialogue.querySelector("#dlg-f-contenu");
  let meta;
  let disponibles;
  try {
    meta = await metadonnees();
    const r = await lireDhis2("dataSets.json", { fields: "id,displayName,periodType", paging: "false" });
    disponibles = (r.donnees?.dataSets || []).map((d) => ({ uid: d.id, nom: d.displayName, periodicite: d.periodType })).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  } catch (erreur) {
    contenu.innerHTML = erreurHtml(erreur);
    return;
  }
  let choisis = nettoyerFormulaires([...(meta.config.formulaires || [])].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0)));

  const dessinerChoisis = () => {
    const zone = contenu.querySelector("#dlg-f-choisis");
    zone.innerHTML = choisis.length ? choisis.map((f, i) => `<li data-uid="${f.uid}">
        <input type="text" value="${echapper(f.nom)}" aria-label="Nom affiché pour ${echapper(f.nom)}" data-renommer="${i}">
        <button type="button" data-monter="${i}" aria-label="Monter ${echapper(f.nom)}" ${i === 0 ? "disabled" : ""}>↑</button>
        <button type="button" data-descendre="${i}" aria-label="Descendre ${echapper(f.nom)}" ${i === choisis.length - 1 ? "disabled" : ""}>↓</button>
        <button type="button" data-retirer="${i}" aria-label="Retirer ${echapper(f.nom)}">Retirer</button></li>`).join("") : `<li class="note">Aucun formulaire suivi.</li>`;
    contenu.querySelectorAll('input[name="dlg-f-ds"]').forEach((c) => { c.checked = choisis.some((f) => f.uid === c.value); });
  };

  contenu.innerHTML = `<div class="dlg-f-grille">
      <section><h3>Formulaires DHIS2 (${disponibles.length})</h3>
        <input type="search" id="dlg-f-recherche" placeholder="Rechercher un formulaire…" aria-label="Rechercher un formulaire">
        <div class="fg-liste dlg-f-liste" role="group" aria-label="Formulaires DHIS2">${disponibles.map((d) => `<label data-nom="${echapper(d.nom.toLowerCase())}"><input type="checkbox" name="dlg-f-ds" value="${d.uid}"> ${echapper(d.nom)} <small>(${echapper(d.periodicite || "")})</small></label>`).join("")}</div></section>
      <section><h3>Suivis, dans l’ordre d’affichage</h3><ol id="dlg-f-choisis" class="dlg-f-choisis"></ol></section>
    </div>
    <footer class="dlg-f-pied"><label>Code PIN <input type="password" id="dlg-f-pin" inputmode="numeric" autocomplete="off" required></label>
      <button type="button" class="live-actualiser" id="dlg-f-enregistrer">Enregistrer</button><span id="dlg-f-message" role="status"></span></footer>`;
  dessinerChoisis();

  contenu.querySelector("#dlg-f-recherche").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    contenu.querySelectorAll(".dlg-f-liste label").forEach((l) => { l.hidden = Boolean(q) && !l.dataset.nom.includes(q); });
  });
  contenu.addEventListener("change", (e) => {
    if (e.target.name === "dlg-f-ds") {
      const d = disponibles.find((x) => x.uid === e.target.value);
      choisis = e.target.checked ? [...choisis, { uid: d.uid, nom: d.nom }] : choisis.filter((f) => f.uid !== d.uid);
      dessinerChoisis();
    } else if (e.target.dataset.renommer !== undefined) {
      choisis[Number(e.target.dataset.renommer)].nom = e.target.value;
    }
  });
  contenu.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const echanger = (i, j) => { [choisis[i], choisis[j]] = [choisis[j], choisis[i]]; dessinerChoisis(); };
    if (b.dataset.monter) echanger(Number(b.dataset.monter), Number(b.dataset.monter) - 1);
    else if (b.dataset.descendre) echanger(Number(b.dataset.descendre), Number(b.dataset.descendre) + 1);
    else if (b.dataset.retirer) { choisis.splice(Number(b.dataset.retirer), 1); dessinerChoisis(); }
    else if (b.id === "dlg-f-enregistrer") {
      const message = contenu.querySelector("#dlg-f-message");
      const pin = contenu.querySelector("#dlg-f-pin").value.trim();
      if (!pin) { message.textContent = "Saisissez le code PIN."; return; }
      message.textContent = "Enregistrement…";
      try {
        await enregistrerConfiguration({ ...meta.config, formulaires: nettoyerFormulaires(choisis) }, pin);
        viderMemoire();
        dialogue.close();
        apresEnregistrement?.();
      } catch (erreur) {
        message.textContent = erreur.message;
      }
    }
  });
}
