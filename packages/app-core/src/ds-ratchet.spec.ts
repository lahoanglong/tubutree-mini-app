import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareCounts, countMaxMd, countPx, inScope, readBaseline, scanTree } from '../../../scripts/uiux/ds-ratchet.mjs';
import { GUARD_RULES, guardViolations, loadPlatformFiles, ruleCounts, type Platform } from '../../../scripts/uiux/ds-shop-rules.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = join(REPO, 'scripts/uiux/ds-ratchet.mjs');

describe('countPx: đếm px viết tay', () => {
  it.each([
    ["const s = { padding: '8px 0 4px' };", 2],
    ['const s = { gap: 12 };', 1],
    ['const s = { margin: -16 };', 1],
    ['const s = { marginTop: -2 };', 1],
    ['const c = <div className="w-[11px] h-[44px]" />;', 2],
    ["const s = { top: '-12.5px' };", 1],
    ['const s = { gap: compact ? 8 : 12 };', 2],
    ['const s = { borderRadius: 10, fontSize: 13 };', 2],
    ['const s = `calc(100% - ${x}px - 24px)`;', 1],
  ])('%s → %i', (src, n) => {
    expect(countPx(src, 'x.tsx')).toBe(n);
  });

  it.each([
    "const s = { border: '1px solid red', outline: '0px' };",
    "const s = { boxShadow: '0 0 0.5px red' };",
    'const s = { lineHeight: 1.5, zIndex: 10, opacity: 0.5, flex: 2, order: 3 };',
    '// padding: 8px\nconst a = 1;',
    '/* gap: 12 */ const a = 1;',
    'const px8 = 1; const gap8 = 2;',
    'const s = { gap: 0, padding: 1 };',
    "const s = { width: '100%', fontSize: 'var(--type-body-size)' };",
    'const s = { gap: spacing, padding: size * 2 };',
  ])('không đếm: %s', (src) => {
    expect(countPx(src, 'x.tsx')).toBe(0);
  });

  it('đọc .ts theo kiểu TS: hàm generic không thành thẻ JSX', () => {
    expect(countPx('const f = <T>(x: T) => ({ gap: 8 });', 'x.ts')).toBe(1);
  });
});

describe('countMaxMd: lớp max-md:', () => {
  it.each([
    ['<div className="max-md:px-4 max-md:-mx-4" />', 2],
    ['<div className="md:max-md:hidden" />', 1],
    ["const C = 'flex max-md:flex-col';", 1],
    ['const C = `a ${x} max-md:b`;', 1],
  ])('%s → %i', (src, n) => {
    expect(countMaxMd(src, 'x.tsx')).toBe(n);
  });

  it.each(['// max-md:px-4\nconst a = 1;', "const s = 'somax-md:x';", 'const maxMd = 1;', "const s = 'md:px-4 lg:px-6';"])('không đếm: %s', (src) => {
    expect(countMaxMd(src, 'x.tsx')).toBe(0);
  });
});

describe('inScope: phạm vi đếm', () => {
  it.each(['apps/web/src/app/page.tsx', 'apps/miniapp/src/pages/home.tsx', 'apps/web/src/components/mini/product-tile.tsx', 'apps/miniapp/src/hooks/use-x.ts'])('trong phạm vi: %s', (p) => {
    expect(inScope(p)).toBe(true);
  });

  it.each([
    'apps/miniapp/src/pages/x.spec.tsx',
    'apps/web/src/components/y.test.ts',
    'apps/web/src/app/admin/page.tsx',
    'apps/web/src/components/admin/a.tsx',
    'apps/miniapp/src/pages/admin.tsx',
    'apps/miniapp/src/pages/ds-gallery.tsx',
    'apps/web/src/app/ds-gallery/gallery.tsx',
    'apps/web/src/test-utils/fixtures.ts',
    'apps/web/src/lib/admin-client.ts',
    'apps/web/src/types.d.ts',
    'apps/web/src/app/globals.css',
    'packages/app-core/src/a.ts',
    'apps/api/src/a.ts',
  ])('ngoài phạm vi: %s', (p) => {
    expect(inScope(p)).toBe(false);
  });
});

describe('compareCounts: chỉ được giảm', () => {
  const cmp = (baseline: Record<string, number>, current: Record<string, number>, kind: 'px' | 'maxMd' = 'px') => compareCounts({ kind, baseline, current });

  it('bằng nhau thì sạch', () => {
    expect(cmp({ a: 3 }, { a: 3 })).toEqual({ errors: [], notices: [] });
  });

  it('tăng ở file đã có là lỗi, nêu tên file và hai số', () => {
    const { errors } = cmp({ 'apps/web/src/a.tsx': 3 }, { 'apps/web/src/a.tsx': 5 });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('apps/web/src/a.tsx');
    expect(errors[0]).toContain('3');
    expect(errors[0]).toContain('5');
  });

  it('file mới có px là lỗi "file mới", file mới sạch thì không có gì', () => {
    const { errors } = cmp({}, { 'apps/web/src/new.tsx': 2 });
    expect(errors[0]).toContain('file mới');
    expect(errors[0]).toContain('apps/web/src/new.tsx');
    expect(cmp({}, {})).toEqual({ errors: [], notices: [] });
  });

  it('giảm chỉ là nhắc hạ baseline, không phải lỗi', () => {
    const r = cmp({ a: 5 }, { a: 2 });
    expect(r.errors).toEqual([]);
    expect(r.notices[0]).toContain('a');
    expect(r.notices[0]).toContain('--write');
  });

  it('baseline còn dòng của file không còn px (hoặc đã xoá) thì nhắc xoá dòng', () => {
    const r = cmp({ gone: 4 }, {});
    expect(r.errors).toEqual([]);
    expect(r.notices[0]).toContain('gone');
  });

  it('lỗi gọi tên bộ đếm theo kind', () => {
    expect(cmp({ a: 1 }, { a: 2 }, 'maxMd').errors[0]).toContain('max-md');
    expect(cmp({ a: 1 }, { a: 2 }, 'px').errors[0]).toContain('px');
  });
});

describe('scanTree: quét cây bằng readFile giả', () => {
  it('chỉ giữ file trong phạm vi và có số đếm > 0', () => {
    const files: Record<string, string> = {
      'apps/web/src/a.tsx': 'export const A = () => <div className="max-md:px-4" style={{ gap: 12 }} />;',
      'apps/web/src/b.tsx': 'export const B = () => <div />;',
      'apps/web/src/app/admin/c.tsx': 'export const C = () => <div style={{ gap: 12 }} />;',
      'apps/miniapp/src/x.spec.tsx': 'export const X = { gap: 12 };',
      'apps/miniapp/src/pages/home.tsx': "export const H = { padding: '8px 4px' };",
    };
    const got = scanTree({ root: '/fake', list: () => Object.keys(files), readFile: (p) => files[p] ?? '' });
    expect(got).toEqual({
      'apps/miniapp/src/pages/home.tsx': { px: 2, maxMd: 0 },
      'apps/web/src/a.tsx': { px: 1, maxMd: 1 },
    });
  });
});

function fakeRepo(extra: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'ds-ratchet-'));
  const files: Record<string, string> = {
    'apps/miniapp/src/pages/home.tsx': "export const H = () => <div style={{ padding: '8px 4px' }} />;",
    'apps/web/src/app/page.tsx': 'export default () => <main className="max-md:px-4" style={{ gap: 12 }} />;',
    ...extra,
  };
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

const run = (root: string, ...args: string[]) => spawnSync('node', [CLI, '--root', root, '--baseline', join(root, 'baseline.json'), ...args], { encoding: 'utf8' });

describe('CLI ds-ratchet trên cây giả (ca vi phạm cố ý)', () => {
  it('--write rồi kiểm lại thì xanh và in cả hai bộ đếm', () => {
    const root = fakeRepo();
    expect(run(root, '--write').status).toBe(0);
    const r = run(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('px-ratchet xanh');
    expect(r.stdout).toContain('max-md-ratchet xanh');
  });

  it('thêm px vào một file thì đỏ và stderr nêu tên file', () => {
    const root = fakeRepo();
    run(root, '--write');
    writeFileSync(join(root, 'apps/web/src/app/page.tsx'), 'export default () => <main className="max-md:px-4" style={{ gap: 12, padding: 24 }} />;');
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('apps/web/src/app/page.tsx');
    expect(r.stderr).toContain('px');
  });

  it('thêm max-md: vào file thì đỏ ở max-md-ratchet', () => {
    const root = fakeRepo();
    run(root, '--write');
    writeFileSync(join(root, 'apps/miniapp/src/pages/home.tsx'), 'export const H = () => <div className="max-md:flex" style={{ padding: \'8px 4px\' }} />;');
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('max-md');
    expect(r.stderr).toContain('apps/miniapp/src/pages/home.tsx');
  });

  it('file mới có px thì đỏ', () => {
    const root = fakeRepo();
    run(root, '--write');
    mkdirSync(join(root, 'apps/web/src/components'), { recursive: true });
    writeFileSync(join(root, 'apps/web/src/components/new.tsx'), 'export const N = { gap: 16 };');
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('file mới');
  });

  it('giảm px: mặc định vẫn xanh và nhắc hạ; --strict thì đỏ; --write rồi --strict xanh', () => {
    const root = fakeRepo();
    run(root, '--write');
    writeFileSync(join(root, 'apps/web/src/app/page.tsx'), 'export default () => <main className="max-md:px-4" />;');
    const soft = run(root);
    expect(soft.status).toBe(0);
    expect(soft.stdout).toContain('--write');
    expect(run(root, '--strict').status).toBe(1);
    expect(run(root, '--write').status).toBe(0);
    expect(run(root, '--strict').status).toBe(0);
  });
});

describe('mã thật: baseline khớp cây hiện tại', () => {
  it('px và max-md không vượt ds-baseline.json', () => {
    const baseline = readBaseline(join(REPO, 'scripts/uiux/ds-baseline.json'));
    const current = scanTree({ root: REPO });
    const px = compareCounts({ kind: 'px', baseline: baseline.px, current: Object.fromEntries(Object.entries(current).filter(([, c]) => c.px > 0).map(([f, c]) => [f, c.px])) });
    const md = compareCounts({ kind: 'maxMd', baseline: baseline.maxMd, current: Object.fromEntries(Object.entries(current).filter(([, c]) => c.maxMd > 0).map(([f, c]) => [f, c.maxMd])) });
    expect([...px.errors, ...md.errors]).toEqual([]);
    expect(Object.keys(current).length).toBeGreaterThan(100);
  });

  it('ds-baseline.json là JSON có ba mục', () => {
    const raw = JSON.parse(readFileSync(join(REPO, 'scripts/uiux/ds-baseline.json'), 'utf8'));
    expect(Object.keys(raw).filter((k) => !k.startsWith('$')).sort()).toEqual(['guards', 'maxMd', 'px']);
  });
});

describe('ds-shop-rules: mỗi luật có ca vi phạm cố ý và ca đối chứng sạch', () => {
  const violations = (platform: Platform, rel: string, text: string, baseline: Record<string, Record<string, number>> = {}) =>
    guardViolations({ platform, files: [{ rel, text }], baseline });

  const BAD: [platform: Platform, ruleId: string, rel: string, text: string][] = [
    ['miniapp', 'tile-custom', 'pages/x.tsx', 'export const A = () => <ProductImage src="a" />;'],
    ['miniapp', 'tile-custom', 'components/home/x.tsx', "export const A = { aspectRatio: '1 / 1' };"],
    ['miniapp', 'strike-element', 'pages/x.tsx', 'export const A = () => <del>10.000đ</del>;'],
    ['miniapp', 'primitive-color', 'components/home/y.tsx', "export const A = { background: 'var(--stone-100)' };"],
    ['miniapp', 'primitive-color', 'pages/offers.tsx', "export const A = { color: 'var(--tubu-orange)' };"],
    ['miniapp', 'zmp-text', 'pages/cart.tsx', "import { Text, Button } from 'zmp-ui';"],
    ['miniapp', 'open-snackbar', 'pages/offers.tsx', 'const { openSnackbar } = useSnackbar();'],
    ['web', 'tile-custom', 'components/home/z.tsx', 'export const A = () => <ProductThumb src="a" />;'],
    ['web', 'strike-element', 'app/ban-chay/z.tsx', 'export const A = () => <s>10.000đ</s>;'],
    ['web', 'primitive-color', 'app/ban-chay/z.tsx', 'export const A = () => <div className="bg-stone-100 hover:text-forest-700" />;'],
    ['web', 'primitive-color', 'components/home/w.tsx', "export const A = { color: 'var(--clay-600)' };"],
    ['web', 'zmp-ui-import', 'lib/anything.tsx', "import { Button } from 'zmp-ui';"],
    ['web', 'open-snackbar', 'lib/anything.ts', 'openSnackbar({ text: "x" });'],
  ];

  it.each(BAD)('%s bắt %s ở %s', (platform, ruleId, rel, text) => {
    const { errors } = violations(platform, rel, text);
    expect(errors.some((e) => e.includes(ruleId) && e.includes(rel)), errors.join('\n')).toBe(true);
  });

  const CLEAN: [platform: Platform, rel: string, text: string][] = [
    ['miniapp', 'components/home/y.tsx', "export const A = { background: 'var(--color-bg-media)' };"],
    ['miniapp', 'components/ui/x.tsx', "export const A = { background: 'var(--stone-100)' }; export const B = () => <ProductImage src='a' />;"],
    ['miniapp', 'css/tokens.css.ts', "export const A = 'var(--stone-100)';"],
    ['miniapp', 'pages/profile.tsx', "import { Text } from 'zmp-ui'; const { openSnackbar } = useSnackbar(); const c = 'var(--stone-100)';"],
    ['miniapp', 'pages/cart.tsx', "import { Button, Page } from 'zmp-ui'; const { notify } = useNotify();"],
    ['miniapp', 'hooks/use-notify.ts', 'const { openSnackbar } = useSnackbar();'],
    ['miniapp', 'components/ui/price-tag.tsx', 'export const A = () => <del>10.000đ</del>;'],
    ['miniapp', 'pages/x.tsx', '// <ProductImage /> var(--stone-100)\nexport const A = 1;'],
    ['web', 'components/mini/x.tsx', 'export const A = () => <div className="bg-stone-100" />;'],
    ['web', 'components/mini/price-tag.tsx', 'export const A = () => <del>10.000đ</del>;'],
    ['web', 'app/ban-chay/z.tsx', 'export const A = () => <div className="bg-[var(--color-bg-media)] text-fg-secondary" />;'],
    ['web', 'app/tai-khoan/page.tsx', 'export const A = () => <div className="bg-stone-100" />;'],
    ['web', 'components/home/z.tsx', '/* bg-stone-100 */ export const A = 1;'],
  ];

  it.each(CLEAN)('%s sạch ở %s', (platform, rel, text) => {
    expect(violations(platform, rel, text)).toEqual({ errors: [], notices: [] });
  });

  it('baseline cho phép đúng số hiện có: hơn một chỗ là đỏ, ít hơn là nhắc', () => {
    const text = "export const A = [{ background: 'var(--stone-100)' }, { color: 'var(--forest-700)' }];";
    const base = { 'primitive-color': { 'components/home/y.tsx': 2 } };
    expect(violations('miniapp', 'components/home/y.tsx', text, base)).toEqual({ errors: [], notices: [] });
    expect(violations('miniapp', 'components/home/y.tsx', `${text}\nexport const B = { color: 'var(--clay-600)' };`, base).errors).toHaveLength(1);
    const fewer = violations('miniapp', 'components/home/y.tsx', "export const A = { background: 'var(--stone-100)' };", base);
    expect(fewer.errors).toEqual([]);
    expect(fewer.notices[0]).toContain('--write');
  });

  it('ruleCounts chỉ ghi file có vi phạm', () => {
    const counts = ruleCounts({ platform: 'miniapp', files: [{ rel: 'pages/offers.tsx', text: 'const { openSnackbar } = useSnackbar();' }, { rel: 'pages/a.tsx', text: 'export const A = 1;' }] });
    expect(counts['open-snackbar']).toEqual({ 'pages/offers.tsx': 2 });
    expect(counts['tile-custom']).toEqual({});
  });

  it('mỗi luật có why không rỗng và id không trùng trong một nền tảng', () => {
    for (const p of ['miniapp', 'web'] as const) {
      const rules = GUARD_RULES.filter((r) => r.platform === p);
      expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
      for (const r of rules) expect(r.why.length, r.id).toBeGreaterThan(20);
    }
  });

  it.each(['miniapp', 'web'] as const)('mã thật %s: không vượt guards của ds-baseline.json', (platform) => {
    const baseline = readBaseline(join(REPO, 'scripts/uiux/ds-baseline.json')).guards[platform] ?? {};
    const files = loadPlatformFiles(REPO, platform);
    expect(files.length).toBeGreaterThan(200);
    expect(guardViolations({ platform, files, baseline }).errors).toEqual([]);
  });
});
