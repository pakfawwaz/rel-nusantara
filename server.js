// Minimal static server for Heroku and local play. No dependencies.
// Files are gzipped once and kept in memory: the kecamatan data is ~6.6 MB raw.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
};
const PUBLIC = ['index.html', 'css/', 'js/', 'data/'];
const cache = new Map(); // file -> { raw, gz, mtime }

function load(file, cb) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return cb(err || new Error('not a file'));
    const hit = cache.get(file);
    if (hit && hit.mtime === st.mtimeMs) return cb(null, hit);
    fs.readFile(file, (err2, raw) => {
      if (err2) return cb(err2);
      const entry = { raw, gz: zlib.gzipSync(raw, { level: 9 }), mtime: st.mtimeMs };
      cache.set(file, entry);
      cb(null, entry);
    });
  });
}

http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html'; }
  catch (e) { res.writeHead(400); return res.end('Bad request'); }
  const file = path.normalize(path.join(ROOT, rel));
  rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (!PUBLIC.some((p) => rel === p || rel.startsWith(p))) { res.writeHead(404); return res.end('Not found'); }
  load(file, (err, entry) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const headers = {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      // data files never change between deploys; code is revalidated each load
      'Cache-Control': rel.startsWith('data/') ? 'public, max-age=86400' : 'no-cache',
      Vary: 'Accept-Encoding',
    };
    if (gzip) headers['Content-Encoding'] = 'gzip';
    const body = gzip ? entry.gz : entry.raw;
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}).listen(PORT, () => console.log(`Rel Nusantara running on port ${PORT}`));
