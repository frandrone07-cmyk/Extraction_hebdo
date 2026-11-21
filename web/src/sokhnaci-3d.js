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
  rendu.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
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

  function lireEtat() {
    const e = acteur;
    const cl = e.classList;
    const nombre = (nom, defaut) => { const v = parseFloat(e.style.getPropertyValue(nom)); return Number.isFinite(v) ? v : defaut; };
    return {
      parle: cl.contains("speaking"), ecoute: cl.contains("listening"), marche: cl.contains("walking"), assise: cl.contains("assise"), danse: cl.contains("danse"),
      sourire: cl.contains("grand-sourire"), geste: e.dataset.geste || "", emotion: e.dataset.emotion || "neutre",
      bouche: e.dataset.sync === "audio" ? nombre("--bouche", 0.4) : null, x: nombre("--x", 0), echelle: nombre("--echelle", 1), sens: nombre("--sens", 1),
      posture: cl.contains("posture-a") ? 1 : cl.contains("posture-b") ? -1 : 0,
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
    const G = s.parle ? s.geste : "";
    const ondule = Math.sin(t * 9);
    if (G === "salut_main") { pose("rightUpperArm", 0, 0, 0.75); pose("rightLowerArm", 0, -1.05 + ondule * 0.4, 0); pose("head", 0, 0, -0.1); }
    else if (G === "pointer_ecran") { pose("rightUpperArm", -0.95, 0, -0.55); pose("rightLowerArm", 0, -0.25, 0); pose("head", 0, -0.15, 0); }
    else if (G === "compter_doigts") { pose("rightUpperArm", 0, 0, 0.45); pose("rightLowerArm", 0, -1.25 + Math.sin(t * 5) * 0.12, 0); }
    else if (G === "pouce_leve") { pose("rightUpperArm", 0, 0, 0.35); pose("rightLowerArm", 0, -1.4, 0); pose("head", 0.05, 0, 0); }
    else if (G === "main_sur_coeur") { pose("leftUpperArm", -0.5, 0, 0.9); pose("leftLowerArm", 0, 1.75, 0); pose("head", 0.08, 0, 0.05); }
    else if (G === "geste_ouvert") { pose("leftUpperArm", -0.25, 0, 0.55 + Math.sin(t * 3) * 0.06); pose("rightUpperArm", -0.25, 0, -0.55 - Math.sin(t * 3) * 0.06); pose("leftLowerArm", 0, 0.55, 0); pose("rightLowerArm", 0, -0.55, 0); }
    else if (G === "geste_rassurant") { pose("leftUpperArm", -0.35, 0, 0.95); pose("rightUpperArm", -0.35, 0, -0.95); pose("leftLowerArm", 0, 1.0 + Math.sin(t * 3) * 0.12, 0); pose("rightLowerArm", 0, -1.0 - Math.sin(t * 3) * 0.12, 0); }
    else if (G === "mains_jointes") { pose("leftUpperArm", -0.45, 0, 0.95); pose("rightUpperArm", -0.45, 0, -0.95); pose("leftLowerArm", 0, 1.5, 0); pose("rightLowerArm", 0, -1.5, 0); }
    if (G === "hochement_tete" || (s.parle && !G)) pose("head", 0.16 * Math.sin(t * 6) * (G ? 1 : 0.4), 0.05 * Math.sin(t * 0.8), 0);
    if (s.ecoute || G === "inclinaison_ecoute") { pose("head", 0.04, 0, 0.17); pose("neck", 0.05, 0, 0.04); }
    if (s.parle && !G) pose("rightUpperArm", -0.12, 0, -1.1 - Math.sin(t * 2.2) * 0.07);

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
    const visible = hauteurModele * 0.86;
    distance = visible / 2 / Math.tan((camera.fov * Math.PI) / 360);
    if (largeur / hauteur < 0.7) distance *= 0.7 / (largeur / hauteur) * 0.9;
    camera.position.set(0, hauteurModele * 0.5, distance);
    camera.lookAt(0, hauteurModele * 0.5, 0);
    camera.updateProjectionMatrix();
  }

  const debogage = { aa: 0, ih: 0, ou: 0, happy: 0, os: {} };
  function image(maintenant) {
    if (!boucle) return;
    requestAnimationFrame(image);
    if (document.hidden) return;
    if (!acteur?.isConnected || !rendu.domElement.isConnected) { horsEcran += 1; if (horsEcran > 90) boucle = false; return; }
    horsEcran = 0;
    const dt = Math.min(0.05, (maintenant - dernier) / 1000 || 0.016);
    dernier = maintenant;
    temps += dt;
    const s = lireEtat();
    calculerPose(s, temps);
    for (const [nom, r] of Object.entries(cible)) {
      const noeud = os(nom);
      if (!noeud) continue;
      const c = (courant[nom] ||= [0, 0, 0]);
      for (let i = 0; i < 3; i += 1) c[i] = lisser(c[i], r[i], dt, 11);
      noeud.rotation.set(c[0], c[1], c[2]);
    }
    const unitesParPixel = (2 * distance * Math.tan((camera.fov * Math.PI) / 360)) / hauteur;
    xLisse = lisser(xLisse, s.x * unitesParPixel, dt, 14);
    echelleLissee = lisser(echelleLissee, s.echelle, dt, 6);
    assiseLissee = lisser(assiseLissee, s.assise ? 1 : 0, dt, 5);
    const yaw0 = s.marche && !s.assise ? s.sens * 1.15 : s.danse ? 0.25 * Math.sin(temps * 2.5) : 0;
    yaw.v = lisser(yaw.v, yaw0, dt, 7);
    vrm.scene.rotation.y = orientationBase + yaw.v;
    // Rapprochement doux : une échelle 2D de 1,32 devient environ 1,10 en 3D pour garder la tête dans le cadre.
    const echelle3d = 1 + (echelleLissee - 1) * 0.33;
    vrm.scene.scale.setScalar(echelle3d);
    vrm.scene.position.set(xLisse, -0.36 * assiseLissee * echelle3d + (s.marche ? Math.abs(Math.sin(temps * 7)) * 0.012 : 0), 0);
    Object.assign(debogage, calculerExpression(s, dt, temps));
    vrm.update(dt);
    rendu.render(scene, camera);
  }

  const observateur = new ResizeObserver(cadrer);
  const controleur = {
    canvas: rendu.domElement,
    relier(elementScene, elementActeur) {
      zone = elementScene;
      acteur = elementActeur;
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
      etat: () => ({ ...debogage, os: Object.fromEntries(["rightUpperArm", "rightLowerArm", "leftUpperLeg", "head"].map((n) => [n, os(n)?.rotation.toArray().slice(0, 3).map((v) => Math.round(v * 100) / 100)])), echelle: vrm.scene.scale.x, x: vrm.scene.position.x, assis: assiseLissee, blink }),
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
