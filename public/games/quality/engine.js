// 品质对决 · 引擎（纯逻辑，无 DOM）
// 规则依据：设计文档 v4.2。唯一改动：特殊牌 24 → 32（每类 2 普 + 1 金 + 1 彩）
//   → 牌堆 26；补牌窗口 26 ÷ 2 = 13（文档的推导是 18÷2=9，同比例）

export const TYPES = ['☕️', '🐋', '☀️', '🌙', '☘️', '༄', '🌈', '☂'];
export const QUAL = { '普': 1, '金': 2, '彩': 3 };
export const CDL = { '普': 0, '金': 1, '彩': 2 };
export const QLIST = ['普', '金', '彩'];

export const CONF = {
  cap: 9,
  cd: true,
  window: 13,
  stallN: 3,
  endCap: 77,
  perType: { '普': 2, '金': 1, '彩': 1 },
  hardK: 200,
  hardPrune: 14
};

export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function makeDeck() {
  const out = [];
  for (const t of TYPES) for (const q of QLIST) {
    const n = CONF.perType[q] || 1;
    for (let k = 1; k <= n; k++) {
      out.push({ id: t + '|' + q + '|' + k, type: t, q, pts: QUAL[q], cdL: CDL[q], blank: false, seen: false, cdUntil: undefined });
    }
  }
  return out;
}
export const makeBlank = () => ({ id: 'BLANK', type: '', q: '空白', pts: 0, cdL: 0, blank: true, seen: false, cdUntil: undefined });

export const specOf = (hand) => hand.filter((c) => !c.blank);
export const sumPts = (arr) => arr.reduce((s, c) => s + c.pts, 0);
export const isPlayable = (c, round) => c.blank || !CONF.cd || c.cdUntil === undefined || round > c.cdUntil;
export const cdLeft = (c, round) => (isPlayable(c, round) ? 0 : c.cdUntil - round + 1);
export const playIdx = (hand, round) => hand.map((_, i) => i).filter((i) => isPlayable(hand[i], round));
export const playSpecials = (hand, round) => playIdx(hand, round).filter((i) => !hand[i].blank).length;

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

export function newGame(seed) {
  const rng = makeRng(seed);
  const master = makeDeck();
  const deck = shuffle(master.slice(), rng);
  const g = {
    rng, master, deck,
    me: { hand: [makeBlank()] },
    ai: { hand: [makeBlank()] },
    discard: [], round: 0, phase: 'select', slots: { me: [], ai: [] },
    logs: [], over: false, winner: null, reason: '', tieStreak: 0,
    stats: { ties: 0, discards: 0, aiDiscards: 0 }
  };
  for (let i = 0; i < 3; i++) { g.me.hand.push(deck.pop()); g.ai.hand.push(deck.pop()); }
  return g;
}

export function nextRound(g) {
  if (g.over) return g;
  if (g.round >= CONF.endCap) {
    const m = sumPts(specOf(g.me.hand)), a = sumPts(specOf(g.ai.hand));
    g.over = true; g.phase = 'over';
    g.winner = m > a ? 'me' : a > m ? 'ai' : 'draw';
    g.reason = '安全网：' + CONF.endCap + ' 回合后按手牌特殊牌总点数判定（' + m + ' : ' + a + '）';
    return g;
  }
  g.round++;
  g.slots = { me: [], ai: [] };
  g.phase = 'select';

  const inWin = g.round <= CONF.window;
  if (inWin) {
    if (g.deck.length > 0) g.me.hand.push(g.deck.pop());
    if (g.deck.length > 0) g.ai.hand.push(g.deck.pop());
  }

  const mp = playSpecials(g.me.hand, g.round), ap = playSpecials(g.ai.hand, g.round);
  if (mp === 0 || ap === 0) {
    g.over = true; g.phase = 'over';
    if (mp === 0 && ap === 0) { g.winner = 'draw'; g.reason = '双方都只剩空白能出'; }
    else if (mp === 0) { g.winner = 'ai'; g.reason = '你只剩空白能出（其余在冷却或已被夺走）'; }
    else { g.winner = 'me'; g.reason = 'AI 只剩空白能出（其余在冷却或已被夺走）'; }
  }
  return g;
}

// 结算。mine / theirs 是本回合双方打出的牌对象
export function resolveRound(g, mine, theirs) {
  const R = g.round;
  mine.concat(theirs).forEach((c) => { c.seen = true; });
  const pP = sumPts(mine), aP = sumPts(theirs);
  const result = pP > aP ? 'me' : pP < aP ? 'ai' : 'tie';

  // 结算去向（文档 4.3）：空白永回自己；特殊牌由赢家夺走；平局各回各家
  for (const c of mine) {
    if (c.blank) g.me.hand.push(c);
    else if (result === 'ai') g.ai.hand.push(c);
    else g.me.hand.push(c);
  }
  for (const c of theirs) {
    if (c.blank) g.ai.hand.push(c);
    else if (result === 'me') g.me.hand.push(c);
    else g.ai.hand.push(c);
  }
  // 冷却：本回合打出过的特殊牌，无论最终落在谁手里，都按品质进冷却
  for (const c of mine.concat(theirs)) if (!c.blank) c.cdUntil = R + c.cdL;

  const ms = specOf(g.me.hand).length, as = specOf(g.ai.hand).length;
  if (ms === 0 || as === 0) {
    g.over = true; g.phase = 'over';
    if (ms === 0 && as === 0) { g.winner = 'draw'; g.reason = '双方特殊牌同时被夺光'; }
    else if (ms === 0) { g.winner = 'ai'; g.reason = '你的特殊牌被夺光了'; }
    else { g.winner = 'me'; g.reason = 'AI 的特殊牌被夺光了'; }
  }

  if (result === 'tie') {
    g.tieStreak++;
    g.stats.ties++;
    if (g.tieStreak >= CONF.stallN) {
      const biggest = (arr) => { let b = null; for (const c of arr) if (!c.blank && (!b || c.pts > b.pts)) b = c; return b; };
      const bm = biggest(mine), ba = biggest(theirs);
      if (bm) { g.me.hand = g.me.hand.filter((c) => c !== bm); bm.cdUntil = undefined; g.deck.splice(Math.floor(g.rng() * (g.deck.length + 1)), 0, bm); }
      if (ba) { g.ai.hand = g.ai.hand.filter((c) => c !== ba); ba.cdUntil = undefined; g.deck.splice(Math.floor(g.rng() * (g.deck.length + 1)), 0, ba); }
      g.tieStreak = 0;
    }
  } else { g.tieStreak = 0; }

  return { result, pP, aP };
}

export function overCount(g, side) {
  return Math.max(0, specOf(side === 'me' ? g.me.hand : g.ai.hand).length - CONF.cap);
}

// 弃置（超出上限的牌回牌堆、冷却清零）
export function trimHand(g, side, indices) {
  const h = side === 'me' ? g.me.hand : g.ai.hand;
  const over = overCount(g, side);
  if (over <= 0) return [];
  const removed = [];
  if (side === 'me') {
    for (const i of (indices || [])) { if (removed.length >= over) break; const c = h[i]; if (c && !c.blank && removed.indexOf(c) < 0) removed.push(c); }
    g.me.hand = h.filter((c) => removed.indexOf(c) < 0);
  } else {
    const sorted = specOf(h).slice().sort((a, b) => a.pts - b.pts);
    for (const c of sorted) { if (removed.length >= over) break; removed.push(c); }
    g.ai.hand = h.filter((c) => removed.indexOf(c) < 0);
    g.stats.aiDiscards += removed.length;
  }
  for (const c of removed) { c.cdUntil = undefined; g.deck.splice(Math.floor(g.rng() * (g.deck.length + 1)), 0, c); }
  g.stats.discards += removed.length;
  return removed;
}