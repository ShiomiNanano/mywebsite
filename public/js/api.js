const API = {
  async request(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || '请求失败');
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get:  (url) => API.request('GET', url),
  post: (url, body) => API.request('POST', url, body),
  put:  (url, body) => API.request('PUT', url, body),
  del:  (url) => API.request('DELETE', url),
};