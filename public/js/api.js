const API = {
  async request(method, url, body, timeout) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout || 8000); // 默认8秒，可自定义
    opts.signal = ctrl.signal;
    try {
      const res = await fetch(url, opts);
      let data = null;
      try { data = await res.json(); } catch (e) {}
      if (!res.ok) {
        const err = new Error((data && data.error) || '请求失败');
        err.status = res.status;
        throw err;
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('加载超时，请刷新页面重试');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  },
  get:  (url) => API.request('GET', url),
  post: (url, body, timeout) => API.request('POST', url, body, timeout),
  put:  (url, body) => API.request('PUT', url, body),
  del:  (url) => API.request('DELETE', url),
};