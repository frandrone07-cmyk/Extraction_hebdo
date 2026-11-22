// Avatar 3D de Sokhna Ci : modèle VRM libre (CC0) animé de façon procédurale avec three.js et three-vrm.
// L'état (parole, gestes, marche, assise, danse, écoute, émotion, bouche) est lu sur l'élément « acteur »
// que le moteur de Sokhna Ci met déjà à jour : le rendu 3D n'est qu'une autre façon de l'afficher.
const URL_MODELE = new URL("../assets/avatar/sokhna.vrm", import.meta.url).href;
const TEINT = "#8a5232";
const TEINT_OMBRE = "#5e3520";
let singleton = null;
let chargement = null;

export function webglDisponible() {
  try {
    const canevas = document.createElement("canvas");
    return Boolean(canevas.getContext("webgl2") || canevas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function avatar3dAutorise() {
  if (navigator.webdriver && !window.__sokhnaci3d) return false;
  if (navigator.connection?.saveData) return false;
  if (!webglDisponible()) return false;
  return true;
}

export function lire3D() { return singleton; }

export function obtenir3D(tenue) {
  if (singleton) return Promise.resolve(singleton);
  if (!chargement) {
    chargement = creer(tenue).then((controleur) => (singleton = controleur)).catch((erreur) => { chargement = null; throw erreur; });
  }
  return chargement;
}

const limiter = (x, min, max) => Math.max(min, Math.min(max, x));
const lisser = (courant, cible, dt, vitesse = 9) => courant + (cible - courant) * (1 - Math.exp(-vitesse * dt));

// ---------------------------------------------------------------- motifs de tissu
function motifCanvas(tenue) {
  const canevas = document.createElement("canvas");
  const taille = { wax: 128, ankara: 126, bazin: 126 }[tenue] || 128;
  canevas.width = canevas.height = taille;
  const c = canevas.getContext("2d");
  if (tenue === "ankara") {
    const u = taille / 18;
    c.fillStyle = "#1b4fa3"; c.fillRect(0, 0, taille, taille);
    c.fillStyle = "#d6336c"; c.beginPath(); c.arc(9 * u, 9 * u, 6.5 * u, 0, 7); c.fill();
    c.fillStyle = "#fff4d6"; c.beginPath(); c.arc(9 * u, 9 * u, 4 * u, 0, 7); c.fill();
    c.fillStyle = "#1b4fa3"; c.beginPath(); c.arc(9 * u, 9 * u, 1.8 * u, 0, 7); c.fill();
    c.strokeStyle = "#f59f00"; c.lineWidth = 1.6 * u;
    for (const [x, y, dx, dy] of [[0, 0, 4, 4], [18, 0, -4, 4], [0, 18, 4, -4], [18, 18, -4, -4]]) { c.beginPath(); c.moveTo(x * u, y * u); c.lineTo((x + dx) * u, (y + dy) * u); c.stroke(); }
  } else if (tenue === "bazin") {
    const u = taille / 14;
    c.fillStyle = "#233f8f"; c.fillRect(0, 0, taille, taille);
    c.strokeStyle = "rgba(232,201,99,.75)"; c.lineWidth = 0.8 * u;
    for (const k of [-7, 0, 7]) { c.beginPath(); c.moveTo(0, (14 + k) * u); c.lineTo(14 * u, k * u); c.stroke(); }
    c.fillStyle = "#e8c963"; c.beginPath(); c.moveTo(7 * u, 3.5 * u); c.lineTo(9 * u, 7 * u); c.lineTo(7 * u, 10.5 * u); c.lineTo(5 * u, 7 * u); c.closePath(); c.fill();
  } else {
    const u = taille / 16;
    c.fillStyle = "#f2a31b"; c.fillRect(0, 0, taille, taille);
    c.fillStyle = "#17365d"; c.beginPath(); c.arc(4 * u, 4 * u, 3.3 * u, 0, 7); c.fill();
    c.fillStyle = "#f6e3b0"; c.beginPath(); c.arc(4 * u, 4 * u, 1.3 * u, 0, 7); c.fill();
    c.fillStyle = "#c2362b"; c.beginPath(); c.moveTo(12 * u, 8 * u); c.lineTo(15 * u, 11 * u); c.lineTo(12 * u, 14 * u); c.lineTo(9 * u, 11 * u); c.closePath(); c.fill();
    c.fillStyle = "#1b7f4f";
    for (const [x, y] of [[12, 2], [2, 13]]) { c.beginPath(); c.arc(x * u, y * u, 1.1 * u, 0, 7); c.fill(); }
  }
  return canevas;
}

// ---------------------------------------------------------------- création
async function creer(tenueInitiale) {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { VRMLoaderPlugin, VRMUtils } = await import("@pixiv/three-vrm");

  const rendu = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  rendu.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  rendu.outputColorSpace = THREE.SRGBColorSpace;
  rendu.domElement.className = "sna-canvas-3d";
  rendu.domElement.setAttribute("aria-hidden", "true");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfe0d4, 1.55));
  const principale = new THREE.DirectionalLight(0xffffff, 1.5);
  principale.position.set(1.2, 2.2, 3);
  scene.add(principale);

  const chargeur = new GLTFLoader();
  chargeur.register((p) => new VRMLoaderPlugin(p));
  const gltf = await chargeur.loadAsync(URL_MODELE);
  const vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  scene.add(vrm.scene);
  VRMUtils.rotateVRM0(vrm);
  const orientationBase = vrm.scene.rotation.y;
  vrm.scene.traverse((objet) => { objet.frustumCulled = false; });
  vrm.scene.getObjectByName("Hair001")?.traverse((objet) => { objet.visible = false; });

  // Regard : les yeux suivent un point proche de la caméra (l'utilisateur), avec de petits mouvements naturels.
  const regard = new THREE.Object3D();
  scene.add(regard);
  if (vrm.lookAt) { vrm.lookAt.target = regard; vrm.lookAt.autoUpdate = true; }
  let prochaineSaccade = 0;
  const saccade = { x: 0, y: 0 };

  const boite = new THREE.Box3().setFromObject(vrm.scene);
  const hauteurModele = boite.max.y - boite.min.y;

  const os = (nom) => vrm.humanoid.getNormalizedBoneNode(nom);
  const expression = (nom, valeur) => { try { vrm.expressionManager?.setValue(nom, valeur); } catch { /* expression absente */ } };

  // ---------- peau, robe, foulard ----------
  const textures = new Map();
  const texture = (tenue) => {
    if (!textures.has(tenue)) {
      const t = new THREE.CanvasTexture(motifCanvas(tenue));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      textures.set(tenue, t);
    }
    return textures.get(tenue);
  };
  const materiaux = [];
  vrm.scene.traverse((objet) => {
    if (!objet.isMesh) return;
    for (const m of Array.isArray(objet.material) ? objet.material : [objet.material]) materiaux.push(m);
  });
  const parNom = (motif) => materiaux.filter((m) => motif.test(m.name || ""));
  for (const m of parNom(/SKIN/i)) {
    m.color?.set(TEINT);
    m.shadeColorFactor?.set(TEINT_OMBRE);
    m.map = null;
    m.shadeMultiplyTexture = null;
    m.needsUpdate = true;
  }

  const foulard = new THREE.Group();
  const matFoulard = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  const calotte = new THREE.Mesh(new THREE.SphereGeometry(0.118, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.58), matFoulard);
  calotte.scale.set(1.0, 0.95, 1.0);
  calotte.position.set(0, 0.115, -0.006);
  const bandeau = new THREE.Mesh(new THREE.TorusGeometry(0.117, 0.019, 16, 48), matFoulard);
  bandeau.rotation.x = Math.PI / 2;
  bandeau.position.set(0, 0.135, -0.004);
  const noeud = new THREE.Group();
  for (const sens of [-1, 1]) {
    const aile = new THREE.Mesh(new THREE.SphereGeometry(0.04, 20, 14), matFoulard);
    aile.scale.set(1.25, 0.7, 0.55);
    aile.position.set(0.045 * sens, 0, 0);
    aile.rotation.z = -0.35 * sens;
    noeud.add(aile);
  }
  noeud.position.set(0, 0.238, 0.035);
  const chignon = new THREE.Mesh(new THREE.SphereGeometry(0.055, 24, 18), new THREE.MeshStandardMaterial({ color: 0x1b110d, roughness: 0.9 }));
  chignon.position.set(0, 0.185, -0.095);
  foulard.add(calotte, bandeau, noeud, chignon);
  os("head").add(foulard);

  let tenueCourante = null;
  function habiller(tenue) {
    if (tenue === tenueCourante) return;
    tenueCourante = tenue;
    const robe = parNom(/CLOTH/i).filter((m) => !/Shoes/i.test(m.name || ""));
    for (const m of robe) {
      if (tenue === "pro") {
        m.map = null; m.shadeMultiplyTexture = null;
        m.color?.set("#0f6b57"); m.shadeColorFactor?.set("#0a4a3c");
      } else {
        const t = texture(tenue);
        t.repeat.set(26, 26);
        m.map = t; m.shadeMultiplyTexture = t;
        m.color?.set("#ffffff"); m.shadeColorFactor?.set("#9d9d9d");
      }
      m.needsUpdate = true;
    }
    for (const m of parNom(/Shoes/i)) { m.map = null; m.shadeMultiplyTexture = null; m.color?.set("#5a3a22"); m.shadeColorFactor?.set("#3a2414"); m.needsUpdate = true; }
    const motifFoulard = tenue === "pro" ? "wax" : tenue;
    const tf = texture(motifFoulard);
    matFoulard.map = tf;
    tf.repeat.set(7, 3);
    matFoulard.needsUpdate = true;
  }
  habiller(tenueInitiale || "wax");

  // ---------- animation ----------
  const courant = {};
  const cible = {};
  const yaw = { v: 0 };
  let tempsClignement = 2 + Math.random() * 3;
  let blink = 0;
  let acteur = null;
  let zone = null;
  let cadrage = "plein";
  let largeur = 1;
  let hauteur = 1;
  let distance = 4;
  let echelleLissee = 1;
  let xLisse = 0;
  let assiseLissee = 0;
  let boucle = false;
  let dernier = 0;
  let temps = 0;
  let horsEcran = 0;
  let accentRapide = 0;
  const surcharges = {};
  let accentLent = 0;

  function acteurActif() {
    const cl = acteur.classList;
    return cl.contains("speaking") || cl.contains("walking") || cl.contains("danse") || cl.contains("listening") || cl.contains("assise") || cl.contains("applaudit") || cl.contains("incline") || cl.contains("reflechit") || cl.contains("pense") || Math.abs(xLisse) > 0.002 || echelleLissee > 1.01;
  }
  function lireEtat() {
    const e = acteur;
    const cl = e.classList;
    const buste = cadrage === "buste";
    const nombre = (nom, defaut) => { const v = parseFloat(e.style.getPropertyValue(nom)); return Number.isFinite(v) ? v : defaut; };
    return {
      parle: cl.contains("speaking"), ecoute: cl.contains("listening"), marche: !buste && cl.contains("walking"), assise: !buste && cl.contains("assise"), danse: !buste && cl.contains("danse"),
      sourire: cl.contains("grand-sourire"), geste: e.dataset.geste || "", emotion: e.dataset.emotion || "neutre", mainGauche: e.dataset.main === "gauche",
      bouche: e.dataset.sync === "audio" ? nombre("--bouche", 0.4) : null, x: buste ? 0 : nombre("--x", 0), echelle: buste ? 1 : nombre("--echelle", 1), sens: buste ? 1 : nombre("--sens", 1),
      posture: cl.contains("posture-a") ? 1 : cl.contains("posture-b") ? -1 : 0,
      applaudit: cl.contains("applaudit"), incline: cl.contains("incline"), reflechit: cl.contains("reflechit"), pense: cl.contains("pense"),
    };
  }

  const pose = (nom, x = 0, y = 0, z = 0) => { cible[nom] = [x, y, z]; };

  function calculerPose(s, t) {
    for (const k of Object.keys(cible)) delete cible[k];
    const respire = Math.sin(t * 1.5);
    pose("hips", 0, s.posture * 0.05, s.posture * 0.025);
    pose("spine", 0.02 * respire, 0, 0);
    pose("chest", 0.025 * respire, 0, 0);
    pose("neck", 0.02 * Math.sin(t * 0.7), 0, 0);
    pose("head", 0.025 * Math.sin(t * 0.55), 0.07 * Math.sin(t * 0.4), 0.03 * Math.sin(t * 0.33));
    pose("leftUpperArm", 0, 0, 1.22);
    pose("rightUpperArm", 0, 0, -1.22);
    pose("leftLowerArm", 0, 0.12, 0);
    pose("rightLowerArm", 0, -0.12, 0);

    // ----- gestes liés aux paroles -----
    const G = s.parle && s.geste !== "parole" ? s.geste : "";
    const ondule = Math.sin(t * 9);
    const accent = s.parle ? s.accent : 0; // pic d'énergie de la voix : la main et la tête marquent les mots appuyés
    const ajoute = (nom, x = 0, y = 0, z = 0) => { const c = cible[nom]; if (c) { c[0] += x; c[1] += y; c[2] += z; } };
    if (G === "salut_main") { pose("rightUpperArm", 0, 0, 0.75); pose("rightLowerArm", 0, -1.05 + ondule * 0.4, 0); pose("head", 0, 0, -0.1); }
    else if (G === "pointer_ecran") { pose("rightUpperArm", -0.95, 0, -0.55); pose("rightLowerArm", 0, -0.25, 0); pose("head", 0, -0.15, 0); }
    else if (G === "compter_doigts") { pose("rightUpperArm", 0, 0, 0.45); pose("rightLowerArm", 0, -1.25 + Math.sin(t * 5) * 0.12, 0); }
    else if (G === "pouce_leve") { pose("rightUpperArm", 0, 0, 0.35); pose("rightLowerArm", 0, -1.4, 0); pose("head", 0.05, 0, 0); }
    else if (G === "main_sur_coeur") { pose("leftUpperArm", -0.5, 0, 0.9); pose("leftLowerArm", 0, 1.75, 0); pose("head", 0.08, 0, 0.05); }
    else if (G === "geste_ouvert") { pose("leftUpperArm", -0.25, 0, 0.55 + Math.sin(t * 3) * 0.06); pose("rightUpperArm", -0.25, 0, -0.55 - Math.sin(t * 3) * 0.06); pose("leftLowerArm", 0, 0.55, 0); pose("rightLowerArm", 0, -0.55, 0); }
    else if (G === "geste_rassurant") { pose("leftUpperArm", -0.35, 0, 0.95); pose("rightUpperArm", -0.35, 0, -0.95); pose("leftLowerArm", 0, 1.0 + Math.sin(t * 3) * 0.12, 0); pose("rightLowerArm", 0, -1.0 - Math.sin(t * 3) * 0.12, 0); }
    else if (G === "mains_jointes") { pose("leftUpperArm", -0.45, 0, 0.95); pose("rightUpperArm", -0.45, 0, -0.95); pose("leftLowerArm", 0, 1.5, 0); pose("rightLowerArm", 0, -1.5, 0); }
    if (G === "hochement_tete") pose("head", 0.16 * Math.sin(t * 6), 0.05 * Math.sin(t * 0.8), 0);
    if (s.ecoute || G === "inclinaison_ecoute") { pose("head", 0.04, 0, 0.17); pose("neck", 0.05, 0, 0.04); }
    if (s.parle) {
      // Chaque mot appuyé fait un petit signe de tête ; avec un geste, la main accentue en même temps que la voix.
      ajoute("head", 0.08 * accent, 0.05 * Math.sin(t * 0.8), 0);
      ajoute("neck", 0.03 * accent, 0, 0);
      if (!G && s.mainGauche) {
        // Phrase impaire : c'est la main gauche qui rythme la parole.
        pose("leftUpperArm", -0.12 - 0.32 * accent, 0, 1.1 + 0.18 * accent);
        pose("leftLowerArm", 0, 0.12 + 0.75 * accent, 0);
        pose("rightLowerArm", 0, -0.12 - 0.3 * s.accentLent, 0);
      } else if (!G) {
        pose("rightUpperArm", -0.12 - 0.32 * accent, 0, -1.1 - 0.18 * accent);
        pose("rightLowerArm", 0, -0.12 - 0.75 * accent, 0);
        pose("leftLowerArm", 0, 0.12 + 0.3 * s.accentLent, 0);
      } else {
        ajoute("rightLowerArm", 0, -0.22 * accent, 0);
        ajoute("leftLowerArm", 0, 0.18 * accent, 0);
      }
    }

    // ----- actions : applaudir, saluer en s'inclinant, réfléchir (main au menton) -----
    if (s.applaudit) {
      const frappe = Math.sin(t * 15);
      // Bras ramenés devant la poitrine ; les avant-bras se rapprochent puis s'écartent (réglé à l'image).
      pose("leftUpperArm", 0, -0.9, 0.45); pose("rightUpperArm", 0, 0.9, -0.45);
      pose("leftLowerArm", 0, -(1.05 + 0.25 * frappe), 0); pose("rightLowerArm", 0, 1.05 + 0.25 * frappe, 0);
      ajoute("head", 0.06 * Math.abs(frappe), 0, 0);
    }
    if (s.incline) {
      pose("spine", 0.32, 0, 0); pose("chest", 0.16, 0, 0); pose("neck", 0.12, 0, 0); pose("head", 0.18, 0, 0);
      pose("leftUpperArm", -0.45, 0, 0.95); pose("rightUpperArm", -0.45, 0, -0.95);
      pose("leftLowerArm", 0, 1.5, 0); pose("rightLowerArm", 0, -1.5, 0);
    }
    if ((s.reflechit && !s.parle) || s.pense) {
      // Main droite au menton, bras gauche replié devant la taille (réglé à l'image).
      pose("rightUpperArm", 0, 0.8, -0.65); pose("rightLowerArm", 0, 2.5, 0);
      pose("leftUpperArm", 0, -0.6, 1.0); pose("leftLowerArm", 0, -1.3, 0);
      pose("head", 0.08, -0.06, 0.08);
    }
    // ----- mains : doigts détendus au repos, forme de main propre à chaque geste (réglé à l'image) -----
    const doigts = (cote, c) => {
      const sens = cote === "left" ? -1 : 1; // flexion vers la paume
      for (const [doigt, k] of [["Index", c[0]], ["Middle", c[1]], ["Ring", c[2]], ["Little", c[3]]]) {
        pose(`${cote}${doigt}Proximal`, 0, 0, sens * k * 0.9);
        pose(`${cote}${doigt}Intermediate`, 0, 0, sens * k);
        pose(`${cote}${doigt}Distal`, 0, 0, sens * k * 0.7);
      }
    };
    const DETENDU = [0.22, 0.3, 0.36, 0.42];
    const OUVERT = [0.05, 0.08, 0.1, 0.12];
    doigts("left", DETENDU);
    doigts("right", DETENDU);
    if (G === "pointer_ecran") doigts("right", [0, 1.2, 1.25, 1.3]); // index tendu vers l'écran
    else if (G === "pouce_leve") doigts("right", [1.3, 1.35, 1.35, 1.35]); // poing fermé, pouce levé
    else if (G === "compter_doigts") doigts("right", [0, 0.05, 1.2, 1.3]); // deux doigts pour énumérer
    else if (["geste_ouvert", "salut_main", "geste_rassurant"].includes(G)) { doigts("left", OUVERT); doigts("right", OUVERT); }
    else if (G === "mains_jointes" || s.applaudit || s.incline) { doigts("left", [0.1, 0.1, 0.12, 0.14]); doigts("right", [0.1, 0.1, 0.12, 0.14]); }
    else if (s.parle && !G) { const ouverture = 0.25 * accent; doigts(s.mainGauche ? "left" : "right", DETENDU.map((k) => Math.max(0, k - ouverture))); }
    // ----- marche -----
    if (s.marche && !s.assise) {
      const pas = Math.sin(t * 7);
      pose("leftUpperLeg", -0.55 * pas, 0, 0); pose("rightUpperLeg", 0.55 * pas, 0, 0);
      pose("leftLowerLeg", Math.max(0, 0.55 * pas) * 0.9, 0, 0); pose("rightLowerLeg", Math.max(0, -0.55 * pas) * 0.9, 0, 0);
      if (!G || G === "inclinaison_ecoute") { pose("leftUpperArm", 0.4 * pas, 0, 1.2); pose("rightUpperArm", -0.4 * pas, 0, -1.2); }
      pose("hips", 0, 0.08 * pas, 0.03 * pas);
      pose("spine", 0.04, -0.05 * pas, 0);
    }
    // ----- assise -----
    if (s.assise) {
      pose("leftUpperLeg", -1.45, 0.04, 0); pose("rightUpperLeg", -1.45, -0.04, 0);
      pose("leftLowerLeg", 1.4, 0, 0); pose("rightLowerLeg", 1.4, 0, 0);
      if (!G) { pose("leftUpperArm", -0.35, 0, 1.0); pose("rightUpperArm", -0.35, 0, -1.0); pose("leftLowerArm", 0, 0.9, 0); pose("rightLowerArm", 0, -0.9, 0); }
    }
    // ----- danse -----
    if (s.danse) {
      const d = Math.sin(t * 5);
      pose("hips", 0, 0.28 * d, 0.1 * d);
      pose("spine", 0, -0.12 * d, -0.06 * d);
      pose("head", 0.08 * Math.abs(d), 0.2 * d, 0.1 * d);
      pose("leftUpperArm", 0, 0, -0.5 + 0.9 * Math.max(0, d)); pose("rightUpperArm", 0, 0, 0.5 - 0.9 * Math.max(0, -d));
      pose("leftLowerArm", 0, 0.8, 0); pose("rightLowerArm", 0, -0.8, 0);
      pose("leftUpperLeg", -0.25 * d, 0, 0); pose("rightUpperLeg", 0.25 * d, 0, 0);
    }
  }

  function calculerExpression(s, dt, t) {
    const E = { happy: 0, sad: 0, relaxed: 0.1, angry: 0 };
    if (s.parle) {
      if (s.emotion === "felicitations") E.happy = 0.9;
      else if (s.emotion === "souriante") E.happy = 0.55;
      else if (s.emotion === "encourageante") { E.happy = 0.3; E.relaxed = 0.2; }
      else if (s.emotion === "preoccupee") { E.sad = 0.5; E.relaxed = 0; }
    }
    if (s.sourire || s.geste === "sourire") E.happy = Math.max(E.happy, 0.9);
    if (s.ecoute) E.relaxed = 0.35;
    // bouche : suit l'énergie réelle du son, sinon mouvement naturel pendant la parole
    let aa = 0; let ih = 0; let ou = 0;
    if (s.parle) {
      if (s.bouche !== null) {
        aa = limiter((s.bouche - 0.3) / 1.1, 0, 1) * 0.85;
        ih = 0.28 * Math.abs(Math.sin(t * 5.3)) * aa;
        ou = 0.22 * Math.abs(Math.sin(t * 3.7)) * (1 - aa * 0.5);
      } else {
        aa = 0.25 + 0.4 * Math.abs(Math.sin(t * 9));
        ih = 0.25 * Math.abs(Math.sin(t * 6.1));
        ou = 0.2 * Math.abs(Math.sin(t * 4.3));
      }
    }
    expression("aa", aa); expression("ih", ih); expression("ou", ou);
    for (const [nom, valeur] of Object.entries(E)) expression(nom, valeur);
    tempsClignement -= dt;
    if (tempsClignement <= 0) { blink = 1; tempsClignement = 2 + Math.random() * 3.5; }
    blink = Math.max(0, blink - dt * 8);
    expression("blink", blink > 0.5 ? 1 : blink * 2);
    return { aa, ih, ou, happy: E.happy };
  }

  function cadrer() {
    if (!zone) return;
    largeur = Math.max(1, zone.clientWidth);
    hauteur = Math.max(1, zone.clientHeight);
    rendu.setSize(largeur, hauteur, false);
    camera.aspect = largeur / hauteur;
    const buste = cadrage === "buste";
    // « pied » : présentatrice du mode TV dans une colonne haute et étroite, pieds au bas du cadre.
    const pied = cadrage === "pied";
    const visible = hauteurModele * (buste ? 0.31 : pied ? 1.32 : 1.16);
    const centre = hauteurModele * (buste ? 0.905 : pied ? 0.56 : 0.52);
    distance = visible / 2 / Math.tan((camera.fov * Math.PI) / 360);
    if (!buste && !pied && largeur / hauteur < 0.7) distance *= 0.7 / (largeur / hauteur) * 0.9;
    if (pied && largeur / hauteur < 0.42) distance *= 0.42 / (largeur / hauteur);
    camera.position.set(0, centre, distance);
    camera.lookAt(0, centre, 0);
    camera.updateProjectionMatrix();
  }

  const debogage = { aa: 0, ih: 0, ou: 0, happy: 0, os: {} };
  // Robustesse : perte du contexte graphique (pilote, veille) et erreurs répétées → retour à l'illustration 2D.
  let contextePerdu = false;
  let erreursSuccessives = 0;
  rendu.domElement.addEventListener("webglcontextlost", (evenement) => { evenement.preventDefault(); contextePerdu = true; });
  rendu.domElement.addEventListener("webglcontextrestored", () => { contextePerdu = false; cadrer(); });
  function abandonner() {
    boucle = false;
    zone?.classList.remove("trois-d");
    rendu.domElement.remove();
    singleton = null;
    chargement = null;
    document.dispatchEvent(new CustomEvent("sokhnaci:3d-indisponible"));
  }
  function image(maintenant) {
    if (!boucle) return;
    requestAnimationFrame(image);
    if (document.hidden || contextePerdu) return;
    try { dessiner(maintenant); erreursSuccessives = 0; } catch (erreur) {
      if (++erreursSuccessives > 20) { console.warn("Avatar 3D arrêté, retour à l'illustration 2D", erreur); abandonner(); }
    }
  }
  function dessiner(maintenant) {
    if (!acteur?.isConnected || !rendu.domElement.isConnected || !zone?.clientWidth) { horsEcran += 1; if (horsEcran > 90) boucle = false; return; }
    horsEcran = 0;
    // Au repos (ni parole, ni mouvement) on dessine environ 24 images par seconde : l'animation reste fluide
    // mais la plateforme reste légère.
    const ecoule = (maintenant - dernier) / 1000;
    if (!acteurActif() && ecoule < 0.04) return;
    const dt = limiter(ecoule || 0.016, 0.001, 0.05); // jamais négatif : sinon le lissage diverge
    dernier = maintenant;
    temps += dt;
    const s = lireEtat();
    const brut = s.parle ? (s.bouche !== null ? limiter((s.bouche - 0.4) / 0.8, 0, 1) : 0.5 + 0.5 * Math.sin(temps * 7)) : 0;
    accentRapide = lisser(accentRapide, brut, dt, 16);
    accentLent = lisser(accentLent, brut, dt, 4);
    s.accent = accentRapide;
    s.accentLent = accentLent;
    calculerPose(s, temps);
    for (const [nom, r] of Object.entries(surcharges)) cible[nom] = r; // réglage des poses (tests uniquement)
    for (const [nom, r] of Object.entries(cible)) {
      const noeud = os(nom);
      if (!noeud) continue;
      const c = (courant[nom] ||= [0, 0, 0]);
      for (let i = 0; i < 3; i += 1) {
        c[i] = lisser(c[i], r[i], dt, 11);
        if (!Number.isFinite(c[i])) c[i] = r[i];
      }
      noeud.rotation.set(c[0], c[1], c[2]);
    }
    const unitesParPixel = (2 * distance * Math.tan((camera.fov * Math.PI) / 360)) / hauteur;
    xLisse = lisser(xLisse, s.x * unitesParPixel, dt, 14);
    echelleLissee = lisser(echelleLissee, s.echelle, dt, 6);
    assiseLissee = lisser(assiseLissee, s.assise ? 1 : 0, dt, 5);
    // La présentatrice du mode TV se tourne vers les diapositives quand elle les montre.
    const versContenu = cadrage !== "buste" && acteur.classList.contains("presentatrice") && s.parle && s.geste === "pointer_ecran" && !s.marche;
    const yaw0 = s.marche && !s.assise ? s.sens * 1.15 : s.danse ? 0.25 * Math.sin(temps * 2.5) : versContenu ? -0.45 : 0;
    yaw.v = lisser(yaw.v, yaw0, dt, 7);
    vrm.scene.rotation.y = orientationBase + yaw.v;
    const tete = os("head");
    if (tete) tete.rotation.y += limiter(-yaw.v * 0.45, -0.55, 0.55);
    // Regard : vers l'utilisateur, en haut à côté quand elle réfléchit, vers l'écran quand elle le montre.
    if (temps > prochaineSaccade) {
      saccade.x = (Math.random() - 0.5) * 0.16;
      saccade.y = (Math.random() - 0.5) * 0.08;
      prochaineSaccade = temps + 0.8 + Math.random() * 2.4;
    }
    const versEcran = s.parle && s.geste === "pointer_ecran";
    const cibleX = ((s.reflechit && !s.parle) || s.pense ? -0.35 : versEcran ? 0.55 : 0) + saccade.x;
    const cibleY = ((s.reflechit && !s.parle) || s.pense ? 0.25 : 0) + saccade.y;
    regard.position.set(
      lisser(regard.position.x, camera.position.x + cibleX, dt, 10),
      lisser(regard.position.y, camera.position.y + cibleY, dt, 10),
      camera.position.z,
    );
    // Rapprochement doux : une échelle 2D de 1,32 devient environ 1,10 en 3D pour garder la tête dans le cadre.
    const echelle3d = 1 + (echelleLissee - 1) * 0.2;
    vrm.scene.scale.setScalar(echelle3d);
    vrm.scene.position.set(xLisse, -0.36 * assiseLissee * echelle3d + (s.marche ? Math.abs(Math.sin(temps * 7)) * 0.012 : 0), 0);
    Object.assign(debogage, calculerExpression(s, dt, temps));
    vrm.update(dt);
    rendu.render(scene, camera);
  }

  const observateur = new ResizeObserver(cadrer);
  const controleur = {
    canvas: rendu.domElement,
    relier(elementScene, elementActeur, options = {}) {
      zone = elementScene;
      acteur = elementActeur;
      cadrage = options.cadrage || "plein";
      rendu.domElement.classList.toggle("sna-canvas-buste", cadrage === "buste");
      if (rendu.domElement.parentElement !== zone) zone.prepend(rendu.domElement);
      observateur.disconnect();
      observateur.observe(zone);
      cadrer();
      vrm.springBoneManager?.reset();
      if (!boucle) { boucle = true; dernier = performance.now(); requestAnimationFrame(image); }
    },
    habiller,
    arreter() { boucle = false; },
  };
  if (window.__sokhnaci3d) {
    window.__sna3d = {
      etat: () => ({ ...debogage, regard: regard.position.toArray().map((v) => Math.round(v * 100) / 100), os: Object.fromEntries(["rightUpperArm", "rightLowerArm", "leftUpperArm", "leftLowerArm", "spine", "leftUpperLeg", "head"].map((n) => [n, os(n)?.rotation.toArray().slice(0, 3).map((v) => Math.round(v * 100) / 100)])), echelle: vrm.scene.scale.x, x: vrm.scene.position.x, assis: assiseLissee, blink }),
      surcharger(valeurs) { for (const k of Object.keys(surcharges)) delete surcharges[k]; Object.assign(surcharges, valeurs || {}); },
      lirePixels() {
        rendu.render(scene, camera);
        const gl = rendu.getContext();
        const total = rendu.domElement.width * rendu.domElement.height;
        const donnees = new Uint8Array(total * 4);
        gl.readPixels(0, 0, rendu.domElement.width, rendu.domElement.height, gl.RGBA, gl.UNSIGNED_BYTE, donnees);
        let opaques = 0;
        for (let i = 3; i < donnees.length; i += 16) if (donnees[i] > 8) opaques += 1;
        return { opaques, echantillons: Math.floor(donnees.length / 16) };
      },
    };
  }
  return controleur;
}
