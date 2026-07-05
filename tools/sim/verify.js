/* ============================================================
   採点ロジックの回帰テスト
   使い方: node tools/sim/verify.js
   - js/scoring.js (共通採点エンジン) を require して実行
   - 合成ストローク(固定シード乱数)で全課題タイプを採点し、
     期待値(total)との完全一致を検証する
   - 採点係数を意図的に変えたときは、出力を確認したうえで
     EXPECTED の値を更新すること
   ============================================================ */
"use strict";
const path = require("path");

const { scoreStrokes, dist, fitStrokesTo } = require(path.join(__dirname, "../../js/scoring.js"));

const W = 700, H = 525; // iPad 横向き相当のキャンバスサイズ

/* ---------------- 固定シード乱数 ---------------- */
let seed = 42;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function gauss() { return (rand() + rand() + rand() + rand() - 2) / 1; }

function pathTargetPoints(pathFn) {
  return (n = 240) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const p = pathFn(i / n);
      pts.push({ x: p.x * W, y: p.y * H });
    }
    return pts;
  };
}

/* ---------------- 結果集計 ---------------- */
let failures = 0;
function check(label, r, expected) {
  const ok = r.total === expected;
  if (!ok) failures++;
  const detail = `acc=${String(r.acc).padStart(3)} cov=${String(r.cov).padStart(3)} smo=${String(r.smo).padStart(3)}` +
    (r.prs != null ? ` prs=${String(r.prs).padStart(3)}` : "") +
    (r.minPartCov != null ? ` 部品最低cov=${String(r.minPartCov).padStart(3)}` : "");
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(14)} total=${String(r.total).padStart(3)} (期待 ${String(expected).padStart(3)})  ${detail}`);
}

/* ============================================================
   Suite 1: 単筆課題 (払い)
   ============================================================ */
{
  const fn = t => ({ x: 0.68 - 0.38 * t - 0.10 * Math.sin(Math.PI * t), y: 0.15 + 0.70 * t });
  const targetPoints = pathTargetPoints(fn);

  function makeStroke({ spacing, tremorAmp, tremorWL, sensorNoise, portion = 1 }) {
    const total = targetPoints(2000);
    let len = 0;
    for (let i = 1; i < total.length; i++) len += dist(total[i - 1], total[i]);
    const nPts = Math.max(8, Math.round((len * portion) / spacing));
    const stroke = [];
    const ph1 = rand() * Math.PI * 2, ph2 = rand() * Math.PI * 2;
    for (let i = 0; i < nPts; i++) {
      const t = (i / (nPts - 1)) * portion;
      const p = fn(t);
      const p2 = fn(Math.min(portion, t + 0.001));
      let nx = -(p2.y - p.y), ny = p2.x - p.x;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
      const s = t * len;
      const tremor =
        tremorAmp * Math.sin((s / tremorWL) * Math.PI * 2 + ph1) +
        tremorAmp * 0.5 * Math.sin((s / (tremorWL * 0.37)) * Math.PI * 2 + ph2);
      stroke.push({
        x: p.x * W + nx * tremor + gauss() * sensorNoise,
        y: p.y * H + ny * tremor + gauss() * sensorNoise,
        p: 0.5,
      });
    }
    return stroke;
  }

  const CASES = [
    ["完璧トレース",       { spacing: 3, tremorAmp: 0.0, tremorWL: 30, sensorNoise: 0.0 }, 100],
    ["軽い人間的ブレ(速)", { spacing: 4, tremorAmp: 1.2, tremorWL: 40, sensorNoise: 0.3 }, 95],
    ["丁寧・ゆっくり(遅)", { spacing: 0.8, tremorAmp: 2.0, tremorWL: 14, sensorNoise: 0.4 }, 97],
    ["普通の初心者",       { spacing: 2, tremorAmp: 2.5, tremorWL: 25, sensorNoise: 0.4 }, 84],
    ["雑な線",             { spacing: 5, tremorAmp: 6.0, tremorWL: 60, sensorNoise: 0.5 }, 79],
    ["半分で放棄",         { spacing: 3, tremorAmp: 1.2, tremorWL: 40, sensorNoise: 0.3, portion: 0.5 }, 26],
  ];

  console.log("=== Suite 1: 単筆課題 (払い) ===");
  for (const [name, params, expected] of CASES) {
    seed = 42 + name.length;
    check(name, scoreStrokes([makeStroke(params)], targetPoints()), expected);
  }
}

/* ============================================================
   Suite 2: 筆圧課題 (均圧・漸強・抜き)
   ============================================================ */
{
  const COURSES = {
    kinatsu: { pathFn: t => ({ x: 0.12 + 0.76 * t, y: 0.5 }), pressureFn: () => 0.5 },
    zenkyo:  { pathFn: t => ({ x: 0.12 + 0.76 * t, y: 0.5 }), pressureFn: t => 0.2 + 0.6 * t },
    nuki:    { pathFn: t => ({ x: 0.75 - 0.50 * t - 0.08 * Math.sin(Math.PI * t), y: 0.15 + 0.70 * t }), pressureFn: t => 0.8 - 0.65 * t },
  };
  /* 期待値: 課題ごとに [完璧, 良い制御, 軽筆圧, 強筆圧, 並, 制御できず, マウス0.5固定]
     ※軽筆圧/強筆圧 = 自然な筆記圧が目標から±0.25 ずれている人。
       オフセット補正により「圧の変化の形」が合っていれば高得点になること */
  const EXPECTED = {
    kinatsu: [96, 96, 96, 96, 92, 59, 96],
    zenkyo:  [96, 96, 96, 96, 92, 65, 55],
    nuki:    [96, 96, 96, 96, 92, 62, 44],
  };
  const SCENARIOS = [
    ["完璧な筆圧",      { wander: 0.0, noise: 0.0 }],
    ["良い制御",        { wander: 0.04, noise: 0.02 }],
    ["軽い筆圧の人",    { wander: 0.04, noise: 0.02, bias: -0.25 }],
    ["強い筆圧の人",    { wander: 0.04, noise: 0.02, bias: 0.25 }],
    ["並の制御",        { wander: 0.10, noise: 0.03 }],
    ["制御できず",      { wander: 0.22, noise: 0.05, drift: 0.15 }],
    ["マウス(0.5固定)", { mouse: true }],
  ];

  for (const [cname, course] of Object.entries(COURSES)) {
    const targetPoints = pathTargetPoints(course.pathFn);

    function makeStroke(prof) {
      const total = targetPoints(2000);
      let len = 0;
      for (let i = 1; i < total.length; i++) len += dist(total[i - 1], total[i]);
      const nPts = Math.max(8, Math.round(len / 2));
      const stroke = [];
      const ph1 = rand() * Math.PI * 2, ph2 = rand() * Math.PI * 2, ph3 = rand() * Math.PI * 2;
      for (let i = 0; i < nPts; i++) {
        const t = i / (nPts - 1);
        const p = course.pathFn(t);
        const p2 = course.pathFn(Math.min(1, t + 0.001));
        let nx = -(p2.y - p.y), ny = p2.x - p.x;
        const nl = Math.hypot(nx, ny) || 1;
        nx /= nl; ny /= nl;
        const s = t * len;
        const tremor = 1.2 * Math.sin((s / 40) * Math.PI * 2 + ph1) + 0.6 * Math.sin((s / 15) * Math.PI * 2 + ph2);
        const targetP = course.pressureFn(t);
        let pv;
        if (prof.mouse) pv = 0.5;
        else pv = targetP + (prof.bias || 0) + prof.wander * Math.sin((s / 120) * Math.PI * 2 + ph3) + gauss() * prof.noise + (prof.drift || 0) * t;
        stroke.push({
          x: p.x * W + nx * tremor + gauss() * 0.3,
          y: p.y * H + ny * tremor + gauss() * 0.3,
          p: Math.max(0.02, Math.min(1, pv)),
        });
      }
      return stroke;
    }

    console.log(`=== Suite 2: 筆圧課題 (${cname}) ===`);
    SCENARIOS.forEach(([sname, prof], si) => {
      seed = 42 + sname.length;
      check(sname, scoreStrokes([makeStroke(prof)], targetPoints(), { pressureFn: course.pressureFn }), EXPECTED[cname][si]);
    });
  }
}

/* ============================================================
   Suite 3: ハッチング (複数ストローク)
   ============================================================ */
{
  const LINES = 6;
  const lineFn = (i, t) => ({ x: 0.32 + 0.104 * i - 0.16 * t, y: 0.2 + 0.6 * t });
  
  function targetLinePoints(li, n = 40) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const p = lineFn(li, i / n);
      pts.push({ x: p.x * W, y: p.y * H });
    }
    return pts;
  }
  function targetPoints(n = 240) {
    const per = Math.max(2, Math.floor(n / LINES));
    const pts = [];
    for (let li = 0; li < LINES; li++) pts.push(...targetLinePoints(li, per));
    return pts;
  }

  function makeLine(li, { shiftX = 0, tremorAmp = 1.2, tremorWL = 40, noise = 0.3, portion = 1 }) {
    const lp = targetLinePoints(li, 2);
    const len = dist(lp[0], lp[2]);
    const nPts = Math.max(8, Math.round((len * portion) / 2));
    const stroke = [];
    const ph = rand() * Math.PI * 2;
    for (let i = 0; i < nPts; i++) {
      const t = (i / (nPts - 1)) * portion;
      const p = lineFn(li, t);
      const s = t * len;
      const tremor = tremorAmp * Math.sin((s / tremorWL) * Math.PI * 2 + ph);
      stroke.push({
        x: p.x * W + shiftX + tremor * 0.94 + gauss() * noise, // 法線≒(0.94, 0.33)
        y: p.y * H + tremor * 0.33 + gauss() * noise,
        p: 0.5,
      });
    }
    return stroke;
  }

  const CASES = [
    ["きれいな6本",      li => makeLine(li, {}), 95],
    ["間隔ややガタガタ", li => makeLine(li, { shiftX: (rand() - 0.5) * 30 }), 88],
    ["間隔大きく乱れ",   li => makeLine(li, { shiftX: (rand() - 0.5) * 70 }), 74],
    ["ヨレヨレの線",     li => makeLine(li, { tremorAmp: 5, tremorWL: 60 }), 83],
    ["2本が同じ場所",    li => makeLine(li === 5 ? 4 : li, {}), 0],
    ["短い線ばかり",     li => makeLine(li, { portion: 0.55 }), 8],
  ];

  console.log("=== Suite 3: ハッチング ===");
  const hatchPartTargets = [...Array(LINES)].map((_, li) => targetLinePoints(li));
  for (const [name, gen, expected] of CASES) {
    seed = 42 + name.length;
    const strokes = [];
    for (let li = 0; li < LINES; li++) strokes.push(gen(li));
    check(name, scoreStrokes(strokes, targetPoints(), { multiStroke: true, partTargets: hatchPartTargets }), expected);
  }
}

/* ============================================================
   Suite 3.5: まる3つ (同心円・曲線の複数ストローク)
   partTargets により円の固有曲率が滑らかさで減点されないこと
   ============================================================ */
{
  const RADII = [0.32, 0.21, 0.10];
  const circleFn = (i, t) => ({
    x: (0.5 + RADII[i] * Math.sin(t * Math.PI * 2)) * W,
    y: (0.5 - RADII[i] * Math.cos(t * Math.PI * 2)) * H,
  });
  function circlePoints(i, n = 40) {
    const pts = [];
    for (let k = 0; k <= n; k++) pts.push(circleFn(i, k / n));
    return pts;
  }
  function targetPoints(n = 240) {
    const per = Math.max(2, Math.floor(n / 3));
    const pts = [];
    for (let i = 0; i < 3; i++) pts.push(...circlePoints(i, per));
    return pts;
  }
  function makeCircle(i, { tremorAmp = 1.2, tremorWL = 40, noise = 0.3 } = {}) {
    const dense = circlePoints(i, 300);
    let len = 0;
    for (let k = 1; k < dense.length; k++) len += dist(dense[k - 1], dense[k]);
    const nPts = Math.max(8, Math.round(len / 2));
    const ph = rand() * Math.PI * 2;
    const stroke = [];
    for (let k = 0; k < nPts; k++) {
      const t = k / (nPts - 1);
      const p = circleFn(i, t);
      const a = t * Math.PI * 2;
      const tremor = tremorAmp * Math.sin(((t * len) / tremorWL) * Math.PI * 2 + ph);
      stroke.push({
        x: p.x + Math.sin(a) * tremor + gauss() * noise,
        y: p.y - Math.cos(a) * tremor + gauss() * noise,
        p: 0.5,
      });
    }
    return stroke;
  }
  const CASES = [
    ["きれいな3円",  () => [makeCircle(0), makeCircle(1), makeCircle(2)], 100],
    ["内円を忘れた", () => [makeCircle(0), makeCircle(1), makeCircle(1)], 0],
  ];
  console.log("=== Suite 3.5: まる3つ (同心円) ===");
  const partTargets = [0, 1, 2].map(i => circlePoints(i));
  for (const [name, gen, expected] of CASES) {
    seed = 42 + name.length;
    check(name, scoreStrokes(gen(), targetPoints(), { multiStroke: true, partTargets }), expected);
  }
}

/* ============================================================
   Suite 4: アタリ課題 (形体道場・複数ストローク)
   胴体アタリ: 背骨 + 胸郭 + 骨盤 の3部品 (js/keitai.js と同じ形状)
   ============================================================ */
{
  const PARTS = [
    t => ({ x: 0.5 - 0.05 * Math.sin(Math.PI * t), y: 0.14 + 0.72 * t }), // 背骨
    t => ({ x: 0.47 + 0.16 * Math.sin(t * Math.PI * 2), y: 0.32 - 0.13 * Math.cos(t * Math.PI * 2) }), // 胸郭
    t => ({ x: 0.48 + 0.13 * Math.sin(t * Math.PI * 2), y: 0.72 - 0.095 * Math.cos(t * Math.PI * 2) }), // 骨盤
  ];
  function partPoints(pi, n = 40) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const p = PARTS[pi](i / n);
      pts.push({ x: p.x * W, y: p.y * H });
    }
    return pts;
  }
  function targetPoints(n = 240) {
    const per = Math.max(2, Math.floor(n / PARTS.length));
    const pts = [];
    for (let pi = 0; pi < PARTS.length; pi++) pts.push(...partPoints(pi, per));
    return pts;
  }

  /* 部品 pi をなぞる (scale ≠ 1 は重心基準で形を拡縮 = 大きさを間違えた場合) */
  function makePart(pi, { tremorAmp = 1.2, tremorWL = 40, noise = 0.3, scale = 1 } = {}) {
    const dense = partPoints(pi, 400);
    let len = 0;
    for (let i = 1; i < dense.length; i++) len += dist(dense[i - 1], dense[i]);
    const nPts = Math.max(8, Math.round(len / 2));
    let cx = 0, cy = 0;
    for (const p of dense) { cx += p.x; cy += p.y; }
    cx /= dense.length; cy /= dense.length;
    const stroke = [];
    const ph = rand() * Math.PI * 2;
    for (let i = 0; i < nPts; i++) {
      const t = i / (nPts - 1);
      const p = PARTS[pi](t);
      const p2 = PARTS[pi](Math.min(1, t + 0.002));
      let nx = -(p2.y - p.y), ny = p2.x - p.x;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
      const s = t * len;
      const tremor = tremorAmp * Math.sin((s / tremorWL) * Math.PI * 2 + ph);
      const bx = cx + (p.x * W - cx) * scale;
      const by = cy + (p.y * H - cy) * scale;
      stroke.push({
        x: bx + nx * tremor + gauss() * noise,
        y: by + ny * tremor + gauss() * noise,
        p: 0.5,
      });
    }
    return stroke;
  }

  const CASES = [
    ["きれいな3筆",     () => [makePart(0), makePart(1), makePart(2)], 98],
    ["ヨレた楕円",       () => [makePart(0), makePart(1, { tremorAmp: 5, tremorWL: 55 }), makePart(2, { tremorAmp: 5, tremorWL: 55 })], 91],
    ["骨盤が小さすぎ",   () => [makePart(0), makePart(1), makePart(2, { scale: 0.55 })], 8],
    ["骨盤を描き忘れ",   () => [makePart(0), makePart(1), makePart(1)], 0],
  ];

  console.log("=== Suite 4: アタリ課題 (胴体) ===");
  const partTargets = PARTS.map((_, pi) => partPoints(pi));
  for (const [name, gen, expected] of CASES) {
    seed = 42 + name.length;
    check(name, scoreStrokes(gen(), targetPoints(), { multiStroke: true, partTargets }), expected);
  }
}

/* ============================================================
   Suite 5: 模写課題 (正規化採点)
   題材: 瓢箪 (js/mosha.js と同じ形状)。フリーハンドの模写を想定し、
   別の場所に別の大きさで描いた絵を fitStrokesTo で正規化してから
   緩めの許容値 (accScale 0.08 / covTolRatio 0.075) で採点する
   ============================================================ */
{
  const S = 500; // 単位正方形 → 500px
  const arcFn = (cx, cy, r, a0, a1) => t => {
    const a = ((a0 + (a1 - a0) * t) * Math.PI) / 180;
    return { x: (cx + r * Math.cos(a)) * S, y: (cy + r * Math.sin(a)) * S };
  };
  const lineFn = (x0, y0, x1, y1) => t => ({ x: (x0 + (x1 - x0) * t) * S, y: (y0 + (y1 - y0) * t) * S });
  const PARTS = [
    arcFn(0.5, 0.33, 0.12, 131.9, -311.9),   // 上の玉
    arcFn(0.5, 0.575, 0.175, -62.7, 242.7),  // 下の玉
    lineFn(0.5, 0.10, 0.5, 0.208),          // 口
  ];
  function partPoints(pi, n = 40) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(PARTS[pi](i / n));
    return pts;
  }
  function targetPoints(n = 240) {
    const per = Math.max(2, Math.floor(n / PARTS.length));
    const pts = [];
    for (let pi = 0; pi < PARTS.length; pi++) pts.push(...partPoints(pi, per));
    return pts;
  }

  /* 模写ストローク: 全体を (offsetX, offsetY, globalScale) で別の場所に描き、
     部品ごとに位置ずれ (partShift px) と手ブレを加える */
  function makeCopy({ globalScale = 0.7, offsetX = 900, offsetY = 300, partShift = 0, tremorAmp = 1.5, tremorWL = 45, distort = 0 }) {
    const strokes = [];
    for (let pi = 0; pi < PARTS.length; pi++) {
      const dense = partPoints(pi, 200);
      let len = 0;
      for (let i = 1; i < dense.length; i++) len += dist(dense[i - 1], dense[i]);
      const nPts = Math.max(8, Math.round((len * globalScale) / 2.5));
      const sx = (rand() - 0.5) * 2 * partShift, sy = (rand() - 0.5) * 2 * partShift;
      const partScale = 1 + (rand() - 0.5) * 2 * distort; // 部品ごとの大きさ間違い
      // 部品の重心
      let cx = 0, cy = 0;
      for (const p of dense) { cx += p.x; cy += p.y; }
      cx /= dense.length; cy /= dense.length;
      const ph = rand() * Math.PI * 2;
      const stroke = [];
      for (let i = 0; i < nPts; i++) {
        const t = i / (nPts - 1);
        const p = PARTS[pi](t);
        const p2 = PARTS[pi](Math.min(1, t + 0.002));
        let nx = -(p2.y - p.y), ny = p2.x - p.x;
        const nl = Math.hypot(nx, ny) || 1;
        nx /= nl; ny /= nl;
        const tremor = tremorAmp * Math.sin(((t * len) / tremorWL) * Math.PI * 2 + ph);
        const bx = cx + (p.x - cx) * partScale + sx;
        const by = cy + (p.y - cy) * partScale + sy;
        stroke.push({
          x: offsetX + (bx + nx * tremor + gauss() * 0.4) * globalScale,
          y: offsetY + (by + ny * tremor + gauss() * 0.4) * globalScale,
          p: 0.5,
        });
      }
      strokes.push(stroke);
    }
    return strokes;
  }

  const CASES = [
    ["上手な模写",       { partShift: 4, tremorAmp: 1.5 }, 98],
    ["並の模写",         { partShift: 12, tremorAmp: 2.5, distort: 0.10 }, 86],
    ["比率を間違えた",   { partShift: 8, tremorAmp: 2, distort: 0.35 }, 78],
    ["部品の位置が滅茶苦茶", { partShift: 45, tremorAmp: 2.5 }, 47],
    ["口を描き忘れ",     { partShift: 6, tremorAmp: 1.5, skipLast: true }, 0],
  ];

  console.log("=== Suite 5: 模写課題 (瓢箪・正規化) ===");
  const partTargets = PARTS.map((_, pi) => partPoints(pi));
  for (const [name, params, expected] of CASES) {
    seed = 42 + name.length;
    let strokes = makeCopy(params);
    if (params.skipLast) strokes = strokes.slice(0, -1);
    const fit = fitStrokesTo(strokes, targetPoints());
    const r = scoreStrokes(fit.strokes, targetPoints(), {
      multiStroke: true, partTargets, accScale: 0.08, covTolRatio: 0.055,
    });
    check(name, r, expected);
  }
}

/* ---------------- 結果 ---------------- */
console.log("");
if (failures) {
  console.log(`✗ ${failures} 件が期待値と不一致。意図した変更なら EXPECTED を更新すること。`);
  process.exit(1);
}
console.log("✓ 全ケース期待値と一致");
