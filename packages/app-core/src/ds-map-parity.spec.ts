import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkDsParity, exportsSymbol, propKeys, type DsMap } from '../../../scripts/check-ds-parity.mjs';

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

  it('không khai thì null; nhắc trong comment không tính', () => {
    expect(propKeys('// interface P { a: string }\nexport function P() {}', 'P')).toBeNull();
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
