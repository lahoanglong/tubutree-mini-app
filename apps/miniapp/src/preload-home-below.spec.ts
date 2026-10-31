import { describe, expect, it } from 'vitest';
import { appConfigWithAsyncJs, homeBelowPreloadFiles } from './preload-home-below';

const chunk = (fileName: string, imports: string[] = [], extra: Record<string, unknown> = {}) => ({ type: 'chunk' as const, fileName, imports, isEntry: false, isDynamicEntry: false, facadeModuleId: null, ...extra });

describe('homeBelowPreloadFiles', () => {
  const bundle = {
    'assets/index.js': chunk('assets/index.js', [], { isEntry: true }),
    'assets/home-below.js': chunk('assets/home-below.js', ['assets/index.js', 'assets/a.js'], { isDynamicEntry: true, facadeModuleId: '/repo/apps/miniapp/src/components/home/home-below.tsx' }),
    'assets/a.js': chunk('assets/a.js', ['assets/b.js']),
    'assets/b.js': chunk('assets/b.js', ['assets/a.js']),
    'assets/other.js': chunk('assets/other.js'),
    'assets/x.css': { type: 'asset' as const, fileName: 'assets/x.css' },
  };

  it('gom chunk home-below và mọi chunk nó cần (kể cả vòng), bỏ entry, bỏ chunk không liên quan', () => {
    expect(homeBelowPreloadFiles(bundle).sort()).toEqual(['assets/a.js', 'assets/b.js', 'assets/home-below.js']);
  });

  it('không có chunk home-below thì không preload gì', () => {
    expect(homeBelowPreloadFiles({ 'assets/index.js': bundle['assets/index.js'] })).toEqual([]);
  });
});

describe('appConfigWithAsyncJs', () => {
  it('thêm chunk vào listAsyncJS, giữ nguyên phần còn lại, không trùng', () => {
    const cfg = { app: { title: 'x' }, listSyncJS: ['assets/index.js'], listAsyncJS: ['assets/a.js'], pages: [] };
    expect(appConfigWithAsyncJs(cfg, ['assets/a.js', 'assets/b.js'])).toEqual({ ...cfg, listAsyncJS: ['assets/a.js', 'assets/b.js'] });
  });

  it('thiếu listAsyncJS thì tạo mới; không có chunk thì không đổi gì', () => {
    expect(appConfigWithAsyncJs({ listSyncJS: [] }, ['assets/b.js'])).toEqual({ listSyncJS: [], listAsyncJS: ['assets/b.js'] });
    const cfg = { listSyncJS: [] };
    expect(appConfigWithAsyncJs(cfg, [])).toBe(cfg);
  });
});
