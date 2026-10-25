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
  { key: 'company.bct_notice_url', value: '', description: null, category: 'company' },
  { key: 'legal.dieu-khoan', value: '', description: null, category: 'legal' },
  { key: 'legal.bao-mat', value: '', description: null, category: 'legal' },
  { key: 'legal.doi-tra', value: '# Đổi trả\n\n- 7 ngày', description: null, category: 'legal' },
  { key: 'legal.van-chuyen', value: '', description: null, category: 'legal' },
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

  it('link Bộ Công Thương sai dạng thì chặn lưu', () => {
    const { container } = setup();
    typeInto(container.querySelector('input[type="url"]'), 'online.gov.vn');
    expect(container.textContent).toContain('Link phải bắt đầu bằng https://');
    expect(byText(container, 'button', 'Lưu thông tin cửa hàng')!.hasAttribute('disabled')).toBe(true);
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
    expect(['dieu-khoan', 'bao-mat', 'doi-tra', 'van-chuyen'].every((s) => container.querySelector(`[data-legal="${s}"]`))).toBe(true);
  });
});
