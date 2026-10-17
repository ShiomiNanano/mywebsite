
/* 幻梦牌 · 单文件版
   引擎 + AI + 界面全部内联，页面里没有任何 import，
   因此不依赖托管方的 Content-Type。 */

/* ===================== 引擎 ===================== */
// 品质对决 · 引擎（纯逻辑，无 DOM）
// 规则依据：设计文档 v4.2。唯一改动：特殊牌 24 → 32（每类 2 普 + 1 金 + 1 彩）
//   → 牌堆 26；补牌窗口 26 ÷ 2 = 13（文档的推导是 18÷2=9，同比例）

const TYPES = ['☕️', '🐋', '☀️', '🌙', '☘️', '༄', '🌈', '☂'];
const QUAL = { '普': 1, '金': 2, '彩': 3 };
const CDL = { '普': 0, '金': 1, '彩': 2 };
const QLIST = ['普', '金', '彩'];

const CONF = {
  cap: 9,
  cd: true,
  window: 13,
  stallN: 3,
  endCap: 77,
  perType: { '普': 2, '金': 1, '彩': 1 },
  hardK: 200,
  hardPrune: 14
};

function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function makeDeck() {
  const out = [];
  for (const t of TYPES) for (const q of QLIST) {
    const n = CONF.perType[q] || 1;
    for (let k = 1; k <= n; k++) {
      out.push({ id: t + '|' + q + '|' + k, type: t, q, pts: QUAL[q], cdL: CDL[q], blank: false, seen: false, cdUntil: undefined });
    }
  }
  return out;
}
const makeBlank = () => ({ id: 'BLANK', type: '', q: '空白', pts: 0, cdL: 0, blank: true, seen: false, cdUntil: undefined });

const specOf = (hand) => hand.filter((c) => !c.blank);
const sumPts = (arr) => arr.reduce((s, c) => s + c.pts, 0);
const isPlayable = (c, round) => c.blank || !CONF.cd || c.cdUntil === undefined || round > c.cdUntil;
const cdLeft = (c, round) => (isPlayable(c, round) ? 0 : c.cdUntil - round + 1);
const playIdx = (hand, round) => hand.map((_, i) => i).filter((i) => isPlayable(hand[i], round));
const playSpecials = (hand, round) => playIdx(hand, round).filter((i) => !hand[i].blank).length;

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

function newGame(seed) {
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

function nextRound(g) {
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
function resolveRound(g, mine, theirs) {
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

function overCount(g, side) {
  return Math.max(0, specOf(side === 'me' ? g.me.hand : g.ai.hand).length - CONF.cap);
}

// 弃置（超出上限的牌回牌堆、冷却清零）
function trimHand(g, side, indices) {
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

/* ===================== AI ===================== */
// 四档 AI
//  easy      : 50% 最小点数两张 / 50% 随机
//  normal    : 贪心（永远最大两张）
//  hard      : 蒙特卡洛 K=200，15% 概率选次优（"会失误"）
//  nightmare : 蒙特卡洛 K=400，不剪枝，零随机（真·算到底）

const LEVEL = {
  easy:      { mode: 'easy' },
  normal:    { mode: 'greedy' },
  hard:      { mode: 'mc', K: 200, prune: 14, miss: 0.15 },
  nightmare: { mode: 'mc', K: 400, prune: 0,  miss: 0 }
};

const pairsOf = (a) => { const r = []; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) r.push([a[i], a[j]]); return r; };
const cdLen = (c) => (c.blank ? 0 : c.cdL);

function pickPairs(g, side, difficulty) {
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

/* ===================== 界面 ===================== */


const $ = (id) => document.getElementById(id);
const QC = { '普': 'var(--普)', '金': 'var(--金)', '彩': 'var(--彩)' };
let g = null, sel = [], phase = 'ready', STARTED = false, msg = '', miss = 0;

// ===== 段位（本地存储；接站点时换成服务端）=====
const TIERS = [
  { name: '学徒',   min: 0,    ai: 'easy' },
  { name: '侍者',   min: 800,  ai: 'normal' },
  { name: '咖啡师', min: 1200, ai: 'hard' },
  { name: '常客',   min: 1600, ai: 'nightmare' },
  { name: '店长',   min: 2000, ai: 'nightmare' }
];
const loadRank = () => {
  try { return JSON.parse(localStorage.getItem('qc_rank') || 'null') || { rating: 0, wins: 0, losses: 0 }; }
  catch (e) { return { rating: 0, wins: 0, losses: 0 }; }
};
const saveRank = (r) => { try { localStorage.setItem('qc_rank', JSON.stringify(r)); } catch (e) {} };
const tierOf = (rating) => { let t = TIERS[0]; for (const x of TIERS) if (rating >= x.min) t = x; return t; };
let RANK = loadRank();

function paintRank() {
  const t = tierOf(RANK.rating);
  document.getElementById('rankName').textContent = t.name;
  document.getElementById('rankScore').textContent = RANK.rating + ' 分';
}

// 段位变化：赢 = 钳制((1000 − 回合×8 − 对手剩余特殊点数×3) / 10, 5, 40)；输 = −8；下限 0
function applyRank(result) {
  const before = RANK.rating;
  const beforeTier = tierOf(before).name;
  let delta = 0;
  if (result === 'me') {
    const oppPts = specOf(g.ai.hand).reduce((s, c) => s + c.pts, 0);
    // 原始值 = 1000 − 回合×8 − 对手剩余点数×3；减去基线 400 再除 12，钳 5~40
    const raw = 1000 - g.round * 8 - oppPts * 3;
    delta = Math.max(5, Math.min(40, Math.round((raw - 400) / 12)));
    RANK.rating += delta; RANK.wins++;
  } else if (result === 'ai') {
    delta = -8;
    RANK.rating = Math.max(0, RANK.rating - 8); RANK.losses++;
  }
  saveRank(RANK); paintRank();
  const afterTier = tierOf(RANK.rating).name;
  const upTxt = afterTier !== beforeTier ? '　→ ' + afterTier + ' · 对手变强了' : '';
  const box = document.getElementById('ovRank');
  box.textContent = (delta >= 0 ? '+' + delta : String(delta)) + ' 分' + upTxt;
}

// ===== 新手引导（只教规则，不教策略）=====
const GUIDE_STEPS = [
  {
    t: '你的牌：8 类 × 3 种品质',
    b: '特殊牌共 32 张 = 8 种符号，每种有 2 张「普」1 张「金」1 张「彩」。<br><br>点数：<b>普 1 点 · 金 2 点 · 彩 3 点</b>。<br>另外双方各有 1 张「空白」（0 点），永远是你的，夺不走。'
  },
  {
    t: '每回合：各出 2 张，比点数之和',
    b: '点选两张自己的牌 → 盖牌 → 声明准备。<br><br>双方同时翻开，<b>两张点数相加比大小</b>。<br>例：金+金 = 4，大于 彩+空白 = 3。'
  },
  {
    t: '赢了会夺走对方的牌',
    b: '点数高的一方，<b>夺走对方本回合打出的特殊牌</b>（空白不夺，各回各家）。<br>平局则各自收回。'
  },
  {
    t: '但强牌要进冷却 ❄',
    b: '本回合出过、以及你赢下的特殊牌，都按品质<b>进冷却</b>：<br>普 0 回合 · <b>金锁 1 回合</b> · <b>彩锁 2 回合</b>。<br><br>所以<br>「赢了这一手，下两回合反而能出的牌更少」。'
  },
  {
    t: '怎么赢',
    b: '① <b>轮到你的回合，你却只剩空白能出</b> → 你输（这是最主要的败因）。<br>② 你的特殊牌被全部夺走 → 你输。<br><br>手牌上限 9 张，超出要弃置（弃掉的牌会回到牌堆，可能再被抽到）。'
  }
];
let guideStep = 0;

function openGuide() {
  guideStep = 0;
  paintGuide();
  document.getElementById('guide').classList.add('on');
}
function closeGuide() {
  document.getElementById('guide').classList.remove('on');
  try { localStorage.setItem('qc_guided', '1'); } catch (e) {}
}
function paintGuide() {
  const s = GUIDE_STEPS[guideStep];
  document.getElementById('gTitle').textContent = s.t;
  document.getElementById('gBody').innerHTML = s.b;
  document.getElementById('gNext').textContent = guideStep >= GUIDE_STEPS.length - 1 ? '开始打牌' : '下一步 (' + (guideStep + 1) + '/' + GUIDE_STEPS.length + ')';
}
function aiLevel() {
  const v = document.getElementById('diff').value;
  return v === 'auto' ? tierOf(RANK.rating).ai : v;
}
const diff = () => $('diff').value;

function start() {
  g = newGame(Date.now() & 0x7fffffff);
  sel = []; phase = 'select'; msg = ''; miss = 0;
  nextRound(g);
  if (g.over) phase = 'over';
  // 进入时手牌盖着（只给牌背），点「开始对局」才翻开 → 防止刷好开局
  phase = 'ready'; STARTED = false;
  paintRank();
  render();
}

function cdOf(c) { return c.blank ? 0 : c.cdL; }
function faceHtml(c, round, picked) {
  const cold = !c.blank && !isPlayable(c, round);
  const qc = c.blank ? '#4a5266' : QC[c.q];
  const qClass = c.blank ? ' q-blank' : (c.q === '普' ? ' q-pu' : c.q === '金' ? ' q-jin' : ' q-cai');
  return '<div class="card' + qClass + (cold ? ' cold' : '') + (picked ? ' pick' : '')
    + '" data-id="' + c.id + '" style="--var-qc:' + qc + '">'
    + (cold ? '<u class="c">❄' + cdLeft(c, round) + '</u>' : '')
    + '<b>' + (c.blank ? '·' : c.type) + '</b><i>' + c.q + ' ' + c.pts + '点</i></div>';
}
const backHtml = () => '<div class="bk">✦</div>';

function render() {
  const r = g.round;
  // 对手
  const aiSpec = specOf(g.ai.hand);
  const aiCold = aiSpec.filter((c) => !isPlayable(c, r)).length;
  $('oppLbl').textContent = '对手 · 手牌 ' + g.ai.hand.length + ' 张' + (aiCold ? '（其中 ' + aiCold + ' 张冷却中）' : '');
  $('oppBacks').innerHTML = g.ai.hand.map(backHtml).join('');
  const known = aiSpec.filter((c) => c.seen);
  $('oppKnown').innerHTML = known.length
    ? known.map((c) => '<span class="tag" style="--var-qc:' + QC[c.q] + '">' + c.type + c.q + '</span>').join('')
    : '<span class="tag">还没有已知的牌</span>';

  // 放牌格
  const slot = (c, mine) => {
    if (!c) return '<div class="slot">空</div>';
    if (!mine && !(g.slots.ai && g.slots.ai.length)) return '<div class="slot on">' + backHtml() + '</div>';
    const cold = !c.blank && !isPlayable(c, r);
    return '<div class="slot on" style="border-color:' + (c.blank ? '#4a5266' : QC[c.q]) + '"><b style="font-size:20px">'
      + (c.blank ? '·' : c.type) + '</b><span style="font-size:10px">' + c.q + c.pts + '点</span></div>';
  };
  const shown = (arr) => (arr && arr.length ? arr : [null, null]);
  $('aiSlots').innerHTML = shown(g.slots.ai).map((c) => slot(c, false)).join('');
  $('meSlots').innerHTML = shown(g.slots.me).map((c) => slot(c, true)).join('');

  $('mid').innerHTML = '第 <b>' + r + '</b> 回合 · 牌堆 <b>' + g.deck.length + '</b> 张 · 补牌还剩 <b>'
    + Math.max(0, CONF.window - r + 1) + '</b> 回合';

  // 手牌
  // 特殊牌与空白牌分两处渲染：空白常驻、占位用，不占上限、不可弃置
  const specials = g.me.hand.map((c, i) => [c, i]).filter((p) => !p[0].blank);
  const blanks = g.me.hand.map((c, i) => [c, i]).filter((p) => p[0].blank);
  if (phase === 'ready') {
    $('meHand').innerHTML = specials.map(() => '<div class="card q-pu" style="background:linear-gradient(150deg,#2a3350,#161c2c);border-color:#3c4767;cursor:default"><b style="font-size:20px;color:#7d88a8">✦</b></div>').join('');
    $('meBlank').innerHTML = blanks.map((p) => faceHtml(p[0], r, false)).join('');
  } else {
    $('meHand').innerHTML = specials.map((p) => faceHtml(p[0], r, sel.indexOf(p[1]) >= 0)).join('');
    $('meBlank').innerHTML = blanks.map((p) => faceHtml(p[0], r, sel.indexOf(p[1]) >= 0)).join('');
  }
  // 拱形：给每张牌标出它在手牌里的位置（--i / --n），CSS 据此旋转与下沉
  // 拱形只作用于特殊手牌（#meHand）；空白牌单列，不参与旋转
  const handCards = document.querySelectorAll('#meHand .card');
  handCards.forEach((el, k) => { el.style.setProperty('--i', String(k)); el.style.setProperty('--n', String(handCards.length)); });
  // 动态收窄：牌越多叠得越紧，保证 9 张也能全在一行内、不被容器裁掉
  const n = handCards.length;
  const cvw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cw')) || 62;
  const rowW = (document.getElementById('meHand').clientWidth || 340) - 8;
  const need = n > 0 ? (rowW - cvw) / Math.max(1, n - 1) : 0;   // 每张允许占的宽度
  const MIN_VISIBLE = 18;                                  // 每张至少露出的宽度（够手指点）
  const wantOverlap = n > 1 ? Math.round(need - cvw) : 0;         // 理想：刚好塞满
  const maxOverlap = -(cvw - MIN_VISIBLE);                        // 底线：每张至少露 18px
  const overlap = n > 1 ? Math.min(-4, Math.max(maxOverlap, wantOverlap)) : 0;
  document.getElementById('meHand').style.setProperty('--overlap', overlap + 'px');
  document.querySelectorAll('#meHand .card, #meBlank .card').forEach((el) => {
    el.onclick = () => onPick(el.dataset.id);
  });

  // 提示与按钮
  let banner = msg;
  if (!banner) {
    if (phase === 'over') banner = '<b>对局结束：</b>' + (g.winner === 'me' ? '你赢了 🎉' : g.winner === 'ai' ? '你输了' : '平局') + '　' + g.reason;
    else if (phase === 'discard') banner = '<b>手牌超出上限：</b>请点选 <b>' + overCount(g, 'me') + '</b> 张弃置（回牌堆）';
    else banner = '点选两张可出的牌 → 盖牌 → 声明准备。❄ = 冷却中，出不了。';
  }
  const LOG_HTML = g.logs.slice(0, 40).map((t, k) => '<div class="lg-line' + (k === 0 ? ' now' : '') + '">' + t + '</div>').join('');
  $('banner').innerHTML = '<span class="bulletin-hint">本局播报</span>' + banner
    + (LOG_HTML ? '<div style="margin-top:6px;opacity:.92">' + LOG_HTML + '</div>' : '');

  const btn = $('primary');
  btn.disabled = true;
  btn.classList.toggle('danger', phase === 'discard');   // 弃置时按钮变红
  if (phase === 'ready') { btn.textContent = '开始对局'; btn.disabled = false; }
  else if (phase === 'select') { btn.textContent = '盖牌并声明准备'; btn.disabled = sel.length !== 2; }
  else if (phase === 'discard') { btn.textContent = '确认弃置 (' + sel.length + '/' + overCount(g, 'me') + ')'; btn.disabled = sel.length !== overCount(g, 'me'); }
  else if (phase === 'over') { btn.textContent = '再来一局'; btn.disabled = false; }
  else { btn.textContent = '翻牌中…'; }

  // 战况
  const mineIds = new Set(g.me.hand.map((c) => c.id));
  const unseen = g.master.filter((c) => !c.seen && !mineIds.has(c.id));
  const inAi = unseen.filter((c) => g.ai.hand.some((h) => h.id === c.id)).length;
  $('pool').innerHTML = '<span class="tag">未现身 ' + unseen.length + ' 张：牌堆 ' + (unseen.length - inAi) + ' · 对手手上 ' + inAi + '</span>';
  $('log').innerHTML = g.logs.slice(0, 12).map((t) => '<div>' + t + '</div>').join('');

  // ★ 结算弹层：赢/输/平必须一眼看到（之前那句被 msg 覆盖了，等于没显示）
  const ov = $('ov');
  if (phase === 'over') {
    const t = $('ovTitle'), rs = $('ovReason');
    // 段位只在这一局第一次进 over 时结算（render 会被调用多次）
    if (!g._ranked) { g._ranked = true; applyRank(g.winner); }
    g.logs = [];   // 局末清空播报
    t.textContent = g.winner === 'me' ? '你赢了 🎉' : g.winner === 'ai' ? '你输了' : '平局';
    t.className = g.winner === 'me' ? 'win' : g.winner === 'ai' ? 'lose' : 'tie';
    rs.textContent = g.reason + '　·　共 ' + g.round + ' 回合';
    ov.classList.add('on');
  } else {
    ov.classList.remove('on');
  }
}

function onPick(id) {
  if (phase !== 'select' && phase !== 'discard') return;
  const i = g.me.hand.findIndex((c) => c.id === id);
  if (i < 0) return;
  const k = sel.indexOf(i);
  if (k >= 0) { sel.splice(k, 1); return render(); }
  const max = phase === 'discard' ? overCount(g, 'me') : 2;
  if (sel.length >= max) return;
  if (phase === 'select' && !isPlayable(g.me.hand[i], g.round)) return;
  // 空白牌不可弃置（文档 1.2）：弃置阶段点它直接忽略
  if (phase === 'discard' && g.me.hand[i].blank) return;
  sel.push(i);
  render();
}

function primary() {
  if (phase === 'ready') { phase = 'select'; STARTED = true; sel = []; render(); return; }
  if (phase === 'over') return start();
  if (phase === 'select' && sel.length === 2) return playPair();
  if (phase === 'discard' && sel.length === overCount(g, 'me')) {
    trimHand(g, 'me', sel);
    sel = []; phase = 'select'; msg = '';
    nextRound(g);
    if (g.over) phase = 'over';
    return render();
  }
}

function playPair() {
  const mine = sel.map((i) => g.me.hand[i]);
  if (mine.some((c) => !isPlayable(c, g.round))) return;
  const ap = pickPairs(g, 'ai', aiLevel());
  const theirs = ap.map((i) => g.ai.hand[i]);
  g.me.hand = g.me.hand.filter((c) => mine.indexOf(c) < 0);
  g.ai.hand = g.ai.hand.filter((c) => theirs.indexOf(c) < 0);
  g.slots = { me: mine, ai: theirs };
  sel = []; phase = 'reveal'; msg = '';
  render();


  // 翻牌期间把双方出的牌写清楚（玩家要能看清对手出了什么）
  msg = '<b>翻牌中…</b><br>你出：' + mine.map((c) => c.blank ? '空白' : c.type + c.q + '(' + c.pts + '点)').join(' + ')
    + '　共 ' + mine.reduce((s, c) => s + c.pts, 0) + ' 点<br>对方出：'
    + theirs.map((c) => c.blank ? '空白' : c.type + c.q + '(' + c.pts + '点)').join(' + ')
    + '　共 ' + theirs.reduce((s, c) => s + c.pts, 0) + ' 点';
  render();

  setTimeout(() => {
    const res = resolveRound(g, mine, theirs);
    // ★ 把"双方各出了什么"写进日志 —— 这是播报栏能回看的关键（提示一闪而过 ✗）
      const fmt = (arr) => arr.map((c) => c.blank ? '空白' : c.type + c.q + c.pts).join('+');
      // ★ 直接写进 g.logs（原来的 log() 函数在这个界面里不存在 → 异常被吞 → 一条都没进去 ✗）
      const fmtCard = (arr) => arr.map((c) => c.blank ? '空白' : c.type + c.q + c.pts).join('+');
      g.logs.unshift('<b>第 ' + g.round + ' 回合</b>　你 ' + fmtCard(mine) + '（' + res.pP + '）｜对方 '
        + fmtCard(theirs) + '（' + res.aP + '）→ '
        + (res.result === 'me' ? '你赢' : res.result === 'ai' ? '你输' : '平局'));
      if (g.logs.length > 40) g.logs.length = 40;
    const myWin = res.result === 'me', tie = res.result === 'tie';
    msg = '<b>' + (myWin ? '你赢了这一手' : tie ? '平局' : '你输了这一手') + '</b>　'
      + '你 ' + res.pP + ' : ' + res.aP + ' 对手'
      + (myWin ? '　（夺走对方的特殊牌，双方打出的牌都进冷却）' : tie ? '　（各自收回，打出的特殊牌进冷却）' : '　（你的特殊牌被夺走）');
    if (g.over) { phase = 'over'; return render(); }
    // AI 超出上限：自动弃点数最低的若干张（文档 4.5）。之前界面漏了这一步。
    if (overCount(g, 'ai') > 0) {
      const dropped = trimHand(g, 'ai');
      if (dropped && dropped.length) msg += '<br><span style="color:var(--ink3)">对手手牌超出上限，弃置了 ' + dropped.length + ' 张（回牌堆）</span>';
    }
    if (overCount(g, 'me') > 0) { phase = 'discard'; sel = []; return render(); }
    nextRound(g);
    if (g.over) { phase = 'over'; return render(); }
    phase = 'select';
    render();
  }, 1000);
}

$('primary').onclick = primary;
function doRestart() {
  // 已经打完（over）或还没开始（ready）→ 不扣分
  if (STARTED && !g.over) {
    const ok = window.confirm('这局还没打完，放弃会扣 8 分。确定要重开吗？');
    if (!ok) return;
    RANK.rating = Math.max(0, RANK.rating - 8);
    RANK.losses++;
    saveRank(RANK); paintRank();
  }
  start();
}
$('restart').onclick = doRestart;
$('diff').onchange = start;
$('ovAgain').onclick = start;

// ===== 引导与实验室入口的绑定 =====
document.getElementById('gNext').addEventListener('click', () => {
  if (guideStep >= GUIDE_STEPS.length - 1) { closeGuide(); return; }
  guideStep++; paintGuide();
});
document.getElementById('gSkip').addEventListener('click', closeGuide);
document.getElementById('viewGuide').addEventListener('click', openGuide);
document.getElementById('resetRank').addEventListener('click', () => {
  RANK = { rating: 0, wins: 0, losses: 0 };
  saveRank(RANK); paintRank();
  document.getElementById('ov').classList.remove('on');
  start();
});

// 第一次进入自动弹引导（只教规则，可跳过；本地记一个标记）
try { if (!localStorage.getItem('qc_guided')) openGuide(); } catch (e) {}
start();

// 返回上一步
document.getElementById('backBtn').addEventListener('click', () => {
  if (window.history.length > 1 && document.referrer) { window.history.back(); }
  else { window.location.href = '/#/games'; }
});

// 返回上一步（带离开惩罚：本局已开始且未结束 → 确认后扣 8 分）
var __qcLeaving = false;
(function () {
  const b = document.getElementById('backBtn');
  if (!b) return;
  b.addEventListener('click', () => {
    if (typeof STARTED !== 'undefined' && STARTED && g && !g.over) {
      const ok = window.confirm('这局还没打完，离开会扣 8 分。确定要回去吗？');
      if (!ok) return;
      RANK.rating = Math.max(0, RANK.rating - 8);
      RANK.losses++;
      saveRank(RANK); paintRank();
    }
      __qcLeaving = true;
    if (window.history.length > 1 && document.referrer) window.history.back();
    else window.location.href = '/#/games';
  });
})();

/* 页面刷新 / 关闭时的离开惩罚
   · beforeunload 只负责弹浏览器原生提示（这里扣分不安全：用户可能点"取消" ✗）
   · pagehide 只在真的离开时触发（取消不会触发 ✓）→ 在这里扣分才安全 ✓
   · 关标签页 / 杀进程时事件可能不发 ✗ —— 这就是我们保留的灰色地带 ✓ */
(function () {
  window.addEventListener('beforeunload', (e) => {
    if (__qcLeaving) return;   // 我们自己点「←」走的，已经扣过分了，不再弹浏览器提示 ✓
    if (typeof STARTED !== 'undefined' && STARTED && g && !g.over) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });
  window.addEventListener('pagehide', () => {
    if (__qcLeaving) return;   // 返回按钮已经扣过，避免重复扣 ✓
    if (typeof STARTED !== 'undefined' && STARTED && g && !g.over) {
      try {
        RANK.rating = Math.max(0, RANK.rating - 8);
        RANK.losses++;
        saveRank(RANK);
      } catch (err) {}
    }
  });
})();