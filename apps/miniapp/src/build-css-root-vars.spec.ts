import { describe, expect, it } from 'vitest';
import { dropOverriddenRootVars, dropOverriddenRootVarsPlugin } from './build-css-root-vars';

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
});
