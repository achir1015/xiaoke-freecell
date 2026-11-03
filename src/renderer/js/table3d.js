// 3D 牌室：長型接龍牌桌、吊燈、地毯、對手座椅與立體紙牌。
// 近處是自己的牌局（可以點選、拖曳），遠處是對手的牌局（縮小）。
// 所有牌都用「目標位置」驅動：layout() 算出每張牌該在哪裡，loop() 平滑移動過去，所以任何狀態都能直接重畫。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { cardCanvas } from './cards.js';
import { suitOf, rankOf, canStack, CELL, FOUND, SUITS } from './rules.js';

const CW = 8.4, CH = 11.76, THICK = 0.1;  // 牌寬、牌高、厚度
const GAP = 10.4;                          // 牌列間距
const COL_Z = CH + 4.2;                    // 牌列開始的 z（相對牌局原點＝上排中心）
const DZ = 3.7;                            // 牌列疊放間距
const MAX_DEPTH = 80;                      // 牌列最長可用深度
const HX = 58, Z_NEAR = 72, Z_FAR = -122;  // 桌面範圍
const BOARDS = [{ x: 0, z: -22, s: 1 }, { x: 0, z: -108, s: 0.6 }]; // 0 我、1 對手

const colX = (i) => (i - 3.5) * GAP;

function roundedShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
const SHAPE = roundedShape(CW, CH, 0.55);
const EDGE_GEO = new THREE.ExtrudeGeometry(SHAPE, { depth: THICK, bevelEnabled: false, curveSegments: 6 });
EDGE_GEO.translate(0, 0, -THICK / 2);
const FACE_GEO = (() => {
  const g = new THREE.ShapeGeometry(SHAPE, 6);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / CW + 0.5, p.getY(i) / CH + 0.5);
  return g;
})();
const MAT_EDGE = new THREE.MeshStandardMaterial({ color: 0xf2ecdc, roughness: 0.6 });

function texOf(cv) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
const faceTex = new Map();
const texFor = (c) => { if (!faceTex.has(c)) faceTex.set(c, texOf(cardCanvas(c))); return faceTex.get(c); };
let backMat = null;
const getBackMat = () => (backMat ||= new THREE.MeshStandardMaterial({ map: texOf(cardCanvas(null)), roughness: 0.42, metalness: 0.02 }));
const HL = new THREE.Color(0xffd84a), HINT = new THREE.Color(0x6cff9a), BAD = new THREE.Color(0xff9a9a), WHITE = new THREE.Color(0xffffff);

function makeCard(id) {
  const g = new THREE.Group();
  const edge = new THREE.Mesh(EDGE_GEO, MAT_EDGE);
  edge.castShadow = true;
  const back = new THREE.Mesh(FACE_GEO, getBackMat());
  back.position.z = -THICK / 2 - 0.002;
  back.rotation.y = Math.PI;
  const face = new THREE.Mesh(FACE_GEO, new THREE.MeshStandardMaterial({ map: texFor(id), roughness: 0.42, metalness: 0.02 }));
  face.position.z = THICK / 2 + 0.002;
  g.add(edge, back, face);
  g.userData = { id, face, tp: new THREE.Vector3(), tq: new THREE.Quaternion(), delay: 0 };
  g.visible = false;
  return g;
}

const eulerQ = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
const Q_FLAT = eulerQ(-Math.PI / 2, 0, 0);

// 空位的框線（暫存格、回收座、空牌列）
function slotTexture(kind, label) {
  const cv = document.createElement('canvas');
  cv.width = 240; cv.height = 336;
  const c = cv.getContext('2d');
  c.strokeStyle = kind === 'found' ? 'rgba(255,226,150,.7)' : 'rgba(255,255,255,.42)';
  c.lineWidth = 7;
  c.setLineDash(kind === 'col' ? [18, 12] : []);
  const r = 22;
  c.beginPath();
  c.moveTo(r + 6, 6); c.arcTo(234, 6, 234, 330, r); c.arcTo(234, 330, 6, 330, r); c.arcTo(6, 330, 6, 6, r); c.arcTo(6, 6, 234, 6, r); c.closePath();
  c.fillStyle = kind === 'found' ? 'rgba(255,226,150,.08)' : 'rgba(0,0,0,.14)';
  c.fill(); c.stroke();
  c.fillStyle = kind === 'found' ? 'rgba(255,226,150,.55)' : 'rgba(255,255,255,.35)';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = kind === 'found' ? '150px "Segoe UI Symbol",serif' : '600 60px "Microsoft JhengHei",sans-serif';
  c.fillText(label, 120, 168);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class Table3D {
  // onDrop({from, n, to})、onClick({loc, k})、onDouble({loc, k})
  constructor(el, { onDrop, onClick, onDouble, mobile = false, touch = false } = {}) {
    this.el = el;
    this.mobile = mobile;
    this.touch = mobile || touch;
    this.onDrop = onDrop; this.onClick = onClick; this.onDouble = onDouble;
    this.cards = [new Map(), new Map()];
    this.views = [null, null];
    this.interactive = false;
    this.sel = null;        // { loc, k }：選取中的牌
    this.hint = null;       // { f, t, n }
    this.drag = null;
    this.celebrate = 0;
    this.lastT = 0;
    this.initScene();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    this.bindPointer();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(el);
  }

  initScene() {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.el.append(r.domElement);
    this.renderer = r;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a120c);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(36, 1, 1, 1400);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.minDistance = 70; this.controls.maxDistance = 360;
    this.controls.maxPolarAngle = Math.PI * 0.44;
    this.controls.enablePan = false;
    if (this.touch) this.controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.setView('tilt');

    scene.add(new THREE.HemisphereLight(0xffeedd, 0x2a1a10, 0.8));
    const lamp = new THREE.SpotLight(0xfff0d8, 30000, 520, 0.85, 0.55, 1.9);
    lamp.position.set(0, 200, 10);
    lamp.target.position.set(0, 0, -20);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    lamp.shadow.bias = -0.0004;
    lamp.shadow.camera.near = 60;
    lamp.shadow.camera.far = 380;
    scene.add(lamp, lamp.target);
    const lamp2 = new THREE.SpotLight(0xfff0d8, 12000, 420, 0.7, 0.6, 1.9);
    lamp2.position.set(0, 190, -100);
    lamp2.target.position.set(0, 0, -100);
    scene.add(lamp2, lamp2.target);
    const fill = new THREE.DirectionalLight(0xffe2c0, 0.4);
    fill.position.set(-70, 110, 140);
    scene.add(fill);

    this.buildRoom(scene);
    this.buildTable(scene);
    this.buildSlots(scene);
  }

  woodTexture(a, b) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    const c = cv.getContext('2d');
    c.fillStyle = a; c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 240; i++) {
      c.strokeStyle = b + Math.floor(20 + Math.random() * 80).toString(16).padStart(2, '0');
      c.lineWidth = Math.random() * 3;
      c.beginPath();
      let y = Math.random() * 512;
      c.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) { y += (Math.random() - 0.5) * 6; c.lineTo(x, y); }
      c.stroke();
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  buildTable(scene) {
    const W = HX * 2, D = Z_NEAR - Z_FAR, cz = (Z_NEAR + Z_FAR) / 2, R = 8;
    // 絨布桌面：中間有一條金色分隔線，兩邊各自的牌局
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = Math.round(1024 * D / W);
    const c = cv.getContext('2d');
    const grd = c.createRadialGradient(512, cv.height * 0.45, 100, 512, cv.height * 0.45, cv.height * 0.75);
    grd.addColorStop(0, '#20845a'); grd.addColorStop(1, '#0e4c33');
    c.fillStyle = grd; c.fillRect(0, 0, 1024, cv.height);
    for (let i = 0; i < 40000; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.045})`; c.fillRect(Math.random() * 1024, Math.random() * cv.height, 2, 2); }
    c.strokeStyle = 'rgba(255,226,150,.24)'; c.lineWidth = 5; c.strokeRect(54, 54, 916, cv.height - 108);
    c.strokeStyle = 'rgba(255,226,150,.13)'; c.lineWidth = 2; c.strokeRect(68, 68, 888, cv.height - 136);
    const midZ = (BOARDS[1].z + 52 * BOARDS[1].s + BOARDS[0].z - 6) / 2;
    const my = ((midZ - Z_FAR) / D) * cv.height;
    c.strokeStyle = 'rgba(255,226,150,.3)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(120, my); c.lineTo(904, my); c.stroke();
    c.fillStyle = 'rgba(255,226,150,.32)'; c.font = '44px "Segoe UI Symbol",serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('♠ ♥ ♦ ♣', 512, my + 1);
    const felt = new THREE.CanvasTexture(cv);
    felt.colorSpace = THREE.SRGBColorSpace;
    felt.anisotropy = 8;
    const shape = roundedShape(W, D, R);
    const top = new THREE.Mesh(new THREE.ShapeGeometry(shape, 12), new THREE.MeshStandardMaterial({ map: felt, roughness: 0.95 }));
    const uv = top.geometry.attributes.uv, pos = top.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / W + 0.5, pos.getY(i) / D + 0.5);
    top.rotation.x = -Math.PI / 2;
    top.position.set(0, 0, cz);
    top.receiveShadow = true;
    scene.add(top);
    this.tableTop = top;
    // 木質桌緣
    const rim = roundedShape(W + 12, D + 12, R + 5);
    rim.holes.push(roundedShape(W, D, R));
    const rimGeo = new THREE.ExtrudeGeometry(rim, { depth: 4.5, bevelEnabled: true, bevelThickness: 1.1, bevelSize: 1.1, bevelSegments: 4, curveSegments: 12 });
    const woodTex = this.woodTexture('#6a3a1c', '#3f2110');
    woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
    woodTex.repeat.set(0.06, 0.06);
    const wood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.38, metalness: 0.05 });
    const rimMesh = new THREE.Mesh(rimGeo, wood);
    rimMesh.rotation.x = -Math.PI / 2;
    rimMesh.position.set(0, -3.4, cz);
    rimMesh.castShadow = true; rimMesh.receiveShadow = true;
    scene.add(rimMesh);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x38200f, roughness: 0.5 });
    for (const [x, z] of [[1, Z_NEAR - 10], [1, Z_FAR + 10], [-1, Z_NEAR - 10], [-1, Z_FAR + 10]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.2, 66, 16), legMat);
      leg.position.set(x * (HX - 8), -38, z);
      leg.castShadow = true;
      scene.add(leg);
    }
    // 對手的椅子（遠端）
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x6d1f24, roughness: 0.7 });
    const chairWood = new THREE.MeshStandardMaterial({ color: 0x4a2a14, roughness: 0.45 });
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(46, 6, 40), seatMat);
    seat.position.set(0, -22, -28);
    const back = new THREE.Mesh(new THREE.BoxGeometry(44, 56, 5), seatMat);
    back.position.set(0, 8, -48); back.rotation.x = 0.08;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(48, 60, 3), chairWood);
    frame.position.set(0, 8, -50.5); frame.rotation.x = 0.08;
    g.add(seat, back, frame);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.position.set(0, 0, Z_FAR - 6);
    scene.add(g);
  }

  buildRoom(scene) {
    const floorY = -71;
    const ft = this.woodTexture('#5a3a22', '#2c1a0e');
    ft.wrapS = ft.wrapT = THREE.RepeatWrapping;
    ft.repeat.set(6, 6);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.55 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = floorY;
    floor.receiveShadow = true;
    scene.add(floor);
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 768;
    const c = cv.getContext('2d');
    c.fillStyle = '#5a1a1e'; c.fillRect(0, 0, 512, 768);
    c.strokeStyle = '#d4a84a'; c.lineWidth = 8; c.strokeRect(24, 24, 464, 720);
    c.strokeStyle = 'rgba(212,168,74,.6)'; c.lineWidth = 3; c.strokeRect(42, 42, 428, 684);
    c.fillStyle = 'rgba(212,168,74,.28)';
    for (let i = 0; i < 8; i++) for (let j = 0; j < 13; j++) { c.save(); c.translate(70 + i * 53, 70 + j * 53); c.rotate(Math.PI / 4); c.fillRect(-9, -9, 18, 18); c.restore(); }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(300, 450), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(0, floorY + 0.3, -38);
    rug.receiveShadow = true;
    scene.add(rug);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3b4a3f, roughness: 0.85 });
    const panel = new THREE.MeshStandardMaterial({ color: 0x4a2c16, roughness: 0.5 });
    for (let k = 0; k < 4; k++) {
      const g = new THREE.Group();
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(1000, 460), wallMat);
      wall.position.set(0, 159, -360);
      const wain = new THREE.Mesh(new THREE.BoxGeometry(1000, 95, 4), panel);
      wain.position.set(0, floorY + 47, -358);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1000, 5, 8), panel);
      rail.position.set(0, floorY + 97, -356);
      g.add(wall, wain, rail);
      // 牆上掛畫：四種花色
      const pic = document.createElement('canvas');
      pic.width = 256; pic.height = 320;
      const pc = pic.getContext('2d');
      pc.fillStyle = '#f2ead6'; pc.fillRect(0, 0, 256, 320);
      pc.fillStyle = k % 2 ? '#c8102e' : '#16181f';
      pc.font = '190px "Segoe UI Symbol",serif'; pc.textAlign = 'center'; pc.textBaseline = 'middle';
      pc.fillText('♠♥♦♣'[k], 128, 160);
      const pt = new THREE.CanvasTexture(pic);
      pt.colorSpace = THREE.SRGBColorSpace;
      for (const dx of k % 2 ? [0] : [-120, 120]) {
        const framed = new THREE.Mesh(new THREE.BoxGeometry(92, 112, 3), new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.5, roughness: 0.4 }));
        framed.position.set(dx, 106, -356);
        const art = new THREE.Mesh(new THREE.PlaneGeometry(80, 100), new THREE.MeshStandardMaterial({ map: pt, roughness: 0.7 }));
        art.position.set(dx, 106, -354);
        g.add(framed, art);
      }
      g.position.z = -38;
      g.rotation.y = (k * Math.PI) / 2;
      scene.add(g);
    }
    // 兩盞吊燈
    for (const z of [10, -100]) {
      const shade = new THREE.Mesh(new THREE.ConeGeometry(34, 22, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x1d5a3e, roughness: 0.4, side: THREE.DoubleSide, metalness: 0.25 }));
      shade.position.set(0, 222, z);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(6.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff2d0 }));
      bulb.position.set(0, 214, z);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 130), new THREE.MeshStandardMaterial({ color: 0x111111 }));
      cord.position.set(0, 298, z);
      scene.add(shade, bulb, cord);
    }
  }

  // 每個牌局的空位框：4 暫存格、4 回收座、8 牌列
  buildSlots(scene) {
    this.slots = [[], []];
    const mats = {};
    const mat = (kind, label) => (mats[kind + label] ||= new THREE.MeshBasicMaterial({ map: slotTexture(kind, label), transparent: true, depthWrite: false }));
    const geo = new THREE.PlaneGeometry(CW + 0.6, CH + 0.6);
    for (let b = 0; b < 2; b++) {
      for (let l = 0; l < 16; l++) {
        let kind, label, loc;
        if (l < 8) { kind = 'col'; label = String(l + 1); loc = l; }
        else if (l < 12) { kind = 'cell'; label = 'ABCD'[l - 8]; loc = l; }
        else { kind = 'found'; label = SUITS[l - 12]; loc = FOUND; }
        const m = new THREE.Mesh(geo, mat(kind, label));
        m.rotation.x = -Math.PI / 2;
        const p = this.slotPos(b, l);
        m.position.set(p.x, 0.03, p.z);
        m.scale.setScalar(BOARDS[b].s);
        m.userData = { slot: true, loc, suit: l >= 12 ? l - 12 : -1, board: b };
        scene.add(m);
        this.slots[b].push(m);
      }
    }
    // 提示用：目的地的光框
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(CW + 2.4, CH + 2.4), new THREE.MeshBasicMaterial({ color: 0x8cffb4, transparent: true, opacity: 0.45, depthWrite: false }));
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.visible = false;
    scene.add(this.glow);
    // 拖曳時的落點光框
    this.dropGlow = new THREE.Mesh(new THREE.PlaneGeometry(CW + 2.4, CH + 2.4), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.4, depthWrite: false }));
    this.dropGlow.rotation.x = -Math.PI / 2;
    this.dropGlow.visible = false;
    scene.add(this.dropGlow);
  }

  // 牌局上的位置（世界座標）：l = 0～7 牌列頂、8～11 暫存格、12～15 回收座（依花色）
  slotPos(b, l) {
    const B = BOARDS[b];
    let x, z;
    if (l < 8) { x = colX(l); z = COL_Z + CH / 2; }
    else if (l < 12) { x = colX(l - 8); z = CH / 2; }
    else { x = colX(l - 8); z = CH / 2; }
    return { x: B.x + x * B.s, z: B.z + z * B.s };
  }

  setView(v) {
    this.viewMode = v;
    const p = this.mobile ? (v === 'wide' ? [0, 205, 70] : [0, 100, 24]) : v === 'top' ? [0, 178, 26] : v === 'low' ? [0, 84, 118] : v === 'wide' ? [0, 215, 92] : [0, 128, 96];
    this.camera.position.set(...p);
    this.controls.target.set(0, 0, this.mobile ? (v === 'wide' ? -30 : 8) : v === 'low' ? 8 : v === 'wide' ? -32 : v === 'top' ? 14 : 16);
    this.controls.update();
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1.35 ? 36 + (1.35 - w / h) * 34 : 36;
    this.camera.updateProjectionMatrix();
  }

  cardObj(b, id) {
    const m = this.cards[b];
    let o = m.get(id);
    if (!o) { o = makeCard(id); o.userData.board = b; m.set(id, o); this.scene.add(o); }
    return o;
  }

  colDz(n) { return n > 1 ? Math.min(DZ, (MAX_DEPTH - CH) / (n - 1)) : DZ; }

  // 主函式：views[0] 自己、views[1] 對手（null 表示不顯示）
  layout(views, { deal = false } = {}) {
    this.views = views;
    for (let b = 0; b < 2; b++) this.layoutBoard(b, views[b], deal);
    this.updateGlow();
  }

  layoutBoard(b, v, deal) {
    const map = this.cards[b];
    const used = new Set();
    for (const s of this.slots[b]) s.visible = !!v;
    if (!v) { for (const o of map.values()) o.visible = false; return; }
    const B = BOARDS[b];
    const world = (x, y, z) => new THREE.Vector3(B.x + x * B.s, y * B.s, B.z + z * B.s);
    const place = (id, p, q, delay = 0, spawn = null) => {
      const o = this.cardObj(b, id);
      used.add(id);
      o.scale.setScalar(B.s);
      const u = o.userData;
      u.tp.copy(p); u.tq.copy(q);
      u.delay = delay;
      if (!o.visible) { o.visible = true; o.position.copy(spawn || p); o.quaternion.copy(q); }
      return o;
    };
    const sel = b === 0 ? this.sel : null;
    const dragIds = b === 0 && this.drag && this.drag.active ? new Set(this.drag.cards) : null;
    const hint = b === 0 ? this.hint : null;
    const deckPos = world(0, 2, -40);
    // 牌列
    v.cols.forEach((col, i) => {
      const dz = this.colDz(col.length);
      col.forEach((c, k) => {
        const lifted = sel && sel.loc === i && k >= sel.k;
        const o = place(c, world(colX(i), 0.12 + k * 0.06 + (lifted ? 1.6 : 0), COL_Z + CH / 2 + k * dz), Q_FLAT, deal ? (k * 8 + i) * 0.018 : 0, deal ? deckPos : null);
        this.tint(o, lifted ? HL : hint && hint.f === i && k >= col.length - hint.n ? HINT : null);
        o.userData.loc = i; o.userData.k = k;
      });
    });
    // 暫存格
    v.cells.forEach((c, i) => {
      if (c < 0) return;
      const lifted = sel && sel.loc === CELL + i;
      const o = place(c, world(colX(i), 0.12 + (lifted ? 1.6 : 0), CH / 2), Q_FLAT);
      this.tint(o, lifted ? HL : hint && hint.f === CELL + i ? HINT : null);
      o.userData.loc = CELL + i; o.userData.k = 0;
    });
    // 回收座：依花色疊起來
    for (let s = 0; s < 4; s++) {
      for (let r = 0; r < v.found[s]; r++) {
        const c = s * 13 + r;
        const o = place(c, world(colX(4 + s), 0.12 + r * 0.05, CH / 2), Q_FLAT);
        this.tint(o, null);
        o.userData.loc = FOUND; o.userData.k = r;
      }
    }
    for (const [id, o] of map) if (!used.has(id)) o.visible = false;
    // 拖曳中的牌由 pointer 控制位置
    if (dragIds) for (const id of dragIds) { const o = map.get(id); if (o) o.userData.dragging = true; }
  }

  tint(o, color) { o.userData.face.material.color.copy(color || WHITE); }

  setSelection(sel) { this.sel = sel; this.relayout(); }
  setHint(m) { this.hint = m; this.relayout(); }
  relayout() { this.layout(this.views); }
  setInteractive(on) { this.interactive = !!on; if (!on) { this.sel = null; this.cancelDrag(); } }

  updateGlow() {
    const m = this.hint;
    if (!m || !this.views[0]) { this.glow.visible = false; return; }
    const l = m.t === FOUND ? 12 + suitOf(this.hintCard(m)) : m.t;
    const p = this.slotPos(0, l);
    let z = p.z;
    if (m.t < CELL) { const n = this.views[0].cols[m.t].length; z = p.z + (n ? n * this.colDz(n + m.n) : 0); }
    this.glow.position.set(p.x, 0.02, z);
    this.glow.visible = true;
  }
  hintCard(m) {
    const v = this.views[0];
    if (m.f < CELL) return v.cols[m.f][v.cols[m.f].length - m.n];
    return v.cells[m.f - CELL];
  }

  // 某張牌（或空位）在畫面上的座標（給自動化測試與教學用）
  screenOf(b, id, slot = -1) {
    const o = slot >= 0 ? this.slots[b][slot] : this.cards[b].get(id);
    if (!o) return null;
    const p = (slot >= 0 ? o.position.clone() : o.userData.tp.clone());
    if (slot < 0 && b === 0) p.z -= CH * 0.32; // 點在牌的上緣（看得到的那一段）
    p.project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  // 慶祝：全部歸位後，回收座的牌輪流跳起來
  celebrateWin(b = 0) { this.celebrate = performance.now(); this.celebrateBoard = b; }

  // ---------------- 點選與拖曳 ----------------
  ndc(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  rayHit(e) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.ndc(e), this.camera);
    const objs = [];
    for (const o of this.cards[0].values()) if (o.visible && !o.userData.dragging) objs.push(o);
    const hits = ray.intersectObjects(objs, true);
    for (const h of hits) {
      let o = h.object;
      while (o && o.userData.id === undefined) o = o.parent;
      if (o) return { card: o.userData.id, loc: o.userData.loc, k: o.userData.k };
    }
    const sh = ray.intersectObjects(this.slots[0].filter((s) => s.visible), false);
    if (sh.length) return { slot: true, loc: sh[0].object.userData.loc, k: -1 };
    return null;
  }
  tablePoint(e) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.ndc(e), this.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -2), p) ? p : null;
  }
  // 桌面上的點落在哪個位置（拖放用）
  dropLoc(p) {
    const B = BOARDS[0];
    const x = (p.x - B.x) / B.s, z = (p.z - B.z) / B.s;
    const i = Math.round(x / GAP + 3.5);
    if (i < 0 || i > 7 || Math.abs(x - colX(i)) > GAP * 0.62) return -1;
    if (z < COL_Z - 1.5) { if (z < -3 || z > CH + 2.5) return -1; return i < 4 ? CELL + i : FOUND; }
    return z < COL_Z + MAX_DEPTH + 8 ? i : -1;
  }

  bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.interactive) return;
      const hit = this.rayHit(e);
      down = { x: e.clientX, y: e.clientY, hit, id: e.pointerId, t: performance.now() };
      if (hit && hit.card != null && hit.loc !== FOUND) {
        const v = this.views[0];
        let cards;
        if (hit.loc < CELL) {
          cards = v.cols[hit.loc].slice(hit.k);
          for (let i = 1; i < cards.length; i++) if (!canStack(cards[i - 1], cards[i])) { cards = null; break; }
        } else cards = [hit.card];
        if (cards) {
          const p = this.tablePoint(e);
          const o = this.cards[0].get(cards[0]);
          down.drag = { cards, loc: hit.loc, k: hit.k, off: p && o ? new THREE.Vector3(o.position.x - p.x, 0, o.position.z - p.z) : new THREE.Vector3(), active: false };
        }
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.interactive) { el.style.cursor = ''; return; }
      if (down && down.drag && down.id === e.pointerId) {
        const d = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        if (!down.drag.active && d > 7) {
          down.drag.active = true;
          this.drag = down.drag;
          try { el.setPointerCapture(e.pointerId); } catch {}
          this.sel = null;
          this.relayout();
        }
        if (down.drag.active) { this.moveDrag(e); return; }
      }
      if (!this.touch) {
        const hit = this.rayHit(e);
        el.style.cursor = hit && (hit.card != null ? hit.loc !== FOUND : true) ? 'pointer' : '';
      }
    });
    const finish = (e) => {
      if (!down || down.id !== e.pointerId) return;
      const dd = down;
      down = null;
      if (dd.drag && dd.drag.active) {
        const p = this.tablePoint(e);
        const to = p ? this.dropLoc(p) : -1;
        const drag = this.drag;
        this.cancelDrag();
        if (to >= 0 && to !== drag.loc && this.onDrop) this.onDrop({ from: drag.loc, n: drag.cards.length, to });
        else this.relayout();
        return;
      }
      if (e.type === 'pointercancel') return;
      const hit = dd.hit;
      const now = performance.now();
      const dbl = this.lastClick && now - this.lastClick.t < 380 && hit && this.lastClick.loc === hit.loc && this.lastClick.k === hit.k;
      this.lastClick = hit ? { t: now, loc: hit.loc, k: hit.k } : null;
      if (dbl && hit.card != null && this.onDouble) { this.lastClick = null; this.onDouble({ loc: hit.loc, k: hit.k }); return; }
      if (this.onClick) this.onClick(hit ? { loc: hit.loc, k: hit.k, card: hit.card } : null);
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('dblclick', (e) => e.preventDefault());
  }

  moveDrag(e) {
    const p = this.tablePoint(e);
    if (!p || !this.drag) return;
    const base = p.clone().add(this.drag.off);
    const n = this.drag.cards.length;
    const dz = this.colDz(n);
    this.drag.cards.forEach((id, i) => {
      const o = this.cards[0].get(id);
      if (!o) return;
      o.userData.dragging = true;
      o.userData.tp.set(base.x, 6 + i * 0.08, base.z + i * dz);
      o.userData.tq.copy(eulerQ(-Math.PI / 2 + 0.12, 0, 0.04));
    });
    const to = this.dropLoc(p);
    if (to >= 0 && to !== this.drag.loc) {
      const sp = this.slotPos(0, to === FOUND ? 12 + suitOf(this.drag.cards[0]) : to);
      let z = sp.z;
      if (to < CELL) { const len = this.views[0].cols[to].length; z += len * this.colDz(len + n); }
      this.dropGlow.position.set(sp.x, 0.02, z);
      this.dropGlow.visible = true;
    } else this.dropGlow.visible = false;
  }

  cancelDrag() {
    if (this.drag) for (const id of this.drag.cards) { const o = this.cards[0].get(id); if (o) o.userData.dragging = false; }
    this.drag = null;
    if (this.dropGlow) this.dropGlow.visible = false;
  }

  loop(t) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (t - this.lastT) / 1000 || 0);
    this.lastT = t;
    const k = 1 - Math.exp(-dt * 12);
    const cel = this.celebrate && t - this.celebrate < 3200 ? (t - this.celebrate) / 1000 : 0;
    if (this.celebrate && !cel) this.celebrate = 0;
    for (let b = 0; b < 2; b++) {
      for (const o of this.cards[b].values()) {
        if (!o.visible) continue;
        const u = o.userData;
        if (u.delay > 0) { u.delay -= dt; continue; }
        const d = o.position.distanceTo(u.tp);
        o.position.lerp(u.tp, u.dragging ? 0.55 : k);
        if (d > 3 && !u.dragging) o.position.y += Math.min(d * 0.025, 0.6);
        if (cel && b === this.celebrateBoard && u.loc === FOUND) {
          const ph = cel * 6 - (u.id % 13) * 0.35 - suitOf(u.id) * 0.2;
          if (ph > 0 && ph < Math.PI) o.position.y = u.tp.y + Math.sin(ph) * 9 * BOARDS[b].s;
        }
        o.quaternion.slerp(u.tq, k);
      }
    }
    if (this.glow.visible) this.glow.material.opacity = 0.3 + 0.2 * Math.sin(t / 220);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

export { BAD, rankOf };
