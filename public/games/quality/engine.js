/* ===================== 引擎（唯一规则实现） ===================== */
// 幻梦牌的全部规则都在这里，前端单机与将来的 PvP 服务端共用同一份：
//   · 浏览器：index.html 里 <script src="./engine.js"> 先于 game.js 加载，
//             下面的 const / function 是脚本级全局，game.js 直接引用；
//   · 服务端：import './engine.js' 之后读 globalThis.QCEngine。
// 本文件不含 import / export 语法、不碰 DOM、不发网络请求、不读系统时钟
// （newGame 的时间戳由调用方注入），因此可以原样在 Worker 里跑。
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
  // 先把 seed 混一遍（splitmix32 的 finalizer）再进 xorshift32。
  // 原因：直接拿 seed 当状态时，小 seed 的头几个输出会挤在 0 附近
  // （seed=1 → 0.000, 0.016, …），而洗牌的第一次迭代正好要用它们，
  // 结果同一个 seed 会反复洗出同一个开局，座位之间还会出现系统性偏差。
  let s = (seed >>> 0) || 1;
  s = (s + 0x9e3779b9) >>> 0;
  s = (s ^ (s >>> 16)) >>> 0; s = Math.imul(s, 0x21f0aaad) >>> 0;
  s = (s ^ (s >>> 15)) >>> 0; s = Math.imul(s, 0x735a2d97) >>> 0;
  s = (s ^ (s >>> 15)) >>> 0;
  if (!s) s = 0x1a2b3c4d;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (let i = 0; i < 4; i++) next();   // 空转几下，把 xorshift 自身的热身也算进去
  return next;
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

function newGame(seed, now) {
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
    t0: now || Date.now(),         // 开局时间（PvP 回放时由外部注入，保证可复现）
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
// 上限按"手上真有几张特殊牌"夹一下：否则弃牌阶段会出现"永远凑不够张数"的死锁
function discardNeed(g) {
  const n = (g.pending && g.pending.n > 0) ? g.pending.n : overCount(g, 'me');
  return Math.max(0, Math.min(n, specOf(g.me.hand).length));
}
function discardWhy(g) {
  return (g.pending && g.pending.n > 0) ? 'moon' : 'cap';
}
// 某一侧要弃几张（PvP 用；单机只有 me 这一侧会问）
function discardNeedSide(g, side) {
  const p = side === 'me' ? g.pending : g.pendingAi;
  const hand = side === 'me' ? g.me.hand : g.ai.hand;
  const n = (p && p.n > 0) ? p.n : overCount(g, side);
  return Math.max(0, Math.min(n, specOf(hand).length));
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
    if (g.autoAi === false) {
      // PvP：对方自己挑要弃哪张（等本人交，判定留到弃完再做）
      g.pendingAi = { n: 1, why: 'moon' };
      ev.push('🌙 你的月亮：对方要弃置 1 张特殊牌');
      bump('moon');
      fx('me', '🌙');
    } else {
      const drop = autoDrop(g, 'ai', 1);
      ev.push('🌙 你的月亮：' + (drop.length ? '对方弃置 ' + drop.map(cardTag).join('') + '（回牌堆）' : '对方已无特殊牌可弃'));
      bump('moon');
      if (playSpecials(g.ai.hand, R) === 0) kill = 'me';
      if (drop.length || kill === 'me') fx('me', '🌙');
    }
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


/* ---------- 一回合的裁判流水线 ----------
   前端单机与 PvP 服务端都走这三步，避免「两边各写一遍结算顺序」这种漂移：
     commitPlay(g, mine, theirs)   出手：从手牌移走、记入 slots
     res = resolveRound(g, mine, theirs)   结算（纯规则解算）
     out = afterRound(g, res)      收尾：判负 / 超上限弃牌 / 是否还需弃置
     applyDiscard(g, side, cards)  若 out.need>0，弃置后再 nextRound

   afterRound 返回 { over, kill, droppedAi, need, why }：
     over=true 表示这一局已经结束，不要再 nextRound；
     need>0   表示还要弃置 need 张（月亮点名或超出上限）才能进下一回合。
   注意：日志类字段（g.logs / g.blocks / g.hist）要在调用 afterRound 之前写，
   因为 trimHand 会往牌堆回牌、改变 g.deck.length。 */
function commitPlay(g, mine, theirs) {
  g.me.hand = g.me.hand.filter((c) => mine.indexOf(c) < 0);
  g.ai.hand = g.ai.hand.filter((c) => theirs.indexOf(c) < 0);
  g.slots = { me: mine, ai: theirs };
}

function afterRound(g, res) {
  const out = { over: false, kill: '', droppedAi: [], need: 0, why: '', needAi: 0, whyAi: '' };

  // 月亮刺杀：对手再没有能出的特殊牌 → 直接判负
  if (res.kill === 'me') { endGame(g, 'me', '月亮刺杀：对方再没有能出的特殊牌'); out.over = true; out.kill = 'me'; return out; }
  if (res.kill === 'ai') { endGame(g, 'ai', '月亮刺杀：你再没有能出的特殊牌'); out.over = true; out.kill = 'ai'; return out; }
  if (g.over) { out.over = true; return out; }

  /* PvP：两边都自己挑弃哪张，所以这里只"报数"，不替任何人弃。
     两张都被点名时是各弃各的，互不影响。 */
  if (g.autoAi === false) {
    out.need = discardNeedSide(g, 'me');
    out.why = out.need > 0 ? ((g.pending && g.pending.n > 0) ? 'moon' : 'cap') : '';
    out.needAi = discardNeedSide(g, 'ai');
    out.whyAi = out.needAi > 0 ? ((g.pendingAi && g.pendingAi.n > 0) ? 'moon' : 'cap') : '';
    // 没人欠牌了才做收尾判定（有人欠牌时，等弃完由调用方再判一次）
    if (out.need === 0 && out.needAi === 0 && tailCheck(g)) out.over = true;
    return out;
  }

  // 单机：AI 超出上限时自己弃点数最低的若干张（文档 4.5）
  if (overCount(g, 'ai') > 0) out.droppedAi = trimHand(g, 'ai');

  // 手牌特殊牌被清空 → 结算后立即判负（文档 3.3）
  if (tailCheck(g)) { out.over = true; return out; }

  // 需要弃置：月亮点名优先，其余是超出上限
  out.need = discardNeed(g);
  out.why = out.need > 0 ? discardWhy(g) : '';
  return out;
}

// 弃置提交：谁弃谁的，顺手把那一边的 pending 清掉
function applyDiscard(g, side, cards) {
  const n = discardCards(g, side, cards);
  if (side === 'me') g.pending = null; else g.pendingAi = null;
  return n;
}

/* ---------- PvP：按「种子 + 每回合双方出的牌 / 弃牌」重放整局 ----------
   服务端只存 seed 和动作记录，不存局面：这样对手的手牌永远不会被下发，
   也不存在"两个客户端各算各的、算出来不一样"的问题。

   rounds 形如：
     [{ round: 1,
        host: ['☕️|彩|1','🌙|普|2'],        // 这一回合出的两张
        guest: [...],
        hostDrop: ['🌙|普|2'],              // 可选：这一回合要弃的牌
        guestDrop: [...] }, ...]
   返回 { g, resolved, stage, need, needAi }：
     stage = 'play'   还在等双方出牌
             'discard' 牌都出了，还等某一方交弃置
             'done'    这局结束
     need / needAi 是"当前回合"里双方还欠几张弃牌（0 表示不用弃）。 */
function pickByIds(hand, ids) {
  const out = [];
  for (const id of ids) {
    const c = hand.find((x) => x.id === id);
    if (!c) return null;
    out.push(c);
  }
  return out;
}

function pvpReplay(seed, t0, rounds) {
  const g = newGame(seed, t0);
  g.autoAi = false;                   // PvP：两边都自己挑牌弃
  nextRound(g);                       // 和单机开局一致：先进入第 1 回合（各抽 1 张）
  const byRound = new Map();
  for (const r of (rounds || [])) {
    const n = Number(r && r.round);
    if (n >= 1) byRound.set(n, r);
  }
  const resolved = [];
  let stage = 'play';
  let need = 0, needAi = 0;
  while (!g.over) {
    const r = byRound.get(g.round);
    if (!r || !r.host || !r.guest || r.host.length !== 2 || r.guest.length !== 2) { stage = 'play'; break; }
    const mine = pickByIds(g.me.hand, r.host);
    const theirs = pickByIds(g.ai.hand, r.guest);
    if (!mine || !theirs) { stage = 'play'; break; }   // 记录和局面对不上：停在上一回合

    commitPlay(g, mine, theirs);
    const res = resolveRound(g, mine, theirs);
    const out = afterRound(g, res);
    resolved.push({ round: g.round, res, mine, theirs });
    if (out.over) { stage = 'done'; break; }

    // 弃置：谁欠谁交，缺谁的记录就停在这里等
    // 注意：交完就把这一侧的 need 清零，否则对面还没交时，界面会一直催已经交过的人再弃一次
    let blocked = false;
    need = out.need; needAi = out.needAi;
    if (need > 0) {
      const cards = Array.isArray(r.hostDrop) ? pickByIds(g.me.hand, r.hostDrop) : null;
      if (!cards || cards.length !== need) blocked = true;
      else {
        applyDiscard(g, 'me', cards);
        need = 0;
        if (tailCheck(g)) { stage = 'done'; break; }
      }
    }
    if (!blocked && needAi > 0) {
      const cards = Array.isArray(r.guestDrop) ? pickByIds(g.ai.hand, r.guestDrop) : null;
      if (!cards || cards.length !== needAi) blocked = true;
      else {
        applyDiscard(g, 'ai', cards);
        needAi = 0;
        if (tailCheck(g)) { stage = 'done'; break; }
      }
    }
    if (blocked) { stage = 'discard'; break; }
    nextRound(g);
    stage = g.over ? 'done' : 'play';
  }
  return { g, resolved, stage, need, needAi };
}

// 只取可序列化的部分（去掉 rng / airy 两个函数），用于存档、回放比对与裁判端持久化
function snapshot(g) {
  const out = {};
  for (const k of Object.keys(g)) {
    if (typeof g[k] === 'function') continue;
    out[k] = g[k];
  }
  return out;
}

/* ---------- 导出 ---------- */
// 浏览器里上面这些 const / function 已经是脚本级全局，game.js 直接引用即可；
// 服务端（Workers，ESM）读 globalThis.QCEngine。加新规则函数时记得也挂到这里。
if (typeof globalThis !== 'undefined') {
  globalThis.QCEngine = {
    TYPES, QUAL, CDL, QLIST, SKILL, SKILL_SHORT, SKILL_DESC, CONF,
    makeRng, makeDeck, makeBlank, specOf, sumPts, isPlayable, cdLeft, playIdx, playSpecials,
    isCai, hasCai, partnerOf, shuffle, newGame, endGame, nextRound, discardCards, autoDrop,
    overCount, trimHand, discardNeed, discardWhy, resolveRound, tailCheck,
    commitPlay, afterRound, applyDiscard, snapshot, pvpReplay, pickByIds, discardNeedSide
  };
}
