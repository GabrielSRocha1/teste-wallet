// Servidor HTTP minimal — só pra contornar o bloqueio de fetch() em file:// do Chrome.
// Uso: node serve.js  →  http://localhost:8000/preview.html
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 8000;
const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.json': 'application/json',
};

// Proxy do RPC publico da Solana — getAsset (DAS) + getTokenSupply.
// Esses metodos sao bloqueados quando chamados de browsers (403 com Origin
// header). Servidor Node nao tem origin, entao funcionam.
function rpcCall(method, params) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const r = require('https').request('https://api.mainnet-beta.solana.com', opts, (resp) => {
      let data = '';
      resp.on('data', (c) => data += c);
      resp.on('end', () => {
        try { resolve(JSON.parse(data).result || null); } catch { resolve(null); }
      });
    });
    r.on('error', () => resolve(null));
    r.write(body);
    r.end();
  });
}

async function proxyAsset(mint, res) {
  try {
    const [asset, sup] = await Promise.all([
      rpcCall('getAsset',       { id: mint }),
      rpcCall('getTokenSupply', [mint]),
    ]);
    const c = (asset && asset.content) || {};
    const out = {
      image:    (c.links && c.links.image) || (c.files && c.files[0] && c.files[0].uri) || null,
      name:     (c.metadata && c.metadata.name)   || null,
      symbol:   (c.metadata && c.metadata.symbol) || null,
      supply:   (sup && sup.value && typeof sup.value.uiAmount === 'number') ? sup.value.uiAmount : null,
      decimals: (sup && sup.value && typeof sup.value.decimals === 'number') ? sup.value.decimals : null,
    };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' });
    res.end(JSON.stringify(out));
  } catch {
    res.writeHead(502); res.end('{}');
  }
}

http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  let p = decodeURIComponent(u.pathname);
  // Proxy: /api/asset?mint=<mint> (mesma rota da serverless function da Vercel)
  if (p === '/api/asset') {
    const mint = u.searchParams.get('mint') || '';
    if (!/^[A-Za-z0-9]{32,44}$/.test(mint)) { res.writeHead(400); res.end('{"error":"invalid mint"}'); return; }
    proxyAsset(mint, res);
    return;
  }
  if (p === '/') p = '/preview.html';
  const filePath = path.join(ROOT, p);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + p); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Servindo ${ROOT} em http://localhost:${PORT}/`);
  console.log(`Abra: http://localhost:${PORT}/preview.html`);
});
