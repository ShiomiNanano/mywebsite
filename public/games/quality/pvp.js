/* ===================== 双人对局（PvP，异步轮流出牌） =====================
   入口：/games/quality/?room=ABCD
   这一层只负责「把服务端下发的局面套进现有的牌桌渲染」，规则一律在服务端
   （functions/api/[[route]].js + engine.js）算好，前端不算牌、不判胜负。

   设计取舍：
   · 复用同一个页面、同一套渲染 —— 只把 g 换成一个由服务端局面拼出来的壳；
   · 不碰单机逻辑：所有改道都挂在 ?room= 上，没有这个参数时一行都不生效。 */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const code = (params.get('room') || '').trim().toUpperCase();

  /* ---------- 没有房间参数时：单机页右下角放一个「双人对局」入口 ----------
     点开是一个小面板：进行中的对局（轮到你会有标记）+ 开新房 + 用房间码加入。
     没做进 SPA 的游戏卡，是为了不碰主站那套渲染与断言。 */
  if (!/^[A-Z0-9]{4,8}$/.test(code)) {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const launch = function () {
      const style = document.createElement('style');
      style.textContent = [
        '#pvpNew{position:fixed;right:14px;bottom:18px;z-index:70;display:flex;align-items:center;gap:7px;',
        'font:inherit;font-size:13px;padding:10px 16px;border-radius:999px;cursor:pointer;color:#2a1f10;',
        'background:linear-gradient(160deg,#f0dcae,#d3b37e);border:1px solid rgba(120,92,44,.5);',
        'box-shadow:0 10px 24px -12px #000}',
        '#pvpNew:disabled{opacity:.6;cursor:default}',
        '#pvpNew i{width:8px;height:8px;border-radius:50%;background:#c0402f;box-shadow:0 0 0 3px rgba(192,64,47,.22)}',
        '#pvpNew i[hidden]{display:none}',
        '#pvpModal{position:fixed;inset:0;z-index:80;display:none;place-items:center;background:rgba(8,6,3,.62)}',
        '#pvpModal.on{display:grid}',
        '.pm-card{width:min(430px,92vw);background:linear-gradient(170deg,#241b0f,#171009);',
        'border:1px solid rgba(211,179,126,.35);border-radius:16px;padding:16px 16px 12px;color:#f2e6cc;',
        'box-shadow:0 24px 60px -30px #000}',
        '.pm-card h3{margin:0 0 10px;font-size:15px;letter-spacing:.08em;color:#e8cf9a}',
        '.pm-body{max-height:46vh;overflow:auto;font-size:13px}',
        '.pm-dim{color:#a89a80;margin:6px 0;line-height:1.7}',
        '.pm-dim a{color:#e8cf9a}',
        '.pm-list{list-style:none;margin:0;padding:0}',
        '.pm-list li{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;cursor:pointer;',
        'border:1px solid rgba(211,179,126,.18);margin-bottom:6px;background:rgba(255,255,255,.03)}',
        '.pm-list li:hover{background:rgba(211,179,126,.14)}',
        '.pm-list b{font-variant-numeric:tabular-nums;letter-spacing:.12em;color:#e8cf9a}',
        '.pm-list span{flex:1;color:#cbb894;font-size:12px}',
        '.pm-list em{font-style:normal;font-size:11px;color:#2a1f10;background:#e8cf9a;border-radius:999px;padding:2px 8px}',
        '.pm-list i{font-style:normal;font-size:11px;color:#8d8069}',
        '.pm-foot{display:flex;gap:8px;margin-top:10px}',
        '.pm-foot button{flex:1;width:auto;font:inherit;font-size:12px;padding:9px 10px;border-radius:10px;cursor:pointer;',
        'color:#2a1f10;background:linear-gradient(160deg,#f0dcae,#d3b37e);border:0}',
        '.pm-foot button.ghost{background:rgba(255,255,255,.08);color:#e9d8b6;border:1px solid rgba(211,179,126,.3)}',
      ].join('');
      document.head.appendChild(style);

      const btn = document.createElement('button');
      btn.id = 'pvpNew';
      btn.type = 'button';
      btn.innerHTML = '<span>双人对局（Beta）</span><i id="pvpDot" hidden></i>';
      document.body.appendChild(btn);

      const modal = document.createElement('div');
      modal.id = 'pvpModal';
      modal.innerHTML = '<div class="pm-card"><h3>双人对局</h3>'
        + '<div id="pmBody" class="pm-body"><p class="pm-dim">读取中…</p></div>'
        + '<div class="pm-foot"><button type="button" data-pm="create">开一间新房</button>'
        + '<button type="button" data-pm="join">用房间码加入</button>'
        + '<button type="button" data-pm="close" class="ghost">关闭</button></div></div>';
      document.body.appendChild(modal);

      const body = modal.querySelector('#pmBody');
      const dot = btn.querySelector('#pvpDot');
      let busy = false;

      async function refresh() {
        body.innerHTML = '<p class="pm-dim">读取中…</p>';
        try {
          const res = await fetch('/api/pvp/rooms', { credentials: 'same-origin' });
          if (res.status === 401) {
            body.innerHTML = '<p class="pm-dim">和朋友对局需要先登录。<a href="/#/login">去登录</a>（登录后会回到这个页面）</p>';
            dot.hidden = true;
            return;
          }
          const data = await res.json().catch(function () { return {}; });
          const rooms = (data && data.rooms) || [];
          dot.hidden = !rooms.some((r) => r.my_turn);
          if (!rooms.length) {
            body.innerHTML = '<p class="pm-dim">还没有进行中的对局。开一间房，把链接发给朋友就行。</p>';
            return;
          }
          body.innerHTML = '<ul class="pm-list">' + rooms.map((r) => '<li data-code="' + esc(r.code) + '">'
            + '<b>' + esc(r.code) + '</b>'
            + '<span>vs ' + esc(r.opponent) + ' · 第 ' + esc(r.round) + ' 回合</span>'
            + (r.my_turn ? '<em>轮到你</em>' : '<i>等对方</i>') + '</li>').join('') + '</ul>';
          Array.prototype.forEach.call(body.querySelectorAll('.pm-list li'), function (li) {
            li.onclick = function () { location.href = '/games/quality/?room=' + li.getAttribute('data-code'); };
          });
        } catch (e) {
          body.innerHTML = '<p class="pm-dim">读不到对局列表：' + esc(e.message || e) + '</p>';
        }
      }

      async function create() {
        if (busy) return;
        busy = true;
        body.innerHTML = '<p class="pm-dim">正在开房…</p>';
        try {
          const res = await fetch('/api/pvp/rooms', { method: 'POST', credentials: 'same-origin' });
          const data = await res.json().catch(function () { return {}; });
          if (res.status === 401) { location.href = '/#/login'; return; }
          if (!res.ok || !data.url) throw new Error(data.error || ('HTTP ' + res.status));
          location.href = data.url;
        } catch (e) {
          body.innerHTML = '<p class="pm-dim">开房失败：' + esc(e.message || e) + '</p>';
        } finally { busy = false; }
      }

      function join() {
        const raw = window.prompt('输入 6 位房间码（朋友发你的那串）：', '');
        if (raw == null) return;
        const c = String(raw).trim().toUpperCase();
        if (!/^[A-Z0-9]{4,8}$/.test(c)) { window.alert('房间码是 4~8 位字母或数字'); return; }
        location.href = '/games/quality/?room=' + c;
      }

      btn.onclick = function () {
        modal.classList.add('on');
        refresh();
      };
      modal.addEventListener('click', function (e) {
        if (e.target === modal) { modal.classList.remove('on'); return; }
        const act = e.target && e.target.getAttribute && e.target.getAttribute('data-pm');
        if (act === 'close') modal.classList.remove('on');
        else if (act === 'create') create();
        else if (act === 'join') join();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') modal.classList.remove('on');
      });

      // 进页面先探一次：有"轮到你"的对局就在按钮上点个红点
      refresh();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', launch);
    else launch();
    return;
  }

  const PVP = window.PVP = {
    on: true, code, view: null, busy: false, timer: null,
    animating: false, animTimer: null,
  };

  // 本地预览的身份开关：URL 上带 ?as=2 就是"另一个人"。必须跟着每个接口请求走，
  // 不能靠 cookie —— 同一个浏览器两个标签页会共用 cookie，两边就变成同一个人了。
  const asParam = (params.get('as') || '').trim();
  const withAs = function (u) {
    if (!asParam) return u;
    return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'as=' + encodeURIComponent(asParam);
  };
  const isDev = /^(localhost|127\.0\.0\.1|::1)$/.test(location.hostname || '');

  /* ---------- 样式（只在这个页面注入，不动 style.css） ---------- */
  const css = document.createElement('style');
  css.textContent = [
    '#pvpBar{position:fixed;left:0;right:0;top:0;z-index:60;display:flex;gap:8px;align-items:center;',
    'justify-content:center;flex-wrap:wrap;padding:8px 12px;font-size:12px;',
    'background:rgba(16,12,6,.82);backdrop-filter:blur(10px);border-bottom:1px solid rgba(211,179,126,.28)}',
    '#pvpBar b{letter-spacing:.12em;color:#e9d6a8}',
    '#pvpBar .pvp-note{color:#cbb894;max-width:52ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#pvpBar button{flex:0 0 auto;width:auto;font:inherit;color:#f2e6cc;background:rgba(255,255,255,.08);border:1px solid rgba(211,179,126,.35);',
    'border-radius:999px;padding:4px 12px;font-size:12px;cursor:pointer}',
    '#pvpBar button:hover{background:rgba(211,179,126,.22)}',
    '#pvpBar button.danger{border-color:rgba(220,120,110,.55);color:#f0c9c4}',
    'body.pvp-on{padding-top:38px}',
    'html.pvp-on .back-bar{top:46px}',          /* 让开顶部房间条，否则返回键点不到 */
    'html.pvp-on #restart{display:none!important}',
    /* 盖在牌桌上的牌背：尺寸铺满卡槽，和翻牌后的卡面一样大 */
    '.slot.on.back{position:relative;padding:0;overflow:hidden;color:#a08a60;font-size:22px;',
    'border:1px solid rgba(168,142,96,.55);',
    'background:linear-gradient(135deg,rgba(255,255,255,.55),transparent 62%),',
    'repeating-linear-gradient(45deg,#f4e8cd 0 3px,#e6d7b4 3px 6px);',
    'box-shadow:inset 0 1px 0 rgba(255,255,255,.8),0 6px 14px -10px rgba(0,0,0,.85)}',
    /* 本地预览的调试条（挂在顶部房间条里，不挡牌桌） */
    '#pvpDev{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding-left:10px;margin-left:2px;',
    'border-left:1px dashed rgba(211,179,126,.45);color:#d8c7a4;font-size:11px}',
    '#pvpDev button{flex:0 0 auto;width:auto;font:inherit;font-size:11px;color:#f2e6cc;',
    'background:rgba(255,255,255,.08);border:1px solid rgba(211,179,126,.35);border-radius:999px;padding:3px 9px;cursor:pointer}',
    '#pvpDev button:hover{background:rgba(211,179,126,.24)}',
  ].join('');
  document.head.appendChild(css);
  document.documentElement.classList.add('pvp-on');
  if (document.body) document.body.classList.add('pvp-on');

  /* ---------- 顶部房间条 ---------- */
  const bar = document.createElement('div');
  bar.id = 'pvpBar';
  bar.innerHTML = '<b>房间 ' + code + '</b>'
    + '<span class="pvp-note" id="pvpNote">正在连接…</span>'
    + '<button id="pvpCopy" type="button">复制邀请链接</button>'
    + '<button id="pvpRefresh" type="button">刷新</button>'
    + '<button id="pvpResign" type="button" class="danger">认输</button>';
  document.body.appendChild(bar);

  const $ = (id) => document.getElementById(id);
  function note(text) {
    const el = $('pvpNote');
    if (el) el.textContent = text || '';
  }

  /* ---------- 把服务端局面套成一个"壳 g" ---------- */
  function shell(v) {
    const myCards = v.hand.map((c) => ({
      id: c.id, type: c.type, q: c.q, pts: c.pts, blank: !!c.blank, seen: true,
      cdL: c.cd, cdUntil: c.cd > 0 ? v.round + c.cd - 1 : undefined,
    }));
    const backs = [];
    for (let i = 0; i < v.oppCount; i++) backs.push({ id: 'bk' + i, type: '', q: '?', pts: 0, blank: false, seen: false });
    return {
      me: { hand: myCards },
      ai: { hand: backs },
      round: v.round,
      slots: { me: [], ai: [] },
      deck: new Array(v.deckCount || 0).fill({}),
      dealUntil: v.round + (v.dealLeft || 0) - 1,
      blocks: v.history.slice(-8).reverse().map((h) => ({
        r: h.r, m: h.mine.join(' '), mp: h.mp, t: h.theirs.join(' '), tp: h.op, fx: [], res: h.res,
      })),
      logs: [], hist: [], tieStreak: 0,
      // 该我弃牌时，把张数塞进 pending —— 单机的 discardNeed / autoLowest 就直接能用了
      pending: (v.stage === 'discard' && v.myDiscard > 0) ? { n: v.myDiscard, why: v.myDiscardWhy || 'moon' } : null,
      over: !!v.over,
      winner: v.winner === 'you' ? 'me' : v.winner === 'opp' ? 'ai' : v.winner === 'draw' ? 'draw' : null,
      reason: v.reason || '',
      stats: { skills: {} }, pstat: { n: 0, totSum: 0 }, seed: 0,
      _ranked: true,          // ← 跳过单机的段位结算
      _pvp: true,
    };
  }

  function statusText(v) {
    if (v.over) {
      return v.winner === 'you' ? '你赢了' : v.winner === 'opp' ? '你输了'
        : (v.winner === 'draw' ? '平局' : '这局结束了');
    }
    if (v.status === 'waiting') return '等对方加入 —— 把邀请链接发过去';
    if (v.stage === 'discard') {
      if (v.myDiscard > 0) return '你还要弃 ' + v.myDiscard + ' 张';
      return '等对方弃牌';
    }
    if (v.myPlayed && !v.oppPlayed) return '已出牌，等对方';
    if (v.myPlayed && v.oppPlayed) return '双方都出了，刷新看结果';
    return '轮到你出牌';
  }
  // 当前该用哪个界面阶段
  function phaseOf(v) {
    if (v.over) return 'over';
    if (v.stage === 'discard' && v.myDiscard > 0) return 'discard';
    if (v.myPlayed) return 'wait';
    return 'select';
  }

  /* 桌面上的牌：把服务端给的牌变成渲染用的对象（不带冷却标记，出的牌就是出的牌） */
  function toSlotCard(c) {
    return { id: c.id, type: c.type, q: c.q, pts: c.pts, blank: !!c.blank, seen: true };
  }

  /* 我方先出、对方还没响应：两张牌背朝上盖在牌桌上，等对方出了再一起翻。
     牌背直接铺满整个卡槽（.slot 的尺寸），否则会比牌桌上的翻牌小一圈。 */
  function paintMyBacks() {
    const box = document.getElementById('meSlots');
    if (!box) return;
    box.innerHTML = '<div class="slot on back">✦</div><div class="slot on back">✦</div>';
  }

  /* 对手那一栏补上名字和段位（render 里只写了"对手 · 手牌 N 张"） */
  function paintOppLabel(v) {
    const opp = v.seat === 'host' ? v.guest : v.host;
    const el = document.getElementById('oppLbl');
    if (!el || !opp) return;
    el.textContent = (opp.name || '对手')
      + (opp.tier ? ' · ' + opp.tier : '')
      + ' · 手牌 ' + v.oppCount + ' 张';
  }

  /* ---------- 应用一次服务端局面 ----------
     reveal 有值时先播一遍「出牌 / 翻牌 / 技能横幅」，1.5 秒后再落定，和单机同节奏。
     注意：g / sel / phase / STARTED 是 game.js 里的顶层 let 绑定（挂在全局词法环境，
     不是 window 上的属性），所以这里必须直接赋值，不能写 window.g = … */
  function apply(v, reveal) {
    PVP.view = v;
    g = shell(v);
    sel = [];
    STARTED = false;                 // 不参与单机那套"中途离开扣分"
    phase = phaseOf(v);
    if (phase === 'discard') { try { sel = autoLowest(g); } catch (e) { sel = []; } }
    if (reveal) {
      g.slots = { me: (reveal.mine || []).map(toSlotCard), ai: (reveal.theirs || []).map(toSlotCard) };
      phase = 'reveal';
    }
    msg = '';
    note(statusText(v) + '　·　第 ' + v.round + ' 回合');
    try { render(); } catch (e) { console.warn('[pvp] render 失败', e); }
    try { paintRank(); } catch (e) {}
    try { paintOppLabel(v); } catch (e) {}
    try { paintDev(v); } catch (e) {}
    if (v.over) {
      // PvP 不显示胜负原因（"谁被夺光"这类文案在两边视角下容易反），只留回合数
      const rs = document.getElementById('ovReason');
      if (rs) rs.textContent = '共 ' + v.round + ' 回合';
    }

    // 已经出过牌、但对方还没出：把牌背留在桌上（不播翻牌），等对方出完再一起翻
    if (!reveal && v.status === 'playing' && v.myPlayed && !v.oppPlayed && !v.over) {
      try { paintMyBacks(); } catch (e) {}
    }

    if (reveal) {
      PVP.animating = true;
      try { sfx('deal'); } catch (e) {}
      setTimeout(function () { try { sfx('reveal'); } catch (e) {} }, 700);
      clearTimeout(PVP.animTimer);
      PVP.animTimer = setTimeout(function () {
        PVP.animating = false;
        try {
          if (reveal.fx && reveal.fx.length) { paintSkillFx(reveal.fx); sfx('skill'); }
          else if (v.over) sfx(v.winner === 'you' ? 'win' : v.winner === 'opp' ? 'lose' : 'tie');
        } catch (e) {}
        g.slots = { me: [], ai: [] };
        phase = phaseOf(v);
        if (phase === 'discard') { try { sel = autoLowest(g); } catch (e) { sel = []; } }
        try { render(); } catch (e) {}
        try { paintOppLabel(v); } catch (e) {}
        if (v.over) {
          const rs = document.getElementById('ovReason');
          if (rs) rs.textContent = '共 ' + v.round + ' 回合';
        }
      }, 1500);
    }
  }

  /* ---------- 网络 ---------- */
  async function api(path, opts) {
    const res = await fetch(withAs(path), Object.assign({ credentials: 'same-origin' }, opts || {}));
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error(data.error || ('HTTP ' + res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function load(silent) {
    if (PVP.animating) return null;      // 正在播翻牌，别把桌面刷掉
    try {
      const v = await api('/api/pvp/rooms/' + encodeURIComponent(code));
      const prev = PVP.view;
      // 轮询/刷新时发现"对方把这一回合补齐了" → 也播一遍翻牌，别让结果干巴巴地跳出来
      const fresh = !!(prev && v.last && v.history.length > prev.history.length);
      if (fresh) apply(v, { mine: v.last.mine, theirs: v.last.theirs, fx: v.last.fx || [] });
      else apply(v);
      return v;
    } catch (e) {
      if (e.status === 401) {
        // 记住这个房间：登录成功后 app.js 会把我们送回来
        try { sessionStorage.setItem('web-next', location.pathname + location.search); } catch (err) {}
        const el = $('pvpNote');
        if (el) el.innerHTML = '<a href="/#/login" style="color:#e9d6a8">登录</a> 后回到这个房间';
        return null;
      }
      note(e.message || '连接失败');
      if (!silent) console.warn('[pvp]', e);
      return null;
    }
  }

  async function submit() {
    if (PVP.busy || PVP.animating) return;
    const picked = sel.map((i) => g.me.hand[i]);
    if (picked.length !== 2) return;
    const ids = picked.map((c) => c.id);
    const prevHist = PVP.view ? PVP.view.history.length : 0;
    PVP.busy = true;
    note('出牌中…');
    try {
      const r = await api('/api/pvp/rooms/' + encodeURIComponent(code) + '/play', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ round: g.round, cards: ids }),
      });
      const v = r.room;
      const last = v.last;
      if (last && v.history.length > prevHist) {
        // 这一手把回合打完了：播双方的翻牌 + 技能横幅
        apply(v, { mine: last.mine, theirs: last.theirs, fx: last.fx || [] });
      } else {
        // 对方还没出：牌背朝上盖在桌上，等对方响应了再翻
        apply(v);
      }
    } catch (e) {
      note(e.message || '出牌失败');
      if (e.status === 409 || e.status === 400) load(true);
    } finally {
      PVP.busy = false;
    }
  }

  async function submitDiscard() {
    if (PVP.busy || PVP.animating) return;
    const need = discardNeed(g);
    const ids = sel.map((i) => g.me.hand[i].id);
    if (!need || ids.length !== need) return;
    PVP.busy = true;
    note('弃置中…');
    try {
      const r = await api('/api/pvp/rooms/' + encodeURIComponent(code) + '/discard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ round: g.round, cards: ids }),
      });
      apply(r.room);          // 弃完可能直接进下一回合，也可能继续等对方
    } catch (e) {
      note(e.message || '弃置失败');
      if (e.status === 409 || e.status === 400) load(true);
    } finally {
      PVP.busy = false;
    }
  }

  async function joinRoom() {
    try {
      const r = await api('/api/pvp/rooms/' + encodeURIComponent(code) + '/join', { method: 'POST' });
      apply(r.room);
      return true;
    } catch (e) {
      note(e.message || '加入失败');
      load(true);
      return false;
    }
  }

  async function resign() {
    if (!window.confirm('确定认输吗？这局会直接结束。')) return;
    try {
      const r = await api('/api/pvp/rooms/' + encodeURIComponent(code) + '/resign', { method: 'POST' });
      apply(r.room);
    } catch (e) { note(e.message || '操作失败'); }
  }

  /* ---------- 接管按钮 ---------- */
  // 单机里 #primary 的 onclick 是页面加载时绑死的，所以这里改写 onclick 本身
  const btn = $('primary');
  const oldClick = btn && btn.onclick;
  if (btn) {
    btn.onclick = function () {
      if (!PVP.on) return oldClick && oldClick.call(this);
      if (phase === 'over') { location.href = '/#/games'; return; }
      if (phase === 'select' && sel.length === 2) return submit();
      if (phase === 'discard' && sel.length === discardNeed(g)) return submitDiscard();
      if (phase === 'wait') { load(); return; }
    };
  }
  // 按钮文案：render() 内部会调用 paintPrimary，所以直接换掉这个全局函数
  paintPrimary = function () {
    const b = $('primary');
    if (!b) return;
    b.disabled = true;
    b.classList.remove('danger');
    if (phase === 'select') { b.textContent = '盖牌并声明准备'; b.disabled = sel.length !== 2; }
    else if (phase === 'discard') {
      const n = discardNeed(g);
      b.textContent = '确认弃置 (' + sel.length + '/' + n + ')';
      b.disabled = sel.length !== n;
      b.classList.add('danger');
    }
    else if (phase === 'wait') { b.textContent = '已出牌 · 点这里刷新'; b.disabled = false; }
    else if (phase === 'over') { b.textContent = '返回游戏页'; b.disabled = false; }
    else { b.textContent = '…'; }
  };

  /* ---------- 顶部按钮 ---------- */
  $('pvpCopy').onclick = async function () {
    const url = location.origin + '/games/quality/?room=' + code;
    try {
      await navigator.clipboard.writeText(url);
      note('邀请链接已复制');
    } catch (e) {
      window.prompt('复制这个链接发给朋友：', url);
    }
  };
  $('pvpRefresh').onclick = function () { load(); };
  $('pvpResign').onclick = resign;

  /* ---------- 本地预览的调试条（只在 127.0.0.1 出现，正式站没有） ---------- */
  let devBar = null;
  function paintDev(v) {
    if (!devBar) return;
    const who = v.seat === 'host' ? v.host.name : ((v.guest && v.guest.name) || '旁观');
    const seat = v.seat === 'host' ? '房主' : (v.seat === 'guest' ? '对手' : '—');
    const el = document.getElementById('pvpDevWho');
    if (el) el.textContent = '身份：' + who + '（' + seat + '）· as=' + (asParam || '1');
  };
  function buildDev() {
    const box = document.createElement('div');
    box.id = 'pvpDev';
    box.innerHTML = '<span id="pvpDevWho">身份：—</span>'
      + '<button type="button" data-dev="swap">换成对方</button>'
      + '<button type="button" data-dev="auto">替对方出牌</button>'
      + '<button type="button" data-dev="new">新开一局</button>';
    (document.getElementById('pvpBar') || document.body).appendChild(box);
    devBar = box;
    box.addEventListener('click', async function (e) {
      const act = e.target && e.target.getAttribute('data-dev');
      if (!act) return;
      if (act === 'swap') {
        const other = asParam === '2' ? '1' : '2';
        location.href = '/games/quality/?room=' + code + '&as=' + other;
        return;
      }
      if (act === 'new') {
        try {
          const r = await api('/api/pvp/rooms', { method: 'POST' });
          location.href = r.url + (asParam ? '&as=' + encodeURIComponent(asParam) : '');
        } catch (err) { note(err.message || '开房失败'); }
        return;
      }
      if (act === 'auto') {
        try {
          const prevHist = PVP.view ? PVP.view.history.length : 0;
          const r = await api('/api/pvp/dev/auto', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }),
          });
          const v = r.room;
          if (v && v.last && v.history.length > prevHist) {
            apply(v, { mine: v.last.mine, theirs: v.last.theirs, fx: v.last.fx || [] });
          } else if (v) {
            apply(v);
          }
          note(r.played ? '替对方出了一手' : '对方已经出过了');
        } catch (err) { note(err.message || '自动出牌失败（正式站没有这个接口）'); }
      }
    });
  }

  /* ---------- 启动 ---------- */
  STARTED = false;
  sel = [];
  try { if (typeof closeGuide === 'function') closeGuide(); } catch (e) {}
  if (isDev) buildDev();

  (async function boot() {
    try {
      const v = await api('/api/pvp/rooms/' + encodeURIComponent(code));
      apply(v);
      if (v.status === 'waiting' && v.seat === 'host') note('等对方加入 —— 把邀请链接发过去');
    } catch (e) {
      if (e.status === 401) {
        const el = $('pvpNote');
        if (el) el.innerHTML = '请先 <a href="/#/login" style="color:#e9d6a8">登录</a>，再打开这个房间';
        return;
      }
      if (e.status === 403) { await joinRoom(); return; }   // 还没入座：自动坐下
      note(e.message || '连接失败');
      console.warn('[pvp]', e);
    }
  })();

  // 等对方出牌 / 等对方加入时每 10 秒拉一次
  PVP.timer = setInterval(function () {
    if (document.hidden || PVP.animating) return;
    const v = PVP.view;
    if (!v || v.over) return;
    if (v.status === 'waiting' || phase === 'wait' || v.myPlayed) load(true);
  }, 10000);
})();
