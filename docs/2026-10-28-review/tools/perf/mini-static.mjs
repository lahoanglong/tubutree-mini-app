// Máy chủ tĩnh cho bản build Mini App đo hiệu năng (thay vite preview).
// Lý do: ở production zmp-ui ZMPRouter đặt basename "/zapps/<APP_ID>", và index.html dùng đường dẫn tương đối (base ''),
// nên cần phục vụ /zapps/<id>/... + mọi đường dẫn có ".../assets/<tệp>" từ thư mục build, còn lại trả index.html.
// Nén gzip như CDN thật; không đặt cache dài (mỗi lần đo là trình duyệt mới nên không ảnh hưởng).
// Dùng: node mini-static.mjs <thư mục build> <cổng>
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';

const [dir, port = '3603'] = process.argv.slice(2);
if (!dir) throw new Error('thiếu thư mục build');
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const i = u.pathname.indexOf('/assets/');
    let file = path.join(dir, 'index.html');
    if (i >= 0) {
      const cand = path.join(dir, decodeURIComponent(u.pathname.slice(i)));
      if (cand.startsWith(dir) && fs.existsSync(cand) && fs.statSync(cand).isFile()) file = cand;
      else {
        res.writeHead(404).end();
        return;
      }
    }
    const ext = path.extname(file);
    const body = fs.readFileSync(file);
    const type = TYPES[ext] ?? 'application/octet-stream';
    const gz = /\.(js|css|html|json|svg)$/.test(ext) && /gzip/.test(req.headers['accept-encoding'] ?? '');
    const out = gz ? zlib.gzipSync(body, { level: 6 }) : body;
    res.writeHead(200, { 'content-type': type, ...(gz ? { 'content-encoding': 'gzip' } : {}), 'content-length': out.length, 'cache-control': 'no-cache' });
    res.end(out);
  })
  .listen(Number(port), '127.0.0.1');
