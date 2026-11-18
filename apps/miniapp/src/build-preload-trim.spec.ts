import { describe, expect, it } from 'vitest';
import { preloadTrim, startupChunks } from './build-preload-trim';

const chunk = (fileName: string, imports: string[] = [], isEntry = false) => ({ type: 'chunk' as const, fileName, isEntry, imports });
const BUNDLE = {
  'assets/index.a.js': chunk('assets/index.a.js', ['assets/vendor-react.b.js', 'assets/vendor-state.c.js'], true),
  'assets/vendor-react.b.js': chunk('assets/vendor-react.b.js'),
  'assets/vendor-state.c.js': chunk('assets/vendor-state.c.js', ['assets/vendor-react.b.js']),
  'assets/game.d.js': chunk('assets/game.d.js', ['assets/index.a.js', 'assets/button.e.js']),
  'assets/button.e.js': chunk('assets/button.e.js', ['assets/vendor-react.b.js']),
  'assets/game.css': { type: 'asset' as const, fileName: 'assets/game.css' },
};

describe('build-preload-trim', () => {
  it('chunk khởi động là entry và bao đóng import tĩnh của nó; chunk chỉ nạp lười không thuộc', () => {
    expect([...startupChunks(BUNDLE)].sort()).toEqual(['assets/index.a.js', 'assets/vendor-react.b.js', 'assets/vendor-state.c.js']);
  });

  it('preload của import động bỏ chunk khởi động (đã chạy), giữ chunk lười; preload của HTML giữ nguyên', () => {
    const { plugin, resolveDependencies } = preloadTrim();
    const deps = ['assets/game.d.js', 'assets/index.a.js', 'assets/button.e.js', 'assets/vendor-react.b.js'];
    expect(resolveDependencies('assets/index.a.js', deps, { hostType: 'js' })).toEqual(deps);
    const hook = plugin.generateBundle as { order: string; handler: (o: unknown, b: unknown) => void };
    expect(hook.order).toBe('pre');
    hook.handler({}, BUNDLE);
    expect(resolveDependencies('assets/index.a.js', deps, { hostType: 'js' })).toEqual(['assets/game.d.js', 'assets/button.e.js']);
    expect(resolveDependencies('index.html', deps, { hostType: 'html' })).toEqual(deps);
  });
});
