import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ enabled: false, redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: h.redirect }));
vi.mock('@tubutree/app-core/features', () => ({
  get CASHBACK_ENABLED() {
    return h.enabled;
  },
}));

import Layout from './layout';

describe('/hoan-tien layout', () => {
  beforeEach(() => h.redirect.mockClear());

  it('cờ tắt: chuyển về Cá nhân như Mini App (/cashback → /profile)', () => {
    h.enabled = false;
    Layout({ children: null });
    expect(h.redirect).toHaveBeenCalledWith('/tai-khoan');
  });

  it('cờ bật: giữ nguyên trang', () => {
    h.enabled = true;
    Layout({ children: null });
    expect(h.redirect).not.toHaveBeenCalled();
  });
});
