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
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0899 149 229', email: 'tubutree@gmail.com' });
    const out = await html();
    expect(out).toContain('href="tel:0899149229"');
    expect(out).toContain('0899 149 229');
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
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0899 149 229', email: 'tubutree@gmail.com' });
    const out = await html();
    expect(out.startsWith('<footer')).toBe(true);
    expect(out).not.toContain('/merchant');
    expect(out).not.toMatch(/Đối Tác/i);
  });

  it('liên kết liên hệ có vùng chạm tối thiểu 44px', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0899 149 229', email: 'tubutree@gmail.com' });
    const links = (await html()).match(/<a [^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const a of links) expect(a).toContain('min-h-11');
  });
});
