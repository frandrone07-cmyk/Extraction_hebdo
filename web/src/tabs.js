import { grapheBarres, grapheBarresEmpilees, grapheDoughnut, grapheLigne, couleurStatut } from "./charts.js";
import { afficherDistricts, initCarte } from "./map.js";
import { ouvrirFicheDistrict } from "./drawer.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function libelleRegion(nom) {
  return nom.replace(/^DRS_/, "");
}

function puceStatut(statut) {
  return `<span class="statut-puce statut-${statut}" aria-hidden="true"></span>`;
}

// Tri générique par en-tête cliquable : réutilisé par les tableaux Districts,
// Synthèse par région et Synthèse par formulaire.
function attacherTriTable(tableId) {
  let triColonne = null;
  let triAsc = true;
  const table = document.getElementById(tableId);
  if (!table) return;
  table.querySelectorAll("th").forEach((th, idx) => {
    th.addEventListener("click", () => {
      const tbody = table.querySelector("tbody");
      const toutes = Array.from(tbody.querySelectorAll("tr"));
      triAsc = triColonne === idx ? !triAsc : true;
      triColonne = idx;
      table.querySelectorAll("th").forEach((t) => t.removeAttribute("aria-sort"));
      th.setAttribute("aria-sort", triAsc ? "ascending" : "descending");
      toutes.sort((a, b) => {
        const va = a.children[idx].textContent.replace(/[^0-9.,-]/g, "");
        const vb = b.children[idx].textContent.replace(/[^0-9.,-]/g, "");
        const na = parseFloat(va);
        const nb = parseFloat(vb);
        const cmp = !isNaN(na) && !isNaN(nb) ? na - nb : a.children[idx].textContent.localeCompare(b.children[idx].textContent);
        return triAsc ? cmp : -cmp;
      });
      toutes.forEach((tr) => tbody.appendChild(tr));
    });
  });
}

function tauxGlobalDe(districts) {
  const valides = districts.filter((d) => d.tauxMoyen !== null);
  if (!valides.length) return null;
  return Math.round((valides.reduce((a, d) => a + d.tauxMoyen, 0) / valides.length) * 10) / 10;
}

// --------------------------- Vue d'ensemble ---------------------------

function genererSynthese(modele) {
  const { regions, districts, seuils } = modele;
  const tauxGlobal = tauxGlobalDe(districts);
  const critiques = districts.filter((d) => d.statut === "critique");
  const meilleure = regions.reduce((a, b) => ((b.tauxMoyen ?? -1) > (a.tauxMoyen ?? -1) ? b : a));
  const plusFaible = regions.reduce((a, b) => ((b.tauxMoyen ?? 101) < (a.tauxMoyen ?? 101) ? b : a));

  const phrases = [];
  phrases.push(`Le taux moyen national de complétude est de <strong>${tauxGlobal}%</strong>.`);
  phrases.push(
    `${libelleRegion(meilleure.nom)} affiche le meilleur taux (${meilleure.tauxMoyen}%), tandis que ${libelleRegion(plusFaible.nom)} est la région la plus en difficulté (${plusFaible.tauxMoyen}%).`
  );
  if (critiques.length === 0) {
    phrases.push("Aucun district n'est sous le seuil critique cette semaine.");
  } else if (critiques.length === 1) {
    phrases.push(`1 district (${critiques[0].nom}) est sous le seuil critique de ${seuils.critique}%.`);
  } else {
    phrases.push(`${critiques.length} districts sont sous le seuil critique de ${seuils.critique}%.`);
  }
  if (modele.evolution.semaines.length >= 2) {
    const n = modele.evolution.moyenne_generale.length;
    const actuel = modele.evolution.moyenne_generale[n - 1];
    const precedent = modele.evolution.moyenne_generale[n - 2];
    if (actuel !== null && precedent !== null) {
      const ecart = Math.round((actuel - precedent) * 10) / 10;
      if (Math.abs(ecart) >= seuils.baisse) {
        phrases.push(ecart > 0 ? `Progression de ${ecart} points par rapport au lundi précédent.` : `Baisse de ${Math.abs(ecart)} points par rapport au lundi précédent.`);
      }
    }
  }
  return phrases.join(" ");
}

export function renderVue(modele) {
  const { regions, districts } = modele;
  const tauxGlobal = tauxGlobalDe(districts);
  const repartition = {
    conforme: districts.filter((d) => d.statut === "conforme").length,
    surveiller: districts.filter((d) => d.statut === "surveiller").length,
    critique: districts.filter((d) => d.statut === "critique").length,
  };
  const alertes = districts
    .filter((d) => d.statut === "critique")
    .sort((a, b) => (a.tauxMoyen ?? 0) - (b.tauxMoyen ?? 0))
    .slice(0, 10);

  return `
    <div class="grid grid-kpi">
      <div class="card kpi"><h3>Taux moyen national</h3><div class="valeur">${tauxGlobal}%</div></div>
      <div class="card kpi"><h3>Régions</h3><div class="valeur">${regions.length}</div></div>
      <div class="card kpi"><h3>Districts</h3><div class="valeur">${districts.length}</div></div>
      <div class="card kpi"><h3>Districts critiques</h3><div class="valeur" style="color:var(--critique)">${repartition.critique}</div></div>
    </div>
    <div class="grid grid2" style="margin-top:16px">
      <div class="card">
        <h2>Synthèse</h2>
        <p>${genererSynthese(modele)}</p>
      </div>
      <div class="card">
        <h2>Répartition des districts</h2>
        <div style="height:220px"><canvas id="ch-statuts"></canvas></div>
      </div>
    </div>
    <div class="grid grid2" style="margin-top:16px">
      <div class="card">
        <h2>Carte des districts</h2>
        <div id="carte"></div>
      </div>
      <div class="card">
        <h2>Évolution du taux moyen</h2>
        <div style="height:280px"><canvas id="ch-evo-globale"></canvas></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Priorités d'action (districts sous le seuil critique)</h2>
      ${alertes.length === 0
        ? '<p class="note">Aucun district en dessous du seuil critique.</p>'
        : `<ul id="liste-alertes">${alertes.map((d) => `<li data-idx="${districts.indexOf(d)}" tabindex="0" role="button">${puceStatut(d.statut)} <strong>${escapeHtml(d.nom)}</strong> (${libelleRegion(d.region)}) — ${d.tauxMoyen}%</li>`).join("")}</ul>`}
    </div>
  `;
}

export function apresRenduVue(modele, theme) {
  const districts = modele.districts;
  const repartition = {
    conforme: districts.filter((d) => d.statut === "conforme").length,
    surveiller: districts.filter((d) => d.statut === "surveiller").length,
    critique: districts.filter((d) => d.statut === "critique").length,
  };
  grapheDoughnut("ch-statuts", repartition);
  grapheLigne("ch-evo-globale", modele.evolution.semaines, [{ label: "Taux moyen", data: modele.evolution.moyenne_generale }]);

  if (!document.getElementById("carte").dataset.init) {
    initCarte("carte", theme);
    document.getElementById("carte").dataset.init = "1";
  }
  afficherDistricts(districts, { onClicDistrict: ouvrirFicheDistrict });

  document.querySelectorAll("#liste-alertes li").forEach((li) => {
    const ouvrir = () => ouvrirFicheDistrict(districts[Number(li.dataset.idx)]);
    li.addEventListener("click", ouvrir);
    li.addEventListener("keydown", (ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), ouvrir()));
  });
}

// --------------------------- Régions et formulaires ---------------------------

export function renderRegions(modele) {
  const { regions, formulaires, districts, seuils } = modele;

  const lignesHeatmap = regions
    .map((r) => {
      const cellules = formulaires
        .map((f) => {
          const vals = r.districts.flatMap((d) => d.formulaires.filter((df) => df.nom === f.nom).map((df) => df.valeur)).filter((v) => v !== null);
          const moy = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
          const statut = moy === null ? "inconnu" : moy < seuils.critique ? "critique" : moy < seuils.conforme ? "surveiller" : "conforme";
          return `<td class="heatmap-cell" style="background:${couleurStatut(statut)}">${moy ?? "—"}</td>`;
        })
        .join("");
      return `<tr><th scope="row">${libelleRegion(r.nom)}</th>${cellules}</tr>`;
    })
    .join("");

  const districtsTries = [...districts].filter((d) => d.tauxMoyen !== null).sort((a, b) => b.tauxMoyen - a.tauxMoyen);
  const top10 = districtsTries.slice(0, 10);
  const flop10 = districtsTries.slice(-10).reverse();
  const ligneClassement = (d) => `<tr data-idx="${districts.indexOf(d)}" class="ligne-district"><td>${escapeHtml(d.nom)}</td><td>${libelleRegion(d.region)}</td><td class="cell-statut cell-${d.statut}">${d.tauxMoyen}%</td></tr>`;

  return `
    <div class="grid grid2">
      <div class="card">
        <h2>Taux moyen par région</h2>
        <div style="height:320px"><canvas id="ch-regions"></canvas></div>
      </div>
      <div class="card">
        <h2>Taux moyen par formulaire</h2>
        <div style="height:320px"><canvas id="ch-formulaires"></canvas></div>
      </div>
    </div>
    <div class="grid grid2" style="margin-top:16px">
      <div class="card">
        <h2>Statuts des districts par région</h2>
        <div style="height:340px"><canvas id="ch-stats-region"></canvas></div>
      </div>
      <div class="card">
        <h2>Taux moyen par période (semaine courante)</h2>
        <div style="height:340px"><canvas id="ch-periodes"></canvas></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Carte thermique régions × formulaires</h2>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Région</th>${formulaires.map((f) => `<th>${escapeHtml(f.nom)}</th>`).join("")}</tr></thead>
          <tbody>${lignesHeatmap}</tbody>
        </table>
      </div>
    </div>
    <div class="grid grid2" style="margin-top:16px">
      <div class="card">
        <h2>10 districts les plus performants</h2>
        <div class="table-scroll"><table><tbody>${top10.map(ligneClassement).join("")}</tbody></table></div>
      </div>
      <div class="card">
        <h2>10 districts les plus en difficulté</h2>
        <div class="table-scroll"><table><tbody>${flop10.map(ligneClassement).join("")}</tbody></table></div>
      </div>
    </div>
    <div class="grid grid2" style="margin-top:16px">
      <div class="card">
        <h2>Synthèse par région</h2>
        <div class="table-scroll">
          <table id="table-synthese-region">
            <thead><tr><th>Région</th><th>Taux moyen</th><th>Districts</th><th>Critiques</th></tr></thead>
            <tbody>${regions.map((r) => `<tr><td>${libelleRegion(r.nom)}</td><td>${r.tauxMoyen ?? "—"}%</td><td>${r.districts.length}</td><td class="cell-critique">${r.nbCritique}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h2>Synthèse par formulaire</h2>
        <div class="table-scroll">
          <table id="table-synthese-formulaire">
            <thead><tr><th>Formulaire</th><th>Taux moyen national</th></tr></thead>
            <tbody>${[...formulaires].sort((a, b) => (a.tauxMoyen ?? 0) - (b.tauxMoyen ?? 0)).map((f) => `<tr><td>${escapeHtml(f.nom)}</td><td class="cell-statut">${f.tauxMoyen ?? "—"}%</td></tr>`).join("")}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

export function apresRenduRegions(modele) {
  const { regions, formulaires, districts } = modele;
  grapheBarres(
    "ch-regions",
    regions.map((r) => libelleRegion(r.nom)),
    regions.map((r) => r.tauxMoyen ?? 0),
    { couleurParValeur: () => couleurStatut("primaire") }
  );
  const formulairesTries = [...formulaires].sort((a, b) => (a.tauxMoyen ?? 0) - (b.tauxMoyen ?? 0)).slice(0, 12);
  grapheBarres(
    "ch-formulaires",
    formulairesTries.map((f) => (f.nom.length > 28 ? f.nom.slice(0, 26) + "…" : f.nom)),
    formulairesTries.map((f) => f.tauxMoyen ?? 0),
    { horizontal: true }
  );

  grapheBarresEmpilees(
    "ch-stats-region",
    regions.map((r) => libelleRegion(r.nom)),
    [
      { label: "Conforme", data: regions.map((r) => r.nbConforme), couleur: couleurStatut("conforme") },
      { label: "À surveiller", data: regions.map((r) => r.nbSurveiller), couleur: couleurStatut("surveiller") },
      { label: "Critique", data: regions.map((r) => r.nbCritique), couleur: couleurStatut("critique") },
    ]
  );

  const parPeriode = new Map();
  for (const d of districts) {
    for (const f of d.formulaires) {
      for (const p of f.historiquePeriodes) {
        if (p.valeur === null) continue;
        if (!parPeriode.has(p.periode_code)) parPeriode.set(p.periode_code, { periode: p.periode, valeurs: [] });
        parPeriode.get(p.periode_code).valeurs.push(p.valeur);
      }
    }
  }
  const periodesTriees = [...parPeriode.entries()].sort(([a], [b]) => a.localeCompare(b));
  grapheBarres(
    "ch-periodes",
    periodesTriees.map(([, v]) => v.periode),
    periodesTriees.map(([, v]) => Math.round((v.valeurs.reduce((a, b) => a + b, 0) / v.valeurs.length) * 10) / 10)
  );

  attacherTriTable("table-synthese-region");
  attacherTriTable("table-synthese-formulaire");
  document.querySelectorAll(".ligne-district").forEach((tr) => {
    tr.addEventListener("click", () => ouvrirFicheDistrict(districts[Number(tr.dataset.idx)]));
  });
}

// --------------------------- Évolution ---------------------------

export function renderEvolution(modele) {
  const { evolution } = modele;
  return `
    <div class="card">
      <h2>Évolution du taux moyen national (par lundi)</h2>
      <div style="height:320px"><canvas id="ch-evo-detail"></canvas></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Évolution par région</h2>
      <p class="note">Cliquez une région dans la légende pour l'isoler ou la masquer.</p>
      <div style="height:380px"><canvas id="ch-evo-regions"></canvas></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Historique des extractions</h2>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Semaine (lundi)</th><th>Taux moyen</th></tr></thead>
          <tbody>${evolution.semaines
            .map((s, i) => `<tr><td>${s}</td><td>${evolution.moyenne_generale[i] ?? "—"}%</td></tr>`)
            .reverse()
            .join("")}</tbody>
        </table>
      </div>
      ${evolution.semaines.length <= 1 ? '<p class="note">Une seule semaine en mémoire pour l\'instant — la comparaison apparaîtra dès la deuxième extraction.</p>' : ""}
    </div>
  `;
}

export function apresRenduEvolution(modele) {
  const { evolution } = modele;
  grapheLigne("ch-evo-detail", evolution.semaines, [{ label: "Taux moyen national", data: evolution.moyenne_generale }]);
  grapheLigne(
    "ch-evo-regions",
    evolution.semaines,
    evolution.par_region.map((s) => ({ label: libelleRegion(s.region), data: s.valeurs }))
  );
}

// --------------------------- Districts ---------------------------

export function renderDistricts(modele) {
  const { districts } = modele;
  const lignes = districts
    .map(
      (d, i) => `
      <tr data-region="${escapeHtml(d.region)}" data-statut="${d.statut}" data-idx="${i}" class="ligne-district">
        <td>${escapeHtml(d.nom)}</td>
        <td>${libelleRegion(d.region)}</td>
        <td class="cell-statut cell-${d.statut}">${puceStatut(d.statut)}${d.tauxMoyen ?? "—"}%</td>
      </tr>`
    )
    .join("");
  const regionsUniques = [...new Set(districts.map((d) => d.region))].sort();

  return `
    <div class="card">
      <div class="filtres">
        <input type="search" id="filtre-recherche" placeholder="Rechercher un district…" aria-label="Rechercher un district">
        <select id="filtre-region" aria-label="Filtrer par région">
          <option value="">Toutes les régions</option>
          ${regionsUniques.map((r) => `<option value="${escapeHtml(r)}">${libelleRegion(r)}</option>`).join("")}
        </select>
        <select id="filtre-statut" aria-label="Filtrer par statut">
          <option value="">Tous les statuts</option>
          <option value="critique">Critique</option>
          <option value="surveiller">À surveiller</option>
          <option value="conforme">Conforme</option>
        </select>
        <button class="btn" id="btn-export-csv" type="button">⬇ Export CSV</button>
      </div>
      <p class="note">Cliquez une ligne pour voir la fiche détaillée (toutes les périodes de la semaine).</p>
      <div class="table-scroll">
        <table id="table-districts">
          <thead><tr><th data-col="nom">District</th><th data-col="region">Région</th><th data-col="taux">Taux moyen</th></tr></thead>
          <tbody>${lignes}</tbody>
        </table>
      </div>
    </div>
  `;
}

export function apresRenduDistricts(modele) {
  const recherche = document.getElementById("filtre-recherche");
  const filtreRegion = document.getElementById("filtre-region");
  const filtreStatut = document.getElementById("filtre-statut");
  const lignes = Array.from(document.querySelectorAll("#table-districts tbody tr"));

  function appliquerFiltres() {
    const terme = recherche.value.trim().toLowerCase();
    for (const tr of lignes) {
      const nom = tr.children[0].textContent.toLowerCase();
      const matchTexte = !terme || nom.includes(terme);
      const matchRegion = !filtreRegion.value || tr.dataset.region === filtreRegion.value;
      const matchStatut = !filtreStatut.value || tr.dataset.statut === filtreStatut.value;
      tr.hidden = !(matchTexte && matchRegion && matchStatut);
    }
  }
  recherche.addEventListener("input", appliquerFiltres);
  filtreRegion.addEventListener("change", appliquerFiltres);
  filtreStatut.addEventListener("change", appliquerFiltres);

  document.getElementById("btn-export-csv").addEventListener("click", () => {
    const visibles = lignes.filter((tr) => !tr.hidden);
    const csv = ["District;Région;Taux moyen"]
      .concat(visibles.map((tr) => `${tr.children[0].textContent};${tr.children[1].textContent};${tr.children[2].textContent.replace(/[^0-9.,—]/g, "")}`))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `districts_${modele.semaineCle}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  attacherTriTable("table-districts");
  document.querySelectorAll("#table-districts .ligne-district").forEach((tr) => {
    tr.addEventListener("click", () => ouvrirFicheDistrict(modele.districts[Number(tr.dataset.idx)]));
  });
}

// --------------------------- Qualité et méthode ---------------------------

export function renderQualite(modele) {
  const { districtsNonResolus, seuils, evolution } = modele;
  return `
    <div class="card">
      <h2>Cases renseignées par extraction (%)</h2>
      <p class="note">Part des cases district × période × formulaire effectivement remplies par DHIS2, par semaine.</p>
      <div style="height:260px"><canvas id="ch-qualite"></canvas></div>
      ${evolution.semaines.length <= 1 ? '<p class="note">Une seule semaine en mémoire pour l\'instant.</p>' : ""}
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Diagnostic de la dernière extraction</h2>
      ${districtsNonResolus.length === 0
        ? '<p class="note">Tous les districts du gabarit ont été reconnus par DHIS2.</p>'
        : `<p>${districtsNonResolus.length} district(s) non reconnus dans DHIS2 (vérifier l'orthographe dans le gabarit) :</p><ul>${districtsNonResolus.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>`}
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Méthode et définitions</h2>
      <p><strong>Taux de complétude (reporting rate)</strong> : pourcentage d'unités sanitaires attendues ayant effectivement soumis leur rapport DHIS2 pour un formulaire et une période donnés.</p>
      <ul>
        <li><span class="statut-puce statut-critique" aria-hidden="true"></span> Critique : taux &lt; ${seuils.critique}%</li>
        <li><span class="statut-puce statut-surveiller" aria-hidden="true"></span> À surveiller : ${seuils.critique}% – ${seuils.conforme}%</li>
        <li><span class="statut-puce statut-conforme" aria-hidden="true"></span> Conforme : taux ≥ ${seuils.conforme}%</li>
      </ul>
      <p>Chaque extraction (chaque lundi) couvre le mois en cours et les mois précédents : un même formulaire peut donc afficher plusieurs valeurs (une par période/mois) au sein d'une même semaine.</p>
    </div>
  `;
}

export function apresRenduQualite(modele) {
  grapheLigne("ch-qualite", modele.evolution.semaines, [{ label: "Cases renseignées", data: modele.evolution.taux_remplissage }]);
}
