#!/usr/bin/env node
// Sinh apps/web/src/lib/legacy-wp-product-map.json: slug sản phẩm WordPress cũ (/product/<slug>/) -> slug sản phẩm mới (/san-pham/<slug>).
// Chỉ đọc dữ liệu công khai; Node >= 22.18 (nạp thẳng legacy-wp-redirects.ts để biết các dòng PDP đã có người duyệt).
//
//   node scripts/ops/build-legacy-wp-product-map.mjs                # in tóm tắt, so với bản đồ đang commit
//   node scripts/ops/build-legacy-wp-product-map.mjs --write        # ghi lại bản đồ
//   node scripts/ops/build-legacy-wp-product-map.mjs --check        # thoát 1 nếu bản đồ đang commit khác kết quả sinh lại
//   node scripts/ops/build-legacy-wp-product-map.mjs --report r.md  # thêm báo cáo: độ phủ theo lượt truy cập, cặp cần người duyệt, slug không khớp
//   node scripts/ops/build-legacy-wp-product-map.mjs --fetch-catalog scripts/ops/data/legacy-catalog-<ngày>.json --catalog <cùng tệp>
//
// Nguồn (ảnh chụp trong scripts/ops/data/):
// - legacy-wp-products-*.json: WooCommerce Store API công khai của site cũ (blog.tubutree.com), có tên đầy đủ, thuộc tính và giá từng biến thể.
// - legacy-catalog-*.json: GET https://api.tubutree.com/api/products (công khai).
// - legacy-product-hits-*.json: số lượt `GET /product/<...>` đếm từ log Apache apex trên VPS (chỉ đếm theo đường dẫn, không lưu IP).
//
// Cách ghép:
// 1. Khớp chính xác: tên mới trùng tên WordPress (bỏ dấu, chữ thường, cùng dung tích) hoặc slug mới bỏ hậu tố băm 6 ký tự trùng slug cũ.
// 2. Khớp gần: điểm = min(độ phủ tên mới bởi slug + tên + thuộc tính cũ, độ phủ slug cũ bởi tên + slug mới). Jaccard thô trên slug không dùng được
//    vì tên mới dài và nhiều chữ quảng cáo (cùng một sản phẩm "ca-phe-muoi-csea" chỉ đạt 0,18). Chặn: chữ đầu slug cũ (loại sản phẩm) phải có
//    trong tên mới; dung tích ghi trên tên mới phải nằm trong các dung tích của trang cũ.
// 3. Nhiều ứng viên cùng điểm (sản phẩm WordPress có biến thể, web mới tách mỗi biến thể một trang): chọn ứng viên có dấu hiệu riêng (dung tích,
//    mùi) được tên trang cũ nhắc trước; chưa phân được thì theo thứ tự biến thể trên trang cũ; vẫn hoà thì đưa vào danh sách cần người duyệt.
// Điểm từ REVIEW_MIN tới dưới AUTO_MIN chỉ vào danh sách cần người duyệt, KHÔNG vào bản đồ. Slug đã có dòng PDP trong LEGACY_PRODUCT_REDIRECTS
// (người đã duyệt) không bị ghi đè.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULT_PATHS = {
  wp: `${REPO}scripts/ops/data/legacy-wp-products-20261116.json`,
  catalog: `${REPO}scripts/ops/data/legacy-catalog-20261116.json`,
  hits: `${REPO}scripts/ops/data/legacy-product-hits-20261116.json`,
  out: `${REPO}apps/web/src/lib/legacy-wp-product-map.json`,
  redirects: `${REPO}apps/web/src/lib/legacy-wp-redirects.ts`,
};
export const AUTO_MIN = 0.85;
export const REVIEW_MIN = 0.6;
export const HITS_DAY = '2026-11-16';

// Chữ đóng gói/nối không phân biệt sản phẩm: "Refill", "[Can 10L]" (dung tích đã đủ nói), "x 10 gói", "và".
const STOP = new Set(['refill', 'can', 'x', 'va']);
// Chữ mô tả mà tên mới thường bỏ: không bắt slug cũ phải có chúng ở tên mới.
const SLUG_FILLER = new Set(['organic', 'huu', 'co', 'size', 'big', 'nho', 'lon', 'sinh', 'hoc', 'tu', 'thien', 'nhien', 'an', 'vat', 'nguyen', 'chat']);
const VOLUME = /(\d+(?:[.,]\d+)?)\s*(ml|lit|l|kg|gram|gam|gr|g)(?![a-z0-9])/g;

export function fold(text) {
  return String(text).normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
}

function volumeKey(amount, unit) {
  let value = Number(amount.replace(',', '.'));
  let base = unit;
  if (unit === 'l' || unit === 'lit') [value, base] = [value * 1000, 'ml'];
  else if (unit === 'kg') [value, base] = [value * 1000, 'g'];
  else if (unit === 'gr' || unit === 'gam' || unit === 'gram') base = 'g';
  return `${Math.round(value * 100) / 100}${base}`;
}

/** Dung tích/khối lượng theo thứ tự xuất hiện, quy về ml hoặc g: "3,8L" -> 3800ml, "0,5L" -> 500ml, "1,4KG" -> 1400g, "chanh1L" -> 1000ml. */
export function volumesWithIndex(text) {
  const out = [];
  for (const m of fold(text).matchAll(VOLUME)) {
    const key = volumeKey(m[1], m[2]);
    if (!out.some((v) => v.key === key)) out.push({ key, index: m.index ?? 0 });
  }
  return out;
}
export const volumes = (text) => volumesWithIndex(text).map((v) => v.key);

export function tokens(text) {
  return fold(text)
    .replace(VOLUME, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t));
}

export const slugBase = (slug) => slug.replace(/-[0-9a-f]{6}$/, '');
const titleHead = (title) => title.split(/\s[–-]\s|–|,|\(|\|/)[0] ?? title;
const sameTokens = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);
const round = (n) => Math.round(n * 1000) / 1000;

function oldEvidence(old) {
  const attrText = (old.attributes ?? []).flatMap((a) => [a.name, ...(a.terms ?? [])]).join(' ');
  const slugText = old.slug.replace(/-/g, ' ');
  const slugTokens = tokens(slugText);
  return {
    slug: old.slug,
    title: old.name ?? '',
    words: new Set([...slugTokens, ...tokens(titleHead(old.name ?? '')), ...tokens(attrText)]),
    vols: new Set([...volumes(old.name ?? ''), ...volumes(attrText), ...volumes(slugText)]),
    core: new Set(slugTokens.filter((t) => !SLUG_FILLER.has(t) && !/^\d+$/.test(t))),
    kind: slugTokens[0] ?? '',
    attrTerms: (old.attributes ?? []).flatMap((a) => a.terms ?? []),
    prices: new Set([old.price, ...(old.variations ?? []).map((v) => v.price)].filter((p) => Number.isFinite(p))),
  };
}

/** null = loại hẳn; `volumeUnverified` = trang cũ không ghi dung tích nên không xác nhận được "dung tích trùng" (chỉ được vào danh sách cần duyệt). */
function scoreCandidate(ev, product) {
  const name = tokens(product.name);
  const nameSet = new Set(name);
  if (nameSet.size === 0 || !nameSet.has(ev.kind)) return null;
  const vols = volumes(product.name);
  const volumeUnverified = vols.length > 0 && ev.vols.size === 0;
  if (!volumeUnverified && vols.some((v) => !ev.vols.has(v))) return null;
  const covered = [...nameSet].filter((t) => ev.words.has(t)).length / nameSet.size;
  const newWords = new Set([...nameSet, ...tokens(slugBase(product.slug).replace(/-/g, ' '))]);
  const core = ev.core.size === 0 ? 1 : [...ev.core].filter((t) => newWords.has(t)).length / ev.core.size;
  return { score: round(Math.min(covered, core)), volumeUnverified };
}

const pricesOf = (p) => [p.basePrice, p.salePrice, ...(p.variations ?? []).map((v) => v.price)].filter((n) => Number.isFinite(n));
const priceMatches = (ev, p) => pricesOf(p).some((n) => ev.prices.has(n));

function wordIndex(haystack, word) {
  const m = new RegExp(`(?:^|[^a-z0-9])${word}(?![a-z0-9])`).exec(haystack);
  return m ? m.index : Number.POSITIVE_INFINITY;
}

/**
 * Phân hoà giữa các biến thể bị web mới tách thành trang riêng, lần lượt: dấu hiệu riêng (mùi, dung tích, "dòng chuyên chấm") được tên trang cũ
 * nhắc trước; giá một biến thể mới trùng giá trên trang cũ; thứ tự biến thể trên trang cũ. Trả null nếu vẫn hoà.
 */
export function breakTie(ev, tied) {
  const tokenSets = tied.map((p) => new Set(tokens(p.name)));
  const volSets = tied.map((p) => new Set(volumes(p.name)));
  const common = (sets) => sets.reduce((acc, set) => new Set([...acc].filter((t) => set.has(t))));
  const sharedWords = common(tokenSets);
  const sharedVols = common(volSets);
  const markers = tied.map((_, i) => {
    const own = [...tokenSets[i]].filter((t) => !sharedWords.has(t));
    const long = own.filter((t) => t.length >= 3);
    return { words: long.length > 0 ? long : own, vols: [...volSets[i]].filter((v) => !sharedVols.has(v)) };
  });
  const NONE = Number.POSITIVE_INFINITY;
  let pool = tied.map((_, i) => i);
  const narrow = (rank, rule) => {
    const ranks = pool.map(rank);
    const best = Math.min(...ranks);
    if (!Number.isFinite(best)) return null;
    pool = pool.filter((_, k) => ranks[k] === best);
    return pool.length === 1 ? { product: tied[pool[0]], rule } : null;
  };
  const title = fold(ev.title);
  const titleVols = volumesWithIndex(ev.title);
  const byTitle = narrow(
    (i) => Math.min(...markers[i].words.map((w) => wordIndex(title, w)), ...markers[i].vols.map((v) => titleVols.find((t) => t.key === v)?.index ?? NONE)),
    'tên trang cũ nhắc trước',
  );
  if (byTitle) return byTitle;
  const byPrice = narrow((i) => (priceMatches(ev, tied[i]) ? 0 : NONE), 'giá trùng trang cũ');
  if (byPrice) return byPrice;
  const terms = ev.attrTerms.map((t) => ({ words: new Set(tokens(t)), vols: new Set(volumes(t)) }));
  const byAttr = narrow((i) => {
    const at = terms.findIndex((t) => markers[i].words.some((w) => t.words.has(w)) || markers[i].vols.some((v) => t.vols.has(v)));
    return at === -1 ? NONE : at;
  }, 'thứ tự biến thể trên trang cũ');
  return byAttr;
}

/**
 * @param {{ wpProducts: Array<{slug:string,name?:string,price?:number,attributes?:Array<{name:string,terms:string[]}>,variations?:Array<{price:number}>}>,
 *           catalog: Array<{slug:string,name:string,basePrice?:number,salePrice?:number|null,variations?:Array<{name:string,price:number}>}>,
 *           extraSlugs?: string[], curated?: Record<string,string> }} input
 * curated: bảng LEGACY_PRODUCT_REDIRECTS (slug cũ -> đích). Slug có đích /san-pham/<slug> ở đó đã có người duyệt nên không vào bản đồ.
 */
export function buildProductMap({ wpProducts, catalog, extraSlugs = [], curated = {} }) {
  const curatedPdp = new Map(Object.entries(curated).flatMap(([k, v]) => (v.startsWith('/san-pham/') ? [[k, v.slice('/san-pham/'.length)]] : [])));
  const catalogSlugs = new Set(catalog.map((p) => p.slug));
  const olds = new Map(wpProducts.map((p) => [p.slug, p]));
  for (const slug of extraSlugs) if (!olds.has(slug) && !catalogSlugs.has(slug)) olds.set(slug, { slug, name: '' });

  const map = {};
  const decisions = [];
  for (const old of [...olds.values()].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const ev = oldEvidence(old);
    const oldName = tokens(old.name ?? '');
    const oldVols = volumes(old.name ?? '');
    const exact = catalog.filter((p) => slugBase(p.slug) === old.slug || (oldName.length > 0 && sameTokens(tokens(p.name), oldName) && sameTokens(volumes(p.name), oldVols)));
    const scored = catalog
      .flatMap((p) => {
        const s = scoreCandidate(ev, p);
        return s ? [{ product: p, ...s }] : [];
      })
      .sort((a, b) => b.score - a.score || a.product.slug.localeCompare(b.product.slug));

    let decision;
    if (exact.length === 1) decision = { kind: 'exact', score: 1, product: exact[0], rule: 'trùng tên hoặc slug' };
    else {
      const pool = exact.length > 1 ? exact.map((product) => ({ product, score: 1, volumeUnverified: false })) : scored;
      const top = pool[0]?.score ?? 0;
      const tiedRows = pool.filter((c) => c.score === top);
      const tied = tiedRows.map((c) => c.product);
      const verified = tiedRows.every((c) => !c.volumeUnverified);
      if (top >= AUTO_MIN && verified && tied.length === 1) decision = { kind: 'fuzzy', score: top, product: tied[0], rule: `điểm ${top}` };
      else if (top >= AUTO_MIN && verified) {
        const broken = breakTie(ev, tied);
        decision = broken ? { kind: 'variant', score: top, product: broken.product, rule: broken.rule, tied: tied.map((p) => p.slug) } : { kind: 'tie', score: top, tied: tied.map((p) => p.slug) };
      } else decision = { kind: top >= REVIEW_MIN ? 'review' : 'none', score: top };
    }
    const candidates = scored.slice(0, 4).map((c) => ({ slug: c.product.slug, score: c.score, priceMatch: priceMatches(ev, c.product), volumeUnverified: c.volumeUnverified }));
    const curatedTarget = curatedPdp.get(old.slug);
    const auto = decision.product?.slug;
    if (auto && !curatedTarget) map[old.slug] = auto;
    decisions.push({ slug: old.slug, title: old.name ?? '', ...decision, product: auto, curated: curatedTarget, candidates });
  }
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  return { map: sorted, decisions };
}

/** Lượt truy cập /product/<...> -> loại đích dự kiến: `pdp` (bản đồ hoặc bảng người duyệt), `search`, `all`, `none` (không có luật). */
export function classifyHits(hits, map, curated) {
  const rows = [];
  for (const [path, count] of Object.entries(hits)) {
    const slug = path.split('/')[0]?.toLowerCase() ?? '';
    const target = map[slug] ? `/san-pham/${map[slug]}` : curated[slug];
    const kind = !target ? 'none' : target.startsWith('/san-pham/') ? 'pdp' : target.startsWith('/san-pham?') ? 'search' : 'all';
    rows.push({ path, slug, count, kind, target: target ?? null, via: map[slug] ? 'map' : target ? 'table' : null });
  }
  const total = rows.reduce((s, r) => s + r.count, 0);
  const by = (k) => rows.filter((r) => r.kind === k).reduce((s, r) => s + r.count, 0);
  return { rows, total, pdp: by('pdp'), search: by('search'), all: by('all'), none: by('none') };
}

/** Slug sạch (chữ thường, số, gạch nối) xuất hiện trong log; đường dẫn kiểu tiêu đề mã hoá % không phải slug. */
export function slugsFromHits(...hitTables) {
  const out = new Set();
  for (const table of hitTables) {
    for (const path of Object.keys(table)) {
      const slug = path.split('/')[0] ?? '';
      if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && /[a-z]/.test(slug)) out.add(slug);
    }
  }
  return [...out].sort();
}

function renderReport({ decisions, coverage, map, autoMin, reviewMin }) {
  const pct = (n) => `${((n * 100) / Math.max(1, coverage.total)).toFixed(1)}%`;
  const hitsBySlug = new Map();
  for (const r of coverage.rows) hitsBySlug.set(r.slug, (hitsBySlug.get(r.slug) ?? 0) + r.count);
  const lines = [];
  lines.push(`# Bản đồ sản phẩm WordPress -> web mới`, '');
  lines.push(`- Bản đồ: ${Object.keys(map).length} dòng tự động (ngưỡng ${autoMin}); vùng cần người duyệt ${reviewMin}–${autoMin}.`);
  lines.push(`- Lượt /product/* ngày ${HITS_DAY}: ${coverage.total}; về PDP ${coverage.pdp} (${pct(coverage.pdp)}), về tìm kiếm ${coverage.search} (${pct(coverage.search)}), về cả kệ ${coverage.all} (${pct(coverage.all)}), không có luật ${coverage.none} (${pct(coverage.none)}).`, '');
  const section = (title, rows, fmt) => {
    lines.push(`## ${title} (${rows.length})`, '');
    for (const d of rows.sort((a, b) => (hitsBySlug.get(b.slug) ?? 0) - (hitsBySlug.get(a.slug) ?? 0) || a.slug.localeCompare(b.slug))) lines.push(fmt(d));
    lines.push('');
  };
  const cand = (d) => d.candidates.map((c) => `\`${c.slug}\` ${c.score}${c.priceMatch ? ' (trùng giá)' : ''}${c.volumeUnverified ? ' (trang cũ không ghi dung tích)' : ''}`).join('; ') || '—';
  section('Tự động vào bản đồ', decisions.filter((d) => d.product && !d.curated), (d) => `- ${hitsBySlug.get(d.slug) ?? 0} lượt \`${d.slug}\` -> \`${d.product}\` (${d.kind}, ${d.rule})`);
  section('Cần người duyệt', decisions.filter((d) => !d.curated && (d.kind === 'review' || d.kind === 'tie')), (d) => `- ${hitsBySlug.get(d.slug) ?? 0} lượt \`${d.slug}\` «${d.title}»: ${d.kind === 'tie' ? `hoà ${d.tied.join(', ')}` : cand(d)}`);
  section('Khác dòng người đã duyệt (giữ dòng người duyệt)', decisions.filter((d) => d.curated && d.product && d.product !== d.curated), (d) => `- \`${d.slug}\`: bảng \`${d.curated}\`, tự động \`${d.product}\` (${d.kind}, ${d.rule})`);
  section('Không khớp sản phẩm nào', decisions.filter((d) => !d.curated && d.kind === 'none'), (d) => `- ${hitsBySlug.get(d.slug) ?? 0} lượt \`${d.slug}\` «${d.title}»: ${cand(d)}`);
  return `${lines.join('\n')}\n`;
}

const HELP = `Dùng: node scripts/ops/build-legacy-wp-product-map.mjs [--write | --check] [--report <tệp.md>]
  [--wp <tệp>] [--catalog <tệp>] [--hits <tệp>] [--out <tệp>]
  [--fetch-catalog <tệp>] [--fetch-wp <tệp>]   tải lại ảnh chụp từ API công khai trước khi sinh`;

export function parseArgs(argv) {
  const opts = { ...DEFAULT_PATHS, write: false, check: false, report: '', fetchCatalog: '', fetchWp: '', help: false };
  const keys = { '--wp': 'wp', '--catalog': 'catalog', '--hits': 'hits', '--out': 'out', '--report': 'report', '--fetch-catalog': 'fetchCatalog', '--fetch-wp': 'fetchWp' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--write') opts.write = true;
    else if (arg === '--check') opts.check = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (keys[arg]) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} cần một giá trị`);
      opts[keys[arg]] = value;
      i += 1;
    } else throw new Error(`Tham số lạ: ${arg}`);
  }
  if (opts.write && opts.check) throw new Error('--write và --check không dùng cùng nhau');
  return opts;
}

const UA = { 'user-agent': 'tubutree-legacy-redirect-map/1.0', accept: 'application/json' };
async function getJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function fetchCatalog(file) {
  const products = [];
  for (let page = 1; page < 20; page += 1) {
    const body = await getJson(`https://api.tubutree.com/api/products?limit=100&page=${page}`);
    products.push(...body.data.map((p) => ({ slug: p.slug, name: p.name, brand: p.brand, basePrice: p.basePrice, salePrice: p.salePrice, inStock: p.inStock })));
    if (products.length >= body.meta.total || body.data.length === 0) break;
  }
  for (const p of products) {
    const detail = await getJson(`https://api.tubutree.com/api/products/${encodeURIComponent(p.slug)}`);
    p.variations = (detail.variations ?? []).map((v) => ({ name: v.name ?? '', price: v.salePrice ?? v.retailPrice }));
  }
  products.sort((a, b) => a.slug.localeCompare(b.slug));
  writeFileSync(file, `${JSON.stringify({ source: 'GET https://api.tubutree.com/api/products', fetchedAt: new Date().toISOString().slice(0, 10), products }, null, 1)}\n`);
}

async function fetchWp(file) {
  const base = 'https://blog.tubutree.com/wp-json/wc/store/v1/products';
  const raw = [];
  for (let page = 1; page < 20; page += 1) {
    const batch = await getJson(`${base}?per_page=100&page=${page}`);
    raw.push(...batch);
    if (batch.length < 100) break;
  }
  const decode = (s) => String(s ?? '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
  const products = [];
  for (const p of raw) {
    const variations = [];
    for (const v of p.variations ?? []) {
      const detail = await getJson(`${base}/${v.id}`);
      variations.push({ attributes: (v.attributes ?? []).map((a) => ({ name: decode(a.name), value: decode(a.value) })), price: Number(detail.prices?.price) });
    }
    products.push({
      slug: p.slug,
      name: decode(p.name),
      price: p.prices?.price ? Number(p.prices.price) : null,
      attributes: (p.attributes ?? []).map((a) => ({ name: decode(a.name), terms: (a.terms ?? []).map((t) => decode(t.name)) })),
      variations,
    });
  }
  products.sort((a, b) => a.slug.localeCompare(b.slug));
  writeFileSync(file, `${JSON.stringify({ source: `GET ${base}?per_page=100 (+ /products/<variation id>)`, fetchedAt: new Date().toISOString().slice(0, 10), products }, null, 1)}\n`);
}

export function loadInputs(opts) {
  const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
  const hitsFile = read(opts.hits);
  const hitTables = Object.values(hitsFile.hits);
  return {
    wpProducts: read(opts.wp).products,
    catalog: read(opts.catalog).products,
    hits: hitsFile.hits[HITS_DAY] ?? {},
    extraSlugs: slugsFromHits(...hitTables),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  if (opts.fetchCatalog) await fetchCatalog(opts.fetchCatalog);
  if (opts.fetchWp) await fetchWp(opts.fetchWp);
  const { LEGACY_PRODUCT_REDIRECTS: curated } = await import(pathToFileURL(opts.redirects).href);
  const inputs = loadInputs(opts);
  const { map, decisions } = buildProductMap({ ...inputs, curated });
  const next = `${JSON.stringify(map, null, 2)}\n`;
  let current = '';
  try {
    current = readFileSync(opts.out, 'utf8');
  } catch {
    current = '';
  }
  const coverage = classifyHits(inputs.hits, map, curated);
  console.log(`${Object.keys(map).length} dòng tự động; lượt ${HITS_DAY}: ${coverage.pdp}/${coverage.total} về PDP (${((coverage.pdp * 100) / Math.max(1, coverage.total)).toFixed(1)}%)`);
  if (opts.report) writeFileSync(opts.report, renderReport({ decisions, coverage, map, autoMin: AUTO_MIN, reviewMin: REVIEW_MIN }));
  if (opts.write) {
    writeFileSync(opts.out, next);
    console.log(`đã ghi ${opts.out}`);
    return 0;
  }
  if (current !== next) {
    console.log(`${opts.out} khác kết quả sinh lại${opts.check ? '' : ' (chạy với --write để ghi)'}`);
    return opts.check ? 1 : 0;
  }
  console.log('bản đồ đang commit khớp kết quả sinh lại');
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(2);
    },
  );
}
