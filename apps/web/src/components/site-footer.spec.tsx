import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPublicSupport: vi.fn(), wasteVisible: true, role: 'AFFILIATE' as string | undefined }));
vi.mock('@/lib/use-waste-visible', () => ({ useWasteVisible: () => mocks.wasteVisible }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: mocks.role ? { id: 'u1', role: mocks.role } : null }) }));
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

  describe('đơn vị vận hành', () => {
    const base = { hotline: '0984 606 774', email: 'tubutree@gmail.com' };
    const company = { legalName: 'Công ty TNHH Tubu', taxCode: '0312345678', address: '1 Đường A, Quận B', bctNoticeUrl: 'https://online.gov.vn/x' };

    it('chưa nhập gì thì không vẽ dòng nào', async () => {
      mocks.getPublicSupport.mockResolvedValue(base);
      const out = await html();
      expect(out).not.toContain('Đơn vị vận hành');
      expect(out).not.toContain('Bộ Công Thương');
    });

    it('đủ thông tin: dòng "Đơn vị vận hành: tên · MST mã · địa chỉ" ở cả chân trang đầy đủ và gọn, kèm link BCT mở tab mới', async () => {
      mocks.getPublicSupport.mockResolvedValue({ ...base, company });
      const out = await html();
      const line = 'Đơn vị vận hành: Công ty TNHH Tubu · MST 0312345678 · 1 Đường A, Quận B';
      expect(out.split(line)).toHaveLength(3);
      const links = out.match(/<a [^>]*href="https:\/\/online.gov.vn\/x"[^>]*>/g) ?? [];
      expect(links).toHaveLength(2);
      for (const a of links) {
        expect(a).toContain('target="_blank"');
        expect(a).toContain('rel="noopener noreferrer"');
        expect(a).toContain('min-h-11');
      }
      expect(out.split('Đã thông báo Bộ Công Thương')).toHaveLength(3);
    });

    it('ẩn từng phần còn trống, không để dấu nối thừa', async () => {
      mocks.getPublicSupport.mockResolvedValue({ ...base, company: { taxCode: '0312345678' } });
      const out = await html();
      expect(out).toContain('Đơn vị vận hành: MST 0312345678<');
      expect(out).not.toContain('·');
      expect(out).not.toContain('Bộ Công Thương');
    });

    it('chỉ có link BCT thì vẽ link, không vẽ dòng vận hành', async () => {
      mocks.getPublicSupport.mockResolvedValue({ ...base, company: { bctNoticeUrl: 'https://online.gov.vn/x' } });
      const out = await html();
      expect(out).not.toContain('Đơn vị vận hành');
      expect(out).toContain('Đã thông báo Bộ Công Thương');
    });
  });

  it('máy tính: 4 cột, có lối vào Vườn Xanh, Đổi rác, Kho quà, Cộng tác viên, Đại lý, Câu chuyện thương hiệu (trước đây bị giấu)', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    const out = await html();
    expect(out).toMatch(/<div class="[^"]*lg:grid-cols-4/);
    for (const to of ['/vuon-xanh', '/doi-rac', '/kho-qua', '/ctv', '/dai-ly', '/hoc-vien', '/cau-chuyen', '/gioi-thieu', '/mua-chung']) {
      expect(out).toContain(`href="${to}"`);
    }
  });

  it('Đổi rác tắt (và khách không có yêu cầu đang mở) thì chân trang không có lối vào Đổi rác', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    mocks.wasteVisible = false;
    try {
      const out = await html();
      expect(out).not.toContain('href="/doi-rac"');
      expect(out).toContain('href="/kho-qua"');
    } finally {
      mocks.wasteVisible = true;
    }
  });

  it('Học viện chỉ hiện cho CTV, đại lý, nhân viên: khách thường và khách chưa đăng nhập không thấy', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    for (const role of ['CUSTOMER', undefined]) {
      mocks.role = role;
      expect(await html()).not.toContain('href="/hoc-vien"');
    }
    mocks.role = 'STAFF';
    expect(await html()).toContain('href="/hoc-vien"');
    mocks.role = 'AFFILIATE';
  });
});
