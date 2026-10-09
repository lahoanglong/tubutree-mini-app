// Máy chủ tĩnh tối giản (SPA fallback) để phục vụ bản build miniapp khi đo request/bytes. Dùng: node static-server.cjs <dir> <port>
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2]); const port = Number(process.argv[3] || 3399);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(root, 'index.html');
  res.setHeader('Content-Type', types[path.extname(p)] || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log('static on', port));
