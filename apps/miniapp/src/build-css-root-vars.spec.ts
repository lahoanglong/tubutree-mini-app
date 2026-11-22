import { describe, expect, it } from 'vitest';
import { dropOverriddenRootVars, dropOverriddenRootVarsPlugin, dropUnusedTailwindDefaults, tailwindVarUsage } from './build-css-root-vars';

describe('build-css-root-vars', () => {
  it('bỏ khai báo biến ở luật `:root` cấp ngoài bị luật `:root` sau ghi đè, giữ khai báo thắng và thuộc tính thường', () => {
    const css = ':root{--a:1;--b:2;color:red}.x{color:var(--a)}:root{--a:3}';
    expect(dropOverriddenRootVars(css)).toEqual({ css: ':root{--b:2;color:red}.x{color:var(--a)}:root{--a:3}', removed: 1 });
  });

  it('bỏ cả luật `:root` khi nó không còn khai báo nào', () => {
    expect(dropOverriddenRootVars(':root{--a:1}:root{--a:2}').css).toBe(':root{--a:2}');
  });

  it('giữ khai báo trước có `!important` khi khai báo sau không có', () => {
    const css = ':root{--a:1!important}:root{--a:2}';
    expect(dropOverriddenRootVars(css)).toEqual({ css, removed: 0 });
    expect(dropOverriddenRootVars(':root{--a:1!important}:root{--a:2!important}').css).toBe(':root{--a:2!important}');
  });

  it('không đụng `:root` lồng trong @media, selector khác hay danh sách selector', () => {
    const css = ':root{--a:1}@media (min-width:1px){:root{--a:2}}:root,.y{--a:3}.z{--a:4}';
    expect(dropOverriddenRootVars(css)).toEqual({ css, removed: 0 });
  });

  it('plugin chỉ sửa asset .css', () => {
    const plugin = dropOverriddenRootVarsPlugin();
    const bundle = {
      'assets/index.css': { type: 'asset', fileName: 'assets/index.css', source: ':root{--a:1}:root{--a:2}' },
      'assets/app.js': { type: 'chunk', fileName: 'assets/app.js', code: ':root{--a:1}:root{--a:2}' },
    };
    const hook = plugin.generateBundle as { order: string; handler: (o: unknown, b: unknown) => void };
    expect(hook.order).toBe('post');
    hook.handler({}, bundle);
    expect(bundle['assets/index.css'].source).toBe(':root{--a:2}');
    expect(bundle['assets/app.js'].code).toBe(':root{--a:1}:root{--a:2}');
  });

  const TW_DEFAULTS =
    '*,:after,:before{--tw-pan-x: ;--tw-ring-inset: ;--tw-shadow:0 0 #0000;--tw-contain-size: }::backdrop{--tw-pan-x: ;--tw-shadow:0 0 #0000}';

  it('Tailwind: bỏ biến mặc định không ai đọc qua var(), giữ biến tiện ích đang dùng; bỏ cả khối ::backdrop khi không luật nào nhắm ::backdrop', () => {
    const app = '.shadow{box-shadow:var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-shadow)}';
    const usage = tailwindVarUsage([TW_DEFAULTS + app], ['const s="--tw-ring-inset"']);
    expect([...usage.used].sort()).toEqual(['--tw-ring-inset', '--tw-ring-offset-shadow', '--tw-shadow']);
    expect(usage.backdropRules).toBe(false);
    expect(dropUnusedTailwindDefaults(TW_DEFAULTS + app, usage)).toEqual({
      css: '*,:after,:before{--tw-ring-inset: ;--tw-shadow:0 0 #0000}' + app,
      removed: 4,
    });
  });

  it('Tailwind: biến dùng ở tệp CSS khác (tải lười) vẫn được giữ; còn luật nhắm ::backdrop thì giữ biến đang dùng trong khối ::backdrop', () => {
    const lazy = 'dialog::backdrop{box-shadow:var(--tw-shadow)}';
    const usage = tailwindVarUsage([TW_DEFAULTS, lazy], []);
    expect(usage.backdropRules).toBe(true);
    expect(dropUnusedTailwindDefaults(TW_DEFAULTS, usage).css).toBe('*,:after,:before{--tw-shadow:0 0 #0000}::backdrop{--tw-shadow:0 0 #0000}');
  });

  it('Tailwind: không đụng biến --tw-* ở luật khác, không đổi gì thì trả nguyên chuỗi', () => {
    const css = '.ring{--tw-ring-inset: ;--tw-unused:1}';
    expect(dropUnusedTailwindDefaults(css, { used: new Set(), backdropRules: false })).toEqual({ css, removed: 0 });
  });

  it('plugin gom biến đang dùng trên mọi tệp CSS và JS của bản build rồi mới cắt', () => {
    const plugin = dropOverriddenRootVarsPlugin();
    const hook = plugin.generateBundle as unknown as { handler: (o: unknown, b: Record<string, unknown>) => void };
    const bundle: Record<string, { type: string; fileName: string; source?: string; code?: string }> = {
      'assets/index.css': { type: 'asset', fileName: 'assets/index.css', source: TW_DEFAULTS },
      'assets/lazy.css': { type: 'asset', fileName: 'assets/lazy.css', source: '.s{box-shadow:var(--tw-shadow)}' },
      'assets/app.js': { type: 'chunk', fileName: 'assets/app.js', code: 'el.style.setProperty("--tw-pan-x","1")' },
    };
    hook.handler({}, bundle);
    expect(bundle['assets/index.css']?.source).toBe('*,:after,:before{--tw-pan-x: ;--tw-shadow:0 0 #0000}');
  });
});
