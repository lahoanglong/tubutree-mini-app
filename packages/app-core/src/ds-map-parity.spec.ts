import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkDsParity, exportsSymbol, paramKeys, propKeys, type DsMap } from '../../../scripts/check-ds-parity.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const MINI = 'apps/miniapp/src/components/ui/product-tile.tsx';
const WEB = 'apps/web/src/components/mini/product-tile.tsx';
const tile = (extra = '') => `export interface ProductTileProps { view: string; href?: string; ${extra} }\nexport function ProductTile(p: ProductTileProps) { return null; }\n`;

const files = (over: Record<string, string> = {}): Record<string, string> => ({ [MINI]: tile(), [WEB]: tile(), ...over });
const reader = (f: Record<string, string>) => (p: string) => f[p] ?? null;
const map = (over: Partial<DsMap> = {}): DsMap => ({
  components: [{ name: 'ProductTile', miniapp: MINI, web: WEB, props: 'ProductTileProps', screens: ['/'] }],
  webOnly: [],
  upcoming: [],
  ...over,
});
const run = (m: DsMap, f = files()) => checkDsParity({ map: m, miniappRoutes: ['/', '/browse'], readFile: reader(f) });

describe('checkDsParity: thành phần phải có ở cả hai app', () => {
  it('bản đồ đủ file, đủ export, props khớp thì xanh', () => {
    expect(run(map()).errors).toEqual([]);
  });

  it('thiếu file web thì báo tên thành phần và đường dẫn web', () => {
    const { errors } = run(map(), { [MINI]: tile() });
    expect(errors.some((e) => e.includes('ProductTile') && e.includes(WEB) && e.includes('web'))).toBe(true);
  });

  it('thiếu file Mini thì báo đường dẫn Mini', () => {
    const { errors } = run(map(), { [WEB]: tile() });
    expect(errors.some((e) => e.includes('ProductTile') && e.includes(MINI) && e.includes('Mini'))).toBe(true);
  });

  it('file web không export đúng tên thì đỏ', () => {
    const { errors } = run(map(), files({ [WEB]: 'export function Other() { return null; }' }));
    expect(errors.some((e) => e.includes('ProductTile') && e.includes(WEB) && e.includes('export'))).toBe(true);
  });

  it('trùng tên trong components thì đỏ', () => {
    const c = map().components[0]!;
    expect(run(map({ components: [c, c] })).errors.some((e) => e.includes('trùng') && e.includes('ProductTile'))).toBe(true);
  });

  it('thiếu miniapp hoặc web thì đỏ', () => {
    const bad = { name: 'X' } as unknown as DsMap['components'][number];
    expect(run(map({ components: [bad] })).errors.some((e) => e.includes('X') && e.includes('miniapp') && e.includes('web'))).toBe(true);
  });

  it('screens có route không nằm trong route-map thì đỏ', () => {
    const c = { ...map().components[0]!, screens: ['/khong-co'] };
    expect(run(map({ components: [c] })).errors.some((e) => e.includes('/khong-co'))).toBe(true);
  });
});

describe('checkDsParity: khoá props', () => {
  const lech = files({ [MINI]: tile('navState?: string;') });

  it('lệch khoá props thì đỏ và nêu khoá', () => {
    const { errors } = run(map(), lech);
    expect(errors.some((e) => e.includes('navState') && e.includes('Mini'))).toBe(true);
  });

  it('propsDiff có reason thì lệch đó được phép', () => {
    const c = { ...map().components[0]!, propsDiff: { miniOnly: ['navState'], reason: 'trạng thái điều hướng chỉ Mini có' } };
    expect(run(map({ components: [c] }), lech).errors).toEqual([]);
  });

  it('propsDiff không có reason thì đỏ', () => {
    const c = { ...map().components[0]!, propsDiff: { miniOnly: ['navState'], reason: ' ' } };
    expect(run(map({ components: [c] }), lech).errors.some((e) => e.includes('reason'))).toBe(true);
  });

  it('propsDiff ghi khoá không có thật ở phía đó thì đỏ (miễn đã cũ)', () => {
    const c = { ...map().components[0]!, propsDiff: { webOnly: ['navState'], reason: 'sai phía' } };
    expect(run(map({ components: [c] }), lech).errors.some((e) => e.includes('navState'))).toBe(true);
  });

  it('props khai mà một bên không có interface thì đỏ', () => {
    const { errors } = run(map(), files({ [WEB]: 'export function ProductTile() { return null; }' }));
    expect(errors.some((e) => e.includes('ProductTileProps') && e.includes(WEB))).toBe(true);
  });
});

describe('checkDsParity: props không khai tên kiểu thì đọc từ tham số của hàm', () => {
  const inline = (extra = '') => `export function ProductTile(p: { view: string; href?: string; ${extra} }) { return null; }\n`;
  const noProps = (): DsMap => ({ components: [{ name: 'ProductTile', miniapp: MINI, web: WEB }], webOnly: [], upcoming: [] });

  it('kiểu inline khớp ở hai app thì xanh', () => {
    expect(run(noProps(), files({ [MINI]: inline(), [WEB]: inline() })).errors).toEqual([]);
  });

  it('kiểu inline lệch một khoá thì đỏ dù map không khai props', () => {
    const { errors } = run(noProps(), files({ [MINI]: inline(), [WEB]: inline('className?: string;') }));
    expect(errors.some((e) => e.includes('ProductTile') && e.includes('className') && e.includes('web'))).toBe(true);
  });

  it('propsDiff có reason cho phép lệch của kiểu inline', () => {
    const m = noProps();
    m.components[0] = { ...m.components[0]!, propsDiff: { webOnly: ['className'], reason: 'web thêm lớp để đặt vào khuôn' } };
    expect(run(m, files({ [MINI]: inline(), [WEB]: inline('className?: string;') })).errors).toEqual([]);
  });

  it('một bên không nhận tham số mà bên kia có thì đỏ (BackButton Mini không props, web có fallbackHref)', () => {
    const none = 'export default function ProductTile() { return null; }\n';
    const { errors } = run(noProps(), files({ [MINI]: none, [WEB]: inline() }));
    expect(errors.some((e) => e.includes('view') && e.includes('web'))).toBe(true);
  });

  it('tham số mang tên interface cùng file thì đọc khoá của interface', () => {
    const named = 'interface P { view: string; href?: string }\nexport function ProductTile(p: P) { return null; }\n';
    expect(run(noProps(), files({ [MINI]: named, [WEB]: inline() })).errors).toEqual([]);
  });

  it('kiểu tham số nằm ngoài file thì đỏ và gợi ý propsUncompared', () => {
    const outside = "import type { P } from './p';\nexport function ProductTile(p: P) { return null; }\n";
    const { errors } = run(noProps(), files({ [MINI]: outside }));
    expect(errors.some((e) => e.includes('ProductTile') && e.includes('không đọc được') && e.includes('propsUncompared'))).toBe(true);
  });

  it('propsUncompared có reason thì bỏ qua so props; thiếu reason hoặc đi cùng props thì đỏ', () => {
    const outside = "import type { P } from './p';\nexport function ProductTile(p: P) { return null; }\n";
    const f = files({ [MINI]: outside });
    const m = noProps();
    m.components[0] = { ...m.components[0]!, propsUncompared: 'kiểu props lấy từ thư viện ngoài' };
    expect(run(m, f).errors).toEqual([]);
    m.components[0] = { ...m.components[0]!, propsUncompared: ' ' };
    expect(run(m, f).errors.some((e) => e.includes('propsUncompared') && e.includes('reason'))).toBe(true);
    m.components[0] = { ...m.components[0]!, propsUncompared: 'có lý do', props: 'ProductTileProps' };
    expect(run(m, f).errors.some((e) => e.includes('propsUncompared') && e.includes('props'))).toBe(true);
  });

  it('thành phần khai bằng const (memo, forwardRef, mũi tên) cũng đọc được tham số', () => {
    const wrapped = 'export const ProductTile = memo(function ProductTile(p: { view: string; href?: string }) { return null; });\n';
    const arrow = 'export const ProductTile = (p: { view: string; href?: string }) => null;\n';
    expect(run(noProps(), files({ [MINI]: wrapped, [WEB]: arrow })).errors).toEqual([]);
  });
});

describe('checkDsParity: webOnly và upcoming', () => {
  const LAYOUT = 'apps/web/src/components/layouts/hub-layout.tsx';
  const layoutFiles = files({ [LAYOUT]: 'export function HubLayout() { return null; }' });

  it('webOnly đủ file, đủ export, có reason thì xanh', () => {
    expect(run(map({ webOnly: [{ name: 'HubLayout', web: LAYOUT, reason: 'lưới máy tính từ lg' }] }), layoutFiles).errors).toEqual([]);
  });

  it('webOnly thiếu reason thì đỏ', () => {
    expect(run(map({ webOnly: [{ name: 'HubLayout', web: LAYOUT, reason: '' }] }), layoutFiles).errors.some((e) => e.includes('HubLayout') && e.includes('reason'))).toBe(true);
  });

  it('webOnly thiếu file thì đỏ', () => {
    expect(run(map({ webOnly: [{ name: 'HubLayout', web: LAYOUT, reason: 'x' }] })).errors.some((e) => e.includes('HubLayout') && e.includes(LAYOUT))).toBe(true);
  });

  it('upcoming có tên chưa có file thì KHÔNG lỗi (bỏ qua mục sắp có)', () => {
    const r = run(map({ upcoming: [{ name: 'SectionCard', package: 'P10', wave: '4b' }] }));
    expect(r.errors).toEqual([]);
  });

  it('upcoming thiếu package hoặc wave thì đỏ', () => {
    const bad = { name: 'SectionCard' } as unknown as DsMap['upcoming'][number];
    expect(run(map({ upcoming: [bad] })).errors.some((e) => e.includes('SectionCard') && e.includes('package'))).toBe(true);
  });

  it('upcoming trùng tên với components (gói quên chuyển mục) thì đỏ', () => {
    const r = run(map({ upcoming: [{ name: 'ProductTile', package: 'P4', wave: '2' }] }));
    expect(r.errors.some((e) => e.includes('ProductTile') && e.includes('sắp có'))).toBe(true);
  });

  it('webOnly trùng tên với components thì đỏ (khuôn riêng web không được khai như thành phần chung)', () => {
    const m = map({ webOnly: [{ name: 'ProductTile', web: WEB, reason: 'x' }] });
    expect(run(m).errors.some((e) => e.includes('webOnly') && e.includes('ProductTile') && e.includes('components'))).toBe(true);
  });

  it('hai dòng webOnly cùng tên thì đỏ', () => {
    const w = { name: 'HubLayout', web: LAYOUT, reason: 'lưới máy tính từ lg' };
    expect(run(map({ webOnly: [w, w] }), layoutFiles).errors.some((e) => e.includes('HubLayout') && e.includes('trùng') && e.includes('webOnly'))).toBe(true);
  });

  it('hai dòng upcoming cùng tên thì đỏ', () => {
    const u = { name: 'SectionCard', package: 'P10', wave: '4b' };
    expect(run(map({ upcoming: [u, u] })).errors.some((e) => e.includes('SectionCard') && e.includes('trùng'))).toBe(true);
  });

  it('upcoming trùng tên với webOnly thì đỏ', () => {
    const r = run(map({ webOnly: [{ name: 'HubLayout', web: LAYOUT, reason: 'x' }], upcoming: [{ name: 'HubLayout', package: 'P6', wave: '3' }] }), layoutFiles);
    expect(r.errors.some((e) => e.includes('HubLayout') && e.includes('sắp có'))).toBe(true);
  });
});

describe('exportsSymbol', () => {
  it.each([
    ['export function A() {}', 'A'],
    ['export default function A() {}', 'A'],
    ['export const A = () => null;', 'A'],
    ['export class A {}', 'A'],
    ['export interface A {}', 'A'],
    ['export type A = string;', 'A'],
    ['const A = 1;\nexport { A, B };', 'A'],
  ])('bắt %s', (src, name) => {
    expect(exportsSymbol(src, name)).toBe(true);
  });

  it.each([
    ['function A() {}', 'A'],
    ['// export function A() {}', 'A'],
    ['/* export const A = 1 */', 'A'],
    ['export function AB() {}', 'A'],
    ["const s = 'export function A() {}';", 'A'],
  ])('bỏ qua %s', (src, name) => {
    expect(exportsSymbol(src, name)).toBe(false);
  });
});

describe('propKeys', () => {
  it('lấy khoá cấp 1 của interface, kể cả ?, readonly, phương thức và kiểu lồng', () => {
    const src = `export interface P { a: string; b?: number; readonly c: { x: number; y: number }; onD(): void; 'e-f': boolean; g?: () => void }`;
    expect(propKeys(src, 'P')).toEqual(['a', 'b', 'c', 'onD', 'e-f', 'g']);
  });

  it('đọc kiểu type X = { ... }', () => {
    expect(propKeys('export type P = { a: string; b?: number };', 'P')).toEqual(['a', 'b']);
  });

  it('giao và hợp của kiểu cùng file: gộp khoá mọi nhánh (ProgressBar)', () => {
    const src = `interface Base { value: number; max: number }\nexport type P = Base & ({ label: string } | { label?: undefined; ariaLabel: string });`;
    expect(propKeys(src, 'P')?.sort()).toEqual(['ariaLabel', 'label', 'max', 'value']);
  });

  it('kiểu nằm ngoài file hoặc có tham số kiểu thì null (không đoán)', () => {
    expect(propKeys("import type { B } from './b';\nexport type P = B & { a: string };", 'P')).toBeNull();
    expect(propKeys("export type P = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & { a: string };", 'P')).toBeNull();
  });

  it('kiểu tự tham chiếu không làm treo', () => {
    expect(propKeys('type A = B; type B = A;', 'A')).toBeNull();
  });

  it('không khai thì null; nhắc trong comment không tính', () => {
    expect(propKeys('// interface P { a: string }\nexport function P() {}', 'P')).toBeNull();
  });
});

describe('paramKeys', () => {
  it.each([
    ['export function A({ x }: { x: string; y?: number }) {}', ['x', 'y']],
    ['export default function A() {}', []],
    ['interface P { a: string }\nexport function A(p: P) {}', ['a']],
    ['export const A = (p: { a: string }) => null;', ['a']],
    ['export const A = memo(function A(p: { a: string; b?: number }) { return null; });', ['a', 'b']],
    ['export const A = forwardRef<HTMLDivElement, { a: string }>((p, ref) => null);', null],
    ['export function A(p) {}', null],
    ['export function B() {}', null],
    ['// export function A(p: { a: string }) {}', null],
  ])('%s', (src, expected) => {
    expect(paramKeys(src, 'A')).toEqual(expected);
  });
});

describe('check-ds-parity CLI', () => {
  const script = join(REPO, 'scripts/check-ds-parity.mjs');
  const cli = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: REPO, encoding: 'utf8' });

  it('bản đồ cố ý vi phạm thì thoát 1 và nói tên thành phần', () => {
    const r = cli('--map', 'packages/app-core/src/ds-map-fixtures/violation.json');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('GhostTile');
    expect(r.stderr).toContain('sắp có');
  });
});

describe('ds-map.json thật', () => {
  it('xanh với file thật và route-map.json', () => {
    const mapPath = join(REPO, 'docs/design/ds-map.json');
    expect(existsSync(mapPath)).toBe(true);
    const routeMap = JSON.parse(readFileSync(join(REPO, 'packages/app-core/src/route-map.json'), 'utf8')) as { routes: { items: { miniapp: string }[] }[] };
    const miniappRoutes = routeMap.routes.flatMap((g) => g.items.map((i) => i.miniapp));
    const result = checkDsParity({
      map: JSON.parse(readFileSync(mapPath, 'utf8')) as DsMap,
      miniappRoutes,
      readFile: (p) => (existsSync(join(REPO, p)) ? readFileSync(join(REPO, p), 'utf8') : null),
    });
    expect(result.errors).toEqual([]);
  });
});
