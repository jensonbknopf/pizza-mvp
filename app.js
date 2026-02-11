// Long-press / Drag Steuerung
const LONG_PRESS_MS = 280;      // fühlt sich “lockig” an (250–350 gut)
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
  cheese:    { label: "Käse",      icon: "./assets/icons/cheese.png",    pieceImgs: ["./assets/pieces/cheese_1.png"],    pieceCount: 55 },
  pepper:    { label: "Paprika",   icon: "./assets/icons/pepper.png",    pieceImgs: ["./assets/pieces/pepper_1.png"],    pieceCount: 35 },
  mushrooms: { label: "Pilze",     icon: "./assets/icons/mushrooms.png", pieceImgs: ["./assets/pieces/mushrooms_1.png"], pieceCount: 26 },
  garlic:    { label: "Knoblauch", icon: "./assets/icons/garlic.png",    pieceImgs: ["./assets/pieces/garlic_1.png"],    pieceCount: 18 },
  salami:    { label: "Salami",    icon: "./assets/icons/salami.png",    pieceImgs: ["./assets/pieces/salami_1.png"],    pieceCount: 16 },
  corn:      { label: "Mais",      icon: "./assets/icons/corn.png",      pieceImgs: ["./assets/pieces/corn_1.png"],      pieceCount: 40 },
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
function formatEUR(value) {
  // de-DE: 7,50 €
  return value.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function updatePrice() {
  const total = BASE_PRICE + (activeToppings.size * TOPPING_PRICE);
  priceBadge.textContent = formatEUR(total);
}

function loadImage(src) {
  if (imageCache.has(src)) return Promise.resolve(imageCache.get(src));

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { imageCache.set(src, img); resolve(img); };
    img.onerror = () => reject(new Error(`Image failed: ${src}`));
    img.src = src;
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

// ---------- Konva setup ----------
let stage, baseLayer, toppingLayer, uiLayer;
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
  toppingLayer = new Konva.Layer();
  uiLayer = new Konva.Layer();

  stage.add(baseLayer);
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
  };
}

function clearAllToppings() {
  toppingLayer.destroyChildren();
  toppingLayer.draw();
  activeToppings.clear();
  toppingNodes.clear();
  updateTrayUI();
  updatePrice();
}

function removeTopping(key) {
  const nodes = toppingNodes.get(key) || [];
  nodes.forEach(n => n.destroy());
  toppingLayer.draw();
  toppingNodes.delete(key);
  activeToppings.delete(key);
  updateTrayUI();
  updatePrice();
}

// ---------- Explosion Scatter ----------
async function explodeScatterTopping(key, dropX, dropY) {
  // Wenn schon aktiv: für MVP ignorieren (keine doppelte Zutat)
  if (activeToppings.has(key)) return;

  activeToppings.add(key);
  updateTrayUI();
  updatePrice();

  const conf = TOPPINGS[key];
  const nodes = [];
  toppingNodes.set(key, nodes);

  // Zielradius: etwas innerhalb des Pizza-Rands
 const targetRadius = pizza.radius * 0.90;

// Safe-Radius: damit das ganze Piece im Kreis bleibt
const maxPiecePx = 28; // grobe Obergrenze in Pixeln (passen wir gleich an)
const safeRadius = Math.max(10, targetRadius - maxPiecePx);

  // Explosionsparameter (feel-good Werte)
  const blastMin = 22;
  const blastMax = 70;

  // Optik-Varianz
  const scaleMin = 0.05;
  const scaleMax = 0.08;

  // Wenn Drop-Punkt außerhalb Pizza liegt (kann bei schnellen Drags passieren),
  // setzen wir Explosion auf Pizza-Zentrum
  const dropInside = isInsideCircle(dropX, dropY, pizza.cx, pizza.cy, pizza.radius);
  const originX = dropInside ? dropX : pizza.cx;
  const originY = dropInside ? dropY : pizza.cy;

  hint.style.opacity = "0";

  for (let i = 0; i < conf.pieceCount; i++) {
    const imgSrc = conf.pieceImgs[Math.floor(Math.random() * conf.pieceImgs.length)];
    const img = await loadImage(imgSrc);

    const target = randomPointInCircle(pizza.cx, pizza.cy, targetRadius);

    // Start: am Ursprung (Drop)
    const startX = originX;
    const startY = originY;

    // Zwischenpunkt: radial “weg” vom Ursprung
    const angle = Math.random() * Math.PI * 2;
    const blastDist = rand(blastMin, blastMax);
    const midX = originX + Math.cos(angle) * blastDist;
    const midY = originY + Math.sin(angle) * blastDist;

    const s = rand(scaleMin, scaleMax);
    const rotation = rand(0, 360);

    const node = new Konva.Image({
      image: img,
      x: startX,
      y: startY,
      offsetX: img.width / 2,
      offsetY: img.height / 2,
      scaleX: s * 0.65,
      scaleY: s * 0.65,
      rotation,
      opacity: 0.0,
      listening: false,
    });

    nodes.push(node);
    toppingLayer.add(node);

    // Animation Phase 1: “Pop + Blast”
    node.to({
      duration: rand(0.10, 0.16),
      x: midX,
      y: midY,
      opacity: rand(0.85, 1.0),
      scaleX: s * 0.95,
      scaleY: s * 0.95,
      easing: Konva.Easings.EaseOut,
    });

    // Animation Phase 2: “Settle” auf Ziel
    // Kleiner Delay, damit es sich wie Explosion anfühlt
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
  setTimeout(() => { hint.style.opacity = activeToppings.size ? "0" : "1"; }, 250);
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
    scaleX: 0.9,
    scaleY: 0.9,
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
    scaleX: 1.05,
    scaleY: 1.05,
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

  // Pizza neu positionieren
  await drawPizzaBase();

  // Hinweis neu zentrieren (DOM macht das)
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











