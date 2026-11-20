import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { loadTerserAst, sameBindings, UNALIAS_PASS_VERSION, unaliasModuleNames, unaliasModuleNamesPlugin } from './build-import-names';

// Hai chunk dạng Rollup + terser xuất ra, cài sẵn bẫy: tham số và biến trong hàm trùng tên nối (`j`, `s`), chunk dùng biến toàn cục `Map`
// trùng tên một export của chunk kia, và một import mặc định.
const LIB = 'const e=(n)=>n*2;const t=(n)=>n+1;const n="s";const k=()=>"k";export{e as j,t as r,n as s,k as Map};export default 7;';
const APP =
  'import d,{j as e,r as t,s as a,Map as h}from"./lib.js";' +
  'function f(j){return e(j)+t(j)}' +
  'const g=(r)=>{const s=r;return[a,s,t(r)]};' +
  'export const result=[f(3),g(4),h(),new Map().size,d];';

function runApp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubu-unalias-'));
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

describe('build-import-names', () => {
  it('bỏ ` as x` ở import/export, chạy ra đúng kết quả cũ dù tên nối trùng tham số và biến trong hàm', async () => {
    const T = await loadTerserAst();
    const lib = unaliasModuleNames(T, LIB);
    const app = unaliasModuleNames(T, APP);

    expect(lib.code).toMatch(/export\{j,r,s,Map\}/);
    expect(app.code).toMatch(/import \w+,\{j,r,s,Map as \w+\}from"\.\/lib\.js"/);
    expect(sameBindings(T, LIB, lib.code)).toBe(true);
    expect(sameBindings(T, APP, app.code)).toBe(true);
    expect(runApp({ 'lib.js': lib.code, 'app.js': app.code })).toBe(runApp({ 'lib.js': LIB, 'app.js': APP }));
    expect(runApp({ 'lib.js': LIB, 'app.js': APP })).toBe('[10,["s",4,5],"k",0,7]');
  });

  it('không ghim tên nối dài mà biến dùng nhiều lần (mỗi tham chiếu dài thêm hơn số byte bỏ được)', async () => {
    const T = await loadTerserAst();
    const code = 'import{longName as e}from"./x.js";e();e();e();export{};';
    const out = unaliasModuleNames(T, code);
    expect(out.pinned).toBe(0);
    expect(out.code).toBe(code);
  });

  it('không ghim biến nhập không còn tham chiếu, tên trùng `export const` hay chunk có eval', async () => {
    const T = await loadTerserAst();
    // Đầu ra thật của terser (cấu hình như vite.config.mts) khi hàm duy nhất dùng `jsx` bị bỏ: import còn, không tham chiếu. Biến không tham chiếu
    // không có trong danh sách tên phạm vi đang dùng của terser, nên ghim nó về `j` thì terser vẫn cấp `j` cho một const dưới (khai báo trùng).
    const names = 'o m n r t d h M s c j l e f g i p b k q u v w x y z A B C D E F G H I J K L N O P Q R S T U V W X Y Z $ _ aa oa ma na ra ta da'.split(' ');
    const unused = `import{j as a}from"./a.js";const ${names.map((n) => `${n}=Math.random()`).join(',')};console.log(1,${names.join(',')},0);`;
    const sameName = 'import{x as e}from"./a.js";e();export const x=1;';
    const withEval = 'import{j as e}from"./a.js";e();eval("e()");export{};';
    for (const code of [unused, sameName, withEval]) {
      const out = unaliasModuleNames(T, code);
      expect(() => T.parse(out.code, { module: true })).not.toThrow();
      expect(sameBindings(T, code, out.code)).toBe(true);
    }
    expect(unaliasModuleNames(T, sameName).code).toMatch(/import\{x as \w+\}/);
    expect(unaliasModuleNames(T, withEval)).toEqual({ code: withEval, pinned: 0 });
  });

  it('plugin giữ nguyên chunk và cảnh báo khi không dựng được cây cú pháp; đổi bản thì đổi băm tên chunk', async () => {
    const plugin = unaliasModuleNamesPlugin();
    const bundle = { 'assets/bad.js': { type: 'chunk', fileName: 'assets/bad.js', code: 'import{j as e}from"./a.js";e(', map: null } };
    const warn = vi.fn();
    const hook = plugin.generateBundle as { handler: (this: unknown, o: unknown, b: unknown) => Promise<void> };
    await hook.handler.call({ warn }, {}, bundle);
    expect(bundle['assets/bad.js'].code).toBe('import{j as e}from"./a.js";e(');
    expect(warn).toHaveBeenCalledTimes(1);
    expect((plugin.augmentChunkHash as () => string)()).toBe(UNALIAS_PASS_VERSION);
  });

  it('`sameBindings` bắt được đổi tên làm một tham chiếu trỏ sang khai báo khác', async () => {
    const T = await loadTerserAst();
    expect(sameBindings(T, 'let a=1;function f(b){return a}export{f};', 'let a=1;function f(a){return a}export{f};')).toBe(false);
    expect(sameBindings(T, 'let a=1;function f(b){return a}export{f};', 'let c=1;function f(b){return c}export{f};')).toBe(true);
  });

  it('plugin đổi chunk JS, bỏ qua chunk có source map và asset', async () => {
    const plugin = unaliasModuleNamesPlugin();
    const bundle = {
      'assets/app.js': { type: 'chunk', fileName: 'assets/app.js', code: APP, map: null },
      'assets/mapped.js': { type: 'chunk', fileName: 'assets/mapped.js', code: APP, map: {} },
      'assets/app.css': { type: 'asset', fileName: 'assets/app.css', source: ':root{--a:1}' },
    };
    const warn = vi.fn();
    const hook = plugin.generateBundle as { order: string; handler: (this: unknown, o: unknown, b: unknown) => Promise<void> };
    expect(hook.order).toBe('post');
    await hook.handler.call({ warn }, {}, bundle);
    expect(bundle['assets/app.js'].code).toMatch(/\{j,r,s,Map as \w+\}/);
    expect(bundle['assets/mapped.js'].code).toBe(APP);
    expect(bundle['assets/app.css'].source).toBe(':root{--a:1}');
    expect(warn).not.toHaveBeenCalled();
  });
});
