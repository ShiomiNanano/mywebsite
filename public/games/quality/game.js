/* ===================== 引擎 ===================== */
// 品质对决 · 引擎（纯逻辑，无 DOM）
// 规则依据：设计文档 v8.3 —— 十层结算流水线
//   ① 封印 ② 平局判定 ③ 点数修正 ④ 比较 ⑤ 改判 ⑥ 移动 ⑦ 冷却 ⑧ 重置 ⑨ 资源 ⑩ 判负收尾
// v2 变更：八张彩卡的特效全部上线；安全网 77 → 100（文档值）
//          补牌窗口仍为 13（32 张池、牌堆 26，26÷2=13，与文档 18÷2=9 同比例）

const TYPES = ['☕️', '🐋', '☀️', '🌙', '☘️', '༄', '🌈', '☂'];
const QUAL = { '普': 1, '金': 2, '彩': 3 };
const CDL = { '普': 0, '金': 1, '彩': 2 };
const QLIST = ['普', '金', '彩'];

// 八张彩卡的技能名：牌面角标与规则图鉴共用这一份，避免两处写岔
const SKILL = {
  '☕️': '白日梦特调', '🐋': '塔尔塔洛斯的瞥视', '☀️': '我仍会向前', '🌙': '༺弦月镰†终末断罪༺',
  '☘️': '最新爆点！！', '༄': '微风中的小憩', '🌈': '牵起晴空的手', '☂': '无染之泉'
};
// 牌面角标那一小条放不下长名，只放两三个字的短名（全名见技能弹层与横幅）
const SKILL_SHORT = { '☕️': '回手', '🐋': '封印', '☀️': '抽牌', '🌙': '弃牌', '☘️': '加点', '༄': '削点', '🌈': '平局', '☂': '重置' };
const SKILL_DESC = {
  '☕️': '另一张不是彩卡时，结算后无论胜负本卡都回到手上；另一张是彩卡则照常结算。',
  '🐋': '使对方本回合两张牌的特效全部失效。自身冷却随搭档：彩 4 / 金 3 / 普或空白 1 回合。',
  '☀️': '结算时从牌堆获得 1 张。【余晖】本卡在手且冷却中时，每打出 1 张同类型 ☀️ 普/金卡再抽 1 张，可叠加，不受封印影响。',
  '🌙': '结算时令对方弃置 1 张手牌；若因此对方无牌可出，直接判负。',
  '☘️': '另一张也是彩卡时，本回合总点数 +1，且自身冷却延长至 3 回合。',
  '༄': '另一张不是彩卡时，对方总点数 −1；若同为 ༄ 卡则 −2。',
  '🌈': '对方点数超过自己时改判为平局，双方本轮出牌各自回手（己方冷却 −1）。',
  '☂': '双方点数相同时锁定平局，双方弃置全部手牌并随机重抽等量，补牌额外延长 5 回合。'
};

const CONF = {
  cap: 9,
  cd: true,
  window: 13,
  stallN: 3,
  endCap: 100,
  perType: { '普': 2, '金': 1, '彩': 1 }
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

// 彩卡判定与"场上有没有某张彩卡"
const isCai = (c) => !!c && !c.blank && c.q === '彩';
const hasCai = (arr, type) => arr.some((c) => isCai(c) && c.type === type);
const partnerOf = (arr, c) => { for (const x of arr) if (x !== c) return x; return null; };

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
    // AI 思考用独立的随机流：采样不能消耗牌堆的随机数，
    // 否则「AI 想得多深」会改变后面抽到什么牌，对战结果没法复现也不好调参
    airy: makeRng((seed ^ 0x5bf03635) >>> 0),
    me: { hand: [makeBlank()] },
    ai: { hand: [makeBlank()] },
    round: 0, phase: 'select', slots: { me: [], ai: [] },
    logs: [], blocks: [], over: false, winner: null, reason: '', tieStreak: 0,
    hist: [],                      // 逐回合完整记录（不截断，只给「导出对局」用）
    t0: Date.now(),                // 开局时间
    seed: (seed >>> 0) || 1,       // 随机种子：同种子 = 同一副牌 + 同一套 AI 随机
    dealUntil: CONF.window,        // 补牌截止回合（☂ 会延长）
    pending: null,                 // 待玩家执行的强制弃置 { n, why }
    pstat: { n: 0, totSum: 0 },    // 玩家历史出牌（噩梦的对手模型输入）
    stats: { ties: 0, discards: 0, aiDiscards: 0, skills: {} }
  };
  for (let i = 0; i < 3; i++) { g.me.hand.push(deck.pop()); g.ai.hand.push(deck.pop()); }
  return g;
}

function endGame(g, winner, reason) {
  g.over = true; g.phase = 'over';
  g.winner = winner; g.reason = reason;
  return g;
}

function nextRound(g) {
  if (g.over) return g;
  if (g.round >= CONF.endCap) {
    const m = sumPts(specOf(g.me.hand)), a = sumPts(specOf(g.ai.hand));
    return endGame(g, m > a ? 'me' : a > m ? 'ai' : 'draw',
      '安全网：' + CONF.endCap + ' 回合后按手牌特殊牌总点数判定（' + m + ' : ' + a + '）');
  }
  g.round++;
  g.slots = { me: [], ai: [] };
  g.phase = 'select';
  g.pending = null;

  const inWin = g.round <= g.dealUntil;
  if (inWin) {
    if (g.deck.length > 0) g.me.hand.push(g.deck.pop());
    if (g.deck.length > 0) g.ai.hand.push(g.deck.pop());
  }

  const mp = playSpecials(g.me.hand, g.round), ap = playSpecials(g.ai.hand, g.round);
  if (mp === 0 || ap === 0) {
    if (mp === 0 && ap === 0) endGame(g, 'draw', '双方都只剩空白能出');
    else if (mp === 0) endGame(g, 'ai', '你只剩空白能出（其余在冷却或已被夺走）');
    else endGame(g, 'me', 'AI 只剩空白能出（其余在冷却或已被夺走）');
  }
  return g;
}

/* ---------- 弃置 ---------- */
// 把指定卡牌回牌堆（冷却清零）——上限弃置、月亮丢弃、☂ 之外的清空都走这里
function discardCards(g, side, cards) {
  const hand = side === 'me' ? g.me.hand : g.ai.hand;
  let n = 0;
  for (const c of cards) {
    const i = hand.indexOf(c);
    if (i < 0 || c.blank) continue;
    hand.splice(i, 1);
    c.cdUntil = undefined;
    g.deck.splice(Math.floor(g.rng() * (g.deck.length + 1)), 0, c);
    n++;
  }
  g.stats.discards += n;
  if (side === 'ai') g.stats.aiDiscards += n;
  return n;
}

// 自动弃置点数最低的若干张（AI 被 🌙 点名时用）
function autoDrop(g, side, n) {
  const hand = side === 'me' ? g.me.hand : g.ai.hand;
  const pick = specOf(hand).slice().sort((a, b) => a.pts - b.pts).slice(0, n);
  if (!pick.length) return [];
  discardCards(g, side, pick);
  return pick;
}

function overCount(g, side) {
  return Math.max(0, specOf(side === 'me' ? g.me.hand : g.ai.hand).length - CONF.cap);
}

// 弃置（超出上限的牌回牌堆、冷却清零）
function trimHand(g, side, indices) {
  const hand = side === 'me' ? g.me.hand : g.ai.hand;
  const over = overCount(g, side);
  if (over <= 0) return [];
  const removed = [];
  if (side === 'me') {
    for (const i of (indices || [])) { if (removed.length >= over) break; const c = hand[i]; if (c && !c.blank && removed.indexOf(c) < 0) removed.push(c); }
  } else {
    for (const c of specOf(hand).slice().sort((a, b) => a.pts - b.pts)) { if (removed.length >= over) break; removed.push(c); }
  }
  discardCards(g, side, removed);
  return removed;
}

// 当前要弃几张、为什么弃（'moon' = 被月亮点名，'cap' = 超出上限）
function discardNeed(g) {
  if (g.pending && g.pending.n > 0) return g.pending.n;
  return overCount(g, 'me');
}
function discardWhy(g) {
  return (g.pending && g.pending.n > 0) ? 'moon' : 'cap';
}

/* ---------- 十层结算流水线（文档 §4.2） ---------- */
// mine / theirs 是本回合双方打出的牌对象。返回结果与本次结算的事件（供播报栏）
function resolveRound(g, mine, theirs) {
  const R = g.round;
  const ev = [];
  // sk：给界面拉横幅用的事件表，按技能"真正生效"的顺序 push（层序即优先级）
  const sk = [];
  const fx = (side, type, name) => { sk.push({ side, type, name: name || SKILL[type] }); };
  const bump = (k) => { g.stats.skills[k] = (g.stats.skills[k] || 0) + 1; };
  const WHO = { me: '你', ai: '对方' };
  const cardTag = (c) => (c.blank ? '空白' : c.type + c.q + c.pts);

  mine.concat(theirs).forEach((c) => { c.seen = true; });
  const rawP = sumPts(mine), rawA = sumPts(theirs);
  g.pstat.n++; g.pstat.totSum += rawP;

  /* ① 封印：只取消特效，点数一分不动 */
  const sealedMe = hasCai(theirs, '🐋');
  const sealedAi = hasCai(mine, '🐋');
  if (sealedMe) { ev.push('🐋 对方的鲸鱼封印了你本回合的全部特效'); bump('sealGot'); fx('ai', '🐋'); }
  if (sealedAi) { ev.push('🐋 你的鲸鱼封印了对方本回合的全部特效'); bump('seal'); fx('me', '🐋'); }

  /* ② 平局判定：只看原始点数；☂ 在这一层被锁定 */
  let umb = false, umbBy = '';
  if (rawP === rawA) {
    if (!sealedMe && hasCai(mine, '☂')) { umb = true; umbBy = 'me'; }
    else if (!sealedAi && hasCai(theirs, '☂')) { umb = true; umbBy = 'ai'; }
  }

  /* ③ 点数修正（被封印则不加不减；冷却特例照常结算） */
  let pP = rawP, aP = rawA;
  const cdFix = new Map();
  const live = { me: !umb && !sealedMe, ai: !umb && !sealedAi };
  const PLAY = { me: mine, ai: theirs };

  // ☘️ 三叶草：搭档为彩卡 → 本回合 +1；自身冷却延长至 3（与是否生效无关）
  for (const side of ['me', 'ai']) {
    for (const c of PLAY[side]) {
      if (!isCai(c) || c.type !== '☘️') continue;
      const pc = partnerOf(PLAY[side], c);
      if (!pc || !isCai(pc)) continue;
      cdFix.set(c, 3);
      if (!live[side]) continue;
      if (side === 'me') pP += 1; else aP += 1;
      ev.push('☘️ ' + WHO[side] + '三叶草：与彩卡搭档，本回合 +1 点（自身冷却延长至 3）');
      bump('clover');
      fx(side, '☘️');
    }
  }
  // ༄ 风：搭档非彩卡 → 对方 −1；搭档同为风 → −2
  for (const side of ['me', 'ai']) {
    for (const c of PLAY[side]) {
      if (!isCai(c) || c.type !== '༄') continue;
      const pc = partnerOf(PLAY[side], c);
      if (!pc || isCai(pc)) continue;
      if (!live[side]) continue;
      const d = (!pc.blank && pc.type === '༄') ? 2 : 1;
      if (side === 'me') aP -= d; else pP -= d;
      ev.push('༄ ' + WHO[side] + '风：对方 −' + d + ' 点' + (d === 2 ? '（搭档同为风）' : ''));
      bump('wind');
      fx(side, '༄');
    }
  }
  // 🐋 鲸鱼自身冷却：搭档 彩 4 / 金 3 / 普或空白 1（与封印结果无关）
  for (const side of ['me', 'ai']) {
    for (const c of PLAY[side]) {
      if (!isCai(c) || c.type !== '🐋') continue;
      const pc = partnerOf(PLAY[side], c);
      if (!pc) continue;
      const m = Math.max(1, 2 + (isCai(pc) ? 2 : pc.q === '金' ? 1 : -1));
      cdFix.set(c, m);
      ev.push('🐋 ' + WHO[side] + '鲸鱼：搭档是' + (pc.blank ? '空白' : pc.q + '卡') + ' → 自身冷却 ' + m + ' 回合');
    }
  }

  /* ④ 比较 + ⑤ 改判 */
  let result;
  let cutMe = 0, cutAi = 0;
  if (umb) {
    result = 'tie';
  } else {
    result = pP > aP ? 'me' : pP < aP ? 'ai' : 'tie';
    if (result === 'ai' && live.me && hasCai(mine, '🌈')) {
      result = 'tie'; cutMe = 1;
      ev.push('🌈 你的彩虹：本回合点数落后 → 改判平局（你本回合出牌冷却 −1）');
      bump('rainbow');
      fx('me', '🌈');
    } else if (result === 'me' && live.ai && hasCai(theirs, '🌈')) {
      result = 'tie'; cutAi = 1;
      ev.push('🌈 对方的彩虹：本回合点数落后 → 改判平局（其出牌冷却 −1）');
      fx('ai', '🌈');
    }
  }

  /* ⑥ 卡牌移动（☕️ 回手在这一层覆盖"被夺取"） */
  const coffeeKeep = (arr) => {
    const c = arr.find((x) => isCai(x) && x.type === '☕️');
    if (!c) return null;
    const pc = partnerOf(arr, c);
    if (!pc || isCai(pc)) return null;      // 搭档为彩卡 → 不回手
    return c;
  };
  const keepMe = (result === 'ai' && !sealedMe) ? coffeeKeep(mine) : null;
  const keepAi = (result === 'me' && !sealedAi) ? coffeeKeep(theirs) : null;
  let loot = [];

  if (result === 'me') {
    loot = specOf(theirs).filter((c) => c !== keepAi);
    for (const c of mine) g.me.hand.push(c);
    for (const c of loot) g.me.hand.push(c);
    if (keepAi) { g.ai.hand.push(keepAi); ev.push('☕️ 对方的咖啡保住了，没被夺走'); fx('ai', '☕️'); }
    for (const c of theirs) if (c.blank) g.ai.hand.push(c);
    g.tieStreak = 0;
  } else if (result === 'ai') {
    loot = specOf(mine).filter((c) => c !== keepMe);
    for (const c of theirs) g.ai.hand.push(c);
    for (const c of loot) g.ai.hand.push(c);
    if (keepMe) { g.me.hand.push(keepMe); ev.push('☕️ 你的咖啡回手：本回合落败也没被夺走'); bump('coffee'); fx('me', '☕️'); }
    for (const c of mine) if (c.blank) g.me.hand.push(c);
    g.tieStreak = 0;
  } else {
    for (const c of mine) g.me.hand.push(c);
    for (const c of theirs) g.ai.hand.push(c);
  }

  /* ⑦ 冷却结算 */
  if (CONF.cd) {
    for (const c of mine) {
      if (c.blank) continue;
      const L = Math.max(0, (cdFix.has(c) ? cdFix.get(c) : c.cdL) - cutMe);
      c.cdUntil = L > 0 ? R + L : undefined;
    }
    for (const c of theirs) {
      if (c.blank) continue;
      const L = Math.max(0, (cdFix.has(c) ? cdFix.get(c) : c.cdL) - cutAi);
      c.cdUntil = L > 0 ? R + L : undefined;
    }
  }

  /* ⑧ ☂ 重置：清空双方特殊牌、按原张数重抽、补牌延长 */
  if (umb) {
    const snap = g.deck.slice();
    const back = [];
    const n1 = specOf(g.me.hand).length, n2 = specOf(g.ai.hand).length;
    for (const c of specOf(g.me.hand)) { g.me.hand = g.me.hand.filter((x) => x !== c); c.cdUntil = undefined; back.push(c); }
    for (const c of specOf(g.ai.hand)) { g.ai.hand = g.ai.hand.filter((x) => x !== c); c.cdUntil = undefined; back.push(c); }
    const take = (n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        let c = null;
        if (snap.length) c = snap.splice(Math.floor(g.rng() * snap.length), 1)[0];
        else if (back.length) c = back.splice(Math.floor(g.rng() * back.length), 1)[0];
        if (!c) break;
        out.push(c);
      }
      return out;
    };
    g.me.hand.push.apply(g.me.hand, take(n1));
    g.ai.hand.push.apply(g.ai.hand, take(n2));
    g.deck = snap.concat(back);
    g.dealUntil = Math.max(g.dealUntil, R + 5);
    ev.push('☂ ' + WHO[umbBy] + '的雨伞：双方原始点数相同 → 本回合锁定平局（不计连平），特殊牌全部重抽（你 ' + n1 + ' 张 / 对方 ' + n2 + ' 张，新牌无冷却），补牌延长至第 ' + g.dealUntil + ' 回合');
    bump('umbrella');
    fx(umbBy, '☂');
  }

  /* ⑨ 资源结算：☀️ 抽牌与余晖、🌙 强制弃置与刺杀 */
  for (const side of ['me', 'ai']) {
    const hand = side === 'me' ? g.me.hand : g.ai.hand;
    const sunMain = (live[side] && hasCai(PLAY[side], '☀️')) ? 1 : 0;
    // 余晖：彩太阳在手牌且冷却中，每打出 1 张同类普/金 再抽 1 张（不受封印影响）
    let glowN = 0;
    const sun = hand.find((c) => isCai(c) && c.type === '☀️' && PLAY[side].indexOf(c) < 0);
    if (sun && sun.cdUntil !== undefined && sun.cdUntil >= R) {
      glowN = PLAY[side].filter((c) => !c.blank && !isCai(c) && c.type === '☀️').length;
    }
    const n = sunMain + glowN;
    let got = 0;
    for (let i = 0; i < n; i++) { if (!g.deck.length) break; hand.push(g.deck.pop()); got++; }
    if (got > 0) {
      ev.push('☀️ ' + WHO[side] + '从牌堆抽了 ' + got + ' 张');
      bump('sun');
      const mainGot = sunMain ? 1 : 0;
      if (mainGot) fx(side, '☀️');
      const glowGot = Math.max(0, Math.min(glowN, got - mainGot));
      for (let i = 0; i < glowGot; i++) fx(side, '☀️', '余晖');
    }
  }

  let kill = null;
  if (live.me && hasCai(mine, '🌙')) {
    const drop = autoDrop(g, 'ai', 1);
    ev.push('🌙 你的月亮：' + (drop.length ? '对方弃置 ' + drop.map(cardTag).join('') + '（回牌堆）' : '对方已无特殊牌可弃'));
    bump('moon');
    if (playSpecials(g.ai.hand, R) === 0) kill = 'me';
    if (drop.length || kill === 'me') fx('me', '🌙');
  }
  if (live.ai && hasCai(theirs, '🌙')) {
    if (specOf(g.me.hand).length > 0) {
      g.pending = { n: 1, why: 'moon' };
      ev.push('🌙 对方的月亮：你必须弃置 1 张特殊牌（弃到再没有能出的牌就直接判负）');
      bump('moonGot');
      fx('ai', '🌙');
    } else {
      ev.push('🌙 对方的月亮：你已无特殊牌可弃');
    }
  }

  /* ⑩ 判负与收尾交给界面（要等玩家弃置完） */
  return { result, pP, aP, rawP, rawA, ev, sk, umb, kill, loot };
}

// ⑩ 收尾：手牌特殊牌被清空 → 立即判负（文档 3.3）
function tailCheck(g) {
  const ms = specOf(g.me.hand).length, as = specOf(g.ai.hand).length;
  if (ms === 0 || as === 0) {
    if (ms === 0 && as === 0) endGame(g, 'draw', '双方特殊牌同时被夺光');
    else if (ms === 0) endGame(g, 'ai', '你的特殊牌被夺光了');
    else endGame(g, 'me', 'AI 的特殊牌被夺光了');
    return true;
  }
  return false;
}

/* ===================== AI ===================== */
//  easy      : 50% 最小点数两张 / 50% 随机
//  normal    : 贪心（永远最大两张）
//  hard      : 影子解算器的小一号版本（采样少、候选少、会小失误）
//  nightmare : 影子解算器 + 三分支对手模型（文档 v8.3 §5 参数）

const LEVEL = {
  easy: { mode: 'easy' },
  normal: { mode: 'greedy' },
  hard: {
    mode: 'shadow', K: 8, maxc: 12, lateK: 12, lateMaxc: 14,
    wB: 0.45, wT: 0.10, wD: 0.45, eps: 0.08, miss: 0.06, lateSpec: 4, lateOpp: 2
  },
  // 噩梦：采样量与候选都拉满，且把对手模型压在"最强"这一支上（0.80）
  // 文档原来的 0.35/0.45/0.20 是照"人类平均水平"写的，对强玩家会自我稀释 ——
  // 实测改成 0.80/0.10/0.10 + K40 后，困难水平玩家的胜率从 45% 掉到 25%
  nightmare: {
    mode: 'shadow', K: 200, maxc: 36, lateK: 360, lateMaxc: 54,
    wB: 0.80, wT: 0.10, wD: 0.10, eps: 0.02, miss: 0, lateSpec: 4, lateOpp: 2
  }
};
// 价值函数权重（文档表 8-3）
const NMV = { card: 8.0, play: 0.5, pts: 0.1, col: 1.5 };

const pairsOf = (a) => { const r = []; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) r.push([a[i], a[j]]); return r; };

/* 影子解算器：不改动任何状态，只把一次结算推算出来（文档 §5.1）
   视角是"自己"：返回值里的 sXxx 是己方，oXxx 是对手 */
function simOutcome(g, selfHand, oppHand, mine, theirs) {
  const R = g.round;
  const sLeft = selfHand.filter((c) => mine.indexOf(c) < 0);
  const oLeft = oppHand.filter((c) => theirs.indexOf(c) < 0);
  const sealedSelf = hasCai(theirs, '🐋');
  const sealedOpp = hasCai(mine, '🐋');
  const rawS = sumPts(mine), rawO = sumPts(theirs);

  let umb = false;
  if (rawS === rawO) {
    if (!sealedSelf && hasCai(mine, '☂')) umb = true;
    else if (!sealedOpp && hasCai(theirs, '☂')) umb = true;
  }

  let sP = rawS, oP = rawO;
  const cdFix = new Map();
  if (!umb) {
    for (const c of mine) {
      if (sealedSelf || !isCai(c)) continue;
      const pc = partnerOf(mine, c);
      if (!pc) continue;
      if (c.type === '☘️' && isCai(pc)) { sP += 1; cdFix.set(c, 3); }
      if (c.type === '༄' && !isCai(pc)) oP -= ((!pc.blank && pc.type === '༄') ? 2 : 1);
    }
    for (const c of theirs) {
      if (sealedOpp || !isCai(c)) continue;
      const pc = partnerOf(theirs, c);
      if (!pc) continue;
      if (c.type === '☘️' && isCai(pc)) { oP += 1; cdFix.set(c, 3); }
      if (c.type === '༄' && !isCai(pc)) sP -= ((!pc.blank && pc.type === '༄') ? 2 : 1);
    }
  }
  for (const side of [mine, theirs]) {
    for (const c of side) {
      if (!isCai(c) || c.type !== '🐋') continue;
      const pc = partnerOf(side, c);
      if (!pc) continue;
      cdFix.set(c, Math.max(1, 2 + (isCai(pc) ? 2 : pc.q === '金' ? 1 : -1)));
    }
  }

  let res, cutS = 0, cutO = 0;
  if (umb) {
    res = 'tie';
  } else {
    res = sP > oP ? 'win' : sP < oP ? 'lose' : 'tie';
    if (res === 'lose' && !sealedSelf && hasCai(mine, '🌈')) { res = 'tie'; cutS = 1; }
    else if (res === 'win' && !sealedOpp && hasCai(theirs, '🌈')) { res = 'tie'; cutO = 1; }
  }

  const coffeeKeep = (arr) => {
    const c = arr.find((x) => isCai(x) && x.type === '☕️');
    if (!c) return null;
    const pc = partnerOf(arr, c);
    if (!pc || isCai(pc)) return null;
    return c;
  };
  const sKeep = (res === 'lose' && !sealedSelf) ? coffeeKeep(mine) : null;
  const oKeep = (res === 'win' && !sealedOpp) ? coffeeKeep(theirs) : null;

  let sF = sLeft.slice(), oF = oLeft.slice();
  if (res === 'win') {
    sF = sF.concat(mine, specOf(theirs).filter((c) => c !== oKeep));
    if (oKeep) oF.push(oKeep);
    oF = oF.concat(theirs.filter((c) => c.blank));
  } else if (res === 'lose') {
    oF = oF.concat(theirs, specOf(mine).filter((c) => c !== sKeep));
    if (sKeep) sF.push(sKeep);
    sF = sF.concat(mine.filter((c) => c.blank));
  } else {
    sF = sF.concat(mine); oF = oF.concat(theirs);
  }

  const cdMap = new Map();
  for (const c of mine) if (!c.blank) cdMap.set(c, Math.max(0, (cdFix.has(c) ? cdFix.get(c) : c.cdL) - cutS));
  for (const c of theirs) if (!c.blank) cdMap.set(c, Math.max(0, (cdFix.has(c) ? cdFix.get(c) : c.cdL) - cutO));
  const cdAt = (c) => {
    if (cdMap.has(c)) { const L = cdMap.get(c); return L > 0 ? R + L : -1; }
    return c.cdUntil === undefined ? -1 : c.cdUntil;
  };

  let deal = g.dealUntil;
  if (umb) deal = Math.max(deal, R + 5);

  const sunN = (play, hand, blocked) => {
    let n = blocked ? 0 : (hasCai(play, '☀️') ? 1 : 0);
    const s = hand.find((c) => isCai(c) && c.type === '☀️' && play.indexOf(c) < 0);
    if (s && cdAt(s) >= R) n += play.filter((c) => !c.blank && !isCai(c) && c.type === '☀️').length;
    return n;
  };
  const sD = sunN(mine, sF, sealedSelf), oD = sunN(theirs, oF, sealedOpp);

  let sSpec = specOf(sF).length, oSpec = specOf(oF).length;
  let sPl = sF.filter((c) => !c.blank && cdAt(c) < R + 1).length;
  let oPl = oF.filter((c) => !c.blank && cdAt(c) < R + 1).length;
  let sPts = sumPts(specOf(sF)), oPts = sumPts(specOf(oF));
  const sC = specOf(sF).filter(isCai).length, oC = specOf(oF).filter(isCai).length;
  sSpec += sD; sPl += sD; oSpec += oD; oPl += oD; sPts += sD * 1.5; oPts += oD * 1.5;

  let kill = null;
  if (!sealedSelf && hasCai(mine, '🌙') && oSpec > 0) {
    oSpec -= 1; oPl = Math.max(0, oPl - 1); oPts = Math.max(0, oPts - 1);
    if (oPl === 0) kill = 'self';
  }
  if (!sealedOpp && hasCai(theirs, '🌙') && sSpec > 0) {
    sSpec -= 1; sPl = Math.max(0, sPl - 1); sPts = Math.max(0, sPts - 1);
    if (sPl === 0) kill = 'opp';
  }
  sSpec = Math.min(sSpec, CONF.cap); oSpec = Math.min(oSpec, CONF.cap);
  sPl = Math.min(sPl, sSpec); oPl = Math.min(oPl, oSpec);

  return { res, sSpec, oSpec, sPl, oPl, sPts, oPts, sC, oC, deal, kill };
}

// 价值函数（文档表 8-3 / 5.2）
function nmValue(o, R) {
  if (o.kill === 'self') return 1e4;
  if (o.kill === 'opp') return -1e4;
  if (o.oSpec === 0) return 1e4;
  if (o.sSpec === 0) return -1e4;
  const wd = (R + 1) <= o.deal;
  let v = NMV.card * (o.sSpec - o.oSpec) + NMV.play * (o.sPl - o.oPl) + NMV.pts * (o.sPts - o.oPts) + NMV.col * (o.sC - o.oC);
  if (o.oPl === 0) v += (wd ? 2 : 400);
  if (o.sPl === 0) v -= (wd ? 4 : 400);
  return v;
}

// 影子解算器选牌：采样对手手牌 → 三分支（最强 / 贴近我方历史均值 / 最弱）→ 评分取最优
function shadowPick(g, side, cfg) {
  const R = g.round;
  const self = side === 'me' ? g.me : g.ai;
  const opp = side === 'me' ? g.ai : g.me;
  const late = specOf(self.hand).length <= cfg.lateSpec || playSpecials(opp.hand, R) <= cfg.lateOpp;
  const K = late ? cfg.lateK : cfg.K;
  const MAXC = late ? cfg.lateMaxc : cfg.maxc;

  let cand = pairsOf(playIdx(self.hand, R));
  if (!cand.length) return [];
  const sumOf = (p) => self.hand[p[0]].pts + self.hand[p[1]].pts;
  if (cand.length > MAXC) {
    const s = cand.slice().sort((a, b) => sumOf(b) - sumOf(a));
    const h = Math.max(1, Math.floor(MAXC / 2));
    cand = s.slice(0, h).concat(s.slice(s.length - h));
  }

  const selfIds = new Set(self.hand.map((c) => c.id));
  const pool = g.master.filter((c) => !selfIds.has(c.id) && !c.seen);
  const known = g.master.filter((c) => c.seen && !selfIds.has(c.id));
  const need = Math.max(0, specOf(opp.hand).length - known.length);
  const hm = g.pstat.n > 0 ? g.pstat.totSum / g.pstat.n : 3.0;   // 我方历史出牌均值（对手模型）

  const dist = [];
  for (let k = 0; k < K; k++) {
    const pool2 = pool.slice();
    const pick = [];
    for (let i = 0; i < need && pool2.length; i++) {
      const j = i + Math.floor(g.airy() * (pool2.length - i));
      const t = pool2[i]; pool2[i] = pool2[j]; pool2[j] = t; pick.push(pool2[i]);
    }
    const hand = known.concat(pick).concat([makeBlank()]);
    const idx = playIdx(hand, R);
    if (idx.length < 2) continue;
    const cs = pairsOf(idx).map((p) => ({ pts: hand[p[0]].pts + hand[p[1]].pts, pl: [hand[p[0]], hand[p[1]]] }))
      .sort((a, b) => b.pts - a.pts);
    const near = cs.reduce((a, b) => (Math.abs(b.pts - hm) < Math.abs(a.pts - hm) ? b : a));
    if (cfg.wB > 0) dist.push({ hand, play: cs[0].pl, w: cfg.wB / K });
    if (cfg.wT > 0) dist.push({ hand, play: near.pl, w: cfg.wT / K });
    if (cfg.wD > 0) dist.push({ hand, play: cs[cs.length - 1].pl, w: cfg.wD / K });
  }
  if (!dist.length) return cand[0];

  const vals = [];
  let bv = -Infinity, best = cand[0];
  for (const p of cand) {
    const myPlay = [self.hand[p[0]], self.hand[p[1]]];
    let v = 0;
    for (const d of dist) v += d.w * nmValue(simOutcome(g, self.hand, d.hand, myPlay, d.play), R);
    vals.push([p, v]);
    if (v > bv) { bv = v; best = p; }
  }

  if (cfg.miss && g.airy() < cfg.miss) {
    const near = vals.slice().sort((a, b) => b[1] - a[1]).slice(1, 4);
    if (near.length) return near[Math.floor(g.airy() * near.length)][0];
  }
  // eps：与最优"视为等价"时，优先少花彩卡（把最强的牌留到后面）
  const tol = Math.abs(bv) * (cfg.eps || 0);
  if (tol > 0) {
    const caiCount = (p) => (isCai(self.hand[p[0]]) ? 1 : 0) + (isCai(self.hand[p[1]]) ? 1 : 0);
    const tied = vals.filter((x) => bv - x[1] <= tol);
    if (tied.length > 1) {
      tied.sort((a, b) => caiCount(a[0]) - caiCount(b[0]) || b[1] - a[1]);
      return tied[0][0];
    }
  }
  return best;
}

function pickPairs(g, side, difficulty) {
  const cfg = LEVEL[difficulty] || LEVEL.normal;
  const me = side === 'me' ? g.me : g.ai;
  const idx = playIdx(me.hand, g.round);
  const pairs = pairsOf(idx);
  if (!pairs.length) return [];
  const sum = (p) => me.hand[p[0]].pts + me.hand[p[1]].pts;

  if (cfg.mode === 'shadow') {
    const p = shadowPick(g, side, cfg);
    if (p && p.length) return p;
  }

  if (cfg.mode === 'easy') {
    if (g.airy() < 0.5) {
      let b = pairs[0], bv = 1e9;
      for (const p of pairs) { const v = sum(p); if (v < bv) { bv = v; b = p; } }
      return b;
    }
    return pairs[Math.floor(g.airy() * pairs.length)];
  }

  const bySum = pairs.slice().sort((a, b) => sum(b) - sum(a));
  return bySum[0];
}





/* ===================== 界面 ===================== */


const $ = (id) => document.getElementById(id);
const QC = { '普': 'var(--普)', '金': 'var(--金)', '彩': 'var(--彩)' };
let g = null, sel = [], phase = 'ready', STARTED = false, msg = '', miss = 0;

/* ===================== 音效 ===================== */
// 全部用 WebAudio 现场合成：不下载音频文件、不占带宽、不用管 CSP 的 media-src。
// 音量压得很低（master 0.35），只做"纸牌 + 木质"底子，不做旋律性花活。
const SFX = { ctx: null, master: null, noise: null, on: true };
const SFX_KEY = 'qc_sound';

function sfxLoad() {
  try { if (localStorage.getItem(SFX_KEY) === '0') SFX.on = false; } catch (e) { /* 隐私模式下读不到就算了 */ }
}
function sfxSave() {
  try { localStorage.setItem(SFX_KEY, SFX.on ? '1' : '0'); } catch (e) { /* 同上 */ }
}

function sfxCtx() {
  if (SFX.ctx) return SFX.ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    SFX.ctx = new AC();
    SFX.master = SFX.ctx.createGain();
    SFX.master.gain.value = 0.35;
    const lp = SFX.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;          // 把高频削掉，听起来"闷"一点，符合丝绒桌面
    SFX.master.connect(lp);
    lp.connect(SFX.ctx.destination);
  } catch (e) { SFX.ctx = null; }
  return SFX.ctx;
}

// 0.5 秒白噪声只生成一次，所有"纸牌摩擦"共用
function sfxNoise(c) {
  if (SFX.noise) return SFX.noise;
  const len = Math.floor(c.sampleRate * 0.5);
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  SFX.noise = b;
  return b;
}

function sfxTone(c, f, dur, type, gain, at, glide) {
  const o = c.createOscillator(), gn = c.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(f, at);
  if (glide && glide !== f) o.frequency.exponentialRampToValueAtTime(glide, at + dur * 0.9);
  gn.gain.setValueAtTime(0.0001, at);
  gn.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.02, dur * 0.3));
  gn.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(gn); gn.connect(SFX.master);
  o.start(at); o.stop(at + dur + 0.03);
}

function sfxNoiseHit(c, dur, gain, freq, q, at) {
  const src = c.createBufferSource(), bp = c.createBiquadFilter(), gn = c.createGain();
  src.buffer = sfxNoise(c);
  bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q || 1;
  gn.gain.setValueAtTime(gain, at);
  gn.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(bp); bp.connect(gn); gn.connect(SFX.master);
  src.start(at); src.stop(at + dur + 0.03);
}

// pick 选牌 · deal 放牌/弃牌 · reveal 翻牌 · skill 特效触发 · win/lose/tie 结算
function sfx(name) {
  if (!SFX.on) return;
  const c = sfxCtx();
  if (!c) return;
  if (c.state === 'suspended') { try { c.resume(); } catch (e) { /* 部分浏览器要求手势后再 resume */ } }
  const t = c.currentTime + 0.001;
  if (name === 'pick') {
    sfxNoiseHit(c, 0.045, 0.10, 3200, 1.6, t);
  } else if (name === 'deal') {
    sfxNoiseHit(c, 0.15, 0.30, 1500, 0.7, t);
    sfxTone(c, 300, 0.11, 'sine', 0.05, t, 220);
  } else if (name === 'reveal') {
    sfxNoiseHit(c, 0.05, 0.20, 2400, 1.8, t);
    sfxTone(c, 700, 0.09, 'triangle', 0.05, t + 0.015, 900);
  } else if (name === 'skill') {
    sfxTone(c, 659.25, 0.5, 'sine', 0.11, t);
    sfxTone(c, 987.77, 0.38, 'sine', 0.045, t + 0.04);
  } else if (name === 'win') {
    [523.25, 659.25, 783.99].forEach((f, i) => sfxTone(c, f, 0.7, 'triangle', 0.12, t + i * 0.11));
  } else if (name === 'lose') {
    sfxTone(c, 311.13, 0.55, 'sine', 0.12, t, 259.66);
    sfxTone(c, 207.65, 0.75, 'sine', 0.06, t + 0.12);
  } else if (name === 'tie') {
    sfxTone(c, 392, 0.45, 'sine', 0.09, t);
  }
}

// ===== 段位（本地存储；接站点时换成服务端）=====
// 七段：分数越高对手越强。0~499 简单，500~1999 普通，2000~4199 困难，4200 起噩梦。
const TIERS = [
  { name: '浅眠初客',     min: 0,    ai: 'easy' },
  { name: '云游熟客',     min: 500,  ai: 'normal' },
  { name: '半醒学徒',     min: 1200, ai: 'normal' },
  { name: '梦游咖啡师',   min: 2000, ai: 'hard' },
  { name: '日光调梦师',   min: 3000, ai: 'hard' },
  { name: '清醒造梦官',   min: 4200, ai: 'nightmare' },
  { name: '白日梦掌梦人', min: 6000, ai: 'nightmare' }
];
const loadRank = () => {
  try { return JSON.parse(localStorage.getItem('qc_rank') || 'null') || { rating: 0, wins: 0, losses: 0 }; }
  catch (e) { return { rating: 0, wins: 0, losses: 0 }; }
};
const saveRank = (r) => { try { localStorage.setItem('qc_rank', JSON.stringify(r)); } catch (e) {} };
const tierOf = (rating) => { let t = TIERS[0]; for (const x of TIERS) if (rating >= x.min) t = x; return t; };
let RANK = loadRank();
if (typeof RANK.streak !== 'number') RANK.streak = 0;
if (typeof RANK.omen !== 'number') RANK.omen = 0;

// ===== 连胜与「噩梦彩蛋」 =====
// 三连胜起，下一局有概率被噩梦盯上：低段位玩家也会撞上最强的对手。
// 不想打 —— 开牌前刷新页面、或按「重开」，就能把它刷掉；代价是连胜中断。
// 本来就在打噩梦的段位（清醒造梦官 / 白日梦掌梦人）不触发，机制不变。
const omenChance = (n) => (n >= 5 ? 0.45 : n === 4 ? 0.30 : n === 3 ? 0.20 : 0);
const HAUNT_BONUS = 30;      // 低段位打赢被盯上的那局，额外加分

// 连胜奖励：到 3 连胜起，每赢一局额外 +3×连胜数（3 连胜 +9、4 连胜 +12…）；连胜中断就归零
const STREAK_FROM = 3;
const streakBonusOf = (n) => (n >= STREAK_FROM ? 3 * n : 0);

// 结算里那行「（含 …）」：把附加奖励拼出来，没有附加就返回空串
function bonusTxt(omen, streak) {
  const parts = [];
  if (omen) parts.push('噩梦加成 +' + omen);
  if (streak) parts.push('连胜奖励 +' + streak);
  return parts.length ? '（含 ' + parts.join('、') + '）' : '';
}

function paintRank() {
  const t = tierOf(RANK.rating);
  const el = document.getElementById('rankName');
  el.textContent = t.name;
  // 牌匾按段位换色：把段位序号写到外层，CSS 用 [data-tier] 取色
  const box = el.parentNode;
  const idx = String(TIERS.indexOf(t));
  if (box && box.dataset) box.dataset.tier = idx;
  else if (box && box.setAttribute) box.setAttribute('data-tier', idx);
  document.getElementById('rankScore').textContent = RANK.rating + ' 分'
    + (RANK.streak >= 2 ? ' · ' + RANK.streak + ' 连胜' : '');
}

// ===== 段位同步：登录了就存在云端（跨设备），没登录就只存这台设备 =====
// 服务端才是权威：POST 回来的是「绝对 rating」而不是增量，所以直接采用不会重复累加。
const SYNC = { online: false, guest: false, note: '' };
const escT = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 播报里的一个回合块：R11 / 我方 / 对方 / 触发 / 结果，一行一件事
function roundBlockHtml(b) {
  const rt = b.res === 'me' ? '你赢' : b.res === 'ai' ? '你输' : '平局';
  return '<div class="rb">'
    + '<div class="rb-h">R' + b.r + '</div>'
    + '<div class="rb-l"><i>我方</i><span>' + escT(b.m) + '</span><em>' + b.mp + '</em></div>'
    + '<div class="rb-l"><i>对方</i><span>' + escT(b.t) + '</span><em>' + b.tp + '</em></div>'
    + (b.fx && b.fx.length ? '<div class="rb-fx">' + escT(b.fx.join('　')) + '</div>' : '')
    + '<div class="rb-res ' + b.res + '">' + rt + '</div>'
    + '</div>';
}

// 技能横幅：文字按事件表顺序排（层序即优先级），同一回合的多条竖着一起拉出来
function skillFxRows(list) {
  return (list || []).map((x) =>
    '<div class="fx-row" data-t="' + x.type + '"><span class="fx-ico">' + x.type +
    '</span><span class="fx-name">' + escT(x.name) + '</span></div>').join('');
}

const FX_TIMERS = [];
function clearFx() {
  while (FX_TIMERS.length) clearTimeout(FX_TIMERS.shift());
  const box = $('skillFx');
  if (box) box.innerHTML = '';
}

// 拉出来 → 停一小会儿 → 收回去
function paintSkillFx(list) {
  clearFx();
  const box = $('skillFx');
  if (!box || !list || !list.length) return;
  box.innerHTML = skillFxRows(list);
  const rows = Array.prototype.slice.call(box.querySelectorAll ? box.querySelectorAll('.fx-row') : []);
  requestAnimationFrame(() => { rows.forEach((r) => r.classList.add('in')); });
  FX_TIMERS.push(setTimeout(() => { rows.forEach((r) => r.classList.remove('in')); }, 1900));
  FX_TIMERS.push(setTimeout(() => { if (box) box.innerHTML = ''; }, 2500));
}

function paintSync(note) {
  const el = $('rankSync');
  if (!el) return;
  el.textContent = SYNC.online ? '已同步到云端' : (note || SYNC.note || '本地段位 · 登录后可上榜');
  el.style.color = SYNC.online ? 'var(--gold, #d9b76a)' : 'var(--ink3, #6d8496)';
}

// 读服务端段位；未登录（401）就安静地留在本地模式
async function loadRemoteRank() {
  try {
    const r = await fetch('/api/games/rank', { credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 401) { SYNC.online = false; SYNC.guest = true; SYNC.note = ''; paintSync(); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    RANK = Object.assign({}, RANK, { rating: j.rating | 0, wins: j.wins | 0, losses: j.losses | 0 });
    saveRank(RANK); paintRank();
    SYNC.online = true; SYNC.guest = false; paintSync();
  } catch (e) {
    SYNC.online = false; SYNC.note = '云端没连上 · 先记本机'; paintSync();
  }
}

// 交一局结果给服务端；进来先把本地算的分显示出来，服务端回来再以服务端为准
async function pushResult(result, rounds, oppPts, haunt) {
  // 已经确认是游客（401 过）就不再每局白发一次请求
  if (SYNC.guest) return;
  try {
    const r = await fetch('/api/games/rank', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ game: 'quality', result: result, rounds: rounds | 0, oppPts: oppPts | 0, haunt: !!haunt })
    });
    if (r.status === 401) { SYNC.online = false; SYNC.guest = true; paintSync(); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    RANK = Object.assign({}, RANK, {
      rating: j.rating | 0, wins: j.wins | 0, losses: j.losses | 0,
      streak: typeof j.streak === 'number' ? j.streak : RANK.streak
    });
    saveRank(RANK); paintRank();
    SYNC.online = true; SYNC.guest = false; paintSync();
    const box = $('ovRank');
    if (box && g && g.over) {
      const b = j.bonus || {};
      const d = typeof j.delta === 'number' ? j.delta : (j.rating | 0) - (RANK.rating | 0);
      box.textContent = (d >= 0 ? '+' + d : String(d)) + ' 分'
        + bonusTxt(b.omen | 0, b.streak | 0) + ' · ' + tierOf(RANK.rating).name;
    }
  } catch (e) {
    SYNC.online = false; SYNC.note = '云端没连上 · 先记本机'; paintSync();
  }
}

// 中途放弃：尽量用 sendBeacon（页面正在关闭时 fetch 会被掐断）
function pushAbandon() {
  if (!g || SYNC.guest) return;
  const oppPts = specOf(g.ai.hand).reduce((s, c) => s + c.pts, 0);
  const body = JSON.stringify({ game: 'quality', result: 'abandon', rounds: g.round | 0, oppPts: oppPts | 0 });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/games/rank', new Blob([body], { type: 'application/json' }));
      return;
    }
  } catch (e) { /* 退回到 fetch */ }
  pushResult('abandon', g.round, oppPts);
}

// 段位变化：赢 = 钳 5~50 的 (1000 − 回合×8 − 对手剩余点数×3 − 400) / 12；输 = −18；下限 0
function applyRank(result) {
  const before = RANK.rating;
  const beforeTier = tierOf(before).name;
  const lowTier = tierOf(before).ai !== 'nightmare';   // 本来就不打噩梦的段位
  let delta = 0;
  let omenBonus = 0;
  let streakBonus = 0;
  if (result === 'me') {
    const oppPts = specOf(g.ai.hand).reduce((s, c) => s + c.pts, 0);
    // 原始值 = 1000 − 回合×8 − 对手剩余点数×3；减去基线 400 再除 12，钳 5~50
    const raw = 1000 - g.round * 8 - oppPts * 3;
    delta = Math.max(5, Math.min(50, Math.round((raw - 400) / 12)));
    // 彩蛋：低段位打赢被噩梦盯上的那局 → 额外加分
    if (g.haunt && lowTier) { omenBonus = HAUNT_BONUS; delta += omenBonus; }
    RANK.streak = (RANK.streak || 0) + 1;
    // 连胜奖励：3 连胜起，每赢一局额外 +3×连胜数（3 连胜 +9、4 连胜 +12…）
    streakBonus = streakBonusOf(RANK.streak);
    delta += streakBonus;
    RANK.rating += delta; RANK.wins++;
    // 连胜够了就摇一次：这一局赢完之后，下一局会不会被盯上
    if (lowTier && document.getElementById('diff').value === 'auto' && Math.random() < omenChance(RANK.streak)) {
      RANK.omen = 1;
    }
  } else if (result === 'ai') {
    delta = -18;
    RANK.rating = Math.max(0, RANK.rating - 18); RANK.losses++;
    RANK.streak = 0;
  } else {
    RANK.streak = 0;     // 平局也算连胜中断
  }
  saveRank(RANK); paintRank();
  // 这一局到底加/减了多少（导出记录要用：不能拿"服务端同步回来的绝对值"当基准）
  g.rankBefore = before; g.rankDelta = delta; g.rankAfter = RANK.rating;
  const afterTier = tierOf(RANK.rating).name;
  const upTxt = afterTier !== beforeTier ? '　→ ' + afterTier + ' · 对手变强了' : '';
  const box = document.getElementById('ovRank');
  box.textContent = (delta >= 0 ? '+' + delta : String(delta)) + ' 分' + bonusTxt(omenBonus, streakBonus) + upTxt;
  // 本地先算（弹层立刻有数），再把这局交给服务端；服务端回来的绝对值会覆盖上面的显示
  if (result === 'me') {
    pushResult('win', g.round, specOf(g.ai.hand).reduce((s, c) => s + c.pts, 0), !!g.haunt && lowTier);
  } else if (result === 'ai') {
    pushResult('loss', g.round, 0);
  }
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
    t: '八张彩卡各有绝招',
    b: '彩卡不只是 3 点 —— 每张还带一个特效，<b>牌底写着技能名</b>（下方「规则速查」里有完整图鉴）：<br><br>🐋 封印 · ☂ 重置 · ☘️ 加持 · ༄ 削弱 · 🌈 改判 · ☕️ 回手 · ☀️ 抽牌 · 🌙 弃置<br><br>特效按固定顺序结算，<b>播报栏会逐条写明</b>这一回合到底发生了什么。'
  },
  {
    t: '怎么赢',
    b: '① <b>轮到你的回合，你却只剩空白能出</b> → 你输（这是最主要的败因）。<br>② 你的特殊牌被全部夺走 → 你输。<br>③ 被 🌙 弃到没有能出的特殊牌 → 直接被刺杀。<br><br>手牌上限 9 张，超出要弃置（弃掉的牌会回到牌堆，可能再被抽到）。<br>前 13 回合每回合补 1 张，满 100 回合按手牌点数判定。'
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
  if (g && g.haunt) return 'nightmare';       // 彩蛋：这一局被噩梦盯上了
  const v = document.getElementById('diff').value;
  return v === 'auto' ? tierOf(RANK.rating).ai : v;
}
const diff = () => $('diff').value;

function start() {
  clearFx();
  const haunt = !!RANK.omen;      // 上一局赢下来的"被盯上"，在这一局兑现
  RANK.omen = 0;
  saveRank(RANK);
  g = newGame(Date.now() & 0x7fffffff);
  if (haunt) g.haunt = true;
  g.level = aiLevel();             // 本局实际难度（导出记录里要写清楚）
  g.ratingBefore = RANK.rating;
  g.tierBefore = tierOf(RANK.rating).name;
  closeLog();
  sel = []; phase = 'select'; msg = ''; miss = 0;
  nextRound(g);
  if (g.over) phase = 'over';
  // 进入时手牌盖着（只给牌背），点「开始对局」才翻开 → 防止刷好开局
  phase = 'ready'; STARTED = false;
  paintRank();
  render();
}

function cdOf(c) { return c.blank ? 0 : c.cdL; }

// 弃置时自动预选点数最低的牌（玩家可以点掉重选）—— 粗模里的手感
function autoLowest(g) {
  const need = discardNeed(g);
  if (need <= 0) return [];
  return g.me.hand.map((c, i) => i)
    .filter((i) => !g.me.hand[i].blank)
    .sort((a, b) => g.me.hand[a].pts - g.me.hand[b].pts)
    .slice(0, need);
}
function faceHtml(c, round, picked) {
  const cold = !c.blank && !isPlayable(c, round);
  const qc = c.blank ? '#4a5266' : QC[c.q];
  const qClass = c.blank ? ' q-blank' : (c.q === '普' ? ' q-pu' : c.q === '金' ? ' q-jin' : ' q-cai');
  return '<div class="card' + qClass + (cold ? ' cold' : '') + (picked ? ' pick' : '')
    + '" data-id="' + c.id + '" style="--var-qc:' + qc + '">'
    + (cold ? '<u class="c">❄' + cdLeft(c, round) + '</u>' : '')
    + '<b>' + (c.blank ? '·' : c.type) + '</b><i>' + c.q + ' ' + c.pts + '点</i>'
    + (c.q === '彩' ? '<em class="sk">' + SKILL_SHORT[c.type] + '</em>' : '') + '</div>';
}
const backHtml = () => '<div class="bk">✦</div>';

// 选中彩卡时，浮出这张卡的技能说明（纯展示，不影响结算）
function paintSkillPop() {
  const pop = document.getElementById('skillPop');
  if (!pop) return;
  const picked = [];
  for (const i of sel) {
    const c = g && g.me.hand[i];
    if (!c || c.blank || c.q !== '彩') continue;
    if (!picked.some((x) => x.id === c.id)) picked.push(c);
  }
  if (!picked.length || phase === 'ready' || phase === 'over') {
    pop.className = 'skill-pop';
    pop.innerHTML = '';
    return;
  }
  pop.innerHTML = picked.map((c) => '<div class="sp-row"><b>' + c.type + ' ' + (SKILL[c.type] || '彩卡')
    + '</b><span>' + (SKILL_DESC[c.type] || '') + '</span></div>').join('');
  pop.className = 'skill-pop on';
  // 横向对齐到选中的那张牌（拿不到布局信息时就贴左边）
  try {
    const el = document.querySelector('#meHand .card.pick.q-cai, #meBlank .card.pick.q-cai');
    const box = pop.parentElement;
    if (el && box && el.getBoundingClientRect && box.getBoundingClientRect && pop.getBoundingClientRect) {
      const r = el.getBoundingClientRect(), br = box.getBoundingClientRect(), pr = pop.getBoundingClientRect();
      const center = r.left - br.left + r.width / 2;
      const left = Math.max(8, Math.min(br.width - pr.width - 8, center - pr.width / 2));
      pop.style.left = Math.round(left) + 'px';
    } else {
      pop.style.left = '8px';
    }
  } catch (e) {
    pop.style.left = '8px';
  }
}

function render() {
  const r = g.round;
  // 噩梦局把牌桌描红边（暗指危险）；换难度 / 换局都会重算
  document.documentElement.classList.toggle('hard', aiLevel() === 'nightmare');
  // 对手
  const aiSpec = specOf(g.ai.hand);
  const aiCold = aiSpec.filter((c) => !isPlayable(c, r)).length;
  $('oppLbl').textContent = '对手 · 手牌 ' + g.ai.hand.length + ' 张' + (aiCold ? '（其中 ' + aiCold + ' 张冷却中）' : '')
    + (g.haunt ? '　·　？？？' : '');
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
    const face = '<b style="font-size:20px">' + (c.blank ? '·' : c.type) + '</b><span style="font-size:10px">'
      + c.q + c.pts + '点</span>';
    // 翻牌阶段：牌背先落桌，再 3D 翻转露出正面（双方同时起步、同一时长，节奏才一致）
    const qcls = c.blank ? 'q-blank' : (c.q === '普' ? 'q-pu' : c.q === '金' ? 'q-jin' : 'q-cai');
    if (phase === 'reveal') {
      return '<div class="slot on face flip ' + qcls + '">'
        + '<div class="fi" style="animation-delay:0ms">'
        + '<div class="fb">✦</div><div class="ff">' + face + '</div></div></div>';
    }
    return '<div class="slot on face ' + qcls + '">' + face + '</div>';
  };
  const shown = (arr) => (arr && arr.length ? arr : [null, null]);
  $('aiSlots').innerHTML = shown(g.slots.ai).map((c) => slot(c, false)).join('');
  $('meSlots').innerHTML = shown(g.slots.me).map((c) => slot(c, true)).join('');

  $('mid').innerHTML = '第 <b>' + r + '</b> 回合 · 牌堆 <b>' + g.deck.length + '</b> 张 · 补牌还剩 <b>'
    + Math.max(0, g.dealUntil - r + 1) + '</b> 回合'
    + (() => {
      if (!document.documentElement.classList.contains('dev-mode')) return '';
      const v = $('diff').value;
      if (v === 'auto') return '';
      const NAME = { easy: '简单', normal: '普通', hard: '困难', nightmare: '噩梦' };
      return '　·　对手：<b>' + (NAME[v] || v) + '</b>';
    })();

  // 手牌
  // 特殊牌与空白牌分两处渲染：空白常驻、占位用，不占上限、不可弃置
  const specials = g.me.hand.map((c, i) => [c, i]).filter((p) => !p[0].blank);
  const blanks = g.me.hand.map((c, i) => [c, i]).filter((p) => p[0].blank);
  if (phase === 'ready') {
    $('meHand').innerHTML = specials.map(() => '<div class="card bk-card"><b>✦</b></div>').join('');
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
    else if (phase === 'discard') {
      const dn = discardNeed(g), dw = discardWhy(g);
      banner = dw === 'moon'
        ? '<b>🌙 对方的月亮：</b>请点选 <b>' + dn + '</b> 张弃置（回牌堆）'
        : '<b>手牌超出上限：</b>请点选 <b>' + dn + '</b> 张弃置（回牌堆）';
      banner += '<br><span style="color:var(--ink3);font-size:11px">已自动选中点数最低的 ' + dn + ' 张，点一下即可取消</span>';
    }
    else banner = '点选两张可出的牌 → 盖牌 → 声明准备。❄ = 冷却中，出不了。';
  }
  const BLOCK_HTML = (g.blocks || []).map(roundBlockHtml).join('');
  $('banner').innerHTML = '<span class="bulletin-hint">本局播报</span>' + banner
    + (BLOCK_HTML ? '<div class="rb-list">' + BLOCK_HTML + '</div>' : '');

  paintPrimary();

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
    if (!g._ranked) {
      g._ranked = true;
      applyRank(g.winner);
      sfx(g.winner === 'me' ? 'win' : g.winner === 'ai' ? 'lose' : 'tie');
    }
    g.logs = [];   // 局末清空播报
    t.textContent = g.winner === 'me' ? '你赢了 🎉' : g.winner === 'ai' ? '你输了' : '平局';
    t.className = g.winner === 'me' ? 'win' : g.winner === 'ai' ? 'lose' : 'tie';
    rs.textContent = g.reason + '　·　共 ' + g.round + ' 回合';
    const om = document.getElementById('ovOmen');
    if (om) {
      om.textContent = RANK.omen ? '……有什么东西正朝这边过来。下一局，它不会留手。' : '';
      om.className = 'ov-omen' + (RANK.omen ? ' on' : '');
    }
    ov.classList.add('on');
  } else {
    ov.classList.remove('on');
  }

  paintSkillPop();
}

// 主按钮的文案与可用状态（选牌时会单独调用它，避免整页重画）
function paintPrimary() {
  const btn = $('primary');
  btn.disabled = true;
  btn.classList.toggle('danger', phase === 'discard');   // 弃置时按钮变红
  if (phase === 'ready') { btn.textContent = '开始对局'; btn.disabled = false; }
  else if (phase === 'select') { btn.textContent = '盖牌并声明准备'; btn.disabled = sel.length !== 2; }
  else if (phase === 'discard') { const dn = discardNeed(g); btn.textContent = '确认弃置 (' + sel.length + '/' + dn + ')'; btn.disabled = sel.length !== dn; }
  else if (phase === 'over') { btn.textContent = '再来一局'; btn.disabled = false; }
  else { btn.textContent = '翻牌中…'; }
}

// 选牌时只切 class，不重建 DOM —— 这样 .card 的 transform 过渡才能真正播出来
function paintSelection() {
  const picked = new Set(sel.map((i) => (g.me.hand[i] || {}).id));
  const nodes = document.querySelectorAll('#meHand .card, #meBlank .card');
  for (const el of nodes) {
    const on = picked.has(el.getAttribute('data-id'));
    if (el.classList.contains('pick') !== on) el.classList.toggle('pick', on);
  }
  paintPrimary();
  paintSkillPop();
}

function onPick(id) {
  if (phase !== 'select' && phase !== 'discard') return;
  const i = g.me.hand.findIndex((c) => c.id === id);
  if (i < 0) return;
  const k = sel.indexOf(i);
  if (k >= 0) { sel.splice(k, 1); return paintSelection(); }
  const max = phase === 'discard' ? discardNeed(g) : 2;
  if (sel.length >= max) {
    if (phase !== 'discard') return;
    sel.shift();            // 弃置阶段选满了：再点一张就换掉最早选的
  }
  if (phase === 'select' && !isPlayable(g.me.hand[i], g.round)) return;
  // 空白牌不可弃置（文档 1.2）：弃置阶段点它直接忽略
  if (phase === 'discard' && g.me.hand[i].blank) return;
  sel.push(i);
  sfx('pick');
  paintSelection();
}

function primary() {
  if (phase === 'ready') { phase = 'select'; STARTED = true; sel = []; render(); return; }
  if (phase === 'over') return start();
  if (phase === 'select' && sel.length === 2) return playPair();
  if (phase === 'discard' && sel.length === discardNeed(g)) {
    const cards = sel.map((i) => g.me.hand[i]).filter((c) => c && !c.blank);
    discardCards(g, 'me', cards);
    const lh2 = lastHist(g);
    if (lh2) lh2.dropMe = cards.map(cTxt);
    g.pending = null;
    sfx('deal');
    sel = [];
    if (tailCheck(g)) { phase = 'over'; return render(); }
    phase = 'select'; msg = '';
    nextRound(g);
    if (g.over) phase = 'over';
    return render();
  }
}

function playPair() {
  const mine = sel.map((i) => g.me.hand[i]);
  if (mine.some((c) => !isPlayable(c, g.round))) return;
  // 出手前的现场（用于对局记录）
  const snap = {
    handMe: g.me.hand.slice(), handAi: g.ai.hand.slice(),
    deckB: g.deck.length,
    coldMe: specOf(g.me.hand).filter((c) => !isPlayable(c, g.round)).length,
    coldAi: specOf(g.ai.hand).filter((c) => !isPlayable(c, g.round)).length
  };
  const ap = pickPairs(g, 'ai', aiLevel());
  const theirs = ap.map((i) => g.ai.hand[i]);
  g.me.hand = g.me.hand.filter((c) => mine.indexOf(c) < 0);
  g.ai.hand = g.ai.hand.filter((c) => theirs.indexOf(c) < 0);
  g.slots = { me: mine, ai: theirs };
  sel = []; phase = 'reveal'; msg = '';
  sfx('deal');
  render();


  // 翻牌期间把双方出的牌写清楚（玩家要能看清对手出了什么）
  const shortCards = (arr) => arr.map((c) => c.blank ? '空白' : c.type + c.q).join(' ');
  msg = '翻牌中…　你 ' + shortCards(mine) + '　｜　对方 ' + shortCards(theirs);
  render();

  setTimeout(() => {
    sfx('reveal');
    const res = resolveRound(g, mine, theirs);
    // 播报：先写"双方各出了什么"，再把本次结算的每一条特效按结算顺序写进去
    const fmtCard = (arr) => arr.map((c) => c.blank ? '空白' : c.type + c.q + c.pts).join('+');
    const ptsNote = (res.rawP === res.pP && res.rawA === res.aP) ? '' : '（原始 ' + res.rawP + ' : ' + res.rawA + '）';
    // 战况面板（折叠着的那块）留完整文字，播报区只留一条回合块
    g.logs.unshift('<b>第 ' + g.round + ' 回合</b>　你 ' + fmtCard(mine) + '（' + res.pP + '）｜对方 '
      + fmtCard(theirs) + '（' + res.aP + '）→ '
      + (res.result === 'me' ? '你赢' : res.result === 'ai' ? '你输' : '平局') + ptsNote);
    for (let i = res.ev.length - 1; i >= 0; i--) g.logs.unshift(res.ev[i]);
    if (g.logs.length > 40) g.logs.length = 40;

    // 触发的效果：用彩卡短名（回手/封印/抽牌/弃牌/加点/削点/平局/重置），余晖保留原名
    const fxTxt = (res.sk || []).map((x) => (x.side === 'me' ? '我方' : '对方') + '·'
      + (x.name === SKILL[x.type] ? (SKILL_SHORT[x.type] || x.name) : x.name));
    g.blocks.unshift({ r: g.round, m: shortCards(mine), mp: res.pP, t: shortCards(theirs), tp: res.aP, fx: fxTxt, res: res.result });
    if (g.blocks.length > 8) g.blocks.length = 8;

    // 对局记录：这一回合的完整细节（手牌/出牌/点数/特效/夺牌/弃置/牌堆）
    g.hist.push({
      r: g.round,
      handMe: snap.handMe.map(cTxt), handAi: snap.handAi.map(cTxt),
      playMe: mine.map(cTxt), playAi: theirs.map(cTxt),
      rawP: res.rawP, rawA: res.rawA, pP: res.pP, aP: res.aP, res: res.result,
      fx: (res.sk || []).map((x) => ({ side: x.side, name: x.name })),
      loot: (res.loot || []).map(cTxt), umb: res.umb ? 1 : 0, kill: res.kill || '',
      deckB: snap.deckB, deckA: g.deck.length, coldMe: snap.coldMe, coldAi: snap.coldAi,
      dropMe: [], dropAi: []
    });

    paintSkillFx(res.sk);
    if (res.sk && res.sk.length) sfx('skill');

    const myWin = res.result === 'me', tie = res.result === 'tie';
    msg = '';   // 这一手的结论已经在回合块里了，上面不再重复一遍

    // 月亮刺杀：对手再没有能出的特殊牌 → 直接判负
    if (res.kill === 'me') { endGame(g, 'me', '月亮刺杀：对方再没有能出的特殊牌'); phase = 'over'; return render(); }
    if (res.kill === 'ai') { endGame(g, 'ai', '月亮刺杀：你再没有能出的特殊牌'); phase = 'over'; return render(); }
    if (g.over) { phase = 'over'; return render(); }

    // AI 超出上限：自动弃点数最低的若干张（文档 4.5）
    if (overCount(g, 'ai') > 0) {
      const dropped = trimHand(g, 'ai');
      if (dropped && dropped.length) {
        const lh = lastHist(g);
        if (lh) lh.dropAi = dropped.map(cTxt);
      }
      if (dropped && dropped.length) msg += '<br><span style="color:var(--ink3)">对手手牌超出上限，弃置了 ' + dropped.length + ' 张（回牌堆）</span>';
    }
    // 手牌特殊牌被清空 → 结算后立即判负（文档 3.3）
    if (tailCheck(g)) { phase = 'over'; return render(); }
    // 需要弃置：月亮点名优先，其余是超出上限
    if (discardNeed(g) > 0) { phase = 'discard'; sel = autoLowest(g); return render(); }
    nextRound(g);
    if (g.over) { phase = 'over'; return render(); }
    phase = 'select';
    render();
  }, 1500);
}

$('primary').onclick = primary;
function doRestart() {
  // 「重开」也能把被盯上的那局刷掉 —— 代价同样是连胜中断
  if (RANK.omen) { RANK.omen = 0; RANK.streak = 0; saveRank(RANK); paintRank(); }
  // 已经打完（over）或还没开始（ready）→ 不扣分
  if (STARTED && !g.over) {
    const ok = window.confirm('这局还没打完，放弃会扣 18 分。确定要重开吗？');
    if (!ok) return;
    RANK.rating = Math.max(0, RANK.rating - 18);
    RANK.losses++;
    saveRank(RANK); paintRank();
    pushAbandon();
  }
  start();
}
$('restart').onclick = doRestart;

// 音效开关（记在本地）
sfxLoad();
function paintSfx() {
  const b = $('sfxBtn');
  if (!b) return;
  b.textContent = SFX.on ? '🔊' : '🔇';
  b.classList.toggle('off', !SFX.on);
}
paintSfx();
$('sfxBtn').onclick = () => {
  SFX.on = !SFX.on;
  sfxSave(); paintSfx();
  if (SFX.on) sfx('pick');
};
$('diff').onchange = start;
$('ovAgain').onclick = start;

/* ===================== 对局记录：导出 txt ===================== */
/* 这一整节只在"结算弹层里点导出"时用，不影响对局本身。
   格式说明：上半部分给人看，末尾附一段结构化 JSON 给分析用（后续的复盘页直接读它）。 */
const MATCH_VER = 'v1';                 // 记录格式版本（复盘页按这个判断怎么读）
const DOC_VER = '20261023';             // 规则版本：和 game.js 的 ?v= 一起递增
const LEVEL_NAME = { easy: '简单', normal: '普通', hard: '困难', nightmare: '噩梦' };

const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
const cTxt = (c) => (!c ? '' : c.blank ? '空白' : c.type + c.q);
const arrTxt = (a) => (a && a.length ? a.join(' ') : '-');

// 「对局信息」一行一条：标签 + 全角冒号。不靠空格对齐 —— 等宽字体里中英文字宽不等，怎么填都会歪
const kv = (k, v) => '  ' + k + '：' + v;

function lastHist(g2) {
  if (!g2 || !g2.hist || !g2.hist.length) return null;
  return g2.hist[g2.hist.length - 1];
}

function stampNow() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
    + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function durTxt(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ' 分 ' + pad2(s % 60) + ' 秒';
}

// 把一局对局写成文本（人看的摘要 + 回合表 + JSON）
function buildMatchTxt(g2) {
  if (!g2) return '';
  const win = g2.winner === 'me' ? '你赢了' : g2.winner === 'ai' ? '你输了' : '平局';
  const rows = g2.hist || [];
  const fxTxt = (list) => (list && list.length
    ? list.map((x) => (x.side === 'me' ? '我方' : '对方') + '·' + x.name).join(' / ')
    : '-');
  const resTxt = (r) => (r === 'me' ? '我方' : r === 'ai' ? '对方' : '平局');
  // 以「本局结算时」的记录为准：服务端同步可能在中途把本地段位覆盖成别的值
  const after = (typeof g2.rankAfter === 'number') ? g2.rankAfter
    : (typeof RANK.rating === 'number' ? RANK.rating : null);
  const before = (typeof g2.rankBefore === 'number') ? g2.rankBefore
    : (after === null ? null : after - (typeof g2.rankDelta === 'number' ? g2.rankDelta : 0));
  const deltaTxt = (before === null || after === null) ? '-'
    : before + ' → ' + after + '（' + (after >= before ? '+' : '') + (after - before) + '）';
  const meSp = specOf(g2.me.hand).length, aiSp = specOf(g2.ai.hand).length;
  const L = [];

  L.push('==========================================================');
  L.push('幻梦牌 · 对局记录 ' + MATCH_VER);
  L.push('==========================================================');
  L.push('【这份文件是什么】');
  L.push('  一局「幻梦牌」的完整记录，用于复盘。');
  L.push('  · 手牌与出牌写作「类型+品质」，例如 ☕普 / 🐋金 / 🌈彩；空白写作「空白」。');
  L.push('  · 「我方」= 玩家，「对方」= AI。');
  L.push('  · 中间是回合表（Tab 分隔，可粘进表格），末尾是结构化 JSON。');
  L.push('');
  L.push('【对局信息】');
  L.push(kv('导出时间', stampNow()));
  L.push(kv('对局用时', durTxt(Date.now() - (g2.t0 || Date.now()))));
  L.push(kv('规则版本', DOC_VER));
  L.push(kv('AI 难度', LEVEL_NAME[g2.level] || g2.level || '-'));
  L.push(kv('段位', (g2.tierBefore || '-') + (before === null ? '' : '（' + before + ' 分）')));
  L.push(kv('被盯上的局', g2.haunt ? '是（连胜彩蛋）' : '否'));
  L.push(kv('随机种子', String(g2.seed)));
  L.push(kv('结果', win));
  L.push(kv('结束原因', g2.reason || '-'));
  L.push(kv('回合数', String(rows.length) + ' 回合已结算' + (g2.round > rows.length ? '，第 ' + g2.round + ' 回合未开始' : '')));
  L.push(kv('段位分', deltaTxt));
  L.push(kv('终局手牌', '我方 ' + meSp + ' 特殊 + 空白　对方 ' + aiSp + ' 特殊 + 空白　牌堆 '
    + g2.deck.length + ' 张　补牌截止 第 ' + g2.dealUntil + ' 回合'));
  L.push('');

  L.push('【逐回合】');
  if (!rows.length) {
    L.push('  （这一局没有打出的回合）');
  } else {
    for (const h of rows) {
      L.push('  R' + h.r + '　你 ' + arrTxt(h.playMe) + '（' + h.pP + '）　对方 '
        + arrTxt(h.playAi) + '（' + h.aP + '）　原始 ' + h.rawP + ':' + h.rawA
        + '　' + (h.res === 'me' ? '你赢' : h.res === 'ai' ? '你输' : '平局')
        + (fxTxt(h.fx) === '-' ? '' : '　特效 ' + fxTxt(h.fx))
        + (h.loot && h.loot.length ? (h.res === 'me' ? '　夺 ' : '　被夺 ') + h.loot.join(' ') : '')
        + (h.dropMe && h.dropMe.length ? '　你弃 ' + h.dropMe.join(' ') : '')
        + (h.dropAi && h.dropAi.length ? '　对方弃 ' + h.dropAi.join(' ') : ''));
    }
  }
  L.push('');
  L.push('【回合表】（Tab 分隔）');
  L.push(['R', 'handMe', 'handAi', 'playMe', 'playAi', 'rawP', 'rawA', 'pP', 'aP', 'res',
    'deckB', 'deckA', 'coldMe', 'coldAi', 'fx', 'loot', 'dropMe', 'dropAi'].join('\t'));
  L.push(['#', '回合开始手牌', '回合开始手牌', '本回合出牌', '本回合出牌', '原始点数', '原始点数',
    '修正后', '修正后', '胜者', '战前牌堆', '战后牌堆', '我方冷却牌数', '对方冷却牌数',
    '触发特效', '被夺走的牌', '我方弃置', '对方弃置'].join('\t'));
  for (const h of rows) {
    L.push([h.r, arrTxt(h.handMe), arrTxt(h.handAi), arrTxt(h.playMe), arrTxt(h.playAi),
      h.rawP, h.rawA, h.pP, h.aP, resTxt(h.res), h.deckB, h.deckA, h.coldMe, h.coldAi,
      fxTxt(h.fx), arrTxt(h.loot), arrTxt(h.dropMe), arrTxt(h.dropAi)].join('\t'));
  }
  L.push('');
  L.push('==========================================================');
  L.push('【结构化 JSON】（给复盘页面直接读：文件末尾这一段整体就是 JSON）');
  try {
    L.push(JSON.stringify({
      format: 'dreamcard-match',
      ver: MATCH_VER,
      docVer: DOC_VER,
      ts: new Date().toISOString(),
      seconds: Math.max(0, Math.round((Date.now() - (g2.t0 || Date.now())) / 1000)),
      seed: g2.seed,
      level: g2.level || '',
      haunt: !!g2.haunt,
      tier: g2.tierBefore || '',
      ratingBefore: before,
      ratingAfter: after,
      conf: { cap: CONF.cap, cd: CONF.cd, window: CONF.window, stallN: CONF.stallN, endCap: CONF.endCap },
      result: { winner: g2.winner, reason: g2.reason, rounds: rows.length, nextRound: g2.round },
      finalHands: {
        me: g2.me.hand.map(cTxt), ai: g2.ai.hand.map(cTxt),
        deck: g2.deck.length, dealUntil: g2.dealUntil
      },
      stats: g2.stats,
      rounds: rows
    }, null, 1));
  } catch (e) {
    L.push('（JSON 生成失败：' + (e && e.message ? e.message : e) + '）');
  }
  return L.join('\n');
}

function openLog() {
  if (!g || !g.over) return;
  const t = $('logText');
  if (t) t.value = buildMatchTxt(g);
  const p = $('logPanel');
  if (p) p.classList.add('on');
}

function closeLog() {
  const p = $('logPanel');
  if (p) p.classList.remove('on');
}

function downloadLog() {
  if (!g || !g.over) return;
  const txt = buildMatchTxt(g);
  const d = new Date();
  const name = '幻梦牌_对局_' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate())
    + '-' + pad2(d.getHours()) + pad2(d.getMinutes())
    + '_' + (g.winner === 'me' ? '胜' : g.winner === 'ai' ? '负' : '平') + '.txt';
  try {
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 2000);
  } catch (e) {
    // 老浏览器不支持下载：退成"选中文本，让用户自己复制"
    const t = $('logText');
    if (t) { t.focus(); if (t.select) t.select(); }
  }
}

function copyLog() {
  const t = $('logText');
  if (!t) return;
  const txt = t.value || buildMatchTxt(g);
  const btn = $('logCopy');
  const done = (ok) => {
    if (!btn) return;
    btn.textContent = ok ? '已复制 ✓' : '请手动全选复制';
    setTimeout(() => { btn.textContent = '复制'; }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(() => done(true)).catch(() => {
      t.focus(); if (t.select) t.select();
      done(false);
    });
  } else {
    t.focus(); if (t.select) t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    done(ok);
  }
}

const ovExportBtn = $('ovExport');
if (ovExportBtn) ovExportBtn.onclick = openLog;
const logCloseBtn = $('logClose');
if (logCloseBtn) logCloseBtn.onclick = closeLog;
const logCopyBtn = $('logCopy');
if (logCopyBtn) logCopyBtn.onclick = copyLog;
const logSaveBtn = $('logSave');
if (logSaveBtn) logSaveBtn.onclick = downloadLog;

// ===== 引导与实验室入口的绑定 ====
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
// 刷新 = 把「被噩梦盯上」这件事一并刷掉（连胜因此中断）
if (RANK.omen) { RANK.omen = 0; RANK.streak = 0; saveRank(RANK); }
start();
// 进来先问一次服务端：登录了就用云端段位，没登录安静地留在本地
paintSync();
loadRemoteRank();
// 返回上一步（带离开惩罚：本局已开始且未结束 → 离开时扣 18 分）
// (已移除 __qcLeaving 机制：后退与刷新统一走同一套离开处理)
// 返回上一步：这里【只做返回】✓
// 离开惩罚统一交给下面的 beforeunload（浏览器原生提示）+ pagehide（真正离开时扣分）✓
// 之前先弹我们自己的确认框再后退，会连弹两次、而且原生框取消也挡不住后退 ✗
(function () {
  const b = document.getElementById('backBtn');
  if (!b) return;
  b.addEventListener('click', () => {
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
    if (typeof STARTED !== 'undefined' && STARTED && g && !g.over) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });
  window.addEventListener('pagehide', () => {
    if (typeof STARTED !== 'undefined' && STARTED && g && !g.over) {
      try {
        RANK.rating = Math.max(0, RANK.rating - 18);
        RANK.losses++;
        saveRank(RANK);
        pushAbandon();
      } catch (err) {}
    }
  });
})();

// 本地预览（127.0.0.1 / localhost）才显示"AI 难度"开关；线上按段位自动
if (/^(localhost|127.0.0.1|::1)$/.test(location.hostname || '')) {
  document.documentElement.classList.add('dev-mode');
}

/* 首屏已经画完，收掉加载遮罩。
   直接摘 class：走 rAF 会被饿死（遮罩是静态不透明层，不触发重绘），遮罩就一直挂着。 */
(function () {
  var veil = document.getElementById('pageVeil');
  if (veil) veil.classList.remove('on');
})();
