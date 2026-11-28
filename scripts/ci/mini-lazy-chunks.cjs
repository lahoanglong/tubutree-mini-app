#!/usr/bin/env node
// Rào chunk tải lười của Mini App: các mô-đun cố ý chỉ nạp khi cần (bộ vẽ ảnh chia sẻ, game, khối dưới màn đầu, trợ lý…) phải còn là chunk
// riêng và chỉ được nạp bằng import() động. Chặn CI (thoát 1) khi vi phạm.
//   node scripts/ci/mini-lazy-chunks.cjs apps/miniapp/www
//
// Vì sao cần: vite.config dùng `experimentalMinChunkSize: 2_000`, Rollup gộp chunk thuần dưới 2 KB vào chunk khác, kể cả chunk import tĩnh.
// tubu-w20-02: một mô-đun app-core dùng chung cho phần nạp sẵn và bộ vẽ lười đã kéo cả bộ vẽ `share-poster-png` vào chunk `share-sheet`,
// mà 10 trang import tĩnh chunk đó. bundle-budget.cjs chỉ cân tổng và entry nên không thấy lỗi kiểu này.
//
// Bốn luật, đo trên bản build (tên tệp `assets/<tên>.<băm 7>.module.js`):
//   1. Mỗi tên trong LAZY_ONLY còn đúng một chunk riêng. Mất tệp nghĩa là Rollup đã gộp mô-đun đó vào chunk khác.
//   2. Không chunk nào import TĨNH chunk đó (`import … from"./x.js"`, `import"./x.js"`, `export … from"./x.js"`), chỉ `import("./x.js")`.
//   3. Không chunk nào trong bao đóng import tĩnh của entry (script module + modulepreload của index.html) bị chính bao đóng đó import động:
//      import động tới một chunk đã nạp sẵn là dấu hiệu mô-đun lười bị kéo về đường nạp đầu.
//   4. Mỗi tên trong NOT_EAGER còn đúng một chunk riêng và chunk đó nằm ngoài bao đóng import tĩnh của entry. Chunk trang con được import tĩnh nó.
// Đổi tên hay bỏ hẳn một mô-đun trong LAZY_ONLY thì sửa danh sách trong cùng PR (thông báo lỗi nêu tên).
const fs = require('fs');
const path = require('path');

/** Chunk lười có tên ổn định, mỗi chunk ≥ 3 KB (dưới ngưỡng gộp thì Rollup có thể gộp vào chunk lười khác, không hại, nhưng tên mất). */
const LAZY_ONLY = [
  'share-poster-png', // bộ vẽ ảnh chia sẻ PNG (canvas), chỉ khi bấm chia sẻ: sự cố tubu-w20-02
  'arcade-canvas', // khung vẽ game arcade
  'arcade-game-overlay', // lớp phủ game arcade
  'mini-round-shell', // khung ván game mini
  'game-matcher', // game Chọn Chuẩn Xanh
  'home-below', // các khối dưới màn đầu của Trang chủ
  'home-quiz-sheet', // tấm câu đố Trang chủ
  'product-story-showcase', // câu chuyện sản phẩm ở trang chi tiết
  'ai-advisor', // trợ lý chọn sản phẩm
  'support-chat', // trò chuyện hỗ trợ
  'repurchase-due-card', // thẻ Mua lại hàng tiêu hao ở Cá nhân và giỏ trống (w36-01)
  'christmas-home', // Noel Xanh ở Trang chủ (cây thông, lịch quà, tuyết, dây đèn): chỉ tải khi theme.seasonal = christmas (w57-01)
  'christmas-garden', // Cây Thông Noel Tự Trang Trí ở thẻ đầu Vườn Xanh: chỉ tải khi theme.seasonal = christmas (w57-02)
];

/** Chunk mà trang con import tĩnh nhưng gói đầu không được kéo theo. */
const NOT_EAGER = [
  // Toàn bảng chữ gian hàng SHOP_COPY (~52 KB). Mô-đun gói đầu dùng `fillBootCopy` (packages/app-core/src/shop-copy-boot.ts); một lệnh `fillCopy`
  // trong mô-đun gói đầu đưa cả bảng về entry (tubu-w31-04).
  'shop-copy',
];

const CHUNK_RE = /^(.+)\.[A-Za-z0-9_-]{7}\.module\.js$/;
const STATIC_RE = /(?:^|[;}\s/])(?:import|export)\s*(?:[\w$*{}\s,]*?from\s*)?["']\.\/([^"']+\.js)["']/g;
const DYNAMIC_RE = /\bimport\(\s*["']\.\/([^"']+\.js)["']\s*\)/g;

const chunkName = (file) => {
  const m = CHUNK_RE.exec(file);
  return m ? m[1] : null;
};

function readGraph(assets) {
  const files = fs.readdirSync(assets).filter((f) => f.endsWith('.js'));
  const graph = new Map();
  for (const file of files) {
    const src = fs.readFileSync(path.join(assets, file), 'utf8');
    const statics = new Set([...src.matchAll(STATIC_RE)].map((m) => path.posix.basename(m[1])));
    const dynamics = new Set([...src.matchAll(DYNAMIC_RE)].map((m) => path.posix.basename(m[1])));
    graph.set(file, { statics, dynamics });
  }
  return graph;
}

/** Entry của index.html: `<script type="module" src>` và `<link rel="modulepreload" href>` trỏ vào assets/. */
function entryFiles(html) {
  const out = new Set();
  for (const m of html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/g)) out.add(path.posix.basename(m[1]));
  for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*\btype=["']module["']/g)) out.add(path.posix.basename(m[1]));
  for (const m of html.matchAll(/<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']([^"']+)["']/g)) out.add(path.posix.basename(m[1]));
  for (const m of html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']modulepreload["']/g)) out.add(path.posix.basename(m[1]));
  return [...out].filter((f) => f.endsWith('.js'));
}

function staticClosure(graph, roots) {
  const seen = new Set();
  const stack = roots.filter((f) => graph.has(f));
  while (stack.length > 0) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const dep of graph.get(f).statics) if (graph.has(dep) && !seen.has(dep)) stack.push(dep);
  }
  return seen;
}

function check(dir) {
  const errors = [];
  const assets = path.join(dir, 'assets');
  const htmlFile = path.join(dir, 'index.html');
  if (!fs.existsSync(assets) || !fs.existsSync(htmlFile)) {
    return { errors: [`không thấy ${path.relative(process.cwd(), assets) || assets} hoặc index.html: bản build đổi chỗ đầu ra hoặc build chưa chạy, nên chưa kiểm được chunk lười.`], lines: [] };
  }
  const graph = readGraph(assets);
  const entries = entryFiles(fs.readFileSync(htmlFile, 'utf8'));
  if (entries.length === 0) errors.push('index.html không có script module nào trỏ vào assets/: không xác định được entry.');
  const eager = staticClosure(graph, entries);
  const importersOf = (file) => [...graph].filter(([, g]) => g.statics.has(file)).map(([f]) => f);

  const lines = [`Chunk lười Mini App (${path.relative(process.cwd(), dir) || dir})`, `  Entry: ${entries.join(', ') || '(không có)'}; bao đóng import tĩnh: ${eager.size} chunk`];
  for (const name of LAZY_ONLY) {
    const files = [...graph.keys()].filter((f) => chunkName(f) === name);
    if (files.length !== 1) {
      errors.push(
        files.length === 0
          ? `Không còn chunk riêng "${name}": Rollup đã gộp mô-đun lười này vào chunk khác (experimentalMinChunkSize), hoặc mô-đun đã đổi tên (khi đó sửa LAZY_ONLY trong scripts/ci/mini-lazy-chunks.cjs).`
          : `Có ${files.length} chunk tên "${name}" (${files.join(', ')}): không biết chunk nào là bản lười.`,
      );
      continue;
    }
    const file = files[0];
    const size = fs.statSync(path.join(assets, file)).size;
    const importers = importersOf(file);
    const dynamicFrom = [...graph].filter(([, g]) => g.dynamics.has(file)).map(([f]) => f);
    if (importers.length > 0) errors.push(`Chunk lười "${name}" bị import tĩnh từ ${importers.join(', ')}: nó sẽ tải cùng các chunk đó thay vì chỉ khi cần.`);
    if (eager.has(file)) errors.push(`Chunk lười "${name}" nằm trong đường nạp đầu của entry.`);
    if (dynamicFrom.length === 0) errors.push(`Chunk lười "${name}" không có import() động nào trỏ tới: không còn được nạp lười (hoặc cách nạp đã đổi).`);
    lines.push(`  ${name.padEnd(24)} ${String(size).padStart(7)} byte  import() từ ${dynamicFrom.length} chunk, import tĩnh từ ${importers.length}`);
  }
  for (const name of NOT_EAGER) {
    const files = [...graph.keys()].filter((f) => chunkName(f) === name);
    if (files.length !== 1) {
      errors.push(
        files.length === 0
          ? `Không còn chunk riêng "${name}": Rollup đã gộp mô-đun này vào chunk khác, hoặc mô-đun đã đổi tên (khi đó sửa NOT_EAGER trong scripts/ci/mini-lazy-chunks.cjs).`
          : `Có ${files.length} chunk tên "${name}" (${files.join(', ')}).`,
      );
      continue;
    }
    const file = files[0];
    const size = fs.statSync(path.join(assets, file)).size;
    if (eager.has(file)) {
      const from = [...eager].filter((f) => graph.get(f).statics.has(file));
      errors.push(`Chunk "${name}" nằm trong đường nạp đầu của entry (import tĩnh từ ${from.join(', ') || 'index.html'}): gói đầu kéo cả chunk này.`);
    }
    lines.push(`  ${name.padEnd(24)} ${String(size).padStart(7)} byte  ngoài đường nạp đầu: ${eager.has(file) ? 'không' : 'có'}`);
  }
  for (const file of eager) {
    for (const target of graph.get(file).dynamics) {
      if (eager.has(target)) errors.push(`${file} import() động ${target} nhưng ${target} đã nằm trong đường nạp đầu: mô-đun lười đã bị kéo về chunk tĩnh.`);
    }
  }
  return { errors, lines };
}

function main() {
  const dir = path.resolve(process.argv[2] || 'apps/miniapp/www');
  const { errors, lines } = check(dir);
  console.log(lines.join('\n'));
  for (const e of errors) console.log(`::error title=Chunk lười Mini App::${e}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = ['### Chunk lười Mini App', '', ...lines.slice(1).map((l) => `- ${l.trim()}`), ...errors.map((e) => `\n> **Lỗi:** ${e}`), ''].join('\n');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }
  console.log(errors.length === 0 ? `Đạt: ${LAZY_ONLY.length} chunk lười đều riêng và chỉ nạp bằng import(); ${NOT_EAGER.length} chunk ngoài đường nạp đầu.` : `Không đạt: ${errors.length} lỗi.`);
  process.exit(errors.length === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { LAZY_ONLY, NOT_EAGER, check };
