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
    expect(compact.match(/<nav[^>]*aria-label="Chính sách \(điện thoại\)"[^>]*>[\s\S]*?<\/nav>/)?.[0].match(/href="\/chinh-sach\//g)).toHaveLength(7);
  });

  it('gọn (W59, w62-01): chữ "Hotline:" ở chân trang điện thoại chỉ cho trình đọc màn hình; chính sách, liên hệ và kênh cộng đồng chữ nhỏ, không khối cao', async () => {
    mocks.getPublicSupport.mockResolvedValue({
      hotline: '0984 606 774',
      email: 'tubutree@gmail.com',
      community: { zaloGroupUrl: 'https://zalo.me/g/abc' },
    });
    const out = await html();
    const compact = out.match(/<footer[^>]*data-compact-footer[^>]*>[\s\S]*?<\/footer>/)?.[0] ?? '';
    expect(compact).toMatch(/<a href="tel:0984606774"[^>]*>[\s\S]*?<span class="sr-only">Hotline: <\/span>0984 606 774/);
    expect(compact).not.toMatch(/py-4|mt-8/);
    for (const label of ['Chính sách', 'Chính sách \\(điện thoại\\)']) {
      const nav = out.match(new RegExp(`<nav[^>]*aria-label="${label}"[^>]*>[\\s\\S]*?</nav>`))?.[0] ?? '';
      for (const a of nav.match(/<a [^>]*>/g) ?? []) expect(a).toContain('min-h-11');
      expect(nav.match(/<a [^>]*class="[^"]*text-xs/g)).toHaveLength(7);
    }
    const channels = out.match(/<nav aria-label="Kênh cộng đồng"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(channels).toMatch(/<a [^>]*class="[^"]*min-h-11[^"]*text-xs/);
    expect(out).not.toMatch(/<footer class="[^"]*py-8/);
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

  it('đủ sáu lối Bộ Công Thương yêu cầu (hướng dẫn mua hàng, thanh toán, vận chuyển, đổi trả, kiểm hàng, bảo mật thông tin) và điều khoản, ở cả hai chân trang, vùng chạm 44px', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    const out = await html();
    for (const label of ['Chính sách', 'Chính sách \\(điện thoại\\)']) {
      const nav = out.match(new RegExp(`<nav[^>]*aria-label="${label}"[^>]*>[\\s\\S]*?</nav>`))?.[0] ?? '';
      const links = [...nav.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]);
      expect(links, label).toEqual([
        ['Hướng dẫn mua hàng', '/chinh-sach/dieu-khoan#dat-hang'],
        ['Thanh toán', '/chinh-sach/thanh-toan'],
        ['Vận chuyển', '/chinh-sach/van-chuyen'],
        ['Đổi trả', '/chinh-sach/doi-tra'],
        ['Kiểm hàng', '/chinh-sach/doi-tra#kiem-hang'],
        ['Bảo mật thông tin', '/chinh-sach/bao-mat'],
        ['Điều khoản sử dụng', '/chinh-sach/dieu-khoan'],
      ]);
      for (const a of nav.match(/<a [^>]*>/g) ?? []) expect(a).toContain('min-h-11');
    }
  });

  it('không có link lẻ rớt dòng: chính sách và liên hệ là lưới đều cột (điện thoại 2 cột; máy tính 4 cột, 7 cột từ lg), không phải hàng tự xuống dòng', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com', guestOrderLookup: true });
    const out = await html();
    expect(out).toMatch(/<nav aria-label="Chính sách"><ul class="grid gap-x-4 grid-cols-4 lg:grid-cols-7">/);
    expect(out).toMatch(/<nav aria-label="Chính sách \(điện thoại\)"><ul class="grid gap-x-4 grid-cols-2">/);
    const compact = out.match(/<footer[^>]*data-compact-footer[^>]*>[\s\S]*?<\/footer>/)?.[0] ?? '';
    expect(compact).toMatch(/<ul aria-label="Hỗ trợ" class="grid grid-cols-2 gap-x-4">/);
    expect(compact).not.toContain('flex-wrap');
  });

  it('cờ đặt không đăng nhập bật: lối "Tra cứu đơn hàng" (/don) ở cả chân trang đầy đủ và gọn, chỉ chữ, vùng chạm 44px; cờ tắt thì không có', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    expect(await html()).not.toContain('href="/don"');

    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com', guestOrderLookup: true });
    const out = await html();
    const links = out.match(/<a [^>]*href="\/don"[^>]*>[\s\S]*?<\/a>/g) ?? [];
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a).toContain('min-h-11');
      expect(a).toContain('Tra cứu đơn hàng');
      expect(a).not.toContain('<svg');
    }
    const compact = out.match(/<footer[^>]*data-compact-footer[^>]*>[\s\S]*?<\/footer>/)?.[0] ?? '';
    expect(compact).toContain('href="/don"');
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

    const MERCHANT_LINE = 'CÔNG TY TNHH TUBU TREE · MST 0319585995 · Cấp ngày 09/06/2026 tại TP.HCM · Số 33, đường 1B, phường Long Bình, Thành phố Hồ Chí Minh';
    const CONTACT = ' · Hotline 0984 606 774 · tubutree@gmail.com';

    it('chưa nhập gì: khối pháp lý gọn của thương nhân đã đăng ký (tên · MST · ngày, nơi cấp · địa chỉ) ở cả hai chân trang, máy tính nối hotline và email; KHÔNG có huy hiệu Bộ Công Thương', async () => {
      mocks.getPublicSupport.mockResolvedValue(base);
      const out = await html();
      expect(out.split(MERCHANT_LINE)).toHaveLength(3);
      expect(out).toContain(`>${MERCHANT_LINE}${CONTACT}</p>`);
      expect(out).toContain(`>${MERCHANT_LINE}</p>`);
      expect(out).not.toContain('Bộ Công Thương');
      expect(out).not.toContain('footer-bct-badge');
    });

    it('đủ thông tin: "tên · MST mã · địa chỉ" ở cả hai chân trang, kèm huy hiệu BCT mở tab mới', async () => {
      mocks.getPublicSupport.mockResolvedValue({ ...base, company });
      const out = await html();
      const line = 'Công ty TNHH Tubu · MST 0312345678 · 1 Đường A, Quận B';
      expect(out.split(line)).toHaveLength(3);
      const links = out.match(/<a [^>]*href="https:\/\/online.gov.vn\/x"[^>]*>/g) ?? [];
      expect(links).toHaveLength(2);
      for (const a of links) {
        expect(a).toContain('target="_blank"');
        expect(a).toContain('rel="noopener noreferrer"');
        expect(a).toContain('min-h-11');
        expect(a).toContain('data-testid="footer-bct-badge"');
      }
      expect(out.split('Đã thông báo Bộ Công Thương')).toHaveLength(3);
    });

    it('đơn vị khác Tubu Tree chưa nhập: không bịa người đại diện, ngày hay nơi cấp, không nêu số ĐKDN trùng MST', async () => {
      mocks.getPublicSupport.mockResolvedValue({ ...base, company: { ...company, registrationNumber: '0312345678' } });
      const out = await html();
      expect(out).not.toMatch(/Người đại diện|Cấp ngày|Cấp tại|ĐKDN/);
    });

    it('đã nhập: số ĐKDN khác MST, ngày và nơi cấp, người đại diện theo admin', async () => {
      mocks.getPublicSupport.mockResolvedValue({
        ...base,
        company: { ...company, representative: 'Nguyễn Văn A', registrationNumber: '41A000001', registrationDate: '12/03/2020', registrationPlace: 'Sở Tài chính Thành phố Hồ Chí Minh' },
      });
      const out = await html();
      const line = 'Công ty TNHH Tubu · MST 0312345678 · ĐKDN số 41A000001 · Cấp ngày 12/03/2020 tại Sở Tài chính Thành phố Hồ Chí Minh · Người đại diện: Nguyễn Văn A · 1 Đường A, Quận B';
      expect(out.split(line)).toHaveLength(3);
    });

    it('chỉ có người đại diện: nêu kèm thông tin thương nhân đã đăng ký', async () => {
      mocks.getPublicSupport.mockResolvedValue({ ...base, company: { representative: 'Nguyễn Văn A' } });
      const out = await html();
      expect(out).toContain('>CÔNG TY TNHH TUBU TREE · MST 0319585995 · Cấp ngày 09/06/2026 tại TP.HCM · Người đại diện: Nguyễn Văn A · Số 33, đường 1B');
    });

    it('ẩn từng phần còn trống, không để dấu nối thừa', async () => {
      mocks.getPublicSupport.mockResolvedValue({ ...base, company: { taxCode: '0312345678' } });
      const out = await html();
      expect(out).toContain('>MST 0312345678</p>');
      expect(out).toContain(`>MST 0312345678${CONTACT}</p>`);
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
      expect(out).toContain('>Công ty TNHH Tubu · MST 0312345678');
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

  it('máy tính: lưới 5 rãnh, Khám phá chiếm 2 rãnh chia 2 cột con; có lối vào Vườn Xanh, Đổi rác, Kho quà, Cộng tác viên, Đại lý, Câu chuyện thương hiệu, Blog (mở https://blog.tubutree.com)', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    const out = await html();
    expect(out).toMatch(/<div class="[^"]*lg:grid-cols-5/);
    expect(out).toMatch(/<nav aria-label="Khám phá" class="lg:col-span-2"><h2[^>]*>Khám phá<\/h2><ul class="[^"]*grid-cols-2/);
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

  it('cột Khám phá có "Bán chạy nhất" (/ban-chay) ngay sau Danh mục; "Tiết kiệm với Refill" (/tiet-kiem-refill) chỉ khi cờ Refill bật; link thật trong HTML dựng ở máy chủ, vùng chạm 44px', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com', refillLanding: true });
    const on = await html();
    const best = on.match(/<a [^>]*href="\/ban-chay"[^>]*>Bán chạy nhất<\/a>/)?.[0];
    const refill = on.match(/<a [^>]*href="\/tiet-kiem-refill"[^>]*>Tiết kiệm với Refill<\/a>/)?.[0];
    expect(best).toContain('min-h-11');
    expect(refill).toContain('min-h-11');
    expect(on.indexOf('href="/ban-chay"')).toBeGreaterThan(on.indexOf('href="/san-pham"'));
    expect(on.indexOf('href="/tiet-kiem-refill"')).toBeGreaterThan(on.indexOf('href="/ban-chay"'));
    expect(on.indexOf('href="/tiet-kiem-refill"')).toBeLessThan(on.indexOf('href="/uu-dai"'));

    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    const off = await html();
    expect(off).toContain('href="/ban-chay"');
    expect(off).not.toContain('href="/tiet-kiem-refill"');
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
