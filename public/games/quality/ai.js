// 四档 AI
//  easy      : 50% 最小点数两张 / 50% 随机
//  normal    : 贪心（永远最大两张）
//  hard      : 蒙特卡洛 K=200，15% 概率选次优（"会失误"）
//  nightmare : 蒙特卡洛 K=400，不剪枝，零随机（真·算到底）
import { CONF, playIdx, specOf } from './engine.js';

const LEVEL = {
  easy:      { mode: 'easy' },
  normal:    { mode: 'greedy' },
  hard:      { mode: 'mc', K: 200, prune: 14, miss: 0.15 },
  nightmare: { mode: 'mc', K: 400, prune: 0,  miss: 0 }
};

const pairsOf = (a) => { const r = []; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) r.push([a[i], a[j]]); return r; };
const cdLen = (c) => (c.blank ? 0 : c.cdL);

export function pickPairs(g, side, difficulty) {
  const cfg = LEVEL[difficulty] || LEVEL.normal;
  const round = g.round;
  const me = side === 'me' ? g.me : g.ai;
  const opp = side === 'me' ? g.ai : g.me;
  const idx = playIdx(me.hand, round);
  const pairs = pairsOf(idx);
  if (!pairs.length) return [];
  const sum = (p) => me.hand[p[0]].pts + me.hand[p[1]].pts;

  if (cfg.mode === 'easy') {
    if (g.rng() < 0.5) {
      let b = pairs[0], bv = 1e9;
      for (const p of pairs) { const v = sum(p); if (v < bv) { bv = v; b = p; } }
      return b;
    }
    return pairs[Math.floor(g.rng() * pairs.length)];
  }

  // 贪心：最大两张（normal，以及 mc 档的兜底/次优候选）
  const bySum = pairs.slice().sort((a, b) => sum(b) - sum(a));

  if (cfg.mode === 'greedy') return bySum[0];

  // ---- 蒙特卡洛 ----
  const ownIds = new Set(me.hand.map((c) => c.id));
  const unknown = g.master.filter((c) => !ownIds.has(c.id) && !c.seen);
  const oppSpec = specOf(opp.hand);
  const known = oppSpec.filter((c) => c.seen);
  const need = Math.max(0, oppSpec.length - known.length);
  const K = cfg.K;
  const hands = [];
  for (let k = 0; k < K; k++) {
    const pool = unknown.slice();
    const pick = [];
    for (let i = 0; i < need && pool.length; i++) {
      const j = i + Math.floor(g.rng() * (pool.length - i));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      pick.push(pool[i]);
    }
    const vals = known.concat(pick).map((c) => c.pts).sort((a, b) => b - a);
    hands.push(vals.length <= 1 ? (vals[0] || 0) : vals[0] + vals[1]);
  }

  let cand = pairs;
  if (cfg.prune && me.hand.length > cfg.prune) {
    const ord = idx.map((i) => [me.hand[i].pts, i]).sort((a, b) => a[0] - b[0]);
    const keep = [];
    for (const v of ord.slice(0, 6).concat(ord.slice(-8)).map((x) => x[1])) if (keep.indexOf(v) < 0) keep.push(v);
    if (keep.length > 1) cand = pairsOf(keep);
  }

  const score = (p) => {
    const a = me.hand[p[0]], b = me.hand[p[1]];
    const myPts = a.pts + b.pts;
    const lock = (cdLen(a) + cdLen(b)) * 0.4;
    let v = 0;
    for (let k = 0; k < K; k++) {
      const o = hands[k];
      if (myPts > o) v += 2 + 0.25 * o - lock;
      else if (myPts < o) v -= 2 + 0.25 * myPts + lock;
    }
    return v;
  };
  const ranked = cand.map((p) => [p, score(p)]).sort((x, y) => y[1] - x[1]);
  if (cfg.miss && ranked.length > 1 && g.rng() < cfg.miss) {
    // "会失误"：在小幅落后于最优的候选里随机挑一个（不是乱出 ✓）
    const near = ranked.slice(1, 4);
    return near[Math.floor(g.rng() * near.length)][0];
  }
  return ranked[0][0];
}