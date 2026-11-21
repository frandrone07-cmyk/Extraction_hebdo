// Rapports professionnels (Word, PDF, Excel) et export de conversation, générés dans le navigateur
// à partir des données affichées : rien n'est envoyé à un serveur.
import { interpreter, labelRegion, nomFormulaire, toutesDistricts, versAffichage } from "./sokhnaci-dialogue.js";
import { pointsAttention, sourcesPour } from "./sokhnaci-competences.js";

const arrondi = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const pct = (x) => (x === null || x === undefined ? "—" : `${arrondi(x)} %`);
const ecartTexte = (x) => (x === null || x === undefined ? "—" : `${x > 0 ? "+" : ""}${x} pt`);
const echapper = (texte) => String(texte ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function dateFr(iso) { return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }); }
function maintenant() { return new Date().toLocaleString("fr-FR", { timeZone: "Africa/Dakar", dateStyle: "long", timeStyle: "short" }); }

export function construireRapport(model) {
  const districts = toutesDistricts(model).filter((d) => d.tauxMoyen !== null && d.tauxMoyen !== undefined);
  const rouges = districts.filter((d) => d.tauxMoyen < model.seuils.critique).length;
  const oranges = districts.filter((d) => d.tauxMoyen >= model.seuils.critique && d.tauxMoyen < model.seuils.conforme).length;
  const verts = districts.length - rouges - oranges;
  const moyenne = districts.reduce((somme, d) => somme + d.tauxMoyen, 0) / (districts.length || 1);
  const asc = [...districts].sort((a, b) => a.tauxMoyen - b.tauxMoyen);
  const analyse = interpreter(model).segments.slice(0, -1).map((segment) => versAffichage(segment.texte));
  const ligneDistrict = (d, i) => [String(i + 1), d.nom, labelRegion(d.region), pct(d.tauxMoyen), ecartTexte(d.variation)];
  const sections = [
    { titre: "Synthèse", paragraphes: [
      `Extraction DHIS2 du ${dateFr(model.semaineCle)} · période : ${model.selection?.periode || "—"}.`,
      `Taux moyen des districts : ${pct(moyenne)}. ${rouges} districts sont en rouge (moins de ${model.seuils.critique} %), ${oranges} à surveiller et ${verts} conformes (${model.seuils.conforme} % et plus), sur ${districts.length} districts analysés.`,
    ] },
    { titre: "Analyse", paragraphes: analyse },
    { titre: "Points d’attention", paragraphes: pointsAttention(model).map((p) => `${p.titre} — ${p.detail}`) },
    { titre: "Districts à accompagner en priorité", tableau: { colonnes: ["Rang", "District", "Région", "Taux", "Écart"], lignes: asc.slice(0, 10).map(ligneDistrict) } },
    { titre: "Meilleurs districts", tableau: { colonnes: ["Rang", "District", "Région", "Taux", "Écart"], lignes: [...asc].reverse().slice(0, 10).map(ligneDistrict) } },
    { titre: "Régions", tableau: { colonnes: ["Région", "Taux moyen", "Districts", "En rouge", "Écart"], lignes: [...(model.toutesRegions || [])].sort((a, b) => (b.tauxMoyen ?? -1) - (a.tauxMoyen ?? -1)).map((r) => [labelRegion(r.nom), pct(r.tauxMoyen), String(r.districts.length), String(r.nbCritique), ecartTexte(r.variation)]) } },
    { titre: "Formulaires", tableau: { colonnes: ["Formulaire", "Taux moyen", "Écart"], lignes: [...(model.tousFormulaires || [])].sort((a, b) => (a.tauxMoyen ?? 101) - (b.tauxMoyen ?? 101)).map((f) => [nomFormulaire(f.nom), pct(f.tauxMoyen), ecartTexte(f.variation)]) } },
    { titre: "Évolution par extraction", tableau: { colonnes: ["Extraction", "Taux moyen (mois comparables)"], lignes: (model.evolution?.semaines || []).map((semaine, i) => [dateFr(semaine), pct(model.evolution.moyenne_generale[i])]) } },
  ];
  const sources = [...sourcesPour(model).map(versAffichage), "Les valeurs proviennent de DHIS2 ; aucune estimation n’a été ajoutée. Un mois récent peut encore progresser (rapports transmis en retard)."];
  return { titre: "Rapport de complétude des rapports DHIS2", sousTitre: `Généré par Sokhna Ci AI le ${maintenant()}`, sections, sources };
}

export function rapportHtml(rapport) {
  const corps = rapport.sections.map((section) => `<h2>${echapper(section.titre)}</h2>${(section.paragraphes || []).map((p) => `<p>${echapper(p)}</p>`).join("")}${section.tableau ? `<table><thead><tr>${section.tableau.colonnes.map((c) => `<th>${echapper(c)}</th>`).join("")}</tr></thead><tbody>${section.tableau.lignes.map((ligne) => `<tr>${ligne.map((cellule) => `<td>${echapper(cellule)}</td>`).join("")}</tr>`).join("")}</tbody></table>` : ""}`).join("");
  return `<!doctype html><html lang="fr" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${echapper(rapport.titre)}</title><style>
    body { font-family: Calibri, Arial, sans-serif; color: #172822; margin: 32px; line-height: 1.5; }
    h1 { color: #087f5b; font-size: 22pt; margin-bottom: 2px; } h2 { color: #0b5c42; font-size: 14pt; margin-top: 22px; border-bottom: 2px solid #087f5b; padding-bottom: 3px; }
    .sous-titre { color: #5e6f67; margin-top: 0; } table { border-collapse: collapse; width: 100%; margin: 8px 0 14px; font-size: 10pt; }
    th { background: #087f5b; color: #fff; text-align: left; } th, td { border: 1px solid #c9d6ce; padding: 5px 8px; } tr:nth-child(even) td { background: #f2f7f3; }
    .sources { font-size: 9pt; color: #5e6f67; margin-top: 24px; } @media print { body { margin: 14mm; } h2 { page-break-after: avoid; } table { page-break-inside: auto; } tr { page-break-inside: avoid; } }
  </style></head><body><h1>${echapper(rapport.titre)}</h1><p class="sous-titre">${echapper(rapport.sousTitre)}</p>${corps}<div class="sources"><strong>Sources et méthode</strong><ul>${rapport.sources.map((s) => `<li>${echapper(s)}</li>`).join("")}</ul></div></body></html>`;
}

function telecharger(blob, nom) {
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nom;
  document.body.append(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const suffixe = (model) => model.semaineCle;

export function telechargerWord(model) {
  telecharger(new Blob(["﻿", rapportHtml(construireRapport(model))], { type: "application/msword;charset=utf-8" }), `Rapport_completude_${suffixe(model)}.doc`);
}

export function imprimerPdf(model) {
  const cadre = document.createElement("iframe");
  cadre.setAttribute("aria-hidden", "true");
  cadre.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.append(cadre);
  cadre.srcdoc = rapportHtml(construireRapport(model));
  cadre.onload = () => {
    cadre.contentWindow.focus();
    cadre.contentWindow.print();
    setTimeout(() => cadre.remove(), 60000);
  };
}

function chargerScript(url) {
  return new Promise((resolve, reject) => {
    if (window.XLSX) { resolve(); return; }
    const balise = document.createElement("script");
    balise.src = url;
    balise.onload = resolve;
    balise.onerror = () => reject(new Error("script indisponible"));
    document.head.append(balise);
  });
}

const URL_TABLEUR = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
export function chargerBibliothequeTableur() { return chargerScript(URL_TABLEUR); }

// Excel (.xlsx) via SheetJS ; si la bibliothèque est injoignable, repli sur un fichier CSV lisible par Excel.
export async function telechargerExcel(model) {
  const rapport = construireRapport(model);
  const feuilles = rapport.sections.filter((s) => s.tableau);
  try {
    await chargerBibliothequeTableur();
    const classeur = window.XLSX.utils.book_new();
    const synthese = [[rapport.titre], [rapport.sousTitre], [], ...rapport.sections.filter((s) => s.paragraphes).flatMap((s) => [[s.titre], ...s.paragraphes.map((p) => [p]), []]), ["Sources et méthode"], ...rapport.sources.map((s) => [s])];
    window.XLSX.utils.book_append_sheet(classeur, window.XLSX.utils.aoa_to_sheet(synthese), "Synthèse");
    for (const feuille of feuilles) window.XLSX.utils.book_append_sheet(classeur, window.XLSX.utils.aoa_to_sheet([feuille.tableau.colonnes, ...feuille.tableau.lignes]), feuille.titre.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
    window.XLSX.writeFile(classeur, `Rapport_completude_${suffixe(model)}.xlsx`);
    return "xlsx";
  } catch {
    const csv = feuilles.map((f) => [f.titre, f.tableau.colonnes.join(";"), ...f.tableau.lignes.map((l) => l.join(";")), ""].join("\n")).join("\n");
    telecharger(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }), `Rapport_completude_${suffixe(model)}.csv`);
    return "csv";
  }
}

export function telechargerConversation(messages, model) {
  const lignes = [`# Conversation avec Sokhna Ci AI`, `Extraction DHIS2 du ${dateFr(model.semaineCle)} · exportée le ${maintenant()}`, ""];
  for (const message of messages) {
    lignes.push(message.role === "utilisateur" ? `**Vous** : ${message.texte}` : `**Sokhna Ci** : ${message.texte}`);
    if (message.sources?.length) lignes.push("", ...message.sources.map((s) => `> Source : ${s}`));
    lignes.push("");
  }
  telecharger(new Blob(["﻿", lignes.join("\n")], { type: "text/markdown;charset=utf-8" }), `Conversation_Sokhna_Ci_${suffixe(model)}.md`);
}
