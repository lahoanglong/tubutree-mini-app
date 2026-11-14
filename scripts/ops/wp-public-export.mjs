#!/usr/bin/env node
// Sao lưu CÔNG KHAI của WordPress tubutree.com trước cutover apex, chỉ bằng GET tới sitemap, REST /wp-json/wp/v2 và tệp ảnh. KHÔNG ghi gì lên WordPress.
// Không thay được bản sao CSDL (mysqldump) hay wp-config.php/.htaccess: những thứ đó nằm trên ZenCloud, chỉ lấy được bằng tài khoản cPanel/SSH của chủ.
//
//   node scripts/ops/wp-public-export.mjs --out /opt/backups/tubutree-wp-precutover-20261114/wp-public-export \
//        --uploads-dir /www/wwwroot/tubutree.com/wp-content/uploads
//   node scripts/ops/wp-public-export.mjs --help
//
// Việc làm (mỗi bước lặp lại an toàn, tệp đã có đủ thì bỏ qua):
//   1. Tải sitemap_index.xml và mọi sitemap con vào <out>/sitemaps/.
//   2. Tải JSON đầy đủ của posts, pages, product, product_cat, categories, tags, media (phân trang 100) vào <out>/rest/.
//   3. Gom mọi URL /wp-content/uploads/... (nguồn ảnh + mọi kích cỡ trong thư viện media, và ảnh nhúng trong nội dung bài/trang/sản phẩm).
//   4. Với --uploads-dir: tải ảnh về đó theo đúng đường dẫn (/wp-content/uploads/2024/05/a.png -> <uploads-dir>/2024/05/a.png), ghi qua tệp .part rồi đổi tên.
//   5. Ghi <out>/MANIFEST.sha256 (sha256 từng tệp JSON/sitemap), <out>/uploads.sha256 (từng ảnh), <out>/uploads-missing.txt (URL trả 404 ở nguồn), <out>/summary.json.
// Mã thoát: 0 đủ, 1 có ảnh lỗi mạng/5xx (404 ở nguồn chỉ ghi vào uploads-missing.txt), 2 sai tham số.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const REST_TYPES = ['posts', 'pages', 'product', 'product_cat', 'categories', 'tags', 'media'];
const UPLOAD_RE = /https?:\/\/(?:www\.)?tubutree\.com\/wp-content\/uploads\/[^\s"'<>)\\,&?#]+/g;
const UA = 'tubutree-w148b-export/1';

const HELP = `Dùng: node scripts/ops/wp-public-export.mjs --out DIR [tuỳ chọn]

  --out DIR            thư mục ghi sitemap, REST JSON, manifest (bắt buộc)
  --uploads-dir DIR    tải ảnh /wp-content/uploads về đây (bỏ qua = chỉ xuất JSON và danh sách URL)
  --origin URL         gốc WordPress (mặc định https://tubutree.com)
  --resolve-ip IP      kết nối thẳng tới IP origin nhưng giữ Host/SNI (cần khi DNS đã trỏ về VPS), vd 42.1.122.84
  --concurrency N      số tải song song (3)
  --delay-ms N         nghỉ giữa hai request của mỗi luồng (120)
  --limit N            chỉ tải N ảnh đầu (thử)
  --dry-run            chỉ xuất JSON và đếm URL, không ghi ảnh
  -h, --help           in trợ giúp này`;

export function parseArgs(argv) {
  const opts = { out: '', uploadsDir: '', origin: 'https://tubutree.com', resolveIp: '', concurrency: 3, delayMs: 120, limit: 0, dryRun: false, help: false };
  const takes = new Set(['--out', '--uploads-dir', '--origin', '--resolve-ip', '--concurrency', '--delay-ms', '--limit']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (takes.has(arg)) {
      i += 1;
      const value = argv[i];
      if (value === undefined) throw new Error(`${arg} cần một giá trị`);
      if (arg === '--out') opts.out = value;
      else if (arg === '--uploads-dir') opts.uploadsDir = value;
      else if (arg === '--origin') opts.origin = value;
      else if (arg === '--resolve-ip') opts.resolveIp = value;
      else {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) throw new Error(`${arg} cần số nguyên không âm`);
        if (arg === '--concurrency') opts.concurrency = Math.max(1, n);
        else if (arg === '--delay-ms') opts.delayMs = n;
        else opts.limit = n;
      }
    } else throw new Error(`Tham số lạ: ${arg}`);
  }
  if (!opts.help && !opts.out) throw new Error('thiếu --out');
  try {
    new URL(opts.origin);
  } catch {
    throw new Error(`--origin không phải URL: ${opts.origin}`);
  }
  return opts;
}

/** Đường dẫn con của /wp-content/uploads/ không thoát thư mục; trả đường dẫn tương đối đã giải mã hoặc null. */
export function safeUploadPath(pathname) {
  if (!pathname.startsWith('/wp-content/uploads/')) return null;
  let rel;
  try {
    rel = decodeURIComponent(pathname.slice('/wp-content/uploads/'.length));
  } catch {
    return null;
  }
  if (!rel || rel.includes('\0') || rel.split('/').some((part) => part === '..' || part === '' || part === '.')) return null;
  return rel;
}

/** Gom mọi URL ảnh uploads của tubutree.com trong một chuỗi hay đối tượng JSON; trả tập đường dẫn (không query, không #). */
export function collectUploadPaths(value, into = new Set()) {
  // JSON thô viết dấu / thành \/ ; đưa về / trước khi dò URL.
  const text = (typeof value === 'string' ? value : JSON.stringify(value)).replace(/\\\//g, '/');
  for (const raw of text.match(UPLOAD_RE) ?? []) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (safeUploadPath(url.pathname)) into.add(url.pathname);
  }
  return into;
}

function request(origin, resolveIp, pathAndQuery, { timeout = 60000 } = {}) {
  const url = new URL(pathAndQuery, origin);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'GET',
        host: resolveIp || url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        headers: { host: url.host, 'user-agent': UA, accept: '*/*' },
        servername: url.hostname,
        timeout,
      },
      (res) => resolve(res),
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function getBuffer(origin, resolveIp, pathAndQuery) {
  const res = await request(origin, resolveIp, pathAndQuery);
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  return { status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256Of = (file) =>
  new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });

function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile() && !entry.name.endsWith('.part')) out.push(full);
  }
  return out;
}

async function exportSitemaps(opts, outDir) {
  const dir = path.join(outDir, 'sitemaps');
  mkdirSync(dir, { recursive: true });
  const index = await getBuffer(opts.origin, opts.resolveIp, '/sitemap_index.xml');
  if (index.status !== 200) throw new Error(`sitemap_index.xml trả ${index.status}`);
  writeFileSync(path.join(dir, 'sitemap_index.xml'), index.body);
  const names = [...index.body.toString('utf8').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => new URL(m[1]).pathname.replace(/^\//, ''));
  for (const name of names) {
    const res = await getBuffer(opts.origin, opts.resolveIp, `/${name}`);
    if (res.status !== 200) throw new Error(`${name} trả ${res.status}`);
    writeFileSync(path.join(dir, name), res.body);
    await sleep(opts.delayMs);
  }
  return names.length + 1;
}

async function exportRest(opts, outDir, uploadPaths) {
  const dir = path.join(outDir, 'rest');
  mkdirSync(dir, { recursive: true });
  const counts = {};
  for (const type of REST_TYPES) {
    const items = [];
    for (let page = 1; ; page += 1) {
      const res = await getBuffer(opts.origin, opts.resolveIp, `/wp-json/wp/v2/${type}?per_page=100&page=${page}`);
      if (res.status === 400 && page > 1) break;
      if (res.status !== 200) throw new Error(`REST ${type} trang ${page} trả ${res.status}`);
      const batch = JSON.parse(res.body.toString('utf8'));
      if (!Array.isArray(batch) || batch.length === 0) break;
      items.push(...batch);
      const total = Number(res.headers['x-wp-totalpages'] ?? '1');
      await sleep(opts.delayMs);
      if (page >= total) break;
    }
    writeFileSync(path.join(dir, `${type}.json`), JSON.stringify(items));
    counts[type] = items.length;
    collectUploadPaths(items, uploadPaths);
  }
  return counts;
}

async function downloadOne(opts, urlPath, rel, destRoot, stats) {
  const dest = path.join(destRoot, rel);
  if (existsSync(dest) && statSync(dest).size > 0) {
    stats.skipped += 1;
    return;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  try {
    // urlPath là pathname của URL nên đã được mã hoá phần trăm; mã hoá thêm lần nữa làm hỏng tên có dấu (%C2 thành %25C2) và trả 404 giả.
    const res = await request(opts.origin, opts.resolveIp, urlPath);
    if (res.statusCode === 404 || res.statusCode === 410) {
      res.resume();
      stats.missing.push(urlPath);
      return;
    }
    if (res.statusCode !== 200) {
      res.resume();
      stats.failed.push(`${urlPath} ${res.statusCode}`);
      return;
    }
    const expected = Number(res.headers['content-length'] ?? '-1');
    await pipeline(res, createWriteStream(part));
    const got = statSync(part).size;
    if (expected >= 0 && got !== expected) {
      rmSync(part, { force: true });
      stats.failed.push(`${urlPath} kích thước ${got} khác Content-Length ${expected}`);
      return;
    }
    renameSync(part, dest);
    stats.downloaded += 1;
    stats.bytes += got;
  } catch (err) {
    rmSync(part, { force: true });
    stats.failed.push(`${urlPath} ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function downloadUploads(opts, paths, destRoot) {
  const stats = { downloaded: 0, skipped: 0, bytes: 0, missing: [], failed: [] };
  const queue = paths.map((p) => [p, safeUploadPath(p)]).filter(([, rel]) => rel);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency, queue.length) }, async () => {
      while (cursor < queue.length) {
        const [urlPath, rel] = queue[cursor];
        cursor += 1;
        await downloadOne(opts, urlPath, rel, destRoot, stats);
        if (opts.delayMs) await sleep(opts.delayMs);
      }
    }),
  );
  return stats;
}

async function writeManifest(files, base, target) {
  const lines = [];
  for (const file of files.sort()) lines.push(`${await sha256Of(file)}  ${path.relative(base, file)}`);
  writeFileSync(target, `${lines.join('\n')}\n`);
  return lines.length;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n\n${HELP}`);
    return 2;
  }
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  const outDir = path.resolve(opts.out);
  mkdirSync(outDir, { recursive: true });
  const summary = { origin: opts.origin, resolveIp: opts.resolveIp || null, startedAt: new Date().toISOString() };

  summary.sitemaps = await exportSitemaps(opts, outDir);
  const uploadPaths = new Set();
  summary.rest = await exportRest(opts, outDir, uploadPaths);
  let list = [...uploadPaths].sort();
  summary.uploadUrls = list.length;
  writeFileSync(path.join(outDir, 'uploads-urls.txt'), `${list.join('\n')}\n`);
  if (opts.limit) list = list.slice(0, opts.limit);
  console.log(`sitemap: ${summary.sitemaps} tệp; REST: ${JSON.stringify(summary.rest)}; ảnh uploads: ${summary.uploadUrls} URL`);

  let exitCode = 0;
  if (opts.uploadsDir && !opts.dryRun) {
    const destRoot = path.resolve(opts.uploadsDir);
    mkdirSync(destRoot, { recursive: true });
    const stats = await downloadUploads(opts, list, destRoot);
    summary.uploads = { downloaded: stats.downloaded, skipped: stats.skipped, bytes: stats.bytes, missing: stats.missing.length, failed: stats.failed.length };
    writeFileSync(path.join(outDir, 'uploads-missing.txt'), `${stats.missing.join('\n')}${stats.missing.length ? '\n' : ''}`);
    writeFileSync(path.join(outDir, 'uploads-failed.txt'), `${stats.failed.join('\n')}${stats.failed.length ? '\n' : ''}`);
    summary.uploadFiles = await writeManifest(walkFiles(destRoot), destRoot, path.join(outDir, 'uploads.sha256'));
    console.log(`ảnh: tải ${stats.downloaded}, đã có ${stats.skipped}, 404 ở nguồn ${stats.missing.length}, lỗi ${stats.failed.length}, ${stats.bytes} byte; trên đĩa ${summary.uploadFiles} tệp`);
    if (stats.failed.length) exitCode = 1;
  }
  summary.finishedAt = new Date().toISOString();
  const jsonFiles = [...walkFiles(path.join(outDir, 'rest')), ...walkFiles(path.join(outDir, 'sitemaps'))];
  summary.manifestFiles = await writeManifest(jsonFiles, outDir, path.join(outDir, 'MANIFEST.sha256'));
  writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary));
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
