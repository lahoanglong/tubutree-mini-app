#!/usr/bin/env node
// Bánh cóc số px viết tay và lớp `max-md:` (P17b). Số đếm theo file của mã giao diện hai app được so với scripts/uiux/ds-baseline.json: tăng thì đỏ,
// giảm thì nhắc hạ baseline (--strict: giảm cũng đỏ), file chưa có trong baseline phải bằng 0. Nối sau check-ds-parity trong `pnpm lint:parity`.
//
// Phạm vi: apps/miniapp/src và apps/web/src, chỉ .ts/.tsx (CSS thuần là nơi định nghĩa token nên không đếm), bỏ spec/test, .d.ts, quản trị (`admin/`,
// `components/admin/`, `pages/admin.tsx`, `lib/admin-`), `ds-gallery` (trang dev vẽ số đo trần để so), `test-utils/`, `test-support/`, `test/`.
// Đếm bằng cây cú pháp nên comment, tên biến không tính. "px viết tay" gồm: mỗi `<n>px` với n > 1 trong chuỗi/mẫu chuỗi (kể cả âm, thập phân, trong `[…]` Tailwind;
// 0px và 1px là đường kẻ/nhích dưới điểm ảnh nên bỏ), và giá trị số |n| > 1 của thuộc tính style kích thước/khoảng cách (padding, margin, gap, top…, width, height, fontSize,
// borderRadius), kể cả hai nhánh của `a ? 8 : 12`. lineHeight/zIndex/opacity/flex là số không đơn vị nên không tính.
//
// Tái tạo baseline (session chính khớp lại khi gộp các gói chạy song song): `node scripts/uiux/ds-ratchet.mjs --write`.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE_FILE = join(REPO, 'scripts/uiux/ds-baseline.json');
const SCAN_ROOTS = ['apps/miniapp/src', 'apps/web/src'];
const WRITE_CMD = 'node scripts/uiux/ds-ratchet.mjs --write';

const EXCLUDED = [
  /\.(spec|test)\.tsx?$/,
  /\.d\.ts$/,
  /(^|\/)admin\//,
  /(^|\/)components\/admin\//,
  /(^|\/)pages\/admin\.tsx$/,
  /ds-gallery/,
  /(^|\/)test-utils\//,
  /(^|\/)test-support\//,
  /(^|\/)test\//,
  /(^|\/)lib\/admin-/,
];

export function inScope(path) {
  return SCAN_ROOTS.some((r) => path.startsWith(`${r}/`)) && /\.tsx?$/.test(path) && !EXCLUDED.some((re) => re.test(path));
}

const PX_PROPS = new Set(
  [
    'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'paddingInline', 'paddingBlock', 'paddingInlineStart', 'paddingInlineEnd',
    'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'marginInline', 'marginBlock', 'marginInlineStart', 'marginInlineEnd',
    'gap', 'rowGap', 'columnGap', 'top', 'right', 'bottom', 'left', 'inset',
    'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'fontSize', 'borderRadius', 'flexBasis',
  ],
);

// Lookbehind để `0.5px` không bị đọc thành `5px` và `a8px` (tên) không thành 8px.
const PX_IN_TEXT = /(?<![\w.])-?(\d+(?:\.\d+)?)px\b/g;
const MAX_MD = /(?<![\w-])max-md:/g;

const parse = (source, fileName) => ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const isTextNode = (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n);

// Giá trị số của vế phải: số trần, số âm, trong ngoặc, hai nhánh của biểu thức điều kiện. Phép tính và lời gọi hàm không phải số viết tay.
function numericValues(expr) {
  if (ts.isNumericLiteral(expr)) return [Number(expr.text)];
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expr.operand)) return [-Number(expr.operand.text)];
  if (ts.isParenthesizedExpression(expr)) return numericValues(expr.expression);
  if (ts.isConditionalExpression(expr)) return [...numericValues(expr.whenTrue), ...numericValues(expr.whenFalse)];
  return [];
}

const propName = (p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null);

function walk(node, onNode) {
  onNode(node);
  ts.forEachChild(node, (c) => walk(c, onNode));
}

export function countPx(source, fileName) {
  let n = 0;
  walk(parse(source, fileName), (node) => {
    if (isTextNode(node)) {
      for (const m of node.text.matchAll(PX_IN_TEXT)) if (Number(m[1]) > 1) n += 1;
    } else if (ts.isPropertyAssignment(node) && PX_PROPS.has(propName(node) ?? '')) {
      n += numericValues(node.initializer).filter((v) => Math.abs(v) > 1).length;
    }
  });
  return n;
}

export function countMaxMd(source, fileName) {
  let n = 0;
  walk(parse(source, fileName), (node) => {
    if (isTextNode(node)) n += (node.text.match(MAX_MD) ?? []).length;
  });
  return n;
}

function walkDir(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '.next') return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walkDir(p) : [p];
  });
}

/** Danh sách file (đường dẫn tương đối gốc repo, dấu `/`) dưới các thư mục quét của `root`. */
function listTree(root) {
  return SCAN_ROOTS.flatMap((r) => (existsSync(join(root, r)) ? walkDir(join(root, r)) : [])).map((p) => relative(root, p).split(sep).join('/'));
}

/** Số đếm theo file trong phạm vi; file 0/0 bị bỏ. `list` và `readFile` để spec thay cây giả. */
export function scanTree({ root, list, readFile } = {}) {
  const files = (list ? list() : listTree(root)).filter(inScope).sort();
  const read = readFile ?? ((p) => readFileSync(join(root, p), 'utf8'));
  const out = {};
  for (const file of files) {
    const text = read(file);
    const counts = { px: countPx(text, file), maxMd: countMaxMd(text, file) };
    if (counts.px > 0 || counts.maxMd > 0) out[file] = counts;
  }
  return out;
}

const LABEL = { px: 'px', maxMd: 'max-md' };

export function compareCounts({ kind, baseline, current }) {
  const label = LABEL[kind];
  const errors = [];
  const notices = [];
  for (const [file, now] of Object.entries(current)) {
    const was = baseline[file];
    if (was === undefined) {
      errors.push(`${file}: file mới có ${now} chỗ ${label} (file mới phải dùng token và khuôn dùng chung, bằng 0; nếu chủ ý ghi nhận thì chạy ${WRITE_CMD})`);
    } else if (now > was) {
      errors.push(`${file}: ${label} tăng ${was} → ${now} (baseline chỉ được giảm: dùng token hoặc thành phần dùng chung thay vì số viết tay)`);
    } else if (now < was) {
      notices.push(`${file}: ${label} giảm ${was} → ${now}, chạy ${WRITE_CMD} để hạ baseline`);
    }
  }
  for (const [file, was] of Object.entries(baseline)) {
    if (current[file] === undefined) notices.push(`${file}: baseline còn ${was} chỗ ${label} nhưng file không còn (đã sạch hoặc đã xoá), chạy ${WRITE_CMD} để xoá dòng`);
  }
  return { errors, notices };
}

const SECTION_COMMENT =
  'Baseline bánh cóc giao diện (P17b). px/maxMd: số chỗ theo file, chỉ được giảm. guards: số chỗ theo luật và file của ds-shop-rules.mjs. Tái tạo: node scripts/uiux/ds-ratchet.mjs --write.';

export function readBaseline(file) {
  const raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return { px: raw.px ?? {}, maxMd: raw.maxMd ?? {}, guards: raw.guards ?? {} };
}

const sortKeys = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);

export function writeBaseline(file, baseline) {
  const body = sortKeys({ $comment: SECTION_COMMENT, px: baseline.px, maxMd: baseline.maxMd, guards: baseline.guards });
  writeFileSync(file, `${JSON.stringify(body, null, 1)}\n`);
}

const pick = (counts, key) => Object.fromEntries(Object.entries(counts).filter(([, c]) => c[key] > 0).map(([f, c]) => [f, c[key]]));
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

export function main(argv = process.argv.slice(2)) {
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const root = resolve(arg('--root') ?? REPO);
  const baselineFile = resolve(arg('--baseline') ?? BASELINE_FILE);
  const current = scanTree({ root });
  const px = pick(current, 'px');
  const maxMd = pick(current, 'maxMd');

  if (argv.includes('--write')) {
    const prev = readBaseline(baselineFile);
    writeBaseline(baselineFile, { px, maxMd, guards: prev.guards });
    console.log(`ds-ratchet: đã ghi ${baselineFile} (px ${sum(px)} chỗ ở ${Object.keys(px).length} file, max-md ${sum(maxMd)} chỗ ở ${Object.keys(maxMd).length} file)`);
    return 0;
  }

  const baseline = readBaseline(baselineFile);
  const strict = argv.includes('--strict');
  let failed = false;
  for (const [kind, now, name] of [['px', px, 'px-ratchet'], ['maxMd', maxMd, 'max-md-ratchet']]) {
    const { errors, notices } = compareCounts({ kind, baseline: baseline[kind], current: now });
    for (const e of errors) console.error(`lỗi: ${name}: ${e}`);
    for (const n of notices) {
      if (strict) console.error(`lỗi: ${name}: ${n}`);
      else console.log(`nhắc: ${name}: ${n}`);
    }
    if (errors.length > 0 || (strict && notices.length > 0)) failed = true;
    else console.log(`${name} xanh (${sum(now)} chỗ ở ${Object.keys(now).length} file)`);
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
