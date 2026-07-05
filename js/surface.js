/* ============================================================
   線刻 共通: canvas 入力・筆描画の部品 (Stage 2/3 で共用)
   - makeSurface(): canvas ごとのストローク管理・ポインタ入力
   - drawStrokesOf(): 筆圧つきの筆描画
   - 筆の太さ設定 (PEN_LEVELS) とパームリジェクションの状態を持つ
   ============================================================ */
"use strict";

const PEN_KEY = "senkoku_pen_v1";
const PEN_LEVELS = [
  { label: "筆：細", base: 1.2, k: 4 },
  { label: "筆：中", base: 2, k: 7 },
  { label: "筆：太", base: 3, k: 12 },
];

function loadPenLevel() {
  try {
    const v = parseInt(localStorage.getItem(PEN_KEY) ?? "1", 10);
    return v >= 0 && v < PEN_LEVELS.length ? v : 1;
  } catch { return 1; }
}

const surfaceState = {
  penLevel: loadPenLevel(),
  penSeen: false,     // 一度ペンを検知したら指入力を無視 (パームリジェクション)
  onPenDetect: null,  // ペン初検知時のコールバック (ステータス表示用)
};

function setPenLevel(v) {
  surfaceState.penLevel = v;
  try { localStorage.setItem(PEN_KEY, String(v)); } catch { /* private mode */ }
}

function acceptPointer(e) {
  if (e.pointerType === "pen") {
    if (!surfaceState.penSeen) {
      surfaceState.penSeen = true;
      if (surfaceState.onPenDetect) surfaceState.onPenDetect();
    }
    return true;
  }
  if (e.pointerType === "touch") return !surfaceState.penSeen;
  return true; // mouse
}

/* canvas ごとのストローク管理・ポインタ入力をまとめる。
   hooks: { render(), canDraw()?, onDown()?, onStroke()? } */
function makeSurface(canvasEl, hooks) {
  const ctx = canvasEl.getContext("2d");
  const sf = { canvas: canvasEl, ctx, stroke: [], strokes: [], drawing: false, pid: null };

  function toLocal(e) {
    const rect = canvasEl.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, p: e.pressure || 0.5, t: e.timeStamp };
  }

  canvasEl.addEventListener("pointerdown", e => {
    if (!acceptPointer(e)) return;
    if (hooks.canDraw && !hooks.canDraw()) return;
    if (sf.drawing) return;
    if (hooks.onDown) hooks.onDown();
    sf.drawing = true;
    sf.pid = e.pointerId;
    sf.stroke = [toLocal(e)];
    canvasEl.setPointerCapture(e.pointerId);
    hooks.render();
    e.preventDefault();
  });

  canvasEl.addEventListener("pointermove", e => {
    if (!sf.drawing || e.pointerId !== sf.pid) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) sf.stroke.push(toLocal(ev));
    hooks.render();
    e.preventDefault();
  });

  function end(e) {
    if (!sf.drawing || e.pointerId !== sf.pid) return;
    sf.drawing = false;
    sf.pid = null;
    if (sf.stroke.length >= 8) {
      sf.strokes.push(sf.stroke);
      sf.stroke = [];
      if (hooks.onStroke) hooks.onStroke();
    } else {
      sf.stroke = []; // 短すぎる線は無視
    }
    hooks.render();
  }
  canvasEl.addEventListener("pointerup", end);
  canvasEl.addEventListener("pointercancel", end);

  sf.clear = () => { sf.stroke = []; sf.strokes = []; };
  sf.resize = () => {
    const rect = canvasEl.getBoundingClientRect();
    if (rect.width === 0) return; // 非表示タブ
    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = Math.round(rect.width * dpr);
    canvasEl.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hooks.render();
  };
  return sf;
}

function drawStrokesOf(sf) {
  const ctx = sf.ctx;
  const pen = PEN_LEVELS[surfaceState.penLevel];
  ctx.save();
  ctx.strokeStyle = "#33323E";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const points of [...sf.strokes, sf.stroke]) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      ctx.lineWidth = pen.base + pen.k * (b.p || 0.5);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}
