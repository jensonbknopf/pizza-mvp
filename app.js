// Long-press / Drag Steuerung
const LONG_PRESS_MS = 80;      // fühlt sich “lockig” an (250–350 gut)
const MOVE_CANCEL_PX = 10;      // wenn man vorher wischt -> kein Drag
let pressTimer = null;
let pressStart = null;          // {x,y}
let pendingKey = null;
let isLongPressArmed = false;   // Long-press wurde ausgelöst, Drag darf starten

// ---------- Preise ----------
const BASE_PRICE = 7.50;
const TOPPING_PRICE = 0.50;

// ---------- Toppings ----------
const TOPPINGS = {
cheese: {
  label: "Käse",
  icon: "./assets/icons/cheese.png",
  pieceImgs: ["./assets/pieces/cheese_1.png"],
  pieceCount: 1,
  scaleMin: 0.38,
  scaleMax: 0.38,
  centered: true
},

pepper: {
  label: "Paprika",
  icon: "./assets/icons/pepper.png",
  pieceImgs: ["./assets/pieces/pepper_1.png"],
  pieceCount: 8,
  scaleMin: 0.05,
  scaleMax: 0.07
},

mushrooms: {
  label: "Pilze",
  icon: "./assets/icons/mushrooms.png",
  pieceImgs: ["./assets/pieces/mushrooms_1.png"],
  pieceCount: 15,
  scaleMin: 0.03,
  scaleMax: 0.06,
  spread: 1.0, 
  rim: 0.3
},

garlic: {
  label: "Knoblauch",
  icon: "./assets/icons/garlic.png",
  pieceImgs: ["./assets/pieces/garlic_1.png"],
  pieceCount: 25,
  scaleMin: 0.005,
  scaleMax: 0.01,
  spread: 0.95, 
  rim: 0.15 // darf ruhig etwas clusterig
},

salami: {
  label: "Salami",
  icon: "./assets/icons/salami.png",
  pieceImgs: ["./assets/pieces/salami_1.png"],
  pieceCount: 6,
  scaleMin: 0.07,
  scaleMax: 0.07
},

corn: {
  label: "Mais",
  icon: "./assets/icons/corn.png",
  pieceImgs: ["./assets/pieces/corn_1.png"],
  pieceCount: 65,
  scaleMin: 0.07,
  scaleMax: 0.01,
  spread: 0.5, 
  rim: 0.15 // Mais klumpt oft leicht
}
};

const BASE_IMG = "./assets/base/pizza_base_sauce.png";

// ---------- State ----------
const activeToppings = new Set();                 // keys
const toppingNodes = new Map();                   // key -> Konva.Image[]
const imageCache = new Map();                     // src -> HTMLImageElement

// ---------- DOM ----------
const stageContainer = document.getElementById("stageContainer");
const trayInner = document.getElementById("trayInner");
const priceBadge = document.getElementById("priceBadge");
const resetBtn = document.getElementById("resetBtn");
const hint = document.getElementById("hint");

// ---------- Helpers ----------
function generateSpacedOrganicTargets(cx, cy, radius, count, ring = 0.65, jitterAng = 0.28, jitterRad = 0.10, minDistPx = 90) {
  const pts = [];
  const start = Math.random() * Math.PI * 2;

  const maxAttempts = 400; // reicht locker für count=5
  let attempts = 0;

  while (pts.length < count && attempts < maxAttempts) {
    attempts++;

    // "organischer Ring": Winkel + Radius jitter
    const i = pts.length; // wir füllen nacheinander
    let a = start + (i * (Math.PI * 2 / count));
    a += (Math.random() * 2 - 1) * jitterAng;

    let r = radius * (ring + (Math.random() * 2 - 1) * jitterRad);

    const p = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };

    // Mindestabstand check
    let ok = true;
    for (let k = 0; k < pts.length; k++) {
      const dx = p.x - pts[k].x;
      const dy = p.y - pts[k].y;
      if (dx * dx + dy * dy < minDistPx * minDistPx) { ok = false; break; }
    }

    if (ok) pts.push(p);
  }

  // Fallback: falls es knapp wird, fülle auf (sollte bei 5 nie passieren)
  while (pts.length < count) pts.push(randomPointInCircle(cx, cy, radius * ring));

  return pts;
}

function generateSpacedRingPlusCenterTargets(cx, cy, radius, outerCount, ring = 0.68, minDistPx = 70) {
  const pts = [];
  const start = Math.random() * Math.PI * 2;

  // ---- Outer ring (mit Abstand) ----
  const maxAttempts = 800;

  for (let i = 0; i < outerCount; i++) {
    let placed = false;
    let attempts = 0;

    while (!placed && attempts < maxAttempts) {
      attempts++;

      let a = start + (i * (Math.PI * 2 / outerCount));
      a += (Math.random() * 2 - 1) * 0.22; // Winkel-Jitter

      let r = radius * (ring + (Math.random() * 2 - 1) * 0.07); // Radius-Jitter

      const p = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };

      // Mindestabstand
      let ok = true;
      for (let k = 0; k < pts.length; k++) {
        const dx = p.x - pts[k].x;
        const dy = p.y - pts[k].y;
        if (dx*dx + dy*dy < minDistPx*minDistPx) { ok = false; break; }
      }

      if (ok) {
        pts.push(p);
        placed = true;
      }
    }

    // Fallback (sollte selten passieren)
    if (!placed) {
      pts.push(randomPointInCircle(cx, cy, radius * ring));
    }
  }

  // ---- Center (auch Abstand zu Ring beachten) ----
  let centerPlaced = false;
  let cAttempts = 0;

  while (!centerPlaced && cAttempts < maxAttempts) {
    cAttempts++;

    const p = {
      x: cx + (Math.random() * 2 - 1) * (radius * 0.05),
      y: cy + (Math.random() * 2 - 1) * (radius * 0.05)
    };

    let ok = true;
    for (let k = 0; k < pts.length; k++) {
      const dx = p.x - pts[k].x;
      const dy = p.y - pts[k].y;
      if (dx*dx + dy*dy < minDistPx*minDistPx) { ok = false; break; }
    }

    if (ok) {
      pts.push(p);
      centerPlaced = true;
    }
  }

  // Fallback: center not perfect
  if (!centerPlaced) pts.push({ x: cx, y: cy });

  return pts;
}

function generateRingPlusCenterTargets(cx, cy, radius, outerCount, ring = 0.62) {
  const pts = [];
  const start = Math.random() * Math.PI * 2;

  for (let i = 0; i < outerCount; i++) {
    // gleichmäßig, aber organisch verschoben
    let a = start + (i * (Math.PI * 2 / outerCount));
    a += (Math.random() * 2 - 1) * 0.22; // Winkel-Jitter

    // Ring-Radius mit Variation
    let r = radius * (ring + (Math.random() * 2 - 1) * 0.08);

    pts.push({
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r
    });
  }

  // Center-Salami: minimaler Jitter, damit sie nicht "zu perfekt" sitzt
  pts.push({
    x: cx + (Math.random() * 2 - 1) * (radius * 0.03),
    y: cy + (Math.random() * 2 - 1) * (radius * 0.03)
  });

  return pts;
}

function generateOrganicRingTargets(cx, cy, radius, count) {
  const pts = [];
  const baseRing = 0.60; // Haupt-Ring
  const start = Math.random() * Math.PI * 2;

  for (let i = 0; i < count; i++) {

    // Basiswinkel (gleichmäßig)
    let a = start + (i * (Math.PI * 2 / count));

    // Winkel leicht verschieben (chaos)
    a += (Math.random() * 2 - 1) * 0.25;

    // Radius leicht variieren (nicht perfekter Kreis)
    let r = radius * (baseRing + (Math.random() * 2 - 1) * 0.12);

    // 1–2 Stück dürfen leicht weiter innen liegen
    if (Math.random() < 0.25) {
      r = radius * (0.35 + Math.random() * 0.15);
    }

    pts.push({
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r
    });
  }

  return pts;
}


function formatEUR(value) {
  // de-DE: 7,50 €
  return value.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function updatePrice() {
  const total = BASE_PRICE + (activeToppings.size * TOPPING_PRICE);
  priceBadge.textContent = formatEUR(total);
}

const ASSET_VERSION = "v12"; // bei Änderungen hochzählen (v13, v14 ...)

function loadImage(src) {
  const abs = new URL(src, document.baseURI).toString();
  const absBusted = abs + (abs.includes("?") ? "&" : "?") + "cb=" + ASSET_VERSION;

  if (imageCache.has(absBusted)) return Promise.resolve(imageCache.get(absBusted));

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { imageCache.set(absBusted, img); resolve(img); };
    img.onerror = () => {
      console.error("❌ Image failed:", absBusted);
      reject(new Error(`Image failed: ${absBusted}`));
    };
    img.src = absBusted;
  });
}

function rand(min, max) { return min + Math.random() * (max - min); }

function randomPointInCircle(cx, cy, radius) {
  const theta = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * radius;
  return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
}

function isInsideCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return (dx*dx + dy*dy) <= (r*r);
}

function generateTargetsTuned(cx, cy, radius, count, spread = 0.8, rim = 0.2) {
  const usableR = radius * (1 - 0.22 * rim);

  const area = Math.PI * usableR * usableR;
  const base = Math.sqrt(area / Math.max(1, count));
  const minDist = Math.max(4, base * (0.15 + 0.55 * spread));

  const pts = [];
  const maxAttempts = count * (20 + Math.floor(60 * spread));

  let attempts = 0;
  while (pts.length < count && attempts < maxAttempts) {
    attempts++;

    const p = randomPointInCircle(cx, cy, usableR);

    let ok = true;
    for (let i = 0; i < pts.length; i++) {
      const dx = p.x - pts[i].x;
      const dy = p.y - pts[i].y;
      if (dx * dx + dy * dy < minDist * minDist) {
        ok = false;
        break;
      }
    }

    if (!ok && Math.random() < (1 - spread) * 0.55) ok = true;

    if (ok) pts.push(p);
  }

  while (pts.length < count) {
    pts.push(randomPointInCircle(cx, cy, usableR));
  }

  return pts;
}

function generateEvenPointsInCircle(cx, cy, radius, count) {
  // Mindestabstand grob aus Fläche/Anzahl abgeleitet (tweakbar)
  const area = Math.PI * radius * radius;
  const minDist = Math.max(6, Math.sqrt(area / count) * 0.35);

  const pts = [];
  const maxAttempts = count * 40;

  let attempts = 0;
  while (pts.length < count && attempts < maxAttempts) {
    attempts++;
    const p = randomPointInCircle(cx, cy, radius);

    let ok = true;
    for (let i = 0; i < pts.length; i++) {
      const dx = p.x - pts[i].x;
      const dy = p.y - pts[i].y;
      if (dx*dx + dy*dy < minDist*minDist) {
        ok = false;
        break;
      }
    }
    if (ok) pts.push(p);
  }

  // Falls wir nicht genug Punkte schaffen, füllen wir den Rest normal auf
  while (pts.length < count) {
    pts.push(randomPointInCircle(cx, cy, radius));
  }

  return pts;
}


// ---------- Konva setup ----------
let stage, baseLayer, cheeseLayer, toppingLayer, uiLayer;
let pizza = { cx: 0, cy: 0, radius: 0, baseNode: null };

function getStageSize() {
  const rect = stageContainer.getBoundingClientRect();
  return { w: Math.floor(rect.width), h: Math.floor(rect.height) };
}

function createStage() {
  const { w, h } = getStageSize();

  stage = new Konva.Stage({
    container: "stageContainer",
    width: w,
    height: h,
  });

baseLayer = new Konva.Layer();
cheeseLayer = new Konva.Layer();
toppingLayer = new Konva.Layer();
uiLayer = new Konva.Layer();

stage.add(baseLayer);
stage.add(cheeseLayer);   // <- zwischen Base und Toppings
stage.add(toppingLayer);
stage.add(uiLayer);
}

async function drawPizzaBase() {
  const { w, h } = getStageSize();
  const baseImg = await loadImage(BASE_IMG);

  // Pizza soll ca. 90% der Breite einnehmen (nach Vorgabe).
  const targetW = w * 0.90;
  const scale = targetW / baseImg.width;
  const drawW = baseImg.width * scale;
  const drawH = baseImg.height * scale;

  const x = (w - drawW) / 2;
  const y = (h - drawH) / 2;

  // Radius aus der kleineren Kante (leicht konservativ, damit nichts über Rand hängt)
  const r = Math.min(drawW, drawH) * 0.46;

  if (pizza.baseNode) pizza.baseNode.destroy();

  const baseNode = new Konva.Image({
    image: baseImg,
    x, y,
    width: drawW,
    height: drawH,
    listening: false,
  });

  baseLayer.add(baseNode);
  baseLayer.draw();

 pizza = {
  cx: x + drawW / 2,
  cy: y + drawH / 2,
  radius: r,
  baseNode,
  baseBox: { x, y, w: drawW, h: drawH }   // <- neu
};

}

function clearAllToppings() {
  toppingLayer.destroyChildren();
  cheeseLayer.destroyChildren();
  toppingLayer.draw();
  cheeseLayer.draw();
  activeToppings.clear();
  toppingNodes.clear();
  updateTrayUI();
  updatePrice();
}

function removeTopping(key) {
  const nodes = toppingNodes.get(key) || [];
  nodes.forEach(n => n.destroy());
  toppingLayer.draw();
  cheeseLayer.draw();
  toppingNodes.delete(key);
  activeToppings.delete(key);
  updateTrayUI();
  updatePrice();
}

// ---------- Explosion Scatter ----------
async function explodeScatterTopping(key, dropX, dropY) {
  const conf = TOPPINGS[key];

  // schon aktiv? -> ignorieren
  if (activeToppings.has(key)) return;

// Sonderfall: zentriertes Topping (Käse)
if (conf.centered) {
  activeToppings.add(key);
  updateTrayUI();
  updatePrice();

  const img = await loadImage(conf.pieceImgs[0]);
  const { x, y, w, h } = pizza.baseBox;

  const node = new Konva.Image({
    image: img,
    x,
    y,
    width: w,
    height: h,
    opacity: 0,
    listening: false,
  });

  cheeseLayer.add(node);
  toppingNodes.set(key, [node]);

  node.to({
    duration: 0.25,
    opacity: 1,
    easing: Konva.Easings.EaseOut,
  });

  cheeseLayer.draw();
  hint.style.opacity = "0";
  return;
}


  // Normal: Scatter
  activeToppings.add(key);
  updateTrayUI();
  updatePrice();

  const nodes = [];
  toppingNodes.set(key, nodes);

  const targetRadius = pizza.radius * 0.90;

  // safe radius damit pieces im Kreis bleiben
  const maxPiecePx = 28;
  const safeRadius = Math.max(10, targetRadius - maxPiecePx);

  const blastMin = 22;
  const blastMax = 70;

  const scaleMin = conf.scaleMin ?? 0.06;
  const scaleMax = conf.scaleMax ?? 0.10;

  const dropInside = isInsideCircle(dropX, dropY, pizza.cx, pizza.cy, pizza.radius);
  const originX = dropInside ? dropX : pizza.cx;
  const originY = dropInside ? dropY : pizza.cy;

  hint.style.opacity = "0";

let targets;

if (key === "pepper") {
  targets = generateSpacedOrganicTargets(
    pizza.cx,
    pizza.cy,
    safeRadius,
    conf.pieceCount,
    0.58,  // ring
    0.28,  // jitter angle
    0.10,  // jitter radius
    60     // minDist in Pixel (tune!)
  );
}
  
else {
  const spread = conf.spread ?? 0.8;
  const rim = conf.rim ?? 0.2;

  targets = generateTargetsTuned(
    pizza.cx,
    pizza.cy,
    safeRadius,
    conf.pieceCount,
    spread,
    rim
  );
}

if (key === "salami") {
  targets = generateSpacedRingPlusCenterTargets(
    pizza.cx,
    pizza.cy,
    safeRadius,
    7,     // außen
    0.70,  // ring (0.66–0.75 gut)
    80     // minDistPx (tune!)
  );
} else if (key === "pepper") {
  targets = generateSpacedOrganicTargets(pizza.cx, pizza.cy, safeRadius, conf.pieceCount, 0.58, 0.28, 0.10, 60);
} else {
  const spread = conf.spread ?? 0.8;
  const rim = conf.rim ?? 0.2;
  targets = generateTargetsTuned(pizza.cx, pizza.cy, safeRadius, conf.pieceCount, spread, rim);
}
  
if (key === "salami") {
  // 7 außen + 1 Mitte
  targets = generateRingPlusCenterTargets(
    pizza.cx,
    pizza.cy,
    safeRadius,
    7,    // outerCount
    0.68  // Ring (0.62–0.75 gut)
  );
} else if (key === "pepper") {
  targets = generateOrganicRingTargets(pizza.cx, pizza.cy, safeRadius, conf.pieceCount);
} else {
  const spread = conf.spread ?? 0.8;
  const rim = conf.rim ?? 0.2;
  targets = generateTargetsTuned(pizza.cx, pizza.cy, safeRadius, conf.pieceCount, spread, rim);
}

  
  for (let i = 0; i < conf.pieceCount; i++) {
    const imgSrc = conf.pieceImgs[Math.floor(Math.random() * conf.pieceImgs.length)];
    const img = await loadImage(imgSrc);

    const s = rand(scaleMin, scaleMax);
    const rotation = rand(0, 360);

    const target = targets[i];

    const angle = Math.random() * Math.PI * 2;
    const blastDist = rand(blastMin, blastMax);
    const midX = originX + Math.cos(angle) * blastDist;
    const midY = originY + Math.sin(angle) * blastDist;

    const node = new Konva.Image({
      image: img,
      x: originX,
      y: originY,
      offsetX: img.width / 2,
      offsetY: img.height / 2,
      scaleX: s,
      scaleY: s,
      rotation,
      opacity: 0,
      listening: false,
    });

    nodes.push(node);
    toppingLayer.add(node);

// Layer-Mix: jedes Piece bekommt eine zufällige Position im Layer-Stack
const n = toppingLayer.getChildren().length;
node.zIndex(Math.floor(Math.random() * n));
    
    node.to({
      duration: rand(0.10, 0.16),
      x: midX,
      y: midY,
      opacity: rand(0.85, 1.0),
      scaleX: s * 1.02,
      scaleY: s * 1.02,
      easing: Konva.Easings.EaseOut,
    });

    node.to({
      duration: rand(0.22, 0.34),
      delay: rand(0.08, 0.14),
      x: target.x,
      y: target.y,
      scaleX: s,
      scaleY: s,
      rotation: rotation + rand(-20, 20),
      easing: Konva.Easings.EaseInOut,
    });
  }

  toppingLayer.draw();
}

// ---------- Dragging (Finger-friendly) ----------
let dragGhost = null;
let draggingKey = null;

async function startDrag(key, pointerX, pointerY) {
  draggingKey = key;

  const iconImg = await loadImage(TOPPINGS[key].icon);

  if (dragGhost) dragGhost.destroy();

  dragGhost = new Konva.Image({
    image: iconImg,
    x: pointerX,
    y: pointerY,
    offsetX: iconImg.width / 2,
    offsetY: iconImg.height / 2,
    scaleX: 0.4,
    scaleY: 0.4,
    opacity: 0.92,
    shadowColor: "black",
    shadowBlur: 16,
    shadowOpacity: 0.35,
    shadowOffset: { x: 0, y: 8 },
  });

  uiLayer.add(dragGhost);
  uiLayer.draw();

  // Lift-Effekt
  dragGhost.to({
    duration: 0.10,
    scaleX: 0.35,
    scaleY: 0.35,
    opacity: 1.0,
    easing: Konva.Easings.EaseOut,
  });
}

function moveDrag(pointerX, pointerY) {
  if (!dragGhost) return;
  dragGhost.position({ x: pointerX, y: pointerY });
  uiLayer.batchDraw();
}

async function endDrag(pointerX, pointerY) {
  if (!dragGhost || !draggingKey) return;

  // Kleine “hochschieben”-Illusion: wir nehmen die Drop-Position leicht oberhalb
  const dropX = pointerX;
  const dropY = pointerY - 10;

  const inside = isInsideCircle(dropX, dropY, pizza.cx, pizza.cy, pizza.radius * 0.98);

  // Ghost weg animieren
  dragGhost.to({
    duration: 0.10,
    opacity: 0.0,
    scaleX: 0.85,
    scaleY: 0.85,
    easing: Konva.Easings.EaseIn,
    onFinish: () => {
      dragGhost?.destroy();
      dragGhost = null;
      uiLayer.draw();
    }
  });

  if (inside) {
    await explodeScatterTopping(draggingKey, dropX, dropY);
  }

  draggingKey = null;
}

// ---------- Tray UI ----------
function updateTrayUI() {
  trayInner.querySelectorAll(".toppingCard").forEach(card => {
    const key = card.dataset.key;
    const isActive = activeToppings.has(key);
    card.classList.toggle("active", isActive);
  });
}

function buildTray() {
  trayInner.innerHTML = "";

  Object.entries(TOPPINGS).forEach(([key, t]) => {
    const card = document.createElement("div");
    card.className = "toppingCard";
    card.dataset.key = key;

    // Trash
    const trash = document.createElement("button");
    trash.className = "trashBtn";
    trash.type = "button";
    trash.textContent = "🗑️";
    trash.title = "Zutat entfernen";
    trash.addEventListener("click", (e) => {
      e.stopPropagation();
      removeTopping(key);
      if (activeToppings.size === 0) hint.style.opacity = "1";
    });

    // Row (Icon)
    const row = document.createElement("div");
    row.className = "toppingRow";

    const iconWrap = document.createElement("div");
    iconWrap.className = "toppingIcon";

    const img = document.createElement("img");
    img.src = t.icon;
    img.alt = t.label;
    iconWrap.appendChild(img);

    row.appendChild(iconWrap);

    // Name + Price
    const name = document.createElement("div");
    name.className = "toppingName";
    name.textContent = t.label;

    const price = document.createElement("div");
    price.className = "toppingPrice";
    price.textContent = `+ ${formatEUR(TOPPING_PRICE)}`;

    // Assemble card
    card.appendChild(trash);
    card.appendChild(row);
    card.appendChild(name);
    card.appendChild(price);

    // ---- Long-press / Lock Drag ----
    card.addEventListener("pointerdown", (ev) => {
      if (ev.target && ev.target.classList.contains("trashBtn")) return;

      pendingKey = key;
      pressStart = { x: ev.clientX, y: ev.clientY };
      isLongPressArmed = false;

      clearTimeout(pressTimer);
      pressTimer = setTimeout(async () => {
        isLongPressArmed = true;

        const rect = stageContainer.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;

        await startDrag(pendingKey, x, y);

        // Capture erst wenn Drag wirklich aktiv ist
        try { card.setPointerCapture(ev.pointerId); } catch {}
      }, LONG_PRESS_MS);
    });

    card.addEventListener("pointermove", (ev) => {
      // Noch kein Long-press: wenn User bewegt -> als Scroll interpretieren, Long-press canceln
      if (!dragGhost && pressStart) {
        const dx = ev.clientX - pressStart.x;
        const dy = ev.clientY - pressStart.y;

        if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
          clearTimeout(pressTimer);
          pressTimer = null;
          pendingKey = null;
          pressStart = null;
          isLongPressArmed = false;
        }
        return;
      }

      // Drag aktiv: Ghost bewegen
      if (dragGhost) {
        ev.preventDefault();
        const rect = stageContainer.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        moveDrag(x, y);
      }
    }, { passive: false });

    card.addEventListener("pointerup", async (ev) => {
      clearTimeout(pressTimer);
      pressTimer = null;

      // Drag nie gestartet -> Tap/Scroll
      if (!dragGhost) {
        pendingKey = null;
        pressStart = null;
        isLongPressArmed = false;
        return;
      }

      const rect = stageContainer.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      await endDrag(x, y);

      pendingKey = null;
      pressStart = null;
      isLongPressArmed = false;
    });

    card.addEventListener("pointercancel", async (ev) => {
      clearTimeout(pressTimer);
      pressTimer = null;

      if (dragGhost) {
        const rect = stageContainer.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        await endDrag(x, y);
      }

      pendingKey = null;
      pressStart = null;
      isLongPressArmed = false;
    });

    trayInner.appendChild(card);
  });

  updateTrayUI();
}

// ---------- Resize handling ----------
let resizeTimer = null;

async function handleResize() {
  if (!stage) return;

  const { w, h } = getStageSize();
  stage.size({ width: w, height: h });

  // Pizza neu zeichnen (berechnet baseBox neu)
  await drawPizzaBase();

  // Wenn Käse aktiv ist → neu positionieren
  if (activeToppings.has("cheese")) {
    const cheeseNodes = toppingNodes.get("cheese");

    if (cheeseNodes && cheeseNodes.length > 0) {
      const node = cheeseNodes[0];
      const { x, y, w, h } = pizza.baseBox;

      node.position({ x, y });
      node.width(w);
      node.height(h);

      cheeseLayer.draw();
    }
  }

  baseLayer.draw();
  toppingLayer.draw();
  uiLayer.draw();
}

window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(handleResize, 120);
});

// ---------- Init ----------
(async function init() {
  createStage();
  buildTray();

  // Base zeichnen
  try {
    await drawPizzaBase();
    
  // Fix für Mobile/GitHub Pages: nach erstem Layout nochmal korrekt messen
setTimeout(async () => {
  await handleResize();
}, 80);

  } catch (e) {
    console.error(e);
    hint.textContent = "Fehlende ? Prüfe /base/pizza_base_sauce.png";
  }

  updatePrice();

  resetBtn.addEventListener("click", () => {
    clearAllToppings();
    hint.style.opacity = "1";
  });
})();











































