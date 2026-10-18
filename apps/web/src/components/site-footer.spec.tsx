import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPublicSupport: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getPublicSupport: mocks.getPublicSupport,
}));

import SiteFooter from './site-footer';

async function html() {
  return renderToStaticMarkup(await SiteFooter());
}

describe('SiteFooter', () => {
  it('hiện hotline và email lấy từ cấu hình công khai, bấm được (tel:/mailto:)', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    const out = await html();
    expect(out).toContain('href="tel:0984606774"');
    expect(out).toContain('0984 606 774');
    expect(out).toContain('href="mailto:tubutree@gmail.com"');
    expect(out).toContain('tubutree@gmail.com');
  });

  it('tổng đài cấu hình số liền 18001234: hiển thị "1800 1234", tel: vẫn là số gốc (R5-BUYER-5)', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '18001234', email: 'tubutree@gmail.com' });
    const out = await html();
    expect(out).toContain('href="tel:18001234"');
    expect(out).toContain('Hotline: 1800 1234');
  });

  it('là landmark contentinfo và không dẫn khách vào Kênh Đối Tác (/merchant)', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    const out = await html();
    expect(out.startsWith('<footer')).toBe(true);
    expect(out).not.toContain('/merchant');
    expect(out).not.toMatch(/Đối Tác/i);
  });

  it('liên kết liên hệ có vùng chạm tối thiểu 44px', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    const links = (await html()).match(/<a [^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const a of links) expect(a).toContain('min-h-11');
  });

  it('có lối tới bốn trang điều khoản/chính sách (D5-01), đủ vùng chạm 44px', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    const out = await html();
    const nav = out.match(/<nav[^>]*aria-label="Chính sách"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(nav).not.toBe('');
    const hrefs = [...nav.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['/chinh-sach/dieu-khoan', '/chinh-sach/bao-mat', '/chinh-sach/doi-tra', '/chinh-sach/van-chuyen']);
    for (const label of ['Điều khoản', 'Bảo mật', 'Đổi trả', 'Vận chuyển']) expect(nav).toContain(label);
    for (const a of nav.match(/<a [^>]*>/g) ?? []) expect(a).toContain('min-h-11');
  });

  it('hiện kênh cộng đồng nào đã có link (mở tab mới, rel an toàn); chưa có thì không vẽ khối', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    expect(await html()).not.toContain('Kênh cộng đồng');

    mocks.getPublicSupport.mockResolvedValue({
      hotline: '0984 606 774',
      email: 'tubutree@gmail.com',
      community: { zaloGroupUrl: 'https://zalo.me/g/abc', tiktokUrl: 'https://www.tiktok.com/@tubutree' },
    });
    const out = await html();
    expect(out).toContain('aria-label="Kênh cộng đồng"');
    expect(out).toMatch(/<a [^>]*href="https:\/\/zalo.me\/g\/abc"[^>]*rel="noopener noreferrer"[^>]*>/);
    expect(out).toContain('Nhóm Zalo');
    expect(out).toContain('TikTok');
    expect(out).not.toContain('Facebook');
  });
});
