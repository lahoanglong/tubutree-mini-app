import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * C-076 (hậu PD-1): khối "LEGACY v1 → v2 ALIAS" đã bị xoá khỏi css/tokens.css nên MỌI file trong
 * src (không chỉ danh sách file đã di cư như ds-c076-pc10*.spec.ts) không được tham chiếu họ biến v1
 * (var(--neutral-*), --primary-*, --leaf-*, --sun-*, --success/--warning/--danger/--info(-bg),
 * --radius-sm/md/lg/xl/full, --shadow-xs/sm/md/lg, --dealer-*, --clay-200/800) và không có hex/rgb thô.
 *
 * Bộ so khớp giữ đồng bộ với scripts/uiux/static-scan.mjs (LEGACY, HEX, RGB) để guard và số đo
 * static-scan không lệch nhau. --shadow-card, --font-body, --safe-*, --dur-*, --ease-out vẫn được định
 * nghĩa ở đầu css/tokens.css (còn dùng bởi .tubu-card/.t-body và component) nên không bị cấm.
 */
const SRC_ROOT = fileURLToPath(new URL('./', import.meta.url));

const LEGACY_NAMES = String.raw`neutral-\d+|primary-\d+|leaf-\d+|sun-\d+|(?:success|warning|danger|info)(?:-bg)?|clay-(?:200|800)|radius-(?:sm|md|lg|xl|full)|shadow-(?:xs|sm|md|lg)|dealer-[a-z-]+`;
const LEGACY_USE = new RegExp(String.raw`var\(--(?:${LEGACY_NAMES})(?=[,)])`, 'g');
const LEGACY_DECL = new RegExp(String.raw`^\s*--(?:${LEGACY_NAMES})\s*:`, 'gm');
const HEX = /(?<![&\w-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?!\w)/g;
const RGB = /\b(?:rgba?|hsla?)\(\s*\d/g;
const TOKEN_DEFINITION_LINE = /^\s*--[\w-]+\s*:/;

/**
 * Ngoại lệ hex/rgb thô — giữ NHỎ, mỗi mục có lý do. Màu nằm trên dòng định nghĩa token của file .css
 * (`--color-brand-*: #...`, `--color-bg-scrim: rgba(...)`) là chỗ DUY NHẤT được giữ màu thô nên không
 * cần liệt kê ở đây; chỉ liệt kê file mà màu thô nằm ngoài kiểu đó hoặc cần tách bạch lý do.
 */
const RAW_COLOR_EXCEPTIONS: Record<string, string> = {
  // Kênh đại lý (B2B) chưa có thiết kế riêng trong DS v2 nên giữ bộ navy cũ; pages/dealer.tsx chỉ tham chiếu --color-dealer-*.
  'css/dealer-theme.css': 'palette navy của dealer, ngoài phạm vi DS v2',
  // Bảng màu cửa hàng do CTV chọn: mã hex là DỮ LIỆU gửi lên API và lưu ở DB, không phải màu của DS.
  'utils/storefront-theme.ts': 'mã màu cửa hàng CTV chọn (dữ liệu, lưu ở backend)',
};

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const rel = (p: string) => relative(SRC_ROOT, p).replace(/\\/g, '/');
const isSpec = (p: string) => /\.(spec|test)\.(ts|tsx)$/.test(p);

const FILES = walk(SRC_ROOT)
  .filter((p) => /\.(ts|tsx|css)$/.test(p) && !isSpec(p))
  .map((p) => ({ file: rel(p), css: p.endsWith('.css'), source: readFileSync(p, 'utf8') }));

/** Bỏ chú thích khối + dòng chú thích đầu dòng (giống static-scan); giữ số dòng để báo đúng vị trí. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, '')).replace(/^\s*\/\/.*$/gm, '');

const lineHits = (src: string, re: RegExp, skipDefinitions: boolean, css: boolean) =>
  stripComments(src)
    .split(/\r?\n/)
    .map((l, i) => ({ n: i + 1, text: l.trim(), raw: l }))
    .filter(({ raw }) => !(skipDefinitions && css && TOKEN_DEFINITION_LINE.test(raw)))
    .filter(({ text }) => {
      re.lastIndex = 0;
      return re.test(text);
    })
    .map(({ n, text }) => `${n}: ${text}`);

const RAW_COLOR = new RegExp(`${HEX.source}|${RGB.source}`, 'g');

describe('bộ so khớp', () => {
  it.each([
    'color: var(--neutral-500)',
    'background: var(--primary-50)',
    'color: var(--leaf-700, #fff)',
    'color: var(--sun-300)',
    'color: var(--danger)',
    'background: var(--success-bg)',
    'color: var(--clay-200)',
    'borderRadius: var(--radius-sm)',
    'borderRadius: var(--radius-md)',
    'borderRadius: var(--radius-lg)',
    'borderRadius: var(--radius-xl)',
    'borderRadius: var(--radius-full)',
    'boxShadow: var(--shadow-xs)',
    'boxShadow: var(--shadow-lg)',
    'color: var(--dealer-ink)',
  ])('bắt %s', (line) => {
    LEGACY_USE.lastIndex = 0;
    expect(LEGACY_USE.test(line)).toBe(true);
  });

  it.each([
    'color: var(--color-text-primary)',
    'color: var(--color-status-danger-fg)',
    'borderRadius: var(--radius-card)',
    'borderRadius: var(--radius-control)',
    'borderRadius: var(--radius-pill)',
    'boxShadow: var(--elevation-1)',
    'boxShadow: var(--shadow-card)',
    'fontFamily: var(--font-body)',
    'color: var(--color-dealer-ink)',
    'color: var(--clay-500)',
    'color: var(--sage-700)',
    'color: var(--forest-600)',
  ])('không bắt tên v2 hoặc biến còn định nghĩa: %s', (line) => {
    LEGACY_USE.lastIndex = 0;
    expect(LEGACY_USE.test(line)).toBe(false);
  });

  it.each(['color: #fff', "color: '#1F2A44'", 'background: rgba(255,255,255,0.85)', 'color: rgb(0, 0, 0)', 'color: hsl(10 20% 30%)'])(
    'bắt màu thô %s',
    (line) => {
      RAW_COLOR.lastIndex = 0;
      expect(RAW_COLOR.test(line)).toBe(true);
    },
  );

  it.each(['color: var(--color-text-primary)', "href='#section'", 'color: transparent', 'margin: &#123;'])(
    'không bắt %s',
    (line) => {
      RAW_COLOR.lastIndex = 0;
      expect(RAW_COLOR.test(line)).toBe(false);
    },
  );
});

describe('quét toàn bộ src', () => {
  it('thật sự quét được cả ts, tsx lẫn css (không rỗng do đường dẫn sai)', () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES.some((f) => f.file === 'css/tokens.css')).toBe(true);
    expect(FILES.some((f) => f.file === 'pages/home.tsx')).toBe(true);
    expect(FILES.some((f) => f.file.endsWith('.spec.tsx'))).toBe(false);
  });

  it('không file nào tham chiếu biến CSS alias v1', () => {
    const offenders = FILES.flatMap(({ file, css, source }) =>
      lineHits(source, LEGACY_USE, false, css).map((h) => `${file}:${h}`),
    );
    expect(offenders).toEqual([]);
  });

  it('không file css nào còn khai báo lại tên alias v1 (khối "LEGACY v1 → v2 ALIAS" đã xoá)', () => {
    const offenders = FILES.filter((f) => f.css).flatMap(({ file, source }) =>
      lineHits(source, LEGACY_DECL, false, true).map((h) => `${file}:${h}`),
    );
    expect(offenders).toEqual([]);
    const tokens = FILES.find((f) => f.file === 'css/tokens.css')!.source;
    expect(tokens).not.toMatch(/LEGACY v1/);
  });

  it('không có hex/rgb thô ngoài dòng định nghĩa token và danh sách ngoại lệ', () => {
    const offenders = FILES.filter((f) => !(f.file in RAW_COLOR_EXCEPTIONS)).flatMap(({ file, css, source }) =>
      lineHits(source, RAW_COLOR, true, css).map((h) => `${file}:${h}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe('danh sách ngoại lệ hex/rgb', () => {
  it('ngắn gọn và mỗi mục có lý do', () => {
    const entries = Object.entries(RAW_COLOR_EXCEPTIONS);
    expect(entries.length).toBeLessThanOrEqual(3);
    for (const [, reason] of entries) expect(reason.trim().length).toBeGreaterThan(10);
  });

  it('mỗi ngoại lệ còn tồn tại và còn màu thô (mục thừa phải xoá khỏi danh sách)', () => {
    for (const file of Object.keys(RAW_COLOR_EXCEPTIONS)) {
      const entry = FILES.find((f) => f.file === file);
      expect(entry, `${file} không còn tồn tại`).toBeDefined();
      expect(lineHits(entry!.source, RAW_COLOR, false, entry!.css).length, `${file} không còn màu thô`).toBeGreaterThan(0);
    }
  });
});
