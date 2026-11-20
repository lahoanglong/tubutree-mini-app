import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { loadTerserAst, sameBindings, unaliasModuleNames, unaliasModuleNamesPlugin } from './build-import-names';

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
