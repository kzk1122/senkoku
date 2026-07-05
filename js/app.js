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
    id: "yokoga", glyph: "一", name: "よこ線",
    desc: "水平な線を、最初から最後まで同じ速さで。",
    pathFn: t => ({ x: 0.12 + 0.76 * t, y: 0.5 }),
  },
  {
    id: "tatega", glyph: "｜", name: "たて線",
    desc: "まっすぐ下へ。ひじから動かす意識で。",
    pathFn: t => ({ x: 0.5, y: 0.12 + 0.76 * t }),
  },
  {
    id: "harai", glyph: "丿", name: "はらい",
    desc: "右上から左下へ、ゆるやかにカーブ。",
    pathFn: t => ({
      x: 0.68 - 0.38 * t - 0.10 * Math.sin(Math.PI * t),
      y: 0.15 + 0.70 * t,
    }),
  },
  {
    id: "nami", glyph: "〜", name: "なみ線",
    desc: "同じ大きさ・同じリズムで波をえがく。手首やわらかく!",
    pathFn: t => ({
      x: 0.12 + 0.76 * t,
      y: 0.5 + 0.13 * Math.sin(t * Math.PI * 4),
    }),
  },
  {
    id: "enso", glyph: "○", name: "まる",
    desc: "上から時計回りに一筆で円を。最初と最後をつなげて。",
    pathFn: t => ({
      x: 0.5 + 0.3 * Math.sin(t * Math.PI * 2),
      y: 0.5 - 0.3 * Math.cos(t * Math.PI * 2),
    }),
  },
  {
    id: "uzu", glyph: "渦", name: "うずまき",
    desc: "外から内へ、間かくを保ちながらぐるぐる。",
    pathFn: t => {
      const turns = 2.5;
      const a = t * Math.PI * 2 * turns;
      const r = 0.34 * (1 - 0.82 * t);
      return { x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) };
    },
  },
  {
    id: "taiko", glyph: "⌒", name: "アーチ",
    desc: "画面いっぱいの大きなアーチを一気に。肩から動かそう。",
    pathFn: t => ({
      x: 0.5 - 0.38 * Math.cos(Math.PI * t),
      y: 0.72 - 0.44 * Math.sin(Math.PI * t),
    }),
  },
  {
    id: "sji", glyph: "乙", name: "S字",
    desc: "上から下へ、曲がりの向きをなめらかに切り替える。",
    pathFn: t => ({
      x: 0.5 - 0.24 * Math.sin(t * Math.PI * 2),
      y: 0.12 + 0.76 * t,
    }),
  },
  /* --- 筆圧コントロール課題 (pressureFn: t → 目標筆圧 0〜1) --- */
  {
    id: "kinatsu", glyph: "均", name: "筆圧キープ",
    desc: "筆圧を一定にキープして、太さのそろった線を。補助線の太さがお手本。",
    pathFn: t => ({ x: 0.12 + 0.76 * t, y: 0.5 }),
    pressureFn: () => 0.5,
  },
  {
    id: "zenkyo", glyph: "強", name: "だんだん強く",
    desc: "軽くスタートして、終わりに向けてだんだん筆圧を強く。",
    pathFn: t => ({ x: 0.12 + 0.76 * t, y: 0.5 }),
    pressureFn: t => 0.2 + 0.6 * t,
  },
  {
    id: "nuki", glyph: "抜", name: "スッと抜く",
    desc: "強くスタートして、はらいながらスッと力を抜いて細く。",
    pathFn: t => ({
      x: 0.75 - 0.50 * t - 0.08 * Math.sin(Math.PI * t),
      y: 0.15 + 0.70 * t,
    }),
    pressureFn: t => 0.8 - 0.65 * t,
  },
  /* --- 複数ストローク課題 (hatch.lines 本描き終えると自動採点) --- */
  {
    id: "hatch", glyph: "彡", name: "ハッチング",
    desc: "ななめの平行線を6本、等間かくに。角度と速さをそろえるのがコツ。",
    hatch: { lines: 6 },
    lineFn: (i, t) => ({
      x: 0.32 + 0.104 * i - 0.16 * t,
      y: 0.2 + 0.6 * t,
    }),
  },
];

const PASS_SCORE = 70;
const STORAGE_KEY = "senkoku_progress_v1";
/* 筆の太さ3段階。lineWidth = base + k * pressure(「中」が従来の太さ) */
const PEN_KEY = "senkoku_pen_v1";
const PEN_LEVELS = [
  { label: "筆：細", base: 1.2, k: 4 },
  { label: "筆：中", base: 2, k: 7 },
  { label: "筆：太", base: 3, k: 12 },
];
const GUIDE_LEVELS = [
  { label: "補助線：濃", alpha: 0.5 },
  { label: "補助線：淡", alpha: 0.18 },
  { label: "補助線：無", alpha: 0.0 },
];

/* ---------------- 状態 ---------------- */
function loadPenLevel() {
  try {
    const v = parseInt(localStorage.getItem(PEN_KEY) ?? "1", 10);
    return v >= 0 && v < PEN_LEVELS.length ? v : 1;
  } catch { return 1; }
}

const state = {
  courseIndex: 0,
  guideLevel: 0,
  penLevel: loadPenLevel(),
  stroke: [],          // 現在の一筆 [{x, y, p, t}] (キャンバス座標)
  strokes: [],         // 描き終えた筆のリスト (複数ストローク課題用)
  justScored: false,   // 採点直後 (次の pointerdown で全消去する)
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
  penBtn: $("penBtn"),
  result: $("result"), stampRank: $("stampRank"), stampScore: $("stampScore"),
  barAcc: $("barAcc"), barCov: $("barCov"), barSmo: $("barSmo"),
  valAcc: $("valAcc"), valCov: $("valCov"), valSmo: $("valSmo"),
  meterPrs: $("meterPrs"), barPrs: $("barPrs"), valPrs: $("valPrs"),
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
/* 解放ゲートは撤廃 (2026-07): どの課題も最初から選べる。
   PASS_SCORE は合格ライン(良)の表示にのみ使う */
function isUnlocked() { return true; }

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

/* お手本パスをキャンバス座標の点列に変換。
   ハッチング課題は全ラインのサンプルを連結した集合を返す */
function targetPoints(n = 240) {
  const c = currentCourse();
  if (c.hatch) {
    const per = Math.max(2, Math.floor(n / c.hatch.lines));
    const pts = [];
    for (let li = 0; li < c.hatch.lines; li++) pts.push(...targetLinePoints(li, per));
    return pts;
  }
  const rect = canvas.getBoundingClientRect();
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const p = c.pathFn(i / n);
    pts.push({ x: p.x * rect.width, y: p.y * rect.height });
  }
  return pts;
}

/* ハッチングの li 本目のラインをキャンバス座標で */
function targetLinePoints(li, n = 40) {
  const rect = canvas.getBoundingClientRect();
  const fn = currentCourse().lineFn;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const p = fn(li, i / n);
    pts.push({ x: p.x * rect.width, y: p.y * rect.height });
  }
  return pts;
}

function render() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  drawGuide();
  for (const s of state.strokes) drawStroke(s);
  drawStroke(state.stroke);
}

function drawGuide() {
  const alpha = GUIDE_LEVELS[state.guideLevel].alpha;
  const course = currentCourse();
  const pts = course.hatch ? targetLinePoints(0) : targetPoints();
  const pf = course.pressureFn;
  if (alpha > 0) {
    ctx.save();
    ctx.strokeStyle = `rgba(156, 153, 168, ${alpha})`;
    ctx.lineJoin = "round";
    if (course.hatch) {
      // ハッチング: 各ラインを破線で
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      for (let li = 0; li < course.hatch.lines; li++) {
        const lp = targetLinePoints(li);
        ctx.beginPath();
        lp.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
      }
    } else if (pf) {
      // 筆圧課題: 目標筆圧を線の太さで可視化 (現在の筆設定と同じ式・実線)
      const pen = PEN_LEVELS[state.penLevel];
      ctx.lineCap = "round";
      for (let i = 1; i < pts.length; i++) {
        ctx.lineWidth = pen.base + pen.k * pf(i / (pts.length - 1));
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
    } else {
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
    ctx.restore();
  }
  // 始点マーカーと方向矢印は常に表示
  const start = pts[0];
  const ahead = pts[6];
  ctx.save();
  ctx.fillStyle = "rgba(255, 107, 87, 0.95)";
  ctx.beginPath();
  ctx.arc(start.x, start.y, 6, 0, Math.PI * 2);
  ctx.fill();
  // ハッチング: 2本目以降の始点にも小さな●を打つ
  if (course.hatch) {
    for (let li = 1; li < course.hatch.lines; li++) {
      const s = targetLinePoints(li, 2)[0];
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
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
  ctx.strokeStyle = "#33323E";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    // 筆圧で太さを変える (マウスは pressure=0.5 相当)。ベースは筆の太さ設定に従う
    const pen = PEN_LEVELS[state.penLevel];
    ctx.lineWidth = pen.base + pen.k * (b.p || 0.5);
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
  // 単筆課題は毎回、複数ストローク課題は採点直後のみ前の筆を消す
  if (state.justScored || !currentCourse().hatch) state.strokes = [];
  state.justScored = false;
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
  if (state.stroke.length < 8) { // 短すぎる線は無視
    state.stroke = [];
    render();
    return;
  }
  const course = currentCourse();
  state.strokes.push(state.stroke);
  state.stroke = [];
  const need = course.hatch ? course.hatch.lines : 1;
  if (state.strokes.length >= need) {
    showResult(scoreCurrent(state.strokes));
    state.justScored = true;
  }
  updateHint();
}
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);

/* ---------------- スコアリング ----------------
   本体は js/scoring.js (共通採点エンジン) に分離。
   ここでは課題定義からお手本とオプションを組み立てて渡すだけ */
function scoreCurrent(strokes) {
  const course = currentCourse();
  return scoreStrokes(strokes, targetPoints(), {
    pressureFn: course.pressureFn,
    multiStroke: !!course.hatch,
  });
}

function rankOf(score) {
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= PASS_SCORE) return "B";
  if (score >= 55) return "C";
  return "D";
}

function noteFor(r) {
  const axes = [r.acc, r.cov, r.smo];
  if (r.prs != null) axes.push(r.prs);
  const weakest = Math.min(...axes);
  if (r.total >= PASS_SCORE) {
    if (r.total >= 90) return "サイコーの線!つぎもこの調子!";
    return "クリア!補助線を淡くしてもう一回やると、もっと上手くなるよ。";
  }
  if (r.prs != null && weakest === r.prs) return "筆圧がお手本とちがうみたい。補助線の太さに合わせてみて!";
  if (currentCourse().hatch && weakest === r.cov) return "間かくがバラバラかも。等間かくを意識してみて!";
  if (weakest === r.cov) return "線がとちゅうで止まってるよ。最後まで一気に!";
  if (weakest === r.acc) return "お手本からはなれてるかも。スピードより正確に!";
  return "線がガタガタしてる。指先じゃなく腕ぜんたいで動かそう!";
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
  els.meterPrs.hidden = r.prs == null;
  if (r.prs != null) els.valPrs.textContent = r.prs;
  els.note.textContent = noteFor(r);

  els.nextBtn.hidden = !(state.courseIndex < COURSES.length - 1);

  els.result.hidden = false;
  requestAnimationFrame(() => {
    els.barAcc.style.width = r.acc + "%";
    els.barCov.style.width = r.cov + "%";
    els.barSmo.style.width = r.smo + "%";
    if (r.prs != null) els.barPrs.style.width = r.prs + "%";
  });

  renderRail(); // 解放状態と最高点を更新
}

function hideResult() {
  els.result.hidden = true;
  [els.barAcc, els.barCov, els.barSmo, els.barPrs].forEach(b => (b.style.width = "0"));
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
  state.strokes = [];
  state.justScored = false;
  hideResult();
  const c = currentCourse();
  els.glyph.textContent = c.glyph;
  els.name.textContent = c.name;
  els.desc.textContent = c.desc;
  renderRail();
  render();
  updateHint();
}

/* ヒント欄: 複数ストローク課題では進捗 (n/6 本) を表示 */
function updateHint() {
  const c = currentCourse();
  if (c.hatch) {
    const done = state.strokes.length;
    els.hint.textContent =
      done > 0 && done < c.hatch.lines
        ? `${done} / ${c.hatch.lines} 本 ─ 残り ${c.hatch.lines - done} 本を等間隔に描くと採点されます。`
        : `●印から矢印の方向へ。平行線を ${c.hatch.lines} 本描き終えると採点されます。`;
  } else {
    els.hint.textContent = "●印から矢印の方向へ、一筆で線をなぞってください。Apple Pencilの筆圧で線の太さが変わります。";
  }
}

/* ---------------- コントロール ---------------- */
els.penBtn.addEventListener("click", () => {
  state.penLevel = (state.penLevel + 1) % PEN_LEVELS.length;
  els.penBtn.textContent = PEN_LEVELS[state.penLevel].label;
  try { localStorage.setItem(PEN_KEY, String(state.penLevel)); } catch { /* private mode */ }
  render();
});

els.guideBtn.addEventListener("click", () => {
  state.guideLevel = (state.guideLevel + 1) % GUIDE_LEVELS.length;
  els.guideBtn.textContent = GUIDE_LEVELS[state.guideLevel].label;
  render();
});

els.clearBtn.addEventListener("click", () => {
  state.stroke = [];
  state.strokes = [];
  state.justScored = false;
  hideResult();
  render();
  updateHint();
});

els.retryBtn.addEventListener("click", () => {
  state.stroke = [];
  state.strokes = [];
  state.justScored = false;
  hideResult();
  render();
  updateHint();
});

els.nextBtn.addEventListener("click", () => {
  if (state.courseIndex < COURSES.length - 1) selectCourse(state.courseIndex + 1);
});

/* ---------------- 初期化 ---------------- */
window.addEventListener("resize", resizeCanvas);
els.penBtn.textContent = PEN_LEVELS[state.penLevel].label; // 保存された太さ設定を反映
selectCourse(0);
resizeCanvas();
