/* ============================================================
   線刻 (Senkoku) − 運筆道場  Stage 1 prototype
   - PointerEvent で Apple Pencil の筆圧を取得
   - お手本パスとの距離・網羅率・滑らかさでスコアリング
   - 70点以上で次の課題が解放 (localStorage に保存)
   ============================================================ */
"use strict";

/* ---------------- 課題定義 ----------------
   pathFn(t): t∈[0,1] → 正規化座標 {x, y} (0〜1) */
const COURSES = [
  {
    id: "yokoga", glyph: "一", name: "横画",
    desc: "水平な線を、始筆から終筆まで一定の速さで。",
    pathFn: t => ({ x: 0.12 + 0.76 * t, y: 0.5 }),
  },
  {
    id: "tatega", glyph: "｜", name: "縦画",
    desc: "垂直な線をまっすぐ下ろす。肘から動かす意識で。",
    pathFn: t => ({ x: 0.5, y: 0.12 + 0.76 * t }),
  },
  {
    id: "harai", glyph: "丿", name: "払い",
    desc: "右上から左下へ、ゆるやかに反る曲線。",
    pathFn: t => ({
      x: 0.68 - 0.38 * t - 0.10 * Math.sin(Math.PI * t),
      y: 0.15 + 0.70 * t,
    }),
  },
  {
    id: "nami", glyph: "〜", name: "波線",
    desc: "一定の振幅とリズムで波を描く。手首の柔らかさの練習。",
    pathFn: t => ({
      x: 0.12 + 0.76 * t,
      y: 0.5 + 0.13 * Math.sin(t * Math.PI * 4),
    }),
  },
  {
    id: "enso", glyph: "○", name: "円相",
    desc: "上から時計回りに一筆で円を。始点と終点を繋げる。",
    pathFn: t => ({
      x: 0.5 + 0.3 * Math.sin(t * Math.PI * 2),
      y: 0.5 - 0.3 * Math.cos(t * Math.PI * 2),
    }),
  },
  {
    id: "uzu", glyph: "渦", name: "渦巻",
    desc: "外から内へ、間隔を保ちながら渦を巻く。総仕上げ。",
    pathFn: t => {
      const turns = 2.5;
      const a = t * Math.PI * 2 * turns;
      const r = 0.34 * (1 - 0.82 * t);
      return { x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) };
    },
  },
];

const PASS_SCORE = 70;
const STORAGE_KEY = "senkoku_progress_v1";
const GUIDE_LEVELS = [
  { label: "補助線：濃", alpha: 0.5 },
  { label: "補助線：淡", alpha: 0.18 },
  { label: "補助線：無", alpha: 0.0 },
];

/* ---------------- 状態 ---------------- */
const state = {
  courseIndex: 0,
  guideLevel: 0,
  stroke: [],          // 現在の一筆 [{x, y, p, t}] (キャンバス座標)
  drawing: false,
  penSeen: false,      // 一度ペンを検知したら指入力を無視 (パームリジェクション)
  activePointerId: null,
  progress: loadProgress(),
};

/* ---------------- DOM ---------------- */
const $ = id => document.getElementById(id);
const canvas = $("canvas");
const ctx = canvas.getContext("2d");
const els = {
  rail: $("courseRail"), glyph: $("courseGlyph"), name: $("courseName"),
  desc: $("courseDesc"), guideBtn: $("guideBtn"), clearBtn: $("clearBtn"),
  result: $("result"), stampRank: $("stampRank"), stampScore: $("stampScore"),
  barAcc: $("barAcc"), barCov: $("barCov"), barSmo: $("barSmo"),
  valAcc: $("valAcc"), valCov: $("valCov"), valSmo: $("valSmo"),
  note: $("resultNote"), retryBtn: $("retryBtn"), nextBtn: $("nextBtn"),
  penStatus: $("penStatus"), hint: $("hint"),
};

/* ---------------- 進捗の保存 ---------------- */
function loadProgress() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function saveProgress() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress)); }
  catch { /* private mode 等では保存しない */ }
}
function bestOf(courseId) { return state.progress[courseId] ?? null; }
function isUnlocked(index) {
  if (index === 0) return true;
  const prev = COURSES[index - 1];
  return (bestOf(prev.id) ?? 0) >= PASS_SCORE;
}

/* ---------------- キャンバス ---------------- */
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

function currentCourse() { return COURSES[state.courseIndex]; }

/* お手本パスをキャンバス座標の点列に変換 */
function targetPoints(n = 240) {
  const rect = canvas.getBoundingClientRect();
  const pts = [];
  const fn = currentCourse().pathFn;
  for (let i = 0; i <= n; i++) {
    const p = fn(i / n);
    pts.push({ x: p.x * rect.width, y: p.y * rect.height });
  }
  return pts;
}

function render() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  drawGuide();
  drawStroke(state.stroke);
}

function drawGuide() {
  const alpha = GUIDE_LEVELS[state.guideLevel].alpha;
  const pts = targetPoints();
  if (alpha > 0) {
    ctx.save();
    ctx.strokeStyle = `rgba(139, 133, 119, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.restore();
  }
  // 始点マーカーと方向矢印は常に表示
  const start = pts[0];
  const ahead = pts[6];
  ctx.save();
  ctx.fillStyle = "rgba(192, 57, 47, 0.85)";
  ctx.beginPath();
  ctx.arc(start.x, start.y, 6, 0, Math.PI * 2);
  ctx.fill();
  const ang = Math.atan2(ahead.y - start.y, ahead.x - start.x);
  ctx.translate(start.x + Math.cos(ang) * 22, start.y + Math.sin(ang) * 22);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(-9, -5); ctx.lineTo(-9, 5); ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawStroke(points) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = "#221F1A";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    // 筆圧で太さを変える (マウスは pressure=0.5 相当)
    ctx.lineWidth = 2 + 7 * (b.p || 0.5);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------------- ポインタ入力 ---------------- */
function toLocal(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top, p: e.pressure || 0.5, t: e.timeStamp };
}

function acceptPointer(e) {
  // ペンを一度でも検知したら、以降タッチ(手のひら)は描画に使わない
  if (e.pointerType === "pen") {
    if (!state.penSeen) {
      state.penSeen = true;
      els.penStatus.textContent = "Apple Pencil 検出 ✓ (筆圧有効)";
    }
    return true;
  }
  if (e.pointerType === "touch") return !state.penSeen;
  return true; // mouse
}

canvas.addEventListener("pointerdown", e => {
  if (!acceptPointer(e)) return;
  if (state.drawing) return;
  hideResult();
  state.drawing = true;
  state.activePointerId = e.pointerId;
  state.stroke = [toLocal(e)];
  canvas.setPointerCapture(e.pointerId);
  render();
  e.preventDefault();
});

canvas.addEventListener("pointermove", e => {
  if (!state.drawing || e.pointerId !== state.activePointerId) return;
  // iPadでは coalesced events で高解像度サンプリング
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events) state.stroke.push(toLocal(ev));
  render();
  e.preventDefault();
});

function endStroke(e) {
  if (!state.drawing || e.pointerId !== state.activePointerId) return;
  state.drawing = false;
  state.activePointerId = null;
  if (state.stroke.length >= 8) {
    showResult(scoreStroke(state.stroke));
  }
}
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);

/* ---------------- スコアリング ---------------- */
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

/* 点列を等間隔に再サンプリング (滑らかさ判定用) */
function resample(points, step) {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    let prev = points[i - 1];
    const cur = points[i];
    let d = dist(prev, cur);
    while (acc + d >= step) {
      const r = (step - acc) / d;
      const np = { x: prev.x + (cur.x - prev.x) * r, y: prev.y + (cur.y - prev.y) * r };
      out.push(np);
      prev = np;
      d = dist(prev, cur);
      acc = 0;
    }
    acc += d;
  }
  return out;
}

/* 角度変化の二階差分平均 = 線のガタつき */
function jitterOf(points, step) {
  const rs = resample(points, step);
  if (rs.length < 4) return 0;
  const angles = [];
  for (let i = 1; i < rs.length; i++) {
    angles.push(Math.atan2(rs[i].y - rs[i - 1].y, rs[i].x - rs[i - 1].x));
  }
  let sum = 0, n = 0;
  for (let i = 1; i < angles.length; i++) {
    let d = angles[i] - angles[i - 1];
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    sum += Math.abs(d);
    n++;
  }
  return n ? sum / n : 0;
}

const clamp01 = v => Math.max(0, Math.min(1, v));

function scoreStroke(stroke) {
  const target = targetPoints();
  // お手本の大きさで正規化 (画面サイズに依存しないように)
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const p of target) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const size = Math.max(Math.hypot(maxX - minX, maxY - minY), 1);

  // 精度: 描いた各点からお手本までの平均距離
  let errSum = 0;
  for (const p of stroke) {
    let best = Infinity;
    for (const q of target) {
      const d = dist(p, q);
      if (d < best) best = d;
    }
    errSum += best;
  }
  const meanErr = errSum / stroke.length / size;
  const acc = clamp01(1 - (meanErr - 0.008) / 0.05) * 100;

  // 網羅: お手本の各点の近くを通過したか
  const covTol = size * 0.055;
  let covered = 0;
  for (const q of target) {
    for (const p of stroke) {
      if (dist(p, q) <= covTol) { covered++; break; }
    }
  }
  const cov = (covered / target.length) * 100;

  // 滑らかさ: お手本自身の曲率を差し引いた「余分なガタつき」
  const step = size / 90;
  const excess = Math.max(0, jitterOf(stroke, step) - jitterOf(target, step));
  const smo = clamp01(1 - excess / 0.45) * 100;

  // 網羅率が低い(線が途中で終わっている)場合は合計点を大きく減点するゲート
  const base = acc * 0.5 + cov * 0.3 + smo * 0.2;
  const gate = clamp01((cov - 40) / 50);
  const total = Math.round(base * gate);
  const avgPressure = stroke.reduce((s, p) => s + (p.p || 0), 0) / stroke.length;

  return { total, acc: Math.round(acc), cov: Math.round(cov), smo: Math.round(smo), avgPressure };
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
    if (r.total >= 90) return "見事な一筆です。次の課題も同じ集中で。";
    return "合格です。補助線を淡くして再挑戦すると更に力がつきます。";
  }
  if (weakest === r.cov) return "線が途中で止まっています。始筆から終筆まで一息に。";
  if (weakest === r.acc) return "お手本から離れています。速さより正確さを優先して。";
  return "線がガタついています。指先ではなく腕全体で動かす意識を。";
}

/* ---------------- 結果表示・進捗 ---------------- */
function showResult(r) {
  const course = currentCourse();
  const prevBest = bestOf(course.id) ?? 0;
  if (r.total > prevBest) {
    state.progress[course.id] = r.total;
    saveProgress();
  }

  els.stampRank.textContent = rankOf(r.total);
  els.stampScore.textContent = r.total;
  els.valAcc.textContent = r.acc;
  els.valCov.textContent = r.cov;
  els.valSmo.textContent = r.smo;
  els.note.textContent = noteFor(r);

  const passed = r.total >= PASS_SCORE;
  const hasNext = state.courseIndex < COURSES.length - 1;
  els.nextBtn.hidden = !(passed && hasNext);

  els.result.hidden = false;
  requestAnimationFrame(() => {
    els.barAcc.style.width = r.acc + "%";
    els.barCov.style.width = r.cov + "%";
    els.barSmo.style.width = r.smo + "%";
  });

  renderRail(); // 解放状態と最高点を更新
}

function hideResult() {
  els.result.hidden = true;
  [els.barAcc, els.barCov, els.barSmo].forEach(b => (b.style.width = "0"));
}

/* ---------------- 課題レール ---------------- */
function renderRail() {
  els.rail.innerHTML = "";
  COURSES.forEach((c, i) => {
    const unlocked = isUnlocked(i);
    const best = bestOf(c.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "chip" + (i === state.courseIndex ? " active" : "") + (unlocked ? "" : " locked");
    btn.setAttribute("aria-label", `${c.name}${unlocked ? "" : "（未解放）"}`);
    btn.innerHTML = `
      <span class="chip-glyph">${c.glyph}</span>
      <span class="chip-name">${c.name}</span>
      <span class="chip-best ${best != null && best >= PASS_SCORE ? "passed" : ""}">${
        best != null ? `${best}点` : "─"
      }</span>`;
    btn.addEventListener("click", () => {
      if (!unlocked) return;
      selectCourse(i);
    });
    els.rail.appendChild(btn);
  });
}

function selectCourse(i) {
  state.courseIndex = i;
  state.stroke = [];
  hideResult();
  const c = currentCourse();
  els.glyph.textContent = c.glyph;
  els.name.textContent = c.name;
  els.desc.textContent = c.desc;
  renderRail();
  render();
}

/* ---------------- コントロール ---------------- */
els.guideBtn.addEventListener("click", () => {
  state.guideLevel = (state.guideLevel + 1) % GUIDE_LEVELS.length;
  els.guideBtn.textContent = GUIDE_LEVELS[state.guideLevel].label;
  render();
});

els.clearBtn.addEventListener("click", () => {
  state.stroke = [];
  hideResult();
  render();
});

els.retryBtn.addEventListener("click", () => {
  state.stroke = [];
  hideResult();
  render();
});

els.nextBtn.addEventListener("click", () => {
  if (state.courseIndex < COURSES.length - 1) selectCourse(state.courseIndex + 1);
});

/* ---------------- 初期化 ---------------- */
window.addEventListener("resize", resizeCanvas);
selectCourse(0);
resizeCanvas();
