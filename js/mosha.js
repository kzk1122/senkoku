/* ============================================================
   線刻 (Senkoku) − 模写道場  Stage 3
   - 和のモチーフをプロシージャル描画したお手本を模写する
   - 三段階の難化: 隣に表示 → 薄く下敷き → 記憶模写 (10秒見て隠す)
   - 「見比べる」で採点。隣/記憶モードは描画をお手本の枠に正規化して
     「形」を採点し、お手本を朱で重ねる差分オーバーレイを表示
   ============================================================ */
"use strict";

const PASS_SCORE = 70;
const STORAGE_KEY = "senkoku_progress_v1"; // 他 Stage と共有 (id はユニーク)
const UNDERLAY_ALPHA = 0.16;
const MEMORY_SECONDS = 10;

/* ---------------- 題材定義 (単位正方形 0..1, y下向き) ---------------- */
const arcFn = (cx, cy, r, a0, a1) => t => {
  const a = ((a0 + (a1 - a0) * t) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
};
const lineFn = (x0, y0, x1, y1) => t => ({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
const polyFn = (...pts) => t => {
  const n = pts.length - 1;
  const ft = Math.min(t, 0.9999) * n;
  const i = Math.floor(ft), r = ft - i;
  return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * r, y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * r };
};

const MOTIFS = [
  {
    id: "ms_tsuki", glyph: "月", name: "三日月",
    desc: "外の弧と内の弧、2本の曲線で月を。弧の張りをよく見て。",
    parts: [
      arcFn(0.5, 0.5, 0.33, -60, 240),
      arcFn(0.5, 0.16, 0.174, 161.9, 18.1),
    ],
  },
  {
    id: "ms_fuji", glyph: "山", name: "富士",
    desc: "左右の稜線のゆるやかな反りと、山頂の雪形。",
    parts: [
      t => ({ x: 0.10 + 0.28 * t, y: 0.82 - 0.48 * t + 0.10 * t * (1 - t) }),
      t => ({ x: 0.62 + 0.28 * t, y: 0.34 + 0.48 * t - 0.10 * t * (1 - t) }),
      polyFn([0.38, 0.34], [0.44, 0.43], [0.50, 0.35], [0.56, 0.44], [0.62, 0.34]),
    ],
  },
  {
    id: "ms_nami", glyph: "波", name: "青海波",
    desc: "同心の半円3つ。間隔を保ちながら弧を重ねる。",
    parts: [
      arcFn(0.5, 0.72, 0.34, 180, 360),
      arcFn(0.5, 0.72, 0.24, 180, 360),
      arcFn(0.5, 0.72, 0.14, 180, 360),
    ],
  },
  {
    id: "ms_hyotan", glyph: "瓢", name: "瓢箪",
    desc: "大小の玉のくびれの位置と比率が命。口も忘れずに。",
    parts: [
      arcFn(0.5, 0.33, 0.12, 131.9, -311.9),
      arcFn(0.5, 0.575, 0.175, -62.7, 242.7),
      lineFn(0.5, 0.10, 0.5, 0.208),
    ],
  },
  {
    id: "ms_ume", glyph: "梅", name: "梅鉢",
    desc: "中心の円と5枚の花弁。等間隔の配置に集中して。",
    parts: [
      ...[0, 1, 2, 3, 4].map(i =>
        arcFn(0.5 + 0.20 * Math.cos(((i * 72 - 90) * Math.PI) / 180),
              0.5 + 0.20 * Math.sin(((i * 72 - 90) * Math.PI) / 180),
              0.095, -90, 270)),
      arcFn(0.5, 0.5, 0.085, -90, 270),
    ],
  },
];

const MODES = [
  { label: "隣に表示", hint: "左のお手本を見ながら、右のキャンバスに同じ絵を描いてください。位置や大きさは自由。描けたら「見比べる」。" },
  { label: "下敷き", hint: "薄い下敷きの上に描きます。なぞるのではなく、自分の線で仕上げる意識で。描けたら「見比べる」。" },
  { label: "記憶", hint: "「お手本を見る」で10秒間だけ表示されます。記憶だけで描いて「見比べる」。" },
];

/* ---------------- 進捗 ---------------- */
function loadProgress() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function saveProgress() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress)); }
  catch { /* private mode */ }
}
function scoreId(motifIdx, mode) { return `${MOTIFS[motifIdx].id}_${mode}`; }
function bestOf(id) { return state.progress[id] ?? null; }
function motifUnlocked(i) {
  if (i === 0) return true;
  return (bestOf(scoreId(i - 1, 0)) ?? 0) >= PASS_SCORE;
}
function modeUnlocked(motifIdx, mode) {
  if (mode === 0) return true;
  return (bestOf(scoreId(motifIdx, mode - 1)) ?? 0) >= PASS_SCORE;
}

/* ---------------- 状態 ---------------- */
const state = {
  motifIndex: 0,
  mode: 0,
  diffTf: null,        // 採点後の差分オーバーレイ変換 (null = 非表示)
  memoryVisible: false, // 記憶モードでお手本表示中か
  memoryTimerId: null,
  progress: loadProgress(),
};

const $ = id => document.getElementById(id);
const els = {
  rail: $("courseRail"), glyph: $("courseGlyph"), name: $("courseName"), desc: $("courseDesc"),
  modeTabs: [...document.querySelectorAll("#modeTabs .tab")],
  penBtn: $("penBtn"), undoBtn: $("undoBtn"), clearBtn: $("clearBtn"),
  peekBtn: $("peekBtn"), compareBtn: $("compareBtn"),
  refCanvas: $("refCanvas"), drawCanvas: $("drawCanvas"), refPane: $("refPane"),
  wrap: $("moshaWrap"), timerDisp: $("timerDisp"),
  result: $("result"), stampRank: $("stampRank"), stampScore: $("stampScore"),
  barAcc: $("barAcc"), barCov: $("barCov"), barSmo: $("barSmo"),
  valAcc: $("valAcc"), valCov: $("valCov"), valSmo: $("valSmo"),
  note: $("resultNote"), retryBtn: $("retryBtn"), nextBtn: $("nextBtn"),
  hint: $("moshaHint"), penStatus: $("penStatus"),
};

surfaceState.onPenDetect = () => {
  els.penStatus.textContent = "Apple Pencil 検出 ✓ (筆圧有効)";
};

function currentMotif() { return MOTIFS[state.motifIndex]; }

/* ---------------- お手本の座標系 ----------------
   単位正方形をキャンバスに等倍フィット (86%) させる */
function fitBox(rect) {
  const side = Math.min(rect.width, rect.height) * 0.86;
  return { side, ox: (rect.width - side) / 2, oy: (rect.height - side) / 2 };
}
function partPoints(pi, n = 40) {
  const rect = els.drawCanvas.getBoundingClientRect();
  const { side, ox, oy } = fitBox(rect);
  const fn = currentMotif().parts[pi];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const p = fn(i / n);
    pts.push({ x: ox + p.x * side, y: oy + p.y * side });
  }
  return pts;
}
function motifTargets(n = 240) {
  const parts = currentMotif().parts;
  const per = Math.max(2, Math.floor(n / parts.length));
  const pts = [];
  for (let pi = 0; pi < parts.length; pi++) pts.push(...partPoints(pi, per));
  return pts;
}

/* ---------------- 描画 ---------------- */
const surface = makeSurface(els.drawCanvas, {
  canDraw: () => !(state.mode === 2 && state.memoryVisible),
  onDown() { hideResult(); state.diffTf = null; },
  onStroke() { updateCompareBtn(); },
  render: renderDraw,
});

/* 部品群をポリラインで描く汎用 */
function drawParts(ctx, rect, { color, alpha, width }) {
  const { side, ox, oy } = fitBox(rect);
  const parts = currentMotif().parts;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const fn of parts) {
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const p = fn(i / 60);
      const x = ox + p.x * side, y = oy + p.y * side;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function renderDraw() {
  const ctx = surface.ctx;
  const rect = els.drawCanvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  // 下敷きモード: お手本を薄く敷く
  if (state.mode === 1) drawParts(ctx, rect, { color: "#221F1A", alpha: UNDERLAY_ALPHA, width: 3 });

  // 差分オーバーレイ: お手本をユーザーの描画位置へ逆変換して朱で重ねる
  if (state.diffTf) {
    const tf = state.diffTf;
    const { side, ox, oy } = fitBox(rect);
    const parts = currentMotif().parts;
    ctx.save();
    ctx.strokeStyle = "#C0392F";
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    for (const fn of parts) {
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const p = fn(i / 60);
        let x = ox + p.x * side, y = oy + p.y * side;
        if (tf !== "identity") {
          x = tf.cx + (x - tf.tcx) / tf.scale;
          y = tf.cy + (y - tf.tcy) / tf.scale;
        }
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawStrokesOf(surface);
}

/* お手本ペイン */
function renderRef() {
  const canvas = els.refCanvas;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const show = state.mode === 0 || (state.mode === 2 && state.memoryVisible);
  if (show) {
    drawParts(ctx, rect, { color: "#221F1A", alpha: 0.95, width: 3 });
  } else {
    ctx.save();
    ctx.fillStyle = "rgba(139, 133, 119, 0.8)";
    ctx.font = "500 14px 'Zen Kaku Gothic New', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(state.mode === 2 ? "記憶で描いてください" : "", rect.width / 2, rect.height / 2);
    ctx.restore();
  }
}

/* ---------------- 記憶モードのぞき見タイマー ---------------- */
function startPeek() {
  if (state.memoryTimerId) clearInterval(state.memoryTimerId);
  state.memoryVisible = true;
  const deadline = Date.now() + MEMORY_SECONDS * 1000;
  const tick = () => {
    const remain = Math.ceil((deadline - Date.now()) / 1000);
    els.timerDisp.textContent = remain > 0 ? String(remain) : "";
    if (remain <= 0) {
      clearInterval(state.memoryTimerId);
      state.memoryTimerId = null;
      state.memoryVisible = false;
      renderRef();
    }
  };
  state.memoryTimerId = setInterval(tick, 200);
  tick();
  renderRef();
}

/* ---------------- 採点 ---------------- */
function updateCompareBtn() {
  els.compareBtn.disabled = surface.strokes.length === 0;
}

function compare() {
  if (!surface.strokes.length) return;
  const target = motifTargets();
  const partTargets = currentMotif().parts.map((_, pi) => partPoints(pi));

  let strokes = surface.strokes;
  let tf = "identity";
  const opts = { multiStroke: true, partTargets };
  if (state.mode !== 1) {
    // 隣/記憶: 位置・大きさは問わず「形」を採点
    const fit = fitStrokesTo(strokes, target);
    strokes = fit.strokes;
    tf = fit;
    opts.accScale = 0.08;      // フリーハンドの模写用に緩め
    opts.covTolRatio = 0.055;
  }
  const r = scoreStrokes(strokes, target, opts);

  state.diffTf = tf; // 差分オーバーレイ表示
  renderDraw();
  showResult(r);
}

function rankOf(score) {
  if (score >= 90) return "秀";
  if (score >= 80) return "優";
  if (score >= PASS_SCORE) return "良";
  if (score >= 55) return "可";
  return "再";
}
function noteFor(r) {
  const weakest = Math.min(r.acc, r.cov, r.smo);
  if (r.total >= PASS_SCORE) {
    if (r.total >= 90) return "見事な模写です。朱の重なりを見て、さらに上を。";
    return "合格です。朱のお手本とのずれを確認して、もう一歩。";
  }
  if (weakest === r.cov) return "描き落としがあります。部品の数と長さを確認して。";
  if (weakest === r.acc) return "プロポーションがずれています。部品同士の比率を先に決めて。";
  return "線がガタついています。ゆっくりでも一息に引いて。";
}

function showResult(r) {
  const id = scoreId(state.motifIndex, state.mode);
  if (r.total > (bestOf(id) ?? 0)) {
    state.progress[id] = r.total;
    saveProgress();
  }
  els.stampRank.textContent = rankOf(r.total);
  els.stampScore.textContent = r.total;
  els.valAcc.textContent = r.acc;
  els.valCov.textContent = r.cov;
  els.valSmo.textContent = r.smo;
  els.note.textContent = noteFor(r);

  const passed = r.total >= PASS_SCORE;
  els.nextBtn.hidden = true;
  if (passed && state.mode < 2) {
    els.nextBtn.textContent = "次の段階へ";
    els.nextBtn.hidden = false;
  } else if (passed && state.mode === 2 && state.motifIndex < MOTIFS.length - 1) {
    els.nextBtn.textContent = "次の題材へ";
    els.nextBtn.hidden = false;
  }
  els.result.hidden = false;
  requestAnimationFrame(() => {
    els.barAcc.style.width = r.acc + "%";
    els.barCov.style.width = r.cov + "%";
    els.barSmo.style.width = r.smo + "%";
  });
  renderRail();
  renderModeTabs();
}
function hideResult() {
  els.result.hidden = true;
  [els.barAcc, els.barCov, els.barSmo].forEach(b => (b.style.width = "0"));
}

/* ---------------- レール・モードタブ ---------------- */
function renderRail() {
  els.rail.innerHTML = "";
  MOTIFS.forEach((m, i) => {
    const unlocked = motifUnlocked(i);
    const best = bestOf(scoreId(i, state.mode));
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "chip" + (i === state.motifIndex ? " active" : "") + (unlocked ? "" : " locked");
    btn.setAttribute("aria-label", `${m.name}${unlocked ? "" : "(未解放)"}`);
    btn.innerHTML = `
      <span class="chip-glyph">${m.glyph}</span>
      <span class="chip-name">${m.name}</span>
      <span class="chip-best ${best != null && best >= PASS_SCORE ? "passed" : ""}">${
        best != null ? `${best}点` : "─"
      }</span>`;
    btn.addEventListener("click", () => {
      if (!unlocked) return;
      selectMotif(i);
    });
    els.rail.appendChild(btn);
  });
}

function renderModeTabs() {
  els.modeTabs.forEach((tab, m) => {
    const unlocked = modeUnlocked(state.motifIndex, m);
    tab.classList.toggle("active", m === state.mode);
    tab.disabled = !unlocked;
  });
}

function applyMode() {
  // 下敷きモードはお手本ペインを隠して1カラムに
  const solo = state.mode === 1;
  els.refPane.hidden = solo;
  els.wrap.classList.toggle("solo", solo);
  els.peekBtn.hidden = state.mode !== 2;
  els.timerDisp.textContent = "";
  state.memoryVisible = false;
  if (state.memoryTimerId) { clearInterval(state.memoryTimerId); state.memoryTimerId = null; }
  els.hint.textContent = MODES[state.mode].hint;
  resetDrawing();
  renderModeTabs();
  renderRail();
  requestAnimationFrame(() => { surface.resize(); renderRef(); });
}

function resetDrawing() {
  surface.clear();
  state.diffTf = null;
  hideResult();
  renderDraw();
  updateCompareBtn();
}

function selectMotif(i) {
  state.motifIndex = i;
  // モードはその題材で解放されている範囲に丸める
  while (state.mode > 0 && !modeUnlocked(i, state.mode)) state.mode--;
  const m = currentMotif();
  els.glyph.textContent = m.glyph;
  els.name.textContent = m.name;
  els.desc.textContent = m.desc;
  applyMode();
}

/* ---------------- コントロール ---------------- */
els.modeTabs.forEach((tab, m) => {
  tab.addEventListener("click", () => {
    if (!modeUnlocked(state.motifIndex, m)) return;
    state.mode = m;
    applyMode();
  });
});

els.penBtn.addEventListener("click", () => {
  setPenLevel((surfaceState.penLevel + 1) % PEN_LEVELS.length);
  els.penBtn.textContent = PEN_LEVELS[surfaceState.penLevel].label;
  renderDraw();
});

els.undoBtn.addEventListener("click", () => {
  surface.strokes.pop();
  state.diffTf = null;
  hideResult();
  renderDraw();
  updateCompareBtn();
});

els.clearBtn.addEventListener("click", resetDrawing);
els.peekBtn.addEventListener("click", startPeek);
els.compareBtn.addEventListener("click", compare);
els.retryBtn.addEventListener("click", resetDrawing);

els.nextBtn.addEventListener("click", () => {
  if (state.mode < 2 && modeUnlocked(state.motifIndex, state.mode + 1)) {
    state.mode++;
    applyMode();
  } else if (state.motifIndex < MOTIFS.length - 1 && motifUnlocked(state.motifIndex + 1)) {
    selectMotif(state.motifIndex + 1);
  }
});

/* ---------------- 初期化 ---------------- */
window.addEventListener("resize", () => {
  surface.resize();
  renderRef();
});
els.penBtn.textContent = PEN_LEVELS[surfaceState.penLevel].label;
selectMotif(0);
