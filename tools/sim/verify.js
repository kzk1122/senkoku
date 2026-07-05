/* ============================================================
   採点ロジックの回帰テスト
   使い方: node tools/sim/verify.js
   - js/app.js の実コード (dist〜scoreStrokes) を抽出して実行
   - 合成ストローク(固定シード乱数)で全課題タイプを採点し、
     期待値(total)との完全一致を検証する
   - 採点係数を意図的に変えたときは、出力を確認したうえで
     EXPECTED の値を更新すること
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "../../js/app.js"), "utf8");
const scoringCode = src.slice(src.indexOf("function dist("), src.indexOf("function rankOf"));

const W = 700, H = 525; // iPad 横向き相当のキャンバスサイズ

/* ---------------- 固定シード乱数 ---------------- */
let seed = 42;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function gauss() { return (rand() + rand() + rand() + rand() - 2) / 1; }

/* ---------------- スコアラーの生成 ----------------
   suite ごとに currentCourse / targetPoints のスタブを差し替える */
function buildScorer(course, targetPointsImpl) {
  const makeFns = new Function(
    "targetPoints", "currentCourse",
    scoringCode + "\nreturn { scoreStrokes, dist };"
  );
  return makeFns(targetPointsImpl, () => course);
}

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
    (r.prs != null ? ` prs=${String(r.prs).padStart(3)}` : "");
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(14)} total=${String(r.total).padStart(3)} (期待 ${String(expected).padStart(3)})  ${detail}`);
}

/* ============================================================
   Suite 1: 単筆課題 (払い)
   ============================================================ */
{
  const fn = t => ({ x: 0.68 - 0.38 * t - 0.10 * Math.sin(Math.PI * t), y: 0.15 + 0.70 * t });
  const targetPoints = pathTargetPoints(fn);
  const { scoreStrokes, dist } = buildScorer({ pathFn: fn }, targetPoints);

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
    check(name, scoreStrokes([makeStroke(params)]), expected);
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
  /* 期待値: 課題ごとに [完璧, 良い制御, 並, 制御できず, マウス0.5固定] */
  const EXPECTED = {
    kinatsu: [96, 95, 90, 28, 96],
    zenkyo:  [96, 95, 90, 35, 35],
    nuki:    [96, 95, 91, 33, 23],
  };
  const SCENARIOS = [
    ["完璧な筆圧",      { wander: 0.0, noise: 0.0 }],
    ["良い制御",        { wander: 0.04, noise: 0.02 }],
    ["並の制御",        { wander: 0.10, noise: 0.03 }],
    ["制御できず",      { wander: 0.22, noise: 0.05, drift: 0.15 }],
    ["マウス(0.5固定)", { mouse: true }],
  ];

  for (const [cname, course] of Object.entries(COURSES)) {
    const targetPoints = pathTargetPoints(course.pathFn);
    const { scoreStrokes, dist } = buildScorer(course, targetPoints);

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
        else pv = targetP + prof.wander * Math.sin((s / 120) * Math.PI * 2 + ph3) + gauss() * prof.noise + (prof.drift || 0) * t;
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
      check(sname, scoreStrokes([makeStroke(prof)]), EXPECTED[cname][si]);
    });
  }
}

/* ============================================================
   Suite 3: ハッチング (複数ストローク)
   ============================================================ */
{
  const LINES = 6;
  const lineFn = (i, t) => ({ x: 0.32 + 0.104 * i - 0.16 * t, y: 0.2 + 0.6 * t });
  const course = { hatch: { lines: LINES }, lineFn };

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
  const { scoreStrokes, dist } = buildScorer(course, targetPoints);

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
    ["2本が同じ場所",    li => makeLine(li === 5 ? 4 : li, {}), 60],
    ["短い線ばかり",     li => makeLine(li, { portion: 0.55 }), 8],
  ];

  console.log("=== Suite 3: ハッチング ===");
  for (const [name, gen, expected] of CASES) {
    seed = 42 + name.length;
    const strokes = [];
    for (let li = 0; li < LINES; li++) strokes.push(gen(li));
    check(name, scoreStrokes(strokes), expected);
  }
}

/* ---------------- 結果 ---------------- */
console.log("");
if (failures) {
  console.log(`✗ ${failures} 件が期待値と不一致。意図した変更なら EXPECTED を更新すること。`);
  process.exit(1);
}
console.log("✓ 全ケース期待値と一致");
