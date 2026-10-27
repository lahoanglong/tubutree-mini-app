// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ phase: 'authenticated', restoring: false, path: '/tai-khoan/vi-tubu' }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase, useAuthRestoring: () => mocks.restoring }));
vi.mock('@/lib/shell-pathname', () => ({ useShellPathname: () => mocks.path }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: (p: string) => p !== '/kho-qua/cua-toi' }));

import { AccountShell } from './account-shell';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r.container;
};

describe('AccountShell (menu tài khoản từ lg)', () => {
  it('đã đăng nhập: có menu nhóm theo mục, đánh dấu mục đang mở, ẩn mục chưa làm xong, menu chỉ từ lg', () => {
    const c = mount(
      <AccountShell>
        <main>nội dung</main>
      </AccountShell>,
    );
    const nav = c.querySelector('nav[aria-label="Menu tài khoản"]') as HTMLElement;
    expect(nav.className).toMatch(/\bhidden\b/);
    expect(nav.className).toMatch(/\blg:block\b/);
    expect(nav.querySelector('a[aria-current="page"]')?.textContent).toBe('Ví Tubu');
    expect(nav.querySelector('a[href="/kho-qua/cua-toi"]')).toBeNull();
    expect(nav.querySelector('a[href="/tai-khoan/diem-xanh"]')).not.toBeNull();
    expect(c.querySelector('main')?.textContent).toBe('nội dung');
  });

  it('chi tiết đơn vẫn đánh dấu mục Đơn hàng; Tổng quan chỉ khớp đúng /tai-khoan', () => {
    mocks.path = '/tai-khoan/don-hang/TUBU1';
    let c = mount(<AccountShell>x</AccountShell>);
    expect(c.querySelector('nav a[aria-current="page"]')?.textContent).toBe('Đơn hàng');
    mocks.path = '/tai-khoan';
    c = mount(<AccountShell>x</AccountShell>);
    expect(c.querySelector('nav a[aria-current="page"]')?.textContent).toBe('Tổng quan');
    mocks.path = '/tai-khoan/vi-tubu';
  });

  it('khách chưa đăng nhập: không có menu; cây DOM của nội dung giữ nguyên để không dựng lại khi phiên khôi phục xong', () => {
    mocks.phase = 'guest';
    const c = mount(
      <AccountShell>
        <main>đăng nhập</main>
      </AccountShell>,
    );
    expect(c.querySelector('nav')).toBeNull();
    expect(c.querySelector('main')?.parentElement?.parentElement).toBe(c.firstElementChild);
    mocks.phase = 'authenticated';
  });

  it('đang khôi phục một phiên có sẵn: dựng sẵn khung hai cột kèm menu khung xương để nội dung không dịch khi phiên về', () => {
    mocks.phase = 'loading';
    mocks.restoring = true;
    const c = mount(
      <AccountShell>
        <main>đang tải</main>
      </AccountShell>,
    );
    expect(c.firstElementChild?.className).toContain('lg:grid-cols-[240px_minmax(0,1fr)]');
    expect(c.querySelector('[data-testid="account-shell-nav-skeleton"]')).not.toBeNull();
    expect(c.querySelector('nav')).toBeNull();
    mocks.phase = 'authenticated';
    mocks.restoring = false;
  });

  it('phase "unavailable" (cờ còn, mất mạng lúc khôi phục): giữ khung hai cột và menu khung xương, không có menu thật', () => {
    mocks.phase = 'unavailable';
    mocks.restoring = false;
    const c = mount(
      <AccountShell>
        <main>mất mạng</main>
      </AccountShell>,
    );
    expect(c.firstElementChild?.className).toContain('lg:grid-cols-[240px_minmax(0,1fr)]');
    const skeleton = c.querySelector('[data-testid="account-shell-nav-skeleton"]') as HTMLElement;
    expect(skeleton.className.split(/\s+/)).toContain('lg:block');
    expect(c.querySelector('nav')).toBeNull();
    expect(c.textContent).toContain('mất mạng');
    mocks.phase = 'authenticated';
  });

  it('lần dựng đầu (chưa biết phiên): khung chỉ ăn khi <html> có data-restoring (script ở head), không có lớp khung vô điều kiện', () => {
    mocks.phase = 'loading';
    mocks.restoring = false;
    const c = mount(
      <AccountShell>
        <main>đang tải</main>
      </AccountShell>,
    );
    const root = c.firstElementChild as HTMLElement;
    const cls = root.className.split(/\s+/);
    expect(cls).not.toContain('lg:grid');
    expect(cls).not.toContain('lg:grid-cols-[240px_minmax(0,1fr)]');
    expect(cls).toContain('[html[data-restoring]_&]:lg:grid');
    const skeleton = c.querySelector('[data-testid="account-shell-nav-skeleton"]') as HTMLElement;
    expect(skeleton.className.split(/\s+/)).not.toContain('lg:block');
    expect(skeleton.className).toContain('[html[data-restoring]_&]:lg:block');
    mocks.phase = 'authenticated';
  });

  it('biết là khách (phiên hết hạn/không có cờ): gỡ data-restoring khỏi <html>; đã đăng nhập cũng gỡ; còn đang tải thì giữ', () => {
    document.documentElement.setAttribute('data-restoring', '');
    mocks.phase = 'loading';
    mocks.restoring = true;
    mount(<AccountShell>x</AccountShell>);
    expect(document.documentElement.hasAttribute('data-restoring')).toBe(true);
    mocks.phase = 'guest';
    mocks.restoring = false;
    mount(<AccountShell>x</AccountShell>);
    expect(document.documentElement.hasAttribute('data-restoring')).toBe(false);
    document.documentElement.setAttribute('data-restoring', '');
    mocks.phase = 'authenticated';
    mount(<AccountShell>x</AccountShell>);
    expect(document.documentElement.hasAttribute('data-restoring')).toBe(false);
  });
});
