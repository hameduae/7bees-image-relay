const http = require('http');

const SECRET = process.env.RELAY_SECRET || '';
const PORT = process.env.PORT || 8080;
const store = new Map(); // id -> {buffer, mime, expires}

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function cleanup() {
  const now = Date.now();
  for (const [k, v] of store) if (v.expires < now) store.delete(k);
}

const server = http.createServer((req, res) => {
  cleanup();
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); return res.end('bad url'); }

  if (req.method === 'POST' && url.pathname === '/upload') {
    const key = req.headers['x-api-key'];
    if (!SECRET || key !== SECRET) { res.writeHead(401); return res.end('unauthorized'); }
    const id = url.searchParams.get('id');
    const ext = (url.searchParams.get('ext') || 'jpg').toLowerCase();
    if (!id || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !MIME[ext]) { res.writeHead(400); return res.end('bad id/ext'); }
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > 30 * 1024 * 1024) { tooBig = true; req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return;
      const buf = Buffer.concat(chunks);
      store.set(id, { buffer: buf, mime: MIME[ext], expires: Date.now() + 30 * 60 * 1000 });
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const proto = req.headers['x-forwarded-proto'] || 'https';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ url: `${proto}://${host}/image/${id}.${ext}` }));
    });
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/image/')) {
    const fname = url.pathname.slice('/image/'.length);
    const m = fname.match(/^([a-zA-Z0-9_-]{1,80})\.(jpg|jpeg|png|webp)$/);
    if (!m) { res.writeHead(400); return res.end('bad request'); }
    const item = store.get(m[1]);
    if (!item) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'content-type': item.mime,
      'content-length': item.buffer.length,
      'cache-control': 'public, max-age=300',
    });
    res.end(item.buffer);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200);
    return res.end('ok');
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => console.log('7bees image relay listening on', PORT));
