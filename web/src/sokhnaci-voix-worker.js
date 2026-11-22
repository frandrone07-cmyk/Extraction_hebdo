// Voix originale de Sokhna Ci : modèle Piper « siwis » (voix féminine française) exécuté dans un Web Worker.
// Le modèle, la session ONNX et le phonémiseur sont chargés UNE seule fois : chaque phrase ne coûte ensuite que
// l'inférence. Le fil principal (page, graphiques, avatar 3D) n'est jamais bloqué par la synthèse.
const VOIX = "fr_FR-siwis-medium";
const MODELE = "https://huggingface.co/diffusionstudio/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx";
const ORT = [
  { script: "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/ort.min.js", wasm: "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/" },
  { script: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.min.js", wasm: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/" },
];
const PHONEMISEUR = [
  "https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/dist/piper-DeOu3H9E.js",
  "https://esm.sh/@diffusionstudio/vits-web@1.0.3/es2022/dist/piper-DeOu3H9E.mjs",
];
const DONNEES_PHONEMISEUR = [
  "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize",
  "https://unpkg.com/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize",
];
const LOT_MAX = 6;

let ort = null;
let session = null;
let config = null;
let phonemiseur = null;
let creerPhonemiseur = null;
let basePhonemiseur = DONNEES_PHONEMISEUR[0];
let sortie = null;
let seuilAnnulation = 0;
const file = [];
let enCours = false;

const envoyer = (message, transfert) => self.postMessage(message, transfert || []);

// ---------------------------------------------------------------- cache persistant (même emplacement que vits-web)
async function dossierCache() {
  try { return await (await navigator.storage.getDirectory()).getDirectoryHandle("piper", { create: true }); } catch { return null; }
}
async function lireCache(nom) {
  try { const dossier = await dossierCache(); return dossier ? await (await dossier.getFileHandle(nom)).getFile() : null; } catch { return null; }
}
async function ecrireCache(nom, blob) {
  try {
    const dossier = await dossierCache();
    if (!dossier) return;
    const fichier = await dossier.getFileHandle(nom, { create: true });
    const flux = await fichier.createWritable();
    await flux.write(blob);
    await flux.close();
  } catch { /* cache facultatif : la voix fonctionne sans */ }
}
async function telecharger(url, suivi) {
  const reponse = await fetch(url);
  if (!reponse.ok) throw new Error(`${url} : HTTP ${reponse.status}`);
  const total = Number(reponse.headers.get("Content-Length") || 0);
  if (!reponse.body || !suivi) return reponse.blob();
  const lecteur = reponse.body.getReader();
  const morceaux = [];
  let charge = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    morceaux.push(value);
    charge += value.length;
    suivi(charge, total);
  }
  return new Blob(morceaux);
}
async function fichierModele(url, suivi) {
  const nom = url.split("/").at(-1);
  const enCache = await lireCache(nom);
  if (enCache && enCache.size > 1000) return { blob: enCache, dejaLa: true };
  const blob = await telecharger(url, suivi);
  await ecrireCache(nom, blob);
  return { blob, dejaLa: false };
}

// ---------------------------------------------------------------- chargement des bibliothèques
async function chargerOrt() {
  let derniere = null;
  for (const source of ORT) {
    try {
      const code = await (await fetch(source.script)).text();
      // Le script déclare « var ort » dans un mode strict : on l'expose explicitement à la portée globale.
      (0, eval)(`${code}\n;globalThis.ort = ort;`);
      ort = globalThis.ort;
      ort.env.wasm.wasmPaths = source.wasm;
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
      return;
    } catch (erreur) { derniere = erreur; }
  }
  throw derniere || new Error("ONNX Runtime indisponible");
}
async function chargerPhonemiseur() {
  let derniere = null;
  for (const url of PHONEMISEUR) {
    try { creerPhonemiseur = (await import(url)).createPiperPhonemize; return; } catch (erreur) { derniere = erreur; }
  }
  throw derniere || new Error("phonémiseur indisponible");
}
async function nouveauPhonemiseur() {
  let derniere = null;
  for (const base of [basePhonemiseur, ...DONNEES_PHONEMISEUR.filter((b) => b !== basePhonemiseur)]) {
    try {
      phonemiseur = await creerPhonemiseur({
        noInitialRun: true,
        print: (ligne) => sortie?.(ligne),
        printErr: () => {},
        locateFile: (f) => (f.endsWith(".wasm") ? `${base}.wasm` : f.endsWith(".data") ? `${base}.data` : f),
      });
      basePhonemiseur = base;
      return;
    } catch (erreur) { derniere = erreur; }
  }
  throw derniere || new Error("phonémiseur indisponible");
}

// Plusieurs phrases sont phonémisées en un seul passage (une ligne JSON par phrase).
function phonemiserUneFois(textes) {
  return new Promise((resolve, reject) => {
    const resultats = [];
    const minuterie = setTimeout(() => { sortie = null; reject(new Error("phonémisation trop longue")); }, 10000);
    sortie = (ligne) => {
      try { resultats.push(JSON.parse(ligne).phoneme_ids); } catch { return; }
      if (resultats.length === textes.length) { clearTimeout(minuterie); sortie = null; resolve(resultats); }
    };
    try {
      phonemiseur.callMain(["-l", config.espeak.voice, "--input", JSON.stringify(textes.map((text) => ({ text }))), "--espeak_data", "/espeak-ng-data"]);
    } catch (erreur) {
      clearTimeout(minuterie);
      sortie = null;
      reject(erreur);
    }
  });
}
async function phonemiser(textes) {
  try { return await phonemiserUneFois(textes); } catch {
    await nouveauPhonemiseur(); // un phonémiseur dans un état incohérent est recréé une fois
    return phonemiserUneFois(textes);
  }
}

// ---------------------------------------------------------------- synthèse
function wav(echantillons, frequence) {
  const vue = new DataView(new ArrayBuffer(44 + echantillons.length * 2));
  const ecrire = (position, texte) => { for (let i = 0; i < texte.length; i += 1) vue.setUint8(position + i, texte.charCodeAt(i)); };
  ecrire(0, "RIFF"); vue.setUint32(4, 36 + echantillons.length * 2, true); ecrire(8, "WAVE"); ecrire(12, "fmt ");
  vue.setUint32(16, 16, true); vue.setUint16(20, 1, true); vue.setUint16(22, 1, true); vue.setUint32(24, frequence, true);
  vue.setUint32(28, frequence * 2, true); vue.setUint16(32, 2, true); vue.setUint16(34, 16, true); ecrire(36, "data");
  vue.setUint32(40, echantillons.length * 2, true);
  // Petit fondu en entrée et en sortie : pas de « clic » entre deux morceaux de phrase.
  const fondu = Math.min(240, Math.floor(echantillons.length / 4));
  for (let i = 0; i < echantillons.length; i += 1) {
    let v = echantillons[i];
    if (i < fondu) v *= i / fondu;
    else if (i > echantillons.length - fondu) v *= (echantillons.length - i) / fondu;
    vue.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true);
  }
  return vue.buffer;
}
async function inferer(ids) {
  const entrees = {
    input: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor("float32", Float32Array.from([config.inference.noise_scale, config.inference.length_scale, config.inference.noise_w]), [3]),
  };
  if (Object.keys(config.speaker_id_map || {}).length) entrees.sid = new ort.Tensor("int64", BigInt64Array.from([0n]), [1]);
  const { output } = await session.run(entrees);
  return wav(output.data, config.audio.sample_rate);
}
const annule = (element) => element.id !== null && element.id < seuilAnnulation;

// Une lecture en cours (id non nul) passe toujours avant le préchauffage (id nul) : la réponse à une question
// n'attend jamais que les phrases préparées à l'avance soient fabriquées.
const prioritaire = () => file.some((element) => element.id !== null);
function ajouter(element) {
  if (element.id === null) { file.push(element); return; }
  const position = file.findIndex((e) => e.id === null);
  if (position < 0) file.push(element); else file.splice(position, 0, element);
}

async function traiterFile() {
  if (enCours) return;
  enCours = true;
  try {
    while (file.length) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const lot = file.splice(0, LOT_MAX).filter((element) => {
        if (annule(element)) { envoyer({ type: "echec", cle: element.cle, annule: true }); return false; }
        return true;
      });
      if (!lot.length) continue;
      const aPhonemiser = lot.filter((element) => !element.phonemes);
      if (aPhonemiser.length) {
        try {
          const resultats = await phonemiser(aPhonemiser.map((element) => element.texte));
          aPhonemiser.forEach((element, i) => { element.phonemes = resultats[i]; });
        } catch {
          for (const element of lot) envoyer({ type: "echec", cle: element.cle });
          continue;
        }
      }
      for (const [i, element] of lot.entries()) {
        // L'inférence ne rend pas la main : on laisse passer les messages reçus (nouvelle question, annulation).
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (element.id === null && prioritaire()) {
          // Une question vient d'arriver : le reste du préchauffage repasse derrière elle.
          for (const reste of lot.slice(i)) file.push(reste);
          break;
        }
        if (annule(element)) { envoyer({ type: "echec", cle: element.cle, annule: true }); continue; }
        try {
          const debut = performance.now();
          const tampon = await inferer(element.phonemes);
          envoyer({ type: "audio", cle: element.cle, wav: tampon, duree: performance.now() - debut }, [tampon]);
        } catch { envoyer({ type: "echec", cle: element.cle }); }
      }
    }
  } finally { enCours = false; }
}

// ---------------------------------------------------------------- initialisation
let initialisation = null;
function initialiser() {
  initialisation ||= (async () => {
    await Promise.all([chargerOrt(), chargerPhonemiseur()]);
    let dernierPourcent = -1;
    const [modele, descriptif] = await Promise.all([
      fichierModele(MODELE, (charge, total) => {
        const pourcent = total ? Math.floor((100 * charge) / total) : -1;
        if (pourcent !== dernierPourcent) { dernierPourcent = pourcent; envoyer({ type: "progression", pourcent }); }
      }),
      fichierModele(`${MODELE}.json`),
    ]);
    config = JSON.parse(await descriptif.blob.text());
    session = await ort.InferenceSession.create(new Uint8Array(await modele.blob.arrayBuffer()), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    await nouveauPhonemiseur();
    // Échauffement : la première inférence est toujours plus lente.
    await inferer((await phonemiser(["Bonjour."]))[0]);
    return { dejaLa: modele.dejaLa };
  })();
  return initialisation;
}

self.onmessage = async (evenement) => {
  const message = evenement.data || {};
  if (message.type === "init") {
    try {
      const { dejaLa } = await initialiser();
      envoyer({ type: "pret", voix: VOIX, dejaLa });
      traiterFile();
    } catch (erreur) {
      initialisation = null;
      envoyer({ type: "erreur", message: String(erreur?.message || erreur) });
    }
  } else if (message.type === "synth") {
    ajouter({ cle: message.cle, id: message.id ?? null, texte: message.texte });
    if (session) traiterFile();
  } else if (message.type === "annuler") {
    seuilAnnulation = Math.max(seuilAnnulation, message.avant);
    for (let i = file.length - 1; i >= 0; i -= 1) if (annule(file[i])) { envoyer({ type: "echec", cle: file[i].cle, annule: true }); file.splice(i, 1); }
  }
};
