/* ============================================================
   線刻 共通採点エンジン (DOM 非依存)
   - Stage 1 (運筆道場) / Stage 2 (形体道場) / tools/sim/verify.js から共用
   - <script> で読むとグローバル定義、Node からは require() で読める
   ============================================================ */
"use strict";

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

const clamp01 = v => Math.max(0, Math.min(1, v));

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

/* 3点移動平均 (両端は保持)。センサノイズ・微細な手ブレを除去してから
   ガタつきを測るための前平滑化に使う */
function smoothPts(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    out.push({
      x: (pts[i - 1].x + pts[i].x + pts[i + 1].x) / 3,
      y: (pts[i - 1].y + pts[i].y + pts[i + 1].y) / 3,
    });
  }
  out.push(pts[pts.length - 1]);
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

/* ------------------------------------------------------------
   scoreStrokes(strokes, target, opts)
   - strokes: 筆のリスト [{x,y,p,t}...][] (単筆課題は要素1つ)
   - target: お手本の点列 (キャンバス座標)
   - opts.pressureFn: 筆圧課題の目標カーブ t → 0〜1 (省略可)
   - opts.multiStroke: 複数ストローク課題 (ハッチング・アタリ等) なら true
     → 滑らかさの基準曲率 0 / 網羅ゲートを厳しく
   - opts.partTargets: 部品ごとのお手本点列の配列 (複数ストローク課題で、
     楕円など曲率を持つ部品があるとき用)。各筆を重心が最寄りの部品に
     マッチングし、その部品の曲率を滑らかさの基準にする
   - opts.accScale / opts.covTolRatio: 精度・網羅の許容値
     (デフォルトはなぞり課題用。模写のようにフリーハンドで形を写す
      課題では緩めの値を渡す)
   精度・網羅・筆圧は全点をまとめて、滑らかさは1本ずつ測って点数加重平均
   ------------------------------------------------------------ */
function scoreStrokes(strokes, target, opts = {}) {
  const pf = opts.pressureFn || null;
  const multiStroke = !!opts.multiStroke;
  const partTargets = opts.partTargets || null;
  const accScale = opts.accScale ?? 0.05;
  const covTolRatio = opts.covTolRatio ?? 0.055;
  const stroke = strokes.flat(); // 精度・網羅・筆圧用の全点

  // お手本の大きさで正規化 (画面サイズに依存しないように)
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const p of target) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const size = Math.max(Math.hypot(maxX - minX, maxY - minY), 1);

  // 精度: 描いた各点からお手本までの平均距離
  // 筆圧課題では、最近傍のお手本位置 t に対応する目標筆圧との誤差も同時に集計
  let errSum = 0;
  const pPairs = pf ? [] : null; // [実筆圧, 目標筆圧] のペア
  for (const p of stroke) {
    let best = Infinity, bestI = 0;
    for (let i = 0; i < target.length; i++) {
      const d = dist(p, target[i]);
      if (d < best) { best = d; bestI = i; }
    }
    errSum += best;
    if (pf) pPairs.push([p.p || 0.5, pf(bestI / (target.length - 1))]);
  }
  const meanErr = errSum / stroke.length / size;
  const acc = clamp01(1 - (meanErr - 0.008) / accScale) * 100;

  // 筆圧: 目標筆圧カーブとの平均誤差 (筆圧課題のみ)
  // 筆圧の絶対値は個人差が大きい (自然な筆記圧が 0.2 の人も 0.7 の人もいる) ため、
  // ユーザーの平均筆圧を目標カーブの平均に合わせるオフセット補正 (±0.35 まで) をかけ、
  // 「圧の変化の形」を採点する。絶対値比較だと実機で prs=0 に張り付く (2026-07 確認)
  let prs = null;
  if (pf) {
    let mp = 0, mt = 0;
    for (const [pv, tv] of pPairs) { mp += pv; mt += tv; }
    mp /= pPairs.length; mt /= pPairs.length;
    const offset = Math.max(-0.35, Math.min(0.35, mt - mp));
    let pErrSum = 0;
    for (const [pv, tv] of pPairs) pErrSum += Math.abs(pv + offset - tv);
    prs = clamp01(1 - (pErrSum / pPairs.length - 0.03) / 0.22) * 100;
  }

  // 網羅: お手本の各点の近くを通過したか
  const covTol = size * covTolRatio;
  let covered = 0;
  for (const q of target) {
    for (const p of stroke) {
      if (dist(p, q) <= covTol) { covered++; break; }
    }
  }
  const cov = (covered / target.length) * 100;

  // 部品ごとの網羅率の最低値 (partTargets があるときのみ)。
  // 小さい部品の描き忘れは合併の網羅率では殆ど下がらないため、これで検出する
  let minPartCov = null;
  if (partTargets) {
    minPartCov = 100;
    for (const pts of partTargets) {
      let c = 0;
      for (const q of pts) {
        for (const p of stroke) {
          if (dist(p, q) <= covTol) { c++; break; }
        }
      }
      minPartCov = Math.min(minPartCov, (c / pts.length) * 100);
    }
  }

  // 滑らかさ: お手本自身の曲率を差し引いた「余分なガタつき」
  // 実機の Apple Pencil はセンサノイズ+微細な手ブレが乗るため、
  // 前平滑化(等間隔リサンプリング→3点移動平均×2)してマクロなうねりだけを測る。
  // 前平滑化なし・step=size/90・許容0.45 だと丁寧に引いた線でも smo=0 に張り付く
  // (2026-07 iPad 実機で確認 → シミュレーションで再調整済み)
  // 複数ストローク課題は1本ずつ測って点数加重平均。
  // 基準曲率: partTargets があれば筆ごとに最寄り部品の曲率、
  // なければ複数ストローク=0 (直線前提) / 単筆=お手本全体の曲率
  const step = size / 45;
  const centroid = pts => {
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    return { x: cx / pts.length, y: cy / pts.length };
  };
  const partJit = partTargets ? partTargets.map(pp => jitterOf(pp, step)) : null;
  const partCen = partTargets ? partTargets.map(centroid) : null;
  const wholeRef = multiStroke ? 0 : jitterOf(target, step);
  let excSum = 0, excW = 0;
  for (const st of strokes) {
    let refJitter = wholeRef;
    if (partTargets) {
      const c = centroid(st);
      let bi = 0, bd = Infinity;
      for (let i = 0; i < partCen.length; i++) {
        const d = dist(c, partCen[i]);
        if (d < bd) { bd = d; bi = i; }
      }
      refJitter = partJit[bi];
    }
    const smoothed = smoothPts(smoothPts(resample(st, step / 2)));
    excSum += Math.max(0, jitterOf(smoothed, step) - refJitter) * st.length;
    excW += st.length;
  }
  const excess = excSum / excW;
  const smo = clamp01(1 - excess / 0.30) * 100;

  // 網羅率が低い(線が途中で終わっている)場合は合計点を大きく減点するゲート
  // 筆圧課題は筆圧軸を加えた4軸で配分
  const base = pf
    ? acc * 0.35 + cov * 0.25 + smo * 0.15 + prs * 0.25
    : acc * 0.5 + cov * 0.3 + smo * 0.2;
  // 筆圧課題では筆圧が悪すぎる場合もゲートで減点 (prs 60+ なら減点なし)
  // 複数ストローク課題は「全部品を埋める」のが本質なので網羅ゲートを厳しく
  // (1本抜け=cov83% でも大幅減点になるように)
  // 部品つき課題ではさらに「部品最低cov」ゲート (60+ で減点なし)
  // → 小さい部品の描き忘れ・大きさの大間違いを確実に不合格にする
  const covGate = multiStroke ? clamp01((cov - 60) / 35) : clamp01((cov - 40) / 50);
  const gate = covGate
    * (pf ? clamp01((prs - 15) / 45) : 1)
    * (minPartCov != null ? clamp01((minPartCov - 20) / 40) : 1);
  const total = Math.round(base * gate);
  const avgPressure = stroke.reduce((s, p) => s + (p.p || 0), 0) / stroke.length;

  return {
    total, acc: Math.round(acc), cov: Math.round(cov), smo: Math.round(smo),
    prs: prs == null ? null : Math.round(prs), avgPressure,
    minPartCov: minPartCov == null ? null : Math.round(minPartCov),
  };
}

/* ------------------------------------------------------------
   fitStrokesTo(strokes, target)
   模写採点用の正規化: ユーザーの描画全体を、お手本のバウンディング
   ボックスに合わせて等倍スケール+中心合わせする。
   位置や大きさではなく「形」を採点するための前処理。
   返り値の { scale, cx, cy, tcx, tcy } は差分オーバーレイ
   (お手本をユーザーの描画位置へ逆変換して重ねる) に使う。
   ------------------------------------------------------------ */
function fitStrokesTo(strokes, target) {
  const bbox = pts => {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY,
      cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
      diag: Math.max(Math.hypot(maxX - minX, maxY - minY), 1) };
  };
  const sb = bbox(strokes.flat());
  const tb = bbox(target);
  const scale = tb.diag / sb.diag;
  const fitted = strokes.map(st =>
    st.map(p => ({
      ...p,
      x: tb.cx + (p.x - sb.cx) * scale,
      y: tb.cy + (p.y - sb.cy) * scale,
    }))
  );
  return { strokes: fitted, scale, cx: sb.cx, cy: sb.cy, tcx: tb.cx, tcy: tb.cy };
}

/* Node (tools/sim/verify.js) から require できるように */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { dist, clamp01, resample, smoothPts, jitterOf, scoreStrokes, fitStrokesTo };
}
