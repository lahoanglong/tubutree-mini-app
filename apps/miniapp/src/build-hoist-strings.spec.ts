import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  chunksInImportCycles,
  HOIST_PASS_VERSION,
  hoistRepeatedStrings,
  hoistRepeatedStringsPlugin,
  inlineHoisted,
  literalBytes,
  sameAfterInlining,
  worthHoisting,
} from './build-hoist-strings';
import { loadTerserAst, sameBindings, unaliasModuleNames } from './build-import-names';

const S = 'var(--color-bg-surface)';
// Chunk dạng Rollup + terser xuất ra, chuỗi `S` lặp ở mọi chỗ mà một biểu thức chuỗi đứng được: giá trị, tham số mặc định, khóa tính của object
// và class, `case`, `in`, so `typeof`, trong hàm lồng có biến trùng tên một ký tự. Kèm chuỗi tên tệp, nguồn import và khóa viết thường không được đụng.
const LIB = 'const e=()=>"đã giao hàng thành công";export{e as j};';
const APP =
  'import{j as e}from"./lib.js";' +
  `const t={background:"${S}",border:"1px solid ${S}"};` +
  `function n(n="${S}"){const t="${S}";return[n,t,"${S}"]}` +
  `class r{["${S}"](){return"${S}"}}` +
  `const o={["${S}"]:1,"aria-label":"${S}"};` +
  `function a(e){switch(e){case"${S}":return 1;default:return 2}}` +
  `const c=typeof n=="function"&&typeof a=="function"&&typeof e=="function"&&typeof r=="function";` +
  `const l=()=>import("./lazy.Ab12Cd3.module.js");` +
  `const s=["./x.Ab12Cd3.module.js","./x.Ab12Cd3.module.js","./y-Ab12Cd3.css","./y-Ab12Cd3.css"];` +
  `export const result=[t,n(),new r()["${S}"](),o,a("${S}"),a("x"),"${S}" in o,c,e(),e()==="đã giao hàng thành công",s,typeof l];`;

function runApp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubu-hoist-'));
  try {
    for (const [name, code] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), code);
    const url = pathToFileURL(path.join(dir, 'app.js')).href;
    return execFileSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(url)}).then((m)=>process.stdout.write(JSON.stringify(m.result)))`], {
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

type Hook = { order: string; handler: (this: unknown, o: unknown, b: unknown) => Promise<void> };

describe('build-hoist-strings', () => {
  it('gom chuỗi lặp vào một hằng đầu chunk, chạy ra đúng kết quả cũ và nhỏ hơn', async () => {
    const T = await loadTerserAst();
    const app = hoistRepeatedStrings(T, APP);

    expect(app.hoisted).toBeGreaterThan(0);
    expect(Buffer.byteLength(app.code)).toBeLessThan(Buffer.byteLength(APP));
    expect(app.code.split(`"${S}"`).length - 1).toBe(1);
    // Câu lệnh đầu tiên chạy là khai báo hằng gom, ngay sau import.
    expect(app.code).toMatch(new RegExp(`^import\\{j as \\w+\\}from"\\./lib\\.js";const \\w+="${S.replace(/[()]/g, '\\$&')}"`));
    expect(sameAfterInlining(T, APP, app.code)).toBe(true);
    expect(runApp({ 'lib.js': LIB, 'app.js': app.code })).toBe(runApp({ 'lib.js': LIB, 'app.js': APP }));
  });

  it('không đụng nguồn import/export, import() động, chuỗi tên tệp và khóa thuộc tính viết thường', async () => {
    const T = await loadTerserAst();
    const { code } = hoistRepeatedStrings(T, APP);
    expect(code).toContain('from"./lib.js"');
    expect(code).toContain('import("./lazy.Ab12Cd3.module.js")');
    expect(code.split('"./x.Ab12Cd3.module.js"').length - 1).toBe(2);
    expect(code.split('"./y-Ab12Cd3.css"').length - 1).toBe(2);
    expect(code).toMatch(/"aria-label":\w+/);
    const reexport = 'export{a,b}from"./lib.Ab12Cd3.module.js";export*from"./lib.Ab12Cd3.module.js";const x="var(--space-inline-sm)",y="var(--space-inline-sm)",z="var(--space-inline-sm)";export{x,y,z};';
    const out = hoistRepeatedStrings(T, reexport);
    expect(out.code.split('from"./lib.Ab12Cd3.module.js"').length - 1).toBe(2);
  });

  it('hai chunk sau khi gom vẫn qua bước bỏ ` as x` và chạy ra đúng kết quả cũ', async () => {
    const T = await loadTerserAst();
    const hoisted = hoistRepeatedStrings(T, APP).code;
    const unaliased = unaliasModuleNames(T, hoisted);
    expect(unaliased.pinned).toBeGreaterThan(0);
    expect(unaliased.code).toMatch(/^import\{j\}from"\.\/lib\.js"/);
    expect(sameBindings(T, hoisted, unaliased.code)).toBe(true);
    expect(runApp({ 'lib.js': LIB, 'app.js': unaliased.code })).toBe(runApp({ 'lib.js': LIB, 'app.js': APP }));
  });

  it('để nguyên chunk có eval/with, chunk không có chuỗi đáng gom, và không bao giờ làm chunk lớn hơn', async () => {
    const T = await loadTerserAst();
    const withEval = `const a="${S}",b="${S}",c="${S}";eval("a");export{a,b,c};`;
    const few = 'const a="ab",b="ab",c="xyz";export{a,b,c};';
    expect(hoistRepeatedStrings(T, withEval)).toEqual({ code: withEval, hoisted: 0 });
    expect(hoistRepeatedStrings(T, few)).toEqual({ code: few, hoisted: 0 });
    expect(worthHoisting(literalBytes('div'), 3)).toBe(false);
    expect(worthHoisting(literalBytes('div'), 4)).toBe(true);
    expect(worthHoisting(literalBytes(S), 1)).toBe(false);
    expect(worthHoisting(literalBytes(S), 2)).toBe(true);
    // Chữ Việt có dấu tính theo byte UTF-8 (Zalo cân byte).
    expect(literalBytes('đ')).toBe(4);
  });

  it('hàm khai trong khối chỉ sống trong khối (chunk là module nên strict) và nhãn vòng lặp không làm bước tự kiểm báo lệch', async () => {
    const T = await loadTerserAst();
    const code =
      `const t=()=>"outer ${S}";function f(x){if(x){function t(){return"${S}"}return t()}return t()}` +
      `function g(){l:for(const k of["${S}","${S}"]){for(;;){if(k)break l}}return"${S}"}` +
      `export const result=[f(0),f(1),g(),"${S}"];`;
    const out = hoistRepeatedStrings(T, code);
    expect(out.hoisted).toBeGreaterThan(0);
    expect(sameAfterInlining(T, code, out.code)).toBe(true);
    expect(runApp({ 'app.js': out.code })).toBe(runApp({ 'app.js': code }));
  });

  it('`sameAfterInlining` bắt được hằng gom bị biến cục bộ che (tham chiếu trỏ sang biến khác)', async () => {
    const T = await loadTerserAst();
    const before = `function f(a){return["${S}",a]}export{f};`;
    expect(sameAfterInlining(T, before, `const b="${S}";function f(a){return[b,a]}export{f};`)).toBe(true);
    expect(sameAfterInlining(T, before, `const a="${S}";function f(a){return[a,a]}export{f};`)).toBe(false);
    expect(inlineHoisted(T, `import{x as c}from"./a.js";const b="${S}";c(b);`)).toBe(`import{x as c}from"./a.js";c("${S}");`);
    expect(() => inlineHoisted(T, 'const b=1;export{b};')).toThrow();
  });

  it('`chunksInImportCycles` trả các chunk nằm trong vòng import tĩnh, kể cả chunk tự import chính nó', () => {
    const graph = new Map<string, string[]>([
      ['a.js', ['b.js', 'vendor.js']],
      ['b.js', ['a.js']],
      ['c.js', ['a.js']],
      ['d.js', ['d.js']],
      ['e.js', ['f.js']],
      ['f.js', ['g.js']],
      ['g.js', ['e.js', 'outside.js']],
      ['vendor.js', []],
    ]);
    expect([...chunksInImportCycles(graph)].sort()).toEqual(['a.js', 'b.js', 'd.js', 'e.js', 'f.js', 'g.js']);
    expect(chunksInImportCycles(new Map([['x.js', ['y.js']], ['y.js', []]])).size).toBe(0);
  });

  it('plugin gom chunk JS, bỏ qua chunk trong vòng import, chunk có source map và asset; lỗi thì giữ chunk và cảnh báo', async () => {
    const plugin = hoistRepeatedStringsPlugin();
    const chunk = (fileName: string, code: string, imports: string[], map: object | null = null) => ({ type: 'chunk', fileName, code, imports, map });
    const bundle = {
      'assets/app.js': chunk('assets/app.js', APP, ['assets/lib.js']),
      'assets/lib.js': chunk('assets/lib.js', LIB, []),
      'assets/loop-a.js': chunk('assets/loop-a.js', APP, ['assets/loop-b.js']),
      'assets/loop-b.js': chunk('assets/loop-b.js', APP, ['assets/loop-a.js']),
      'assets/mapped.js': chunk('assets/mapped.js', APP, [], {}),
      'assets/bad.js': chunk('assets/bad.js', `const a="${S}";a(`, []),
      'assets/app.css': { type: 'asset', fileName: 'assets/app.css', source: `:root{--a:"${S}"}` },
    };
    const warn = vi.fn();
    const hook = plugin.generateBundle as Hook;
    expect(hook.order).toBe('post');
    await hook.handler.call({ warn }, {}, bundle);
    expect(bundle['assets/app.js'].code).not.toBe(APP);
    expect(bundle['assets/app.js'].code.split(`"${S}"`).length - 1).toBe(1);
    expect(bundle['assets/lib.js'].code).toBe(LIB);
    expect(bundle['assets/loop-a.js'].code).toBe(APP);
    expect(bundle['assets/loop-b.js'].code).toBe(APP);
    expect(bundle['assets/mapped.js'].code).toBe(APP);
    expect(bundle['assets/bad.js'].code).toBe(`const a="${S}";a(`);
    expect(bundle['assets/app.css'].source).toBe(`:root{--a:"${S}"}`);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((plugin.augmentChunkHash as () => string)()).toBe(HOIST_PASS_VERSION);
  });

  it('vite.config chạy bước gom chuỗi trước bước bỏ ` as x` (bước gom đặt lại mọi tên biến cục bộ)', () => {
    const config = fs.readFileSync(path.join(__dirname, '../vite.config.mts'), 'utf8');
    const hoist = config.indexOf('hoistRepeatedStringsPlugin()');
    const unalias = config.indexOf('unaliasModuleNamesPlugin()');
    expect(hoist).toBeGreaterThan(-1);
    expect(unalias).toBeGreaterThan(hoist);
  });
});
