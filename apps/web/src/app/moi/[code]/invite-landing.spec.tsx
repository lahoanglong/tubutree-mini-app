// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { click, render } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ cfg: null as unknown, fail: false, track: vi.fn() }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/core-http-server', () => ({
  createServerHttp: () => ({
    get: async (path: string) => {
      if (mocks.fail) throw new Error('API down');
      if (path !== '/config/public') throw new Error(`đường lạ ${path}`);
      return mocks.cfg;
    },
  }),
}));
vi.mock('@/lib/analytics', () => ({ trackWebEvent: mocks.track }));

import InviteLandingPage, { generateMetadata } from './page';
import { InviteLandingCta } from './invite-landing-cta';

const ON = { referralShareCardEnabled: true, newCustomer: { welcomeVoucher: { amount: 30000, minOrder: 199000 } } };

const html = async (code: string) => {
  const el = (await InviteLandingPage({ params: Promise.resolve({ code }) })) as ReactElement;
  const box = document.createElement('div');
  box.innerHTML = renderToStaticMarkup(el);
  return box;
};

beforeEach(() => {
  mocks.cfg = ON;
  mocks.fail = false;
});
afterEach(() => vi.clearAllMocks());

describe('trang đích link mời /moi/[code]', () => {
  it('cờ tắt, thiếu cờ hoặc API lỗi: 404 (không lộ trang khi tính năng chưa bật)', async () => {
    mocks.cfg = { ...ON, referralShareCardEnabled: false };
    await expect(html('ABC123')).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.cfg = { newCustomer: ON.newCustomer };
    await expect(html('ABC123')).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.cfg = { referralShareCardEnabled: 'true' };
    await expect(html('ABC123')).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.fail = true;
    await expect(html('ABC123')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('mã đúng khuôn: lời chào chung, quà cho bạn mới theo cấu hình, một nút vào Trang chủ kèm ?ref=', async () => {
    const box = await html('ABC123');
    expect(box.querySelector('h1')?.textContent).toBe('Mời bạn sống xanh cùng Tubu Tree');
    expect(box.textContent).toContain('Một người bạn đã mời bạn ghé Tubu Tree.');
    expect(box.textContent).toContain('30.000đ');
    const links = box.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('/?ref=ABC123');
    expect(links[0]!.textContent).toBe('Bắt đầu mua sắm');
  });

  it('mã không tồn tại cho ra đúng cùng một trang (không tra mã nên không lộ mã nào có thật); trang không in mã ra chữ', async () => {
    const a = (await html('ABC123')).innerHTML.replace('ABC123', 'X');
    const b = (await html('ZZZ999')).innerHTML.replace('ZZZ999', 'X');
    expect(a).toBe(b);
    expect((await html('ABC123')).textContent).not.toContain('ABC123');
  });

  it('mã sai khuôn: trang chung không quà, nút về Trang chủ trơn, chuỗi lạ không vào HTML', async () => {
    const box = await html('<script>alert(1)</script>');
    expect(box.querySelector('a')?.getAttribute('href')).toBe('/');
    expect(box.innerHTML).not.toContain('script');
    expect(box.textContent).not.toContain('30.000đ');
  });

  it('không có tên, số điện thoại hay số liệu của người mời trong HTML', async () => {
    const box = await html('ABC123');
    expect(box.textContent).not.toMatch(/0\d{9}/);
    expect(box.textContent).not.toMatch(/Điểm Xanh/);
  });

  it('metadata: noindex nofollow, không canonical, không og:url; tiêu đề chung', async () => {
    const meta = await generateMetadata();
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeNull();
    expect(meta.openGraph).not.toHaveProperty('url');
    expect(meta.title).toEqual({ absolute: fillCopy('invite.landing.title') });
  });

  it('ảnh xem trước là tệp PNG tĩnh 1200x630 cạnh trang (thẻ chung, không mã, không tên), chữ thay thế đúng tiêu đề', () => {
    const png = readFileSync(join(__dirname, 'opengraph-image.png'));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(readFileSync(join(__dirname, 'opengraph-image.alt.txt'), 'utf8')).toBe(fillCopy('invite.landing.title'));
  });

  it('nút: báo invite_landing_viewed khi mở và invite_landing_cta khi bấm, không mang mã mời', () => {
    const view = render(<InviteLandingCta href="/?ref=ABC123" />);
    expect(mocks.track).toHaveBeenCalledWith('invite_landing_viewed', {});
    const link = view.container.querySelector('a')!;
    link.addEventListener('click', (e) => e.preventDefault());
    click(link);
    expect(mocks.track).toHaveBeenCalledWith('invite_landing_cta', {});
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain('ABC123');
    view.unmount();
  });
});
