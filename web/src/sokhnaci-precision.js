// Réponses précises de Sokhna Ci aux questions ciblées : diagnostic d'un district, évolution d'une région,
// classement dans une région, listes, dénombrements, « X ou Y », formulaires sans données, recommandations.
// Chaque chiffre vient du modèle affiché ; si la question ne correspond à aucun cas, on renvoie null et les
// autres compétences prennent le relais.
import { D, E, P, T, cadreDonnees, emotionPour, labelRegion, liste, niveau, nomFormulaire, reponse, segment, toutesDistricts } from "./sokhnaci-dialogue.js";
import { construireBilan } from "./bilan.js";

const norm = (texte) => String(texte ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const un = (x) => Math.round(x * 10) / 10;
const moyenne = (v) => { const u = v.filter((x) => x !== null && x !== undefined); return u.length ? u.reduce((a, b) => a + b, 0) / u.length : null; };
const contient = (q, nom) => { const n = norm(nom); return n.length >= 3 && ` ${q} `.includes(` ${n} `); };
const NOMBRES = { deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10 };

function nombreDemande(q) {
  const chiffre = q.match(/\b(\d{1,2})\b/);
  if (chiffre) return Math.max(1, Math.min(15, Number(chiffre[1])));
  const mot = q.split(" ").find((m) => NOMBRES[m]);
  return mot ? NOMBRES[mot] : null;
}

// Entités citées : régions et districts, les plus longs d'abord. Si un nom désigne à la fois une région et un
// district (Kolda, Matam…), le mot « district » tranche ; sinon c'est la région.
function entites(q, model) {
  const regions = (model.toutesRegions || []).filter((r) => contient(q, labelRegion(r.nom)))
    .sort((a, b) => q.indexOf(norm(labelRegion(a.nom))) - q.indexOf(norm(labelRegion(b.nom))));
  const districts = toutesDistricts(model).filter((d) => contient(q, d.nom))
    .sort((a, b) => norm(b.nom).length - norm(a.nom).length);
  const parleDistrict = /\bdistricts?\b/.test(q);
  // « Quel district de Thiès… », « liste des districts en rouge à Matam » : on cherche DANS la région du même nom.
  const chercheDansRegion = /\b(quels?|lesquels?|lequel|liste|combien|tous les)\b/.test(q) && /\bdistricts\b|\bdistrict (de|du|d|a|en)\b/.test(q);
  const homonyme = (d) => regions.some((r) => norm(labelRegion(r.nom)) === norm(d.nom));
  const district = districts.find((d) => !homonyme(d) || (parleDistrict && !chercheDansRegion)) || null;
  return { regions, district, parleDistrict };
}

const FAIBLE = /\b(pire|plus (en )?retard|plus faibles?|plus bas|derniers?|moins bons?|en difficulte)\b/;
const FORT = /\b(meilleurs?|plus (forts?|eleves?|hauts?)|mieux|premiers?|plus avances?)\b/;

export function repondrePrecis(questionBrute, model) {
  const q = norm(questionBrute);
  if (!q || !model?.districts) return null;
  const seuils = model.seuils;
  const cadre = cadreDonnees(model);
  const { regions, district, parleDistrict } = entites(q, model);
  const region = regions[0] || null;

  // 1. Recommandations : les solutions du bilan, adaptées à la situation de la semaine.
  if (/\b(que (faut il|dois je|devons nous|faire)|quoi faire|recommand\w*|solutions?|actions? (a mener|prioritaires?)|que proposes? tu|plan d action)\b/.test(q) && !district) {
    const bilan = construireBilan(model);
    const actions = bilan.solutions.slice(0, 3);
    return reponse("encourageante", [
      segment(`${cadre}, voici mes ${E(actions.length)} recommandations prioritaires.`, "geste_ouvert"),
      ...actions.map((s, i) => segment(`${["D’abord", "Ensuite", "Enfin"][i]} (${s.priorite.toLowerCase()}) : ${s.titre.charAt(0).toLowerCase()}${s.titre.slice(1)}. ${s.detail}`, i ? "compter_doigts" : "pointer_ecran")),
    ], "Voulez-vous le détail d’une de ces actions ?");
  }

  // 2. Formulaires sans données (cellules vides ou à zéro), éventuellement dans une région.
  if (/\b(sans donnees?|pas de donnees?|aucune donnee|vides?|manquants?|non renseignes?|a zero)\b/.test(q)) {
    const portee = region ? { ...model, districts: region.districts } : model;
    const bilan = construireBilan(portee);
    if (!bilan.sansDonnees.length) return reponse("felicitations", [segment(`${cadre}, tous les formulaires ont des données${region ? ` dans la région de ${labelRegion(region.nom)}` : ""}.`, "pouce_leve")]);
    const tete = bilan.sansDonnees.slice(0, 3);
    return reponse("preoccupee", [
      segment(`${cadre}, ${E(bilan.totalManquants)} cellules district × formulaire sont vides ou à zéro${region ? ` dans la région de ${labelRegion(region.nom)}` : ""}, sur ${E(bilan.totalCellules)}.`, "pointer_ecran"),
      segment(`Les plus touchés : ${liste(tete.map((l) => `« ${nomFormulaire(l.nom)} », ${E(l.vides)} sans donnée et ${E(l.zeros)} à zéro sur ${E(l.attendus)}`))}.`, "compter_doigts"),
      segment("Il faut vérifier si ces formulaires s’appliquent bien à ces structures, puis relancer la saisie.", "geste_rassurant"),
    ], "Voulez-vous la situation d’un de ces formulaires ?");
  }

  // 3. Dénombrements : régions en rouge, formulaires suivis, districts d'une région.
  if (/\bcombien\b/.test(q)) {
    if (/\bregions?\b/.test(q)) {
      const avec = (model.toutesRegions || []).filter((r) => r.tauxMoyen !== null && r.tauxMoyen !== undefined);
      const rouges = avec.filter((r) => r.tauxMoyen < seuils.critique);
      const verts = avec.filter((r) => r.tauxMoyen >= seuils.conforme);
      return reponse(rouges.length ? "preoccupee" : "felicitations", [
        segment(`${cadre}, ${E(rouges.length)} ${rouges.length > 1 ? "régions sont" : "région est"} en rouge sur ${E(avec.length)}, ${E(avec.length - rouges.length - verts.length)} à surveiller et ${E(verts.length)} ${verts.length > 1 ? "conformes" : "conforme"}.`, "compter_doigts"),
        ...(rouges.length ? [segment(`Les plus basses : ${liste([...rouges].sort((a, b) => a.tauxMoyen - b.tauxMoyen).slice(0, 3).map((r) => `${labelRegion(r.nom)}, à ${T(un(r.tauxMoyen))}`))}.`, "geste_rassurant")] : []),
      ]);
    }
    if (/\bformulaires?\b/.test(q)) {
      const formulaires = (model.tousFormulaires || []).filter((f) => f.tauxMoyen !== null && f.tauxMoyen !== undefined);
      const rouges = formulaires.filter((f) => f.tauxMoyen < seuils.critique).length;
      return reponse("neutre", [segment(`${cadre}, ${E(formulaires.length)} formulaires sont suivis ; ${E(rouges)} ${rouges > 1 ? "sont" : "est"} sous le seuil critique de ${T(seuils.critique)}.`, "compter_doigts")]);
    }
    if (region) {
      const avec = region.districts.filter((d) => d.tauxMoyen !== null && d.tauxMoyen !== undefined);
      return reponse(emotionPour(region.tauxMoyen, seuils), [segment(`${cadre}, la région de ${labelRegion(region.nom)} compte ${E(region.districts.length)} districts : ${E(region.nbCritique)} en rouge, ${E(region.nbSurveiller)} à surveiller et ${E(region.nbConforme)} ${region.nbConforme > 1 ? "conformes" : "conforme"}.`, "compter_doigts"), ...(avec.length ? [] : [])]);
    }
  }

  // 4. Comparaison « X ou Y » / « X et Y » entre deux régions.
  // « compare X et Y » reste traité par la compétence de comparaison (tableau, graphique) ; ici : « X ou Y ? », « qui fait mieux ».
  if (regions.length >= 2 && !district && !/\bcompar/.test(q) && (/\bou\b/.test(q) || /\bqui (fait|est)\b/.test(q) || /\bmieux\b/.test(q))) {
    const [a, b] = regions;
    if (a.tauxMoyen !== null && b.tauxMoyen !== null) {
      const [devant, derriere] = a.tauxMoyen >= b.tauxMoyen ? [a, b] : [b, a];
      return reponse("neutre", [
        segment(`${cadre}, ${labelRegion(devant.nom)} fait mieux : ${T(un(devant.tauxMoyen))} contre ${T(un(derriere.tauxMoyen))} pour ${labelRegion(derriere.nom)}, soit ${P(un(devant.tauxMoyen - derriere.tauxMoyen))} d’écart.`, "pointer_ecran"),
        segment(`En rouge : ${E(devant.nbCritique)} districts sur ${E(devant.districts.length)} pour ${labelRegion(devant.nom)}, ${E(derriere.nbCritique)} sur ${E(derriere.districts.length)} pour ${labelRegion(derriere.nom)}.`, "compter_doigts"),
      ], `Voulez-vous le détail de ${labelRegion(derriere.nom)} ?`);
    }
  }

  // 5. Évolution d'une région (série par extraction).
  if (region && !district && /\b(evolu\w*|progress\w*|tendance|depuis|amelior\w*|baisse)\b/.test(q)) {
    const serie = (model.evolution?.par_region || []).find((s) => s.region === region.nom);
    const semaines = model.evolution?.semaines || [];
    const points = (serie?.valeurs || []).map((v, i) => ({ v, s: semaines[i] })).filter((p) => p.v !== null && p.v !== undefined);
    if (points.length >= 2) {
      const premier = points[0];
      const dernier = points.at(-1);
      const pas = un(dernier.v - points.at(-2).v);
      const total = un(dernier.v - premier.v);
      return reponse(total >= 0 ? "encourageante" : "preoccupee", [
        segment(`Pour la région de ${labelRegion(region.nom)}, le taux des mois comparables est passé de ${T(un(premier.v))} le ${D(premier.s)} à ${T(un(dernier.v))} le ${D(dernier.s)}, soit ${P(total)} ${total >= 0 ? "de gagnés" : "de perdus"} sur ${E(points.length)} extractions.`, "pointer_ecran"),
        segment(Math.abs(pas) < 0.5 ? "La dernière extraction est stable." : `À la dernière extraction : ${pas > 0 ? "+" : "−"}${P(pas)}.`, pas < 0 ? "geste_rassurant" : "hochement_tete"),
      ], "Voulez-vous comparer avec une autre région ?");
    }
  }

  // 6. Région qui progresse ou recule le plus.
  if (/\bregions?\b/.test(q) && /\b(progresse|avance|recule|baisse|ameliore)\w*\b/.test(q) && /\bplus\b/.test(q)) {
    const recul = /\b(recule|baisse)\w*/.test(q);
    const gains = (model.evolution?.par_region || []).map((s) => {
      const v = s.valeurs.filter((x) => x !== null && x !== undefined);
      return v.length >= 2 ? { nom: s.region, gain: un(v.at(-1) - v[0]) } : null;
    }).filter(Boolean).sort((a, b) => (recul ? a.gain - b.gain : b.gain - a.gain)).slice(0, 3);
    if (gains.length) return reponse(recul ? "preoccupee" : "felicitations", [
      segment(`Depuis la première extraction suivie, les régions qui ${recul ? "reculent" : "progressent"} le plus sont ${liste(gains.map((g) => `${labelRegion(g.nom)} (${g.gain >= 0 ? "+" : "−"}${P(g.gain)})`))}.`, recul ? "geste_rassurant" : "pouce_leve"),
    ]);
  }

  // 7. Dans une région : formulaire le plus faible, liste des districts en rouge, classement des districts.
  if (region && !district) {
    if (/\bformulaires?\b/.test(q) && (FAIBLE.test(q) || FORT.test(q))) {
      const fort = FORT.test(q) && !FAIBLE.test(q);
      const noms = [...new Set(region.districts.flatMap((d) => d.formulaires.map((f) => f.nom)))];
      const classes = noms.map((nom) => ({ nom, taux: moyenne(region.districts.flatMap((d) => d.formulaires.filter((f) => f.nom === nom).map((f) => f.valeur))) }))
        .filter((f) => f.taux !== null).sort((a, b) => (fort ? b.taux - a.taux : a.taux - b.taux)).slice(0, 3);
      if (classes.length) return reponse(fort ? "souriante" : "preoccupee", [
        segment(`${cadre}, dans la région de ${labelRegion(region.nom)}, les formulaires ${fort ? "les mieux renseignés" : "les plus en retard"} sont ${liste(classes.map((f) => `« ${nomFormulaire(f.nom)} », à ${T(un(f.taux))}`))}.`, "compter_doigts"),
      ], "Voulez-vous les districts concernés ?");
    }
    const avec = region.districts.filter((d) => d.tauxMoyen !== null && d.tauxMoyen !== undefined);
    if (/\b(liste|lesquels|quels|tous)\b/.test(q) && /\b(rouge|critiques?|retard)\b/.test(q)) {
      const rouges = avec.filter((d) => d.tauxMoyen < seuils.critique).sort((a, b) => a.tauxMoyen - b.tauxMoyen);
      if (!rouges.length) return reponse("felicitations", [segment(`${cadre}, aucun district de ${labelRegion(region.nom)} n’est en rouge.`, "pouce_leve")]);
      return reponse("preoccupee", [segment(`${cadre}, ${E(rouges.length)} ${rouges.length > 1 ? "districts sont" : "district est"} en rouge dans la région de ${labelRegion(region.nom)} : ${liste(rouges.slice(0, 10).map((d) => `${d.nom}, à ${T(un(d.tauxMoyen))}`))}.`, "compter_doigts")]);
    }
    if ((parleDistrict || /\bqui\b/.test(q)) && (FAIBLE.test(q) || FORT.test(q))) {
      const fort = FORT.test(q) && !FAIBLE.test(q);
      const n = nombreDemande(q) || 3;
      const classes = [...avec].sort((a, b) => (fort ? b.tauxMoyen - a.tauxMoyen : a.tauxMoyen - b.tauxMoyen)).slice(0, n);
      return reponse(fort ? "felicitations" : "preoccupee", [
        segment(`${cadre}, dans la région de ${labelRegion(region.nom)}, ${classes.length > 1 ? `les districts ${fort ? "les mieux placés" : "les plus en retard"} sont` : `le district ${fort ? "le mieux placé" : "le plus en retard"} est`} ${liste(classes.map((d) => `${d.nom}, à ${T(un(d.tauxMoyen))}`))}.`, "compter_doigts"),
      ], "Voulez-vous savoir pourquoi ?");
    }
  }

  // 8. Diagnostic d'un district : pourquoi est-il en retard ?
  if (district && /\b(pourquoi|explique|diagnostic|cause|raison|detail\w*|qu est ce qui)\b/.test(q)) {
    const valeurs = district.formulaires.filter((f) => f.valeur !== null && f.valeur !== undefined);
    const vides = district.formulaires.length - valeurs.length;
    const zeros = valeurs.filter((f) => f.valeur === 0).length;
    const sousSeuil = valeurs.filter((f) => f.valeur < seuils.critique).length;
    const faibles = [...valeurs].sort((a, b) => a.valeur - b.valeur).slice(0, 3);
    const regionDistrict = (model.toutesRegions || []).find((r) => r.nom === district.region);
    const mediane = (() => { const v = (regionDistrict?.districts || []).map((d) => d.tauxMoyen).filter((x) => x !== null && x !== undefined).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; })();
    const segments = [segment(`${cadre}, ${district.nom} est à ${T(un(district.tauxMoyen))}, ${niveau(district.tauxMoyen, seuils)}.`, "pointer_ecran")];
    segments.push(segment(`${E(sousSeuil)} formulaires sur ${E(district.formulaires.length)} sont sous ${T(seuils.critique)}, dont ${E(zeros)} à zéro${vides ? `, et ${E(vides)} sans aucune donnée` : ""} : ${sousSeuil >= district.formulaires.length * 0.8 ? "le retard est global, c’est la transmission des rapports qui est en cause" : "le retard est ciblé sur quelques formulaires"}.`, "compter_doigts"));
    if (faibles.length) segments.push(segment(`Les plus faibles : ${liste(faibles.map((f) => `« ${nomFormulaire(f.nom)} », à ${T(un(f.valeur))}`))}.`, "geste_rassurant"));
    if (mediane !== null && regionDistrict) {
      const ecart = un(district.tauxMoyen - mediane);
      segments.push(segment(Math.abs(ecart) < 5 ? `C’est proche des autres districts de ${labelRegion(regionDistrict.nom)} (médiane ${T(un(mediane))}) : la difficulté est aussi régionale.` : `C’est ${P(ecart)} ${ecart < 0 ? "sous" : "au-dessus de"} la médiane des districts de ${labelRegion(regionDistrict.nom)} (${T(un(mediane))}) : ${ecart < 0 ? "un problème propre à ce district, à vérifier sur place" : "il fait mieux que ses voisins"}.`, "pointer_ecran"));
    }
    return reponse(emotionPour(district.tauxMoyen, seuils), segments, "Voulez-vous le détail par formulaire ?");
  }

  // 9. « Le district de Kolda » : fiche du district (et non de la région qui porte le même nom).
  if (district && parleDistrict && (model.toutesRegions || []).some((r) => norm(labelRegion(r.nom)) === norm(district.nom))) {
    const faibles = district.formulaires.filter((f) => f.valeur !== null && f.valeur !== undefined).sort((a, b) => a.valeur - b.valeur).slice(0, 2);
    const variation = district.variation;
    return reponse(emotionPour(district.tauxMoyen, seuils), [
      segment(`${cadre}, le district de ${district.nom} est à ${T(un(district.tauxMoyen))}, ${niveau(district.tauxMoyen, seuils)}.`, "pointer_ecran"),
      ...(variation === null || variation === undefined ? [] : [segment(Math.abs(variation) < 0.5 ? "C’est stable par rapport à l’extraction de comparaison." : `C’est ${P(variation)} ${variation > 0 ? "de mieux" : "de moins"} que l’extraction de comparaison.`, "hochement_tete")]),
      ...(faibles.length ? [segment(`Formulaires les plus faibles : ${liste(faibles.map((f) => `« ${nomFormulaire(f.nom)} », à ${T(un(f.valeur))}`))}.`, "geste_rassurant")] : []),
    ], "Voulez-vous savoir pourquoi ?");
  }

  // 10. « Les N districts (ou régions) les plus faibles / meilleurs » au niveau national.
  const n = nombreDemande(q);
  if (n && (FAIBLE.test(q) || FORT.test(q)) && !region) {
    const fort = FORT.test(q) && !FAIBLE.test(q);
    const parRegion = /\bregions?\b/.test(q) && !parleDistrict;
    const source = parRegion ? (model.toutesRegions || []).map((r) => ({ nom: labelRegion(r.nom), taux: r.tauxMoyen })) : toutesDistricts(model).map((d) => ({ nom: d.nom, taux: d.tauxMoyen }));
    const classes = source.filter((x) => x.taux !== null && x.taux !== undefined).sort((a, b) => (fort ? b.taux - a.taux : a.taux - b.taux)).slice(0, n);
    return reponse(fort ? "felicitations" : "preoccupee", [
      segment(`${cadre}, ${fort ? "les" : "les"} ${E(classes.length)} ${parRegion ? "régions" : "districts"} ${fort ? "les mieux placés" : "les plus en retard"} sont ${liste(classes.map((x) => `${x.nom}, à ${T(un(x.taux))}`))}.`, "compter_doigts"),
    ]);
  }
  return null;
}
