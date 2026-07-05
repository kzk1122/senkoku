/* ============================================================
   線刻 (Senkoku) − 形体道場  Stage 2
   - アタリ課題: 図形分解(円・楕円・線)を複数ストロークで組み立て、
     共通採点エンジン (js/scoring.js) で採点
   - ジェスチャードローイング: プロシージャル生成ポーズ + タイマー
   ============================================================ */
"use strict";

const PASS_SCORE = 70;
const STORAGE_KEY = "senkoku_progress_v1"; // Stage 1 と共有 (課題 id はユニーク)
const GUIDE_LEVELS = [
  { label: "補助線：濃", alpha: 0.5 },
  { label: "補助線：淡", alpha: 0.18 },
  { label: "補助線：無", alpha: 0.0 },
];

/* 楕円パス生成 (上から時計回り) */
const ellipsePath = (cx, cy, rx, ry) => t => ({
  x: cx + rx * Math.sin(t * Math.PI * 2),
  y: cy - ry * Math.cos(t * Math.PI * 2),
});
/* 直線パス生成 */
const linePath = (x0, y0, x1, y1) => t => ({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
/* 折れ線パス生成 */
const polyPath = (...pts) => t => {
  const n = pts.length - 1;
  const ft = Math.min(t, 0.9999) * n;
  const i = Math.floor(ft), r = ft - i;
  return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * r, y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * r };
};
/* 回転楕円パス生成 (円柱のアタリ用。rotDeg = 長軸の傾き) */
const rotEllipsePath = (cx, cy, a, b, rotDeg) => t => {
  const ph = t * Math.PI * 2;
  const rot = (rotDeg * Math.PI) / 180;
  const u = a * Math.cos(ph), v = b * Math.sin(ph);
  return { x: cx + u * Math.cos(rot) - v * Math.sin(rot), y: cy + u * Math.sin(rot) + v * Math.cos(rot) };
};

/* ---------------- アタリ課題定義 ----------------
   parts: 部品パスのリスト。1部品=1筆。全部品を描くと自動採点 */
const ATARI_COURSES = [
  {
    id: "at_head", glyph: "頭", name: "頭部アタリ",
    desc: "卵形 → 正中線 → 目線の3筆。顔の向きの基準を刻む。",
    parts: [
      ellipsePath(0.5, 0.5, 0.20, 0.32),      // 卵形の輪郭
      linePath(0.5, 0.18, 0.5, 0.82),          // 正中線
      linePath(0.30, 0.5, 0.70, 0.5),          // 目線
    ],
  },
  {
    id: "at_torso", glyph: "胴", name: "胴体アタリ",
    desc: "背骨 → 胸郭 → 骨盤の3筆。体幹の流れをつかむ。",
    parts: [
      t => ({ x: 0.5 - 0.05 * Math.sin(Math.PI * t), y: 0.14 + 0.72 * t }), // 背骨
      ellipsePath(0.47, 0.32, 0.16, 0.13),     // 胸郭
      ellipsePath(0.48, 0.72, 0.13, 0.095),    // 骨盤
    ],
  },
  {
    id: "at_body", glyph: "全", name: "全身アタリ",
    desc: "頭 → 背骨 → 胸郭 → 骨盤 → 両腕 → 両脚の8筆で立ち姿を。",
    parts: [
      ellipsePath(0.5, 0.13, 0.045, 0.065),    // 頭
      linePath(0.5, 0.20, 0.5, 0.52),          // 背骨
      ellipsePath(0.5, 0.31, 0.105, 0.095),    // 胸郭
      ellipsePath(0.5, 0.55, 0.085, 0.065),    // 骨盤
      t => ({ x: 0.40 - 0.07 * t - 0.015 * Math.sin(Math.PI * t), y: 0.25 + 0.30 * t }), // 左腕
      t => ({ x: 0.60 + 0.07 * t + 0.015 * Math.sin(Math.PI * t), y: 0.25 + 0.30 * t }), // 右腕
      t => ({ x: 0.46 - 0.04 * t, y: 0.61 + 0.32 * t }),                                  // 左脚
      t => ({ x: 0.54 + 0.04 * t, y: 0.61 + 0.32 * t }),                                  // 右脚
    ],
  },
  /* --- 部位アタリ (2026-07 追加) --- */
  {
    id: "at_profile", glyph: "顔", name: "横顔アタリ",
    desc: "頭の円 → 側面の円 → 顎のライン。耳は側面円の中心に来る。",
    parts: [
      ellipsePath(0.50, 0.36, 0.22, 0.27),   // 頭の円
      ellipsePath(0.54, 0.38, 0.11, 0.135),  // 側面(こめかみ)の円
      polyPath([0.30, 0.52], [0.36, 0.74], [0.50, 0.84], [0.66, 0.60]), // 顎のライン
    ],
  },
  {
    id: "at_arm", glyph: "腕", name: "腕アタリ",
    desc: "上腕の円柱 → 肘の円 → 前腕の円柱 → 手の円。関節で区切る。",
    parts: [
      rotEllipsePath(0.33, 0.33, 0.19, 0.08, 45),    // 上腕
      ellipsePath(0.49, 0.50, 0.05, 0.06),           // 肘
      rotEllipsePath(0.645, 0.455, 0.16, 0.05, -15), // 前腕
      ellipsePath(0.83, 0.40, 0.055, 0.065),         // 手
    ],
  },
  {
    id: "at_hand", glyph: "手", name: "手アタリ",
    desc: "手のひらの板 → 指のかたまり → 親指。まず塊でとらえる。",
    parts: [
      polyPath([0.36, 0.42], [0.62, 0.40], [0.66, 0.66], [0.51, 0.74], [0.37, 0.66], [0.36, 0.42]), // 手のひら
      t => ({ x: 0.36 + 0.27 * t, y: 0.41 - 1.15 * t * (1 - t) }), // 指のかたまり
      rotEllipsePath(0.30, 0.55, 0.10, 0.042, 130),                // 親指
    ],
  },
  {
    id: "at_leg", glyph: "脚", name: "脚アタリ",
    desc: "太ももの円柱 → 膝の円 → すねの円柱 → 足のくさび。",
    parts: [
      rotEllipsePath(0.455, 0.30, 0.185, 0.07, 75),  // 太もも
      ellipsePath(0.51, 0.52, 0.05, 0.045),          // 膝
      rotEllipsePath(0.525, 0.70, 0.155, 0.055, 84), // すね
      polyPath([0.55, 0.84], [0.51, 0.94], [0.72, 0.95], [0.63, 0.86], [0.55, 0.84]), // 足
    ],
  },
  {
    id: "at_foot", glyph: "足", name: "足アタリ",
    desc: "足首の円 → 側面のくさび → 親指の円。かかとの奥行きを意識。",
    parts: [
      ellipsePath(0.44, 0.36, 0.06, 0.075),  // 足首
      polyPath([0.44, 0.46], [0.35, 0.62], [0.33, 0.70], [0.76, 0.72], [0.72, 0.60], [0.46, 0.46]), // くさび
      ellipsePath(0.74, 0.64, 0.045, 0.05),  // 親指
    ],
  },
];

/* ---------------- 進捗 (Stage 1 と同じ形式) ---------------- */
function loadProgress() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function saveProgress() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress)); }
  catch { /* private mode */ }
}

/* ---------------- 状態 ---------------- */
const state = {
  courseIndex: 0,
  guideLevel: 0,
  justScored: false,
  progress: loadProgress(),
};

const $ = id => document.getElementById(id);
const els = {
  tabAtari: $("tabAtari"), tabGesture: $("tabGesture"),
  atariSec: $("atariSec"), gestureSec: $("gestureSec"),
  rail: $("courseRail"), glyph: $("courseGlyph"), name: $("courseName"), desc: $("courseDesc"),
  penBtn: $("penBtn"), guideBtn: $("guideBtn"), clearBtn: $("clearBtn"),
  result: $("result"), stampRank: $("stampRank"), stampScore: $("stampScore"),
  barAcc: $("barAcc"), barCov: $("barCov"), barSmo: $("barSmo"),
  valAcc: $("valAcc"), valCov: $("valCov"), valSmo: $("valSmo"),
  note: $("resultNote"), retryBtn: $("retryBtn"), nextBtn: $("nextBtn"),
  atariHint: $("atariHint"), penStatus: $("penStatus"),
  gPenBtn: $("gPenBtn"), timeBtn: $("timeBtn"), gClearBtn: $("gClearBtn"), startBtn: $("startBtn"),
  poseCanvas: $("poseCanvas"), gestureCanvas: $("gestureCanvas"),
  gestureOverlay: $("gestureOverlay"), gestureMsg: $("gestureMsg"),
  nextPoseBtn: $("nextPoseBtn"), timerDisp: $("timerDisp"),
};

function currentCourse() { return ATARI_COURSES[state.courseIndex]; }
function bestOf(id) { return state.progress[id] ?? null; }
/* 解放ゲートは撤廃 (2026-07): どの課題も最初から選べる */
function isUnlocked() { return true; }

/* 入力・筆描画の部品は js/surface.js (makeSurface / drawStrokesOf) を使用 */
surfaceState.onPenDetect = () => {
  els.penStatus.textContent = "Apple Pencil 検出 ✓ (筆圧有効)";
};

/* ============================================================
   アタリ課題
   ============================================================ */
const atari = makeSurface($("atariCanvas"), {
  onDown() {
    hideResult();
    if (state.justScored) { atari.clear(); state.justScored = false; }
  },
  onStroke() {
    const c = currentCourse();
    if (atari.strokes.length >= c.parts.length) {
      showResult(scoreStrokes(atari.strokes, atariTargets(), {
        multiStroke: true,
        partTargets: c.parts.map((_, pi) => partPoints(pi)),
      }));
      state.justScored = true;
    }
    updateAtariHint();
  },
  render: renderAtari,
});

/* 部品 pi のお手本点列 (キャンバス座標) */
function partPoints(pi, n = 40) {
  const rect = atari.canvas.getBoundingClientRect();
  const fn = currentCourse().parts[pi];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const p = fn(i / n);
    pts.push({ x: p.x * rect.width, y: p.y * rect.height });
  }
  return pts;
}
/* 全部品のお手本点列の合併 (採点用) */
function atariTargets(n = 240) {
  const parts = currentCourse().parts;
  const per = Math.max(2, Math.floor(n / parts.length));
  const pts = [];
  for (let pi = 0; pi < parts.length; pi++) pts.push(...partPoints(pi, per));
  return pts;
}

function renderAtari() {
  const ctx = atari.ctx;
  const rect = atari.canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  const course = currentCourse();
  const alpha = GUIDE_LEVELS[state.guideLevel].alpha;

  // 補助線: 各部品を破線で
  if (alpha > 0) {
    ctx.save();
    ctx.strokeStyle = `rgba(156, 153, 168, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.lineJoin = "round";
    for (let pi = 0; pi < course.parts.length; pi++) {
      const pts = partPoints(pi);
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
    ctx.restore();
  }

  // 始点マーカー: 次に描く部品は大きい●+矢印、他は小さい●
  ctx.save();
  ctx.fillStyle = "rgba(255, 107, 87, 0.95)";
  const nextPi = Math.min(atari.strokes.length, course.parts.length - 1);
  for (let pi = 0; pi < course.parts.length; pi++) {
    const pts = partPoints(pi, 12);
    const s = pts[0];
    ctx.beginPath();
    ctx.arc(s.x, s.y, pi === nextPi ? 6 : 3.5, 0, Math.PI * 2);
    ctx.fill();
    if (pi === nextPi) {
      const a = pts[1];
      const ang = Math.atan2(a.y - s.y, a.x - s.x);
      ctx.save();
      ctx.translate(s.x + Math.cos(ang) * 22, s.y + Math.sin(ang) * 22);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(-9, -5); ctx.lineTo(-9, 5); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();

  drawStrokesOf(atari);
}

function updateAtariHint() {
  const c = currentCourse();
  const done = atari.strokes.length;
  els.atariHint.textContent =
    done > 0 && done < c.parts.length
      ? `${done} / ${c.parts.length} 筆 ─ 大きい●が次の部品の始点です。`
      : `●印から部品を1つずつ。${c.parts.length} 筆そろうと採点されます。`;
}

/* ---------------- 結果表示 (Stage 1 と同等・筆圧軸なし) ---------------- */
function rankOf(score) {
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= PASS_SCORE) return "B";
  if (score >= 55) return "C";
  return "D";
}
function noteFor(r) {
  const weakest = Math.min(r.acc, r.cov, r.smo);
  if (r.total >= PASS_SCORE) {
    if (r.total >= 90) return "かたちバッチリ!つぎもこの調子!";
    return "クリア!補助線を淡くしてもう一回やると、もっと上手くなるよ。";
  }
  if (weakest === r.cov) return "部品が足りないか、大きくズレてるかも。全部の部品を描こう!";
  if (weakest === r.acc) return "かたちがお手本とちがうかも。位置と大きさを先に決めよう!";
  return "線がガタガタしてる。楕円は一気にくるっと!";
}

function showResult(r) {
  const course = currentCourse();
  if (r.total > (bestOf(course.id) ?? 0)) {
    state.progress[course.id] = r.total;
    saveProgress();
  }
  els.stampRank.textContent = rankOf(r.total);
  els.stampScore.textContent = r.total;
  els.valAcc.textContent = r.acc;
  els.valCov.textContent = r.cov;
  els.valSmo.textContent = r.smo;
  els.note.textContent = noteFor(r);
  els.nextBtn.hidden = !(state.courseIndex < ATARI_COURSES.length - 1);
  els.result.hidden = false;
  requestAnimationFrame(() => {
    els.barAcc.style.width = r.acc + "%";
    els.barCov.style.width = r.cov + "%";
    els.barSmo.style.width = r.smo + "%";
  });
  renderRail();
}
function hideResult() {
  els.result.hidden = true;
  [els.barAcc, els.barCov, els.barSmo].forEach(b => (b.style.width = "0"));
}

/* ---------------- 課題レール ---------------- */
function renderRail() {
  els.rail.innerHTML = "";
  ATARI_COURSES.forEach((c, i) => {
    const unlocked = isUnlocked(i);
    const best = bestOf(c.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "chip" + (i === state.courseIndex ? " active" : "") + (unlocked ? "" : " locked");
    btn.setAttribute("aria-label", `${c.name}${unlocked ? "" : "(未解放)"}`);
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
  atari.clear();
  state.justScored = false;
  hideResult();
  const c = currentCourse();
  els.glyph.textContent = c.glyph;
  els.name.textContent = c.name;
  els.desc.textContent = c.desc;
  renderRail();
  renderAtari();
  updateAtariHint();
}

/* ============================================================
   ジェスチャードローイング
   ============================================================ */
const TIMES = [
  { label: "時間：30秒", sec: 30 },
  { label: "時間：60秒", sec: 60 },
  { label: "時間：2分", sec: 120 },
];

/* 骨格比率 (身長 = 1.0) */
const BONE = {
  spine: 0.30, neck: 0.045, headR: 0.062,
  shoulderW: 0.115, hipW: 0.07,
  upperArm: 0.16, foreArm: 0.14,
  thigh: 0.24, shin: 0.22,
};

/* ポーズプリセット
   角度規約: 四肢は「真下=0°、体の前(+x)=正」のワールド角。[付け根, 相対の先]
   torso は「直立=0°、前傾=正」 */
const POSES = [
  { name: "直立",     torso: 0,   armL: [10, 5],     armR: [-8, -4],   legL: [4, -2],    legR: [-4, -2] },
  { name: "歩き",     torso: 5,   armL: [26, 20],    armR: [-20, 15],  legL: [22, -12],  legR: [-14, -30] },
  { name: "走り",     torso: 18,  armL: [-40, -75],  armR: [45, 70],   legL: [50, -55],  legR: [-25, -80] },
  { name: "座り",     torso: -6,  armL: [35, 40],    armR: [30, 45],   legL: [88, -88],  legR: [92, -88] },
  { name: "しゃがみ", torso: 28,  armL: [60, 30],    armR: [55, 35],   legL: [95, -140], legR: [90, -135] },
  { name: "万歳",     torso: -6,  armL: [168, 8],    armR: [-168, -8], legL: [8, -3],    legR: [-8, -3] },
  { name: "蹴り",     torso: -12, armL: [55, 25],    armR: [-45, 20],  legL: [78, -25],  legR: [-15, -8] },
  { name: "前屈",     torso: 72,  armL: [35, 10],    armR: [28, 12],   legL: [4, -4],    legR: [-4, -4] },
];

/* 関節位置を計算 (単位空間 → 後で fit) */
function buildFigure(pose, mirror) {
  const R = d => (d * Math.PI) / 180;
  const m = mirror ? -1 : 1;
  const up = a => ({ x: m * Math.sin(R(a)), y: -Math.cos(R(a)) });
  const dn = a => ({ x: m * Math.sin(R(a)), y: Math.cos(R(a)) });
  const add = (p, d, s) => ({ x: p.x + d.x * s, y: p.y + d.y * s });

  const pelvis = { x: 0, y: 0 };
  const tdir = up(pose.torso);
  const neck = add(pelvis, tdir, BONE.spine);
  const headC = add(neck, up(pose.torso + 0.5 * pose.torso), BONE.neck + BONE.headR);
  const perp = { x: -tdir.y * m, y: tdir.x * m }; // 体の右手側
  const shoulderL = add(neck, perp, -BONE.shoulderW * 0.35);
  const shoulderR = add(neck, perp, BONE.shoulderW * 0.35);
  const hipL = { x: pelvis.x - BONE.hipW * 0.5, y: pelvis.y };
  const hipR = { x: pelvis.x + BONE.hipW * 0.5, y: pelvis.y };

  const elbowL = add(shoulderL, dn(pose.armL[0]), BONE.upperArm);
  const wristL = add(elbowL, dn(pose.armL[0] + pose.armL[1]), BONE.foreArm);
  const elbowR = add(shoulderR, dn(pose.armR[0]), BONE.upperArm);
  const wristR = add(elbowR, dn(pose.armR[0] + pose.armR[1]), BONE.foreArm);
  const kneeL = add(hipL, dn(pose.legL[0]), BONE.thigh);
  const ankleL = add(kneeL, dn(pose.legL[0] + pose.legL[1]), BONE.shin);
  const kneeR = add(hipR, dn(pose.legR[0]), BONE.thigh);
  const ankleR = add(kneeR, dn(pose.legR[0] + pose.legR[1]), BONE.shin);

  return { pose, mirror, pelvis, neck, headC, shoulderL, shoulderR, hipL, hipR,
           elbowL, wristL, elbowR, wristR, kneeL, ankleL, kneeR, ankleR };
}

const gesture = {
  timeIdx: 1,
  running: false,
  deadline: 0,
  timerId: null,
  figure: null,
  lastPose: -1,
};

const gSurface = makeSurface(els.gestureCanvas, {
  canDraw: () => gesture.running,
  render: renderGesture,
});

function renderGesture() {
  const rect = els.gestureCanvas.getBoundingClientRect();
  gSurface.ctx.clearRect(0, 0, rect.width, rect.height);
  drawStrokesOf(gSurface);
}

/* ポーズをリファレンスキャンバスへ描画 */
function renderPose() {
  const canvas = els.poseCanvas;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const fig = gesture.figure;
  if (!fig) {
    ctx.save();
    ctx.fillStyle = "rgba(156, 153, 168, 0.8)";
    ctx.font = "500 14px 'Zen Kaku Gothic New', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("「開始」でポーズが", rect.width / 2, rect.height / 2 - 12);
    ctx.fillText("表示されます", rect.width / 2, rect.height / 2 + 12);
    ctx.restore();
    return;
  }

  // 全関節 + 頭の外周で bbox を取り、キャンバスに収める
  const joints = [fig.pelvis, fig.neck, fig.shoulderL, fig.shoulderR, fig.hipL, fig.hipR,
    fig.elbowL, fig.wristL, fig.elbowR, fig.wristR, fig.kneeL, fig.ankleL, fig.kneeR, fig.ankleR];
  let minX = fig.headC.x - BONE.headR, maxX = fig.headC.x + BONE.headR;
  let minY = fig.headC.y - BONE.headR, maxY = fig.headC.y + BONE.headR;
  for (const j of joints) {
    minX = Math.min(minX, j.x); maxX = Math.max(maxX, j.x);
    minY = Math.min(minY, j.y); maxY = Math.max(maxY, j.y);
  }
  const margin = 0.14;
  const scale = Math.min(
    (rect.width * (1 - margin * 2)) / Math.max(maxX - minX, 0.2),
    (rect.height * (1 - margin * 2)) / Math.max(maxY - minY, 0.2)
  );
  const ox = rect.width / 2 - ((minX + maxX) / 2) * scale;
  const oy = rect.height / 2 - ((minY + maxY) / 2) * scale;
  const P = p => ({ x: ox + p.x * scale, y: oy + p.y * scale });

  ctx.save();
  ctx.strokeStyle = "#33323E";
  ctx.fillStyle = "#33323E";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const line = (...pts) => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const q = P(p);
      i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y);
    });
    ctx.stroke();
  };

  // 体幹の楕円 (胸郭・骨盤) — 傾きは torso 角に合わせる
  const R = d => (d * Math.PI) / 180;
  const m = fig.mirror ? -1 : 1;
  const rot = m * R(fig.pose.torso);
  const chestC = P({
    x: fig.pelvis.x + (fig.neck.x - fig.pelvis.x) * 0.68,
    y: fig.pelvis.y + (fig.neck.y - fig.pelvis.y) * 0.68,
  });
  ctx.beginPath();
  ctx.ellipse(chestC.x, chestC.y, 0.105 * scale, 0.085 * scale, rot, 0, Math.PI * 2);
  ctx.stroke();
  const pelC = P(fig.pelvis);
  ctx.beginPath();
  ctx.ellipse(pelC.x, pelC.y, 0.08 * scale, 0.055 * scale, rot, 0, Math.PI * 2);
  ctx.stroke();

  // 頭
  const hc = P(fig.headC);
  ctx.beginPath();
  ctx.arc(hc.x, hc.y, BONE.headR * scale, 0, Math.PI * 2);
  ctx.stroke();

  // 背骨と四肢
  line(fig.pelvis, fig.neck);
  line(fig.shoulderL, fig.elbowL, fig.wristL);
  line(fig.shoulderR, fig.elbowR, fig.wristR);
  line(fig.hipL, fig.kneeL, fig.ankleL);
  line(fig.hipR, fig.kneeR, fig.ankleR);

  // 関節ドット
  for (const j of [fig.shoulderL, fig.shoulderR, fig.elbowL, fig.elbowR, fig.wristL, fig.wristR,
    fig.hipL, fig.hipR, fig.kneeL, fig.kneeR, fig.ankleL, fig.ankleR]) {
    const q = P(j);
    ctx.beginPath();
    ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 接地線
  const groundY = oy + maxY * scale + 8;
  ctx.strokeStyle = "rgba(156, 153, 168, 0.5)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(rect.width * 0.15, groundY);
  ctx.lineTo(rect.width * 0.85, groundY);
  ctx.stroke();
  ctx.restore();
}

/* ---------------- タイマー ---------------- */
function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function startGesture() {
  // 前回と違うポーズをランダムに選ぶ + 左右反転 + 角度ゆらぎ
  let idx;
  do { idx = Math.floor(Math.random() * POSES.length); } while (idx === gesture.lastPose && POSES.length > 1);
  gesture.lastPose = idx;
  const base = POSES[idx];
  const jitter = () => (Math.random() - 0.5) * 10;
  const pose = {
    name: base.name,
    torso: base.torso + jitter() * 0.5,
    armL: [base.armL[0] + jitter(), base.armL[1] + jitter()],
    armR: [base.armR[0] + jitter(), base.armR[1] + jitter()],
    legL: [base.legL[0] + jitter() * 0.6, base.legL[1] + jitter() * 0.6],
    legR: [base.legR[0] + jitter() * 0.6, base.legR[1] + jitter() * 0.6],
  };
  gesture.figure = buildFigure(pose, Math.random() < 0.5);
  gSurface.clear();
  els.gestureOverlay.hidden = true;
  gesture.running = true;
  gesture.deadline = Date.now() + TIMES[gesture.timeIdx].sec * 1000;
  els.startBtn.textContent = "次のポーズ";
  renderPose();
  renderGesture();
  if (gesture.timerId) clearInterval(gesture.timerId);
  gesture.timerId = setInterval(tick, 200);
  tick();
}

function tick() {
  const remain = (gesture.deadline - Date.now()) / 1000;
  els.timerDisp.textContent = fmtTime(remain);
  if (remain <= 0) {
    clearInterval(gesture.timerId);
    gesture.timerId = null;
    gesture.running = false;
    els.timerDisp.textContent = "0:00";
    els.gestureMsg.textContent = "タイムアップ!";
    els.gestureOverlay.hidden = false;
  }
}

/* ---------------- タブ・コントロール ---------------- */
function showTab(which) {
  const isAtari = which === "atari";
  els.tabAtari.classList.toggle("active", isAtari);
  els.tabGesture.classList.toggle("active", !isAtari);
  els.atariSec.hidden = !isAtari;
  els.gestureSec.hidden = isAtari;
  // 非表示中はキャンバスサイズが 0 なので、表示時にリサイズ
  if (isAtari) atari.resize();
  else { gSurface.resize(); renderPose(); }
}
els.tabAtari.addEventListener("click", () => showTab("atari"));
els.tabGesture.addEventListener("click", () => showTab("gesture"));

function cyclePen() {
  setPenLevel((surfaceState.penLevel + 1) % PEN_LEVELS.length);
  const label = PEN_LEVELS[surfaceState.penLevel].label;
  els.penBtn.textContent = label;
  els.gPenBtn.textContent = label;
  renderAtari();
  renderGesture();
}
els.penBtn.addEventListener("click", cyclePen);
els.gPenBtn.addEventListener("click", cyclePen);

els.guideBtn.addEventListener("click", () => {
  state.guideLevel = (state.guideLevel + 1) % GUIDE_LEVELS.length;
  els.guideBtn.textContent = GUIDE_LEVELS[state.guideLevel].label;
  renderAtari();
});

els.clearBtn.addEventListener("click", () => {
  atari.clear();
  state.justScored = false;
  hideResult();
  renderAtari();
  updateAtariHint();
});
els.retryBtn.addEventListener("click", () => {
  atari.clear();
  state.justScored = false;
  hideResult();
  renderAtari();
  updateAtariHint();
});
els.nextBtn.addEventListener("click", () => {
  if (state.courseIndex < ATARI_COURSES.length - 1) selectCourse(state.courseIndex + 1);
});

els.timeBtn.addEventListener("click", () => {
  gesture.timeIdx = (gesture.timeIdx + 1) % TIMES.length;
  els.timeBtn.textContent = TIMES[gesture.timeIdx].label;
  if (!gesture.running) els.timerDisp.textContent = fmtTime(TIMES[gesture.timeIdx].sec);
});
els.gClearBtn.addEventListener("click", () => {
  gSurface.clear();
  renderGesture();
});
els.startBtn.addEventListener("click", startGesture);
els.nextPoseBtn.addEventListener("click", startGesture);

/* ---------------- 初期化 ---------------- */
window.addEventListener("resize", () => {
  atari.resize();
  gSurface.resize();
  if (!els.gestureSec.hidden) renderPose();
});
els.penBtn.textContent = PEN_LEVELS[surfaceState.penLevel].label;
els.gPenBtn.textContent = PEN_LEVELS[surfaceState.penLevel].label;
els.timeBtn.textContent = TIMES[gesture.timeIdx].label;
els.timerDisp.textContent = fmtTime(TIMES[gesture.timeIdx].sec);
selectCourse(0);
atari.resize();
