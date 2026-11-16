// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ShopInfoCard } from './shop-info-card';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { ConfigRow } from '@/lib/admin-client';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const ROWS: ConfigRow[] = [
  { key: 'company.legal_name', value: '', description: null, category: 'company' },
  { key: 'company.tax_code', value: '', description: null, category: 'company' },
  { key: 'company.address', value: '', description: null, category: 'company' },
  { key: 'company.representative', value: '', description: null, category: 'company' },
  { key: 'company.business_registration_number', value: '', description: null, category: 'company' },
  { key: 'company.business_registration_date', value: '', description: null, category: 'company' },
  { key: 'company.business_registration_place', value: '', description: null, category: 'company' },
  { key: 'company.bct_notice_url', value: '', description: null, category: 'company' },
  { key: 'legal.dieu-khoan', value: '', description: null, category: 'legal' },
  { key: 'legal.bao-mat', value: '', description: null, category: 'legal' },
  { key: 'legal.doi-tra', value: '# Đổi trả\n\n- 7 ngày', description: null, category: 'legal' },
  { key: 'legal.van-chuyen', value: '', description: null, category: 'legal' },
  { key: 'legal.thanh-toan', value: '', description: null, category: 'legal' },
];

function setup() {
  const puts: { key: string; value: unknown }[] = [];
  const api = mockFetch({
    '/admin/config': (init) => {
      if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)));
      return { body: { ok: true } };
    },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const r = render(<ShopInfoCard rows={ROWS} />);
  mounted.push(r);
  return { puts, ...r };
}

describe('ShopInfoCard', () => {
  it('gõ chữ thường (không ngoặc kép) rồi lưu: gửi chuỗi đã cắt khoảng trắng, chỉ các ô đã sửa', async () => {
    const { container, puts } = setup();
    typeInto(container.querySelector('input[placeholder^="Công ty"]'), '  Công ty TNHH Tubu  ');
    typeInto(container.querySelector('input[placeholder="0123456789"]'), '0312345678');
    click(byText(container, 'button', 'Lưu thông tin cửa hàng'));
    await flush();
    expect(puts).toEqual([
      { key: 'company.legal_name', value: 'Công ty TNHH Tubu' },
      { key: 'company.tax_code', value: '0312345678' },
    ]);
  });

  it('ô chỉ có ký tự vô hình (rộng 0, BOM) coi như chưa nhập: nút Lưu vẫn khoá, không gửi gì', async () => {
    const { container, puts } = setup();
    typeInto(container.querySelector('input[placeholder^="Công ty"]'), '\u200b\ufeff\u2060');
    const save = byText(container, 'button', 'Lưu thông tin cửa hàng')!;
    expect(save.hasAttribute('disabled')).toBe(true);
    click(save);
    await flush();
    expect(puts).toEqual([]);
  });

  it('ô công ty có chữ thật lẫn ký tự vô hình ở hai đầu: lưu chuỗi đã cắt sạch', async () => {
    const { container, puts } = setup();
    typeInto(container.querySelector('input[placeholder^="Công ty"]'), '\u200b Công ty TNHH Tubu \ufeff');
    click(byText(container, 'button', 'Lưu thông tin cửa hàng'));
    await flush();
    expect(puts).toEqual([{ key: 'company.legal_name', value: 'Công ty TNHH Tubu' }]);
  });

  it('link Bộ Công Thương sai dạng thì chặn lưu', () => {
    const { container } = setup();
    typeInto(container.querySelector('input[type="url"]'), 'online.gov.vn');
    expect(container.textContent).toContain('Link phải bắt đầu bằng https://');
    expect(byText(container, 'button', 'Lưu thông tin cửa hàng')!.hasAttribute('disabled')).toBe(true);
  });

  it.each([
    ['https://user:pass@online.gov.vn/x', 'tên đăng nhập'],
    [`https://online.gov.vn/${'a'.repeat(500)}`, 'dài quá'],
    ['http://online.gov.vn', 'https://'],
    ['https://example.com/online.gov.vn', 'online.gov.vn hoặc *.gov.vn'],
    ['https://online.gov.vn.evil.com/x', 'online.gov.vn hoặc *.gov.vn'],
    ['https://online.gov.vn:8443/x', 'online.gov.vn hoặc *.gov.vn'],
  ])('link Bộ Công Thương bị API bỏ (%#) thì chặn lưu', (url, hint) => {
    const { container } = setup();
    typeInto(container.querySelector('input[type="url"]'), url);
    expect(container.textContent).toContain(hint);
    expect(byText(container, 'button', 'Lưu thông tin cửa hàng')!.hasAttribute('disabled')).toBe(true);
  });

  it('nói rõ trang khách cập nhật chậm', () => {
    const { container } = setup();
    expect(container.textContent).toContain('Trang khách cập nhật sau tối đa 5 phút, chân trang tối đa 1 giờ.');
  });

  it('chính sách: Xem trước dựng markdown, link trang khách đúng đường dẫn, Lưu gửi đúng khoá', async () => {
    const { container, puts } = setup();
    const doc = container.querySelector('[data-legal="doi-tra"]') as HTMLElement;
    expect(doc.querySelector('a')!.getAttribute('href')).toBe('/chinh-sach/doi-tra');
    click(byText(doc, 'button', 'Xem trước'));
    expect(doc.querySelector('[data-legal-preview] h2, [data-legal-preview] h3')!.textContent).toContain('Đổi trả');
    expect(doc.querySelector('[data-legal-preview] li')!.textContent).toContain('7 ngày');
    click(byText(doc, 'button', 'Quay lại soạn'));
    typeInto(doc.querySelector('textarea'), '# Đổi trả\n\n- 14 ngày');
    click(byText(doc, 'button', 'Lưu'));
    await flush();
    expect(puts).toEqual([{ key: 'legal.doi-tra', value: '# Đổi trả\n\n- 14 ngày' }]);
    expect(['dieu-khoan', 'bao-mat', 'doi-tra', 'van-chuyen', 'thanh-toan'].every((s) => container.querySelector(`[data-legal="${s}"]`))).toBe(true);
  });

  it('người đại diện + ĐKDN: lưu đúng các ô đã sửa; ngày hợp lệ nhiều dạng đều được lưu nguyên văn người gõ', async () => {
    const { container, puts } = setup();
    typeInto(container.querySelector('input[placeholder="Họ và tên"]'), ' Nguyễn Văn A ');
    typeInto(container.querySelector('input[placeholder="Số ghi trên giấy chứng nhận"]'), '0319585995');
    typeInto(container.querySelector('input[placeholder="dd/mm/yyyy"]'), '12/03/2020');
    typeInto(container.querySelector('input[placeholder^="Sở Tài chính"]'), 'Sở Tài chính Thành phố Hồ Chí Minh');
    click(byText(container, 'button', 'Lưu thông tin cửa hàng'));
    await flush();
    expect(puts).toEqual([
      { key: 'company.representative', value: 'Nguyễn Văn A' },
      { key: 'company.business_registration_number', value: '0319585995' },
      { key: 'company.business_registration_date', value: '12/03/2020' },
      { key: 'company.business_registration_place', value: 'Sở Tài chính Thành phố Hồ Chí Minh' },
    ]);
  });

  it.each(['31/02/2020', '2099-01-01', 'mai', '12-03-2020'])('ngày cấp "%s" API sẽ bỏ: báo lỗi và khoá nút Lưu', async (bad) => {
    const { container, puts } = setup();
    typeInto(container.querySelector('input[placeholder="dd/mm/yyyy"]'), bad);
    expect(container.textContent).toContain('Ngày cấp phải dạng ngày/tháng/năm');
    const save = byText(container, 'button', 'Lưu thông tin cửa hàng')!;
    expect(save.hasAttribute('disabled')).toBe(true);
    click(save);
    await flush();
    expect(puts).toEqual([]);
  });

  it('số giấy chứng nhận có ký tự lạ bị chặn, ô để trống thì không báo lỗi', async () => {
    const { container } = setup();
    expect(container.textContent).not.toContain('chỉ gồm chữ số');
    typeInto(container.querySelector('input[placeholder="Số ghi trên giấy chứng nhận"]'), '<b>1</b>');
    expect(container.textContent).toContain('Số giấy chứng nhận chỉ gồm chữ số');
    expect(byText(container, 'button', 'Lưu thông tin cửa hàng')!.hasAttribute('disabled')).toBe(true);
  });
});
