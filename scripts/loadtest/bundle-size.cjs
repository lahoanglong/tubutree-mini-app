// Tổng hợp kích thước JS/CSS/ảnh/font của 1 thư mục build (raw + gzip). Dùng: node bundle-size.cjs <dir> [top]
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const root = path.resolve(process.argv[2]);
const top = Number(process.argv[3] || 12);
const rows = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else { const b = fs.readFileSync(p); rows.push({ p: path.relative(root, p).split(path.sep).join('/'), raw: b.length, gz: /\.(js|css|html|json|svg|map)$/.test(p) ? zlib.gzipSync(b).length : b.length }); }
  }
})(root);
const sum = (re) => { const r = rows.filter((x) => re.test(x.p)); return { files: r.length, rawKB: Math.round(r.reduce((s, x) => s + x.raw, 0) / 1024), gzKB: Math.round(r.reduce((s, x) => s + x.gz, 0) / 1024) }; };
console.log('JS', JSON.stringify(sum(/\.js$/)), '\nCSS', JSON.stringify(sum(/\.css$/)), '\nIMG/FONT', JSON.stringify(sum(/\.(png|jpe?g|webp|gif|svg|woff2?|ttf)$/)), '\nALL', JSON.stringify(sum(/./)));
rows.sort((a, b) => b.raw - a.raw);
console.log(rows.slice(0, top).map((x) => `${x.p}  ${Math.round(x.raw / 1024)}KB raw / ${Math.round(x.gz / 1024)}KB gz`).join('\n'));
