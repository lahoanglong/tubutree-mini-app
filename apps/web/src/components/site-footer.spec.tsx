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

  it('chân trang gọn ở điện thoại cũng có cả hotline và email (Bộ Công Thương), không chỉ chân trang máy tính', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    const compact = (await html()).match(/<footer[^>]*data-compact-footer[^>]*>[\s\S]*?<\/footer>/)?.[0] ?? '';
    expect(compact).toContain('href="tel:0984606774"');
    expect(compact).toContain('href="mailto:tubutree@gmail.com"');
    expect(compact.match(/<nav[^>]*aria-label="Chính sách \(điện thoại\)"[^>]*>[\s\S]*?<\/nav>/)?.[0].match(/href="\/chinh-sach\//g)).toHaveLength(5);
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

  it('có lối tới năm trang điều khoản/chính sách (D5-01, Bộ Công Thương), đủ vùng chạm 44px', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    const out = await html();
    const nav = out.match(/<nav[^>]*aria-label="Chính sách"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(nav).not.toBe('');
    const hrefs = [...nav.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['/chinh-sach/dieu-khoan', '/chinh-sach/bao-mat', '/chinh-sach/doi-tra', '/chinh-sach/van-chuyen', '/chinh-sach/thanh-toan']);
    for (const label of ['Điều khoản', 'Bảo mật', 'Đổi trả', 'Vận chuyển', 'Thanh toán']) expect(nav).toContain(label);
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

    const MERCHANT_LINE = 'Đơn vị vận hành: CÔNG TY TNHH TUBU TREE · MST 0319585995 · Số 33, đường 1B, phường Long Bình, Thành phố Hồ Chí Minh';

    it('chưa nhập gì thì nêu thương nhân đã đăng ký (tên, MST, địa chỉ) ở cả chân trang đầy đủ và gọn, và KHÔNG có huy hiệu Bộ Công Thương', async () => {
      mocks.getPublicSupport.mockResolvedValue(base);
      const out = await html();
      expect(out.split(MERCHANT_LINE)).toHaveLength(3);
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

    it('chưa nhập số ĐKDN: số là MST của công ty (mã số doanh nghiệp), không bịa người đại diện, ngày hay nơi cấp', async () => {
      mocks.getPublicSupport.mockResolvedValue({ ...base, company });
      const out = await html();
      expect(out).not.toContain('Người đại diện');
      expect(out.split('Giấy chứng nhận đăng ký doanh nghiệp số 0312345678<')).toHaveLength(3);
      expect(out).not.toMatch(/cấp ngày|do [^<]* cấp/);
    });

    it('hộ kinh doanh (tên không phải công ty) chưa nhập ĐKDN thì KHÔNG có dòng hồ sơ pháp lý', async () => {
      mocks.getPublicSupport.mockResolvedValue({ ...base, company: { ...company, legalName: 'Hộ kinh doanh Tubu' } });
      const out = await html();
      expect(out).not.toContain('Giấy chứng nhận');
      expect(out).not.toContain('footer-company-legal');
    });

    it('đã nhập: dòng người đại diện + số, nơi cấp, ngày cấp ĐKDN ở cả chân trang đầy đủ và gọn', async () => {
      mocks.getPublicSupport.mockResolvedValue({
        ...base,
        company: { ...company, representative: 'Nguyễn Văn A', registrationNumber: '0312345678', registrationDate: '12/03/2020', registrationPlace: 'Sở Tài chính Thành phố Hồ Chí Minh' },
      });
      const out = await html();
      const line = 'Người đại diện theo pháp luật: Nguyễn Văn A · Giấy chứng nhận đăng ký doanh nghiệp số 0312345678 do Sở Tài chính Thành phố Hồ Chí Minh cấp ngày 12/03/2020';
      expect(out.split(line)).toHaveLength(3);
    });

    it('chỉ có người đại diện: nêu người đại diện, số ĐKDN theo MST của thương nhân đang hiện ở dòng vận hành', async () => {
      mocks.getPublicSupport.mockResolvedValue({ ...base, company: { representative: 'Nguyễn Văn A' } });
      const out = await html();
      expect(out).toContain('Người đại diện theo pháp luật: Nguyễn Văn A · Giấy chứng nhận đăng ký doanh nghiệp số 0319585995<');
      expect(out.split(MERCHANT_LINE)).toHaveLength(3);
    });

    it('ẩn từng phần còn trống, không để dấu nối thừa', async () => {
      mocks.getPublicSupport.mockResolvedValue({ ...base, company: { taxCode: '0312345678' } });
      const out = await html();
      expect(out).toContain('Đơn vị vận hành: MST 0312345678<');
      expect(out).not.toContain('·');
      expect(out).not.toContain('Bộ Công Thương');
    });

    it('chỉ có link BCT thật thì vẽ huy hiệu, dòng vận hành vẫn là thương nhân đã đăng ký', async () => {
      mocks.getPublicSupport.mockResolvedValue({ ...base, company: { bctNoticeUrl: 'https://online.gov.vn/x' } });
      const out = await html();
      expect(out.split(MERCHANT_LINE)).toHaveLength(3);
      expect(out).toContain('Đã thông báo Bộ Công Thương');
    });

    it.each([
      ['rỗng', ''],
      ['http không mã hoá', 'http://online.gov.vn/x'],
      ['tên miền lạ', 'https://example.com/online.gov.vn'],
      ['giả hậu tố', 'https://online.gov.vn.evil.com/x'],
      ['có @ lừa host', 'https://online.gov.vn@evil.com/x'],
      ['javascript', 'javascript:alert(1)'],
    ])('huy hiệu Bộ Công Thương KHÔNG hiện khi link %s', async (_name, url) => {
      mocks.getPublicSupport.mockResolvedValue({ ...base, company: { ...company, bctNoticeUrl: url } });
      const out = await html();
      expect(out).not.toContain('Bộ Công Thương');
      expect(out).not.toContain('evil.com');
      expect(out).toContain('Đơn vị vận hành: Công ty TNHH Tubu');
    });

    it('huy hiệu hiện với link của cổng online.gov.vn và với tên miền *.gov.vn', async () => {
      for (const url of ['https://online.gov.vn/Home/WebDetails/123', 'https://www.online.gov.vn/x', 'https://tmdt.gov.vn/xac-nhan']) {
        mocks.getPublicSupport.mockResolvedValue({ ...base, company: { ...company, bctNoticeUrl: url } });
        const out = await html();
        expect(out).toContain(`href="${url}"`);
        expect(out.split('Đã thông báo Bộ Công Thương')).toHaveLength(3);
      }
    });
  });

  it('máy tính: 4 cột, có lối vào Vườn Xanh, Đổi rác, Kho quà, Cộng tác viên, Đại lý, Câu chuyện thương hiệu, Blog (mở https://blog.tubutree.com)', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    const out = await html();
    expect(out).toMatch(/<div class="[^"]*lg:grid-cols-4/);
    for (const to of ['/vuon-xanh', '/doi-rac', '/kho-qua', '/ctv', '/dai-ly', '/hoc-vien', '/cau-chuyen', '/gioi-thieu', '/mua-chung', 'https://blog.tubutree.com']) {
      expect(out).toContain(`href="${to}"`);
    }
    const blogLinks = out.match(/<a [^>]*href="https:\/\/blog\.tubutree\.com"[^>]*>/g) ?? [];
    expect(blogLinks).toHaveLength(2);
    for (const a of blogLinks) {
      expect(a).toContain('target="_blank"');
      expect(a).toContain('rel="noopener noreferrer"');
      expect(a).toContain('min-h-11');
    }
  });

  it('"Mã giảm giá" trỏ thẳng hub Ưu đãi mở sẵn cả danh sách mã, không qua chuyển hướng /ma-giam-gia', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    const out = await html();
    expect(out).toMatch(/<a [^>]*href="\/uu-dai\?codes=all"[^>]*>Mã giảm giá<\/a>/);
    expect(out).not.toContain('href="/ma-giam-gia"');
  });

  it('cột Khám phá có "Bộ quà tặng" (/bo-qua-tang) ngay sau Mã giảm giá', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    const out = await html();
    expect(out).toMatch(/<a [^>]*href="\/bo-qua-tang"[^>]*>Bộ quà tặng<\/a>/);
    expect(out.indexOf('href="/bo-qua-tang"')).toBeGreaterThan(out.indexOf('href="/uu-dai?codes=all"'));
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
