/* ============================================================================
   咖啡馆前台（AI 对话）· 前端代码存档
   ----------------------------------------------------------------------------
   2026 年暂时下线这个功能时，从 public/js/app.js 里整块抽出来的，逻辑没有改动。
   连同后端一起下线：functions/api/[[route]].js 里的 CHAT_FEATURE 开关。
   数据库里的 chat_usage / chat_daily / settings 三张表和 admin 设定的内容都还在，
   所以恢复之后读者之前的对话设定不会丢（对话记录本来就是不保存的）。

   ============================ 怎么恢复 ============================
   1) 把本文件移到 public/js/chat-module.js
   2) public/index.html 里，在 app.js 之后加一行：
        <script src="js/chat-module.js"></script>
   3) public/js/app.js：
        · route() 里加回：  else if (parts[0] === 'chat') view = await this.renderChat();
          （并删掉「已下线，送回书架」那一行）
        · route() 的 admin 分支里加回：  else if (sub === 'chat') view = await this.renderAdminChat();
        · route() 里加回：  if (parts[0] !== 'chat') this.chatHistory = [];
        · renderMenu() 的卡片列表里加回文末注释里的那张卡片
        · adminNav() 里加回：  <a class="${active === 'chat' ? 'active' : ''}" href="#/admin/chat">对话设定</a>
        · afterRender() 里加回文末注释里的那几行事件绑定
   4) functions/api/[[route]].js：把 CHAT_FEATURE 改成 true，并配好 DEEPSEEK_API_KEY
   ================================================================ */

Object.assign(App, {
  chatHistory: [],     // 本次对话（只存在内存，离开即清空）
  chatBusy: false,

  /* ---------- 与柒乃聊天（咖啡馆对话页，需要登录） ---------- */
  async renderChat() {
    if (!this.state.user) { location.hash = '#/login'; return ''; }
    this.pageTitle = '咖啡馆前台 · 白日梦咖啡馆';
    let cfg = { enabled: true, greeting: '欢迎来到白日梦咖啡馆。今天想聊点什么？' };
    try { cfg = await API.get('/api/chat/config'); } catch (e) {}
    const bubbles = this.chatHistory.map(mm => `
      <div class="chat-msg ${mm.role}">
        ${mm.role === 'assistant' ? this.avatarHtml({ username: '潮見柒乃', avatar: '' }, 32) : this.avatarHtml(this.state.user, 32)}
        <div class="chat-bubble">${esc(mm.content)}</div>
      </div>`).join('');
    return `
    <div class="page chat-page">
      ${this.topbar()}
      <div class="chat-wrap">
        <div class="chat-panel">
          <div class="chat-head">
            <div class="chat-nana">
              ${this.avatarHtml({ username: '潮見柒乃', avatar: '' }, 44)}
              <div class="chat-nana-info">
                <div class="chat-nana-name">潮見柒乃</div>
                <div class="chat-nana-sub">新的章节在写了。请不要催我。</div>
              </div>
            </div>
            ${cfg.enabled ? `<button class="btn btn-small btn-ghost" id="chatClearBtn">清空对话</button>` : ''}
          </div>
          ${cfg.enabled ? `
          <div class="chat-body" id="chatBody">
            <div class="chat-msg nana">
              ${this.avatarHtml({ username: '潮見柒乃', avatar: '' }, 32)}
              <div class="chat-bubble">${esc(cfg.greeting)}</div>
            </div>
            ${bubbles}
            <div class="chat-typing" id="chatTyping" style="display:none">
              ${this.avatarHtml({ username: '潮見柒乃', avatar: '' }, 32)}
              <div class="chat-bubble">柒乃：……</div>
            </div>
          </div>
          <form class="chat-input-row" id="chatForm">
            <input class="chat-input" name="text" placeholder="和柒乃说点什么……" autocomplete="off" maxlength="2000" required>
            <button class="btn btn-small btn-primary chat-send" type="submit">发送</button>
          </form>
          ` : `
          <div class="chat-closed"><p>柒乃现在休息中，请稍后再来。</p></div>
          `}
        </div>
      </div>
    </div>`;
  },

  appendChatBubble(role, content) {
    const body = document.getElementById('chatBody');
    if (!body) return;
    const div = document.createElement('div');
    div.className = 'chat-msg ' + role;
    const avatar = role === 'assistant'
      ? this.avatarHtml({ username: '潮見柒乃', avatar: '' }, 32)
      : this.avatarHtml(this.state.user, 32);
    div.innerHTML = avatar + `<div class="chat-bubble">${esc(content)}</div>`;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  },

  async handleChatSend(e) {
    e.preventDefault();
    const form = e.target;
    const text = form.text.value.trim();
    if (!text || this.chatBusy) return;
    form.text.value = '';
    this.chatHistory.push({ role: 'user', content: text });
    this.appendChatBubble('user', text);
    const typing = document.getElementById('chatTyping');
    const body = document.getElementById('chatBody');
    if (typing) typing.style.display = 'flex';
    if (body) body.scrollTop = body.scrollHeight;
    this.chatBusy = true;
    let reply;
    try {
      const data = await API.post('/api/chat', { messages: this.chatHistory }, 60000);
      reply = data.reply;
    } catch (err) {
      reply = '（' + err.message + '）';
    } finally {
      this.chatBusy = false;
      if (typing) typing.style.display = 'none';
    }
    this.chatHistory.push({ role: 'assistant', content: reply });
    this.appendChatBubble('assistant', reply);
  },

  handleChatClear() {
    if (this.chatBusy) { toast('柒乃正在说话，稍等片刻', 'err'); return; }
    this.chatHistory = [];
    this.route();
  },

  /* ---------- 后台：对话设定 ---------- */
  async renderAdminChat() {
    const u = this.state.user;
    if (!u || u.role !== 'admin') { location.hash = '#/menu'; return ''; }
    this.pageTitle = '对话设定 · 白日梦咖啡馆';
    const cfg = await API.get('/api/admin/chat-config');
    return `
    <div class="page">
      ${this.topbar()}
      ${this.adminNav('chat')}
      <div class="admin-head"><h2>对话设定</h2></div>
      <div class="admin-form-wrap">
        <form id="adminChatForm" class="admin-form">
          <div class="form-row">
            <label>启用对话</label>
            <label class="switch-row"><input type="checkbox" id="chatEnabled" ${cfg.enabled ? 'checked' : ''}> 允许读者与柒乃聊天</label>
          </div>
          <div class="form-row">
            <label>柒乃的开场白</label>
            <input type="text" id="chatGreeting" value="${esc(cfg.greeting)}">
          </div>
          <div class="form-row">
            <label>柒乃的人格设定（system prompt，决定她怎么说话）</label>
            <textarea id="chatPersona" rows="8">${esc(cfg.persona)}</textarea>
          </div>
          <div class="form-row">
            <button class="btn btn-primary" type="submit">保存设定</button>
          </div>
        </form>
      </div>
    </div>`;
  },

  async handleAdminChat(e) {
    e.preventDefault();
    try {
      await API.put('/api/admin/chat-config', {
        enabled: document.getElementById('chatEnabled').checked,
        persona: document.getElementById('chatPersona').value.trim(),
        greeting: document.getElementById('chatGreeting').value.trim(),
      });
      toast('对话设定已保存');
    } catch (err) { toast(err.message, 'err'); }
  },
});

/* ============================================================================
   下面这几段是恢复时要贴回 app.js 的 HTML / 事件绑定（原样保留）
   ----------------------------------------------------------------------------
   renderMenu() 的卡片：放在「设定」卡片之后

        <a class="menu-card menu-chat" href="#/chat">
          <div class="menu-card-icon">☕</div>
          <div class="menu-card-content">
            <h3>咖啡馆前台-Beta</h3>
            <p>与某神秘鲸鱼女子聊聊</p>
            <span class="menu-card-meta">${u ? '对话' : '需登录'}</span>
          </div>
          <div class="menu-card-arrow">→</div>
        </a>

   afterRender() 的事件绑定：

        // 对话功能
        const chatForm = document.getElementById('chatForm');
        if (chatForm) chatForm.onsubmit = (e) => this.handleChatSend(e);
        const chatClear = document.getElementById('chatClearBtn');
        if (chatClear) chatClear.onclick = () => this.handleChatClear();
        const chatBody = document.getElementById('chatBody');
        if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;
        const adminChatForm = document.getElementById('adminChatForm');
        if (adminChatForm) adminChatForm.onsubmit = (e) => this.handleAdminChat(e);

   样式：public/css/style.css 里「咖啡馆前台」那一节没有删，标注了「已下线」，直接可用。
   ============================================================================ */
