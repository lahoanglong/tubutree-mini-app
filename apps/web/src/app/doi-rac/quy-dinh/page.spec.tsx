// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ serverGet: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/core-http-server', () => ({ createServerHttp: () => ({ get: mocks.serverGet }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: vi.fn() } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));

import RulesPage, { metadata } from './page';

let mounted: Rendered[] = [];
beforeEach(() => {
  mocks.serverGet.mockReset();
  mocks.get.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/doi-rac/quy-dinh (trang công khai)', () => {
  it('metadata: có tiêu đề, mô tả, canonical và không chặn lập chỉ mục', () => {
    expect(metadata.title).toBe('Thể lệ Đổi rác lấy quà — Tubu Tree');
    expect(metadata.description).toBeTruthy();
    expect(metadata.alternates?.canonical).toBe('/doi-rac/quy-dinh');
    expect(metadata.robots).toBeUndefined();
  });

  it('thể lệ đọc ở server (GET /waste/rules) được dựng sẵn vào trang', async () => {
    mocks.serverGet.mockResolvedValue({ text: 'Thể lệ A' });
    const r = render(await RulesPage());
    mounted.push(r);
    await flush(4);
    expect(mocks.serverGet).toHaveBeenCalledWith('/waste/rules');
    expect(r.container.textContent).toContain('Thể lệ A');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('server lỗi: trang vẫn dựng, trình duyệt tự tải', async () => {
    mocks.serverGet.mockRejectedValue(new Error('API tạm lỗi'));
    mocks.get.mockResolvedValue({ text: 'Thể lệ B' });
    const r = render(await RulesPage());
    mounted.push(r);
    await flush(6);
    expect(r.container.textContent).toContain('Thể lệ B');
  });
});

describe('robots cho /doi-rac', () => {
  it('khoá cây riêng tư nhưng mở lại riêng /doi-rac/quy-dinh', async () => {
    const { default: robots } = await import('../../robots');
    const rule = [robots().rules].flat()[0] as { allow: string[]; disallow: string[] };
    expect(rule.disallow).toContain('/doi-rac');
    expect(rule.allow).toContain('/doi-rac/quy-dinh');
  });
});
