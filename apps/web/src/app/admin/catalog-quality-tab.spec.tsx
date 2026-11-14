// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { CatalogAuditProductDto, CatalogAuditVariationDto } from '@tubutree/shared-types';
import { KNOWN_MEDIA_MISMATCHES } from '@tubutree/app-core/commerce/catalog-quality-audit';
import { PANCAKE_FIX_CSV_HEADERS } from '@tubutree/app-core/commerce/catalog-pancake-csv';
import { CatalogQualityTab } from './catalog-quality-tab';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};

const BAD = KNOWN_MEDIA_MISMATCHES[0]!;
const V = (over: Partial<CatalogAuditVariationDto> = {}): CatalogAuditVariationDto => ({
  id: 'v1',
  pancakeId: 'pk-v1',
  sku: 'SKU1',
  name: 'Chai 100ml',
  stock: 10,
  retailPrice: 50000,
  isActive: true,
  ...over,
});
const P = (over: Partial<CatalogAuditProductDto> = {}): CatalogAuditProductDto => ({
  id: 'p-on',
  slug: 'sp-on',
  name: 'Sản phẩm ổn',
  pancakeId: null,
  isActive: true,
  thumbnail: 'https://x/on.png',
  description: 'Mô tả đủ',
  shortDesc: null,
  hasIngredients: true,
  inStock: true,
  variations: [V()],
  ...over,
});
const PRODUCTS: CatalogAuditProductDto[] = [
  P({ id: 'p-bad', slug: `${BAD.baseSlug}-c1337b`, name: 'Nước rửa chén Fuwa3e 100ml', thumbnail: BAD.badThumbnail }),
  P({ id: 'p-anh', slug: 'sp-thieu-anh', name: 'Sản phẩm thiếu ảnh', thumbnail: null }),
  P({ id: 'p-trong', slug: 'sp-trong-mo-ta', name: 'Sản phẩm trống mô tả', description: '<p>&nbsp;</p>', inStock: false }),
  P({
    id: 'p-gia',
    slug: 'sp-gia-sai',
    name: 'Sản phẩm giá sai',
    isActive: false,
    variations: [V({ id: 'v-gia', sku: 'GIA0', retailPrice: 0 }), V({ id: 'v-ton', sku: 'TON', stock: 999999 }), V({ id: 'v-ten', sku: 'TEN', name: '' })],
  }),
  P({ id: 'p-dp', slug: 'son-duong-gac-tuoi-a07', name: 'Son dưỡng gấc tươi', description: '' }),
  P(),
];

const STATS = { since: '2026-11-12T01:04:00.000Z', total: 0, ok: 0, fallback: 0, latencyP95Ms: null, latencySamples: 0, topSkus: [] };
const auditBody = (products = PRODUCTS, truncated = false) => ({ body: { products, truncated } });
const ZERO_PRICE = { scope: 'FULL', updatedAt: '2026-11-13T01:00:00.000Z', count: 0, keptCount: 0, newCount: 0, skus: [], truncated: false };
const routes = (over: Record<string, { status?: number; body: unknown } | (() => { status?: number; body: unknown })> = {}) => ({
  '/admin/catalog-quality/audit': auditBody(),
  '/admin/catalog-quality/pancake-zero-price': { body: ZERO_PRICE },
  '/admin/ai-advisor/stats': { body: STATS },
  ...over,
});
const runCheck = async (r: Rendered) => {
  click(byText(r.container, 'button', 'Kiểm tra ngay'));
  await flush(20);
};
const auditCalls = (m: ReturnType<typeof mockFetch>) => m.calls.filter((c) => c.url.includes('/admin/catalog-quality/audit'));
const listItems = (r: Rendered) => Array.from(r.container.querySelectorAll('ul[aria-label="Sản phẩm cần sửa"] > li'));
const box = (r: Rendered, name: string) => r.container.querySelector<HTMLInputElement>(`input[aria-label="Chọn ${name} để soạn mô tả bằng AI"]`)!;

describe('CatalogQualityTab', () => {
  it('lúc đầu chưa gọi lần kiểm nào, chỉ có nút Kiểm tra ngay; tiêu đề thu gọn/mở rộng được', async () => {
    const m = mockFetch(routes());
    vi.stubGlobal('fetch', m.fn);
    const r = mount(<CatalogQualityTab />);
    await flush();
    expect(auditCalls(m)).toHaveLength(0);
    expect(r.container.textContent).toContain('Kiểm tra chất lượng Catalog');
    expect(byText(r.container, 'button', 'Kiểm tra ngay')).not.toBeNull();
    const toggle = r.container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(byText(r.container, 'button', 'Kiểm tra ngay')).toBeNull();
    click(toggle);
    expect(byText(r.container, 'button', 'Kiểm tra ngay')).not.toBeNull();
  });

  it('bấm kiểm tra: MỘT lời gọi admin thay cho đọc từng sản phẩm, hiện số đếm, 6 chip loại lỗi và badge tình trạng mô tả', async () => {
    const m = mockFetch(routes());
    vi.stubGlobal('fetch', m.fn);
    const r = mount(<CatalogQualityTab />);
    await runCheck(r);
    expect(auditCalls(m)).toHaveLength(1);
    expect(m.calls.some((c) => /\/products(\/|\?)/.test(c.url))).toBe(false);
    const t = r.container.textContent ?? '';
    expect(t).toContain('Đã kiểm 6 sản phẩm: 5 sản phẩm cần sửa, trong đó 4 đang còn hàng.');
    const group = r.container.querySelector('[role="group"][aria-label="Lọc theo loại lỗi"]')!;
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      'Tất cả (5)',
      'Ảnh lệch tên (1)',
      'Thiếu ảnh (1)',
      'Giá bằng 0 hoặc sai (1)',
      'Tồn kho giả (1)',
      'Biến thể chưa đặt tên (1)',
      'Trống mô tả (2)',
    ]);
    expect(t).toContain('Mô tả trên 6 sản phẩm: Đã có mô tả gốc DB: 4 · Đang dùng bản dự phòng: 1 · Chưa có mô tả: 1');
    expect(t).not.toContain('Sản phẩm ổn');
    expect(listItems(r)).toHaveLength(5);
    const row = (name: string) => listItems(r).find((li) => li.textContent?.includes(name))!;
    expect(row('Son dưỡng gấc tươi').textContent).toContain('Đang dùng bản dự phòng');
    expect(row('Sản phẩm trống mô tả').textContent).toContain('Chưa có mô tả');
    expect(row('Sản phẩm trống mô tả').textContent).toContain('Hết hàng');
    expect(row('Sản phẩm thiếu ảnh').textContent).toContain('Đã có mô tả gốc DB');
    expect(row('Sản phẩm giá sai').textContent).toContain('Đang ẩn');
    expect(row('Sản phẩm thiếu ảnh').textContent).not.toContain('Đang ẩn');
    expect(row('Nước rửa chén Fuwa3e 100ml').textContent).toContain('Vệ sinh bồn cầu Eco Enzyme 100ml');
    expect(byText(r.container, 'button', 'Kiểm tra lại')).not.toBeNull();
  });

  it('lọc theo loại lỗi và theo tình trạng mô tả; mọi nút bấm và ô tích đủ lớn cho ngón tay (44px)', async () => {
    vi.stubGlobal('fetch', mockFetch(routes()).fn);
    const r = mount(<CatalogQualityTab />);
    await runCheck(r);
    click(byText(r.container, 'button', 'Thiếu ảnh (1)'));
    expect(listItems(r).map((li) => li.textContent)).toEqual([expect.stringContaining('Sản phẩm thiếu ảnh')]);
    expect(byText(r.container, 'button', 'Thiếu ảnh (1)')!.getAttribute('aria-pressed')).toBe('true');
    click(byText(r.container, 'button', 'Tất cả (5)'));
    expect(listItems(r)).toHaveLength(5);
    click(byText(r.container, 'button', 'Đang dùng bản dự phòng (1)'));
    expect(listItems(r).map((li) => li.textContent)).toEqual([expect.stringContaining('Son dưỡng gấc tươi')]);
    click(byText(r.container, 'button', 'Đã có mô tả gốc DB (3)'));
    expect(listItems(r)).toHaveLength(3);
    click(byText(r.container, 'button', 'Trống mô tả (2)'));
    expect(listItems(r)).toHaveLength(0);
    expect(r.container.textContent).toContain('Không có sản phẩm nào thuộc bộ lọc này.');
    click(byText(r.container, 'button', 'Mọi tình trạng mô tả'));
    click(byText(r.container, 'button', 'Tất cả (5)'));
    for (const b of Array.from(r.container.querySelectorAll('button'))) expect(b.className, b.textContent ?? '').toMatch(/min-h-\[44px\]/);
    for (const c of Array.from(r.container.querySelectorAll('ul[aria-label="Sản phẩm cần sửa"] input[type="checkbox"]'))) {
      expect(c.closest('label')!.className).toMatch(/min-h-\[44px\]/);
      expect(c.closest('label')!.className).toMatch(/min-w-\[44px\]/);
    }
  });

  it('catalog bị cắt (truncated): hiện cảnh báo; không cắt thì không có', async () => {
    vi.stubGlobal('fetch', mockFetch(routes({ '/admin/catalog-quality/audit': auditBody(PRODUCTS, true) })).fn);
    const r = mount(<CatalogQualityTab />);
    await runCheck(r);
    expect(r.container.textContent).toContain('danh sách đã bị cắt');
    vi.stubGlobal('fetch', mockFetch(routes()).fn);
    click(byText(r.container, 'button', 'Kiểm tra lại'));
    await flush(20);
    expect(r.container.textContent).not.toContain('danh sách đã bị cắt');
  });

  it('không lỗi nào: báo sạch, không dựng danh sách, nút CSV khoá và nói rõ vì sao', async () => {
    vi.stubGlobal('fetch', mockFetch(routes({ '/admin/catalog-quality/audit': auditBody([P()]) })).fn);
    const r = mount(<CatalogQualityTab />);
    await runCheck(r);
    expect(r.container.textContent).toContain('Đã kiểm 1 sản phẩm, không có lỗi.');
    expect(r.container.querySelector('ul[aria-label="Sản phẩm cần sửa"]')).toBeNull();
    expect((byText(r.container, 'button', 'Xuất CSV sửa Pancake') as HTMLButtonElement).disabled).toBe(true);
    expect(r.container.textContent).toContain('Không có biến thể lỗi nào để xuất');
  });

  it('lỗi mạng/máy chủ: báo lỗi kèm Thử lại; thử lại thành công thì hiện kết quả', async () => {
    let fail = true;
    const m = mockFetch(routes({ '/admin/catalog-quality/audit': () => (fail ? { status: 500, body: { message: 'x' } } : auditBody()) }));
    vi.stubGlobal('fetch', m.fn);
    const r = mount(<CatalogQualityTab />);
    await runCheck(r);
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain('Không đọc được catalog');
    expect(r.container.textContent).not.toContain('Đã kiểm');
    fail = false;
    click(byText(r.container, '[role="alert"] button', 'Thử lại'));
    await flush(20);
    expect(r.container.querySelector('[role="alert"]')).toBeNull();
    expect(r.container.textContent).toContain('Đã kiểm 6 sản phẩm');
  });

  it('403 (không phải quản trị viên): nói rõ là thiếu quyền, vẫn có Thử lại', async () => {
    vi.stubGlobal('fetch', mockFetch(routes({ '/admin/catalog-quality/audit': { status: 403, body: { message: 'Forbidden' } } })).fn);
    const r = mount(<CatalogQualityTab />);
    await runCheck(r);
    const alert = r.container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('không có quyền');
    expect(byText(alert, 'button', 'Thử lại')).not.toBeNull();
  });

  it('bấm hai lần liền chỉ gửi một lượt kiểm; nút báo bận bằng aria-busy trong lúc chờ', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => (release = res));
    const m = mockFetch(routes());
    const slow = async (url: string, init?: RequestInit) => {
      if (url.includes('/admin/catalog-quality/audit')) await gate;
      return m.fn(url, init);
    };
    vi.stubGlobal('fetch', slow);
    const r = mount(<CatalogQualityTab />);
    const btn = byText(r.container, 'button', 'Kiểm tra ngay')!;
    click(btn);
    click(btn);
    await flush();
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(r.container.querySelector('#catalog-quality-body')!.getAttribute('aria-busy')).toBe('true');
    release();
    await flush(20);
    expect(auditCalls(m)).toHaveLength(1);
    expect(btn.getAttribute('aria-busy')).toBeNull();
  });

  describe('Xuất CSV sửa Pancake', () => {
    let blobs: Blob[];
    let anchors: { download: string; href: string }[];
    const savedCreate = URL.createObjectURL;
    const savedRevoke = URL.revokeObjectURL;
    beforeEach(() => {
      blobs = [];
      anchors = [];
      URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
        blobs.push(b as Blob);
        return 'blob:csv-test';
      });
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        anchors.push({ download: this.download, href: this.href });
      });
    });
    afterEach(() => {
      URL.createObjectURL = savedCreate;
      // downloadCsvText thu hồi URL sau 1 giây, thường là SAU khi test đã xong; jsdom không có hàm này nên trả về hàm rỗng thay vì undefined,
      // kẻo hẹn giờ trễ ném TypeError "không có test nào" và làm cả lần chạy vitest thoát mã 1.
      URL.revokeObjectURL = typeof savedRevoke === 'function' ? savedRevoke : () => undefined;
    });
    const bytesOf = (blob: Blob) =>
      new Promise<Uint8Array>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
        fr.onerror = () => reject(fr.error);
        fr.readAsArrayBuffer(blob);
      });

    it('hiện số dòng sẽ xuất; tải file có BOM UTF-8 đúng MỘT lần, tiêu đề cột đúng, mỗi biến thể lỗi một dòng', async () => {
      vi.stubGlobal('fetch', mockFetch(routes()).fn);
      const r = mount(<CatalogQualityTab />);
      await runCheck(r);
      const btn = byText(r.container, 'button', 'Xuất CSV sửa Pancake') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      expect(r.container.textContent).toContain('Sẽ xuất 3 dòng biến thể lỗi');
      expect(btn.className).toMatch(/min-h-\[44px\]/);
      click(btn);
      expect(blobs).toHaveLength(1);
      expect(anchors).toHaveLength(1);
      expect(anchors[0]!.download).toMatch(/^tubutree-sua-pancake-\d{8}\.csv$/);
      expect(anchors[0]!.href).toBe('blob:csv-test');
      expect(blobs[0]!.type).toMatch(/^text\/csv/);
      const bytes = await bytesOf(blobs[0]!);
      expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
      expect(Array.from(bytes.slice(3, 6))).not.toEqual([0xef, 0xbb, 0xbf]);
      const text = new TextDecoder('utf-8', { ignoreBOM: false }).decode(bytes.slice(3));
      const lines = text.split('\r\n');
      expect(lines[0]).toBe(PANCAKE_FIX_CSV_HEADERS.join(','));
      expect(lines[0]).toBe('pancakeId,sku,name,issueCodes,currentStock,retailPrice');
      expect(lines).toHaveLength(4);
      expect(lines.slice(1).map((l) => l.split(',')[1]).sort()).toEqual(['GIA0', 'TEN', 'TON']);
      expect(lines.find((l) => l.includes(',TEN,'))).toContain('Sản phẩm giá sai');
    });

    it('không có biến thể lỗi: bấm nút không tải gì', async () => {
      vi.stubGlobal('fetch', mockFetch(routes({ '/admin/catalog-quality/audit': auditBody([P({ id: 'p-anh', slug: 'a', name: 'A', thumbnail: null })]) })).fn);
      const r = mount(<CatalogQualityTab />);
      await runCheck(r);
      const btn = byText(r.container, 'button', 'Xuất CSV sửa Pancake') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      click(btn);
      expect(blobs).toHaveLength(0);
      expect(anchors).toHaveLength(0);
    });
  });

  describe('chọn sản phẩm để soạn mô tả', () => {
    const MANY = Array.from({ length: 12 }, (_, i) => P({ id: `p-t${i}`, slug: `trong-${i}`, name: `Trống ${String(i).padStart(2, '0')}`, description: '' }));
    const composeBtn = (r: Rendered) => byText(r.container, 'button', 'Soạn mô tả bằng AI') as HTMLButtonElement;

    it('tích chọn cập nhật số trên nút Soạn; chưa chọn thì nút báo khoá', async () => {
      vi.stubGlobal('fetch', mockFetch(routes()).fn);
      const r = mount(<CatalogQualityTab />);
      await runCheck(r);
      expect(composeBtn(r).textContent).toBe('Soạn mô tả bằng AI (0)');
      expect(composeBtn(r).getAttribute('aria-disabled')).toBe('true');
      click(box(r, 'Sản phẩm thiếu ảnh'));
      click(box(r, 'Sản phẩm giá sai'));
      expect(composeBtn(r).textContent).toBe('Soạn mô tả bằng AI (2)');
      expect(composeBtn(r).getAttribute('aria-disabled')).toBeNull();
      click(box(r, 'Sản phẩm thiếu ảnh'));
      expect(composeBtn(r).textContent).toBe('Soạn mô tả bằng AI (1)');
    });

    it('tối đa 10 sản phẩm một lượt: tích đủ 10 thì ô chưa tích bị khoá, bỏ một ô thì mở lại', async () => {
      vi.stubGlobal('fetch', mockFetch(routes({ '/admin/catalog-quality/audit': auditBody(MANY) })).fn);
      const r = mount(<CatalogQualityTab />);
      await runCheck(r);
      for (let i = 0; i < 10; i++) click(box(r, `Trống ${String(i).padStart(2, '0')}`));
      expect(composeBtn(r).textContent).toBe('Soạn mô tả bằng AI (10)');
      expect(box(r, 'Trống 10').disabled).toBe(true);
      expect(box(r, 'Trống 11').disabled).toBe(true);
      expect(box(r, 'Trống 09').disabled).toBe(false);
      click(box(r, 'Trống 09'));
      expect(box(r, 'Trống 10').disabled).toBe(false);
      click(box(r, 'Trống 10'));
      expect(composeBtn(r).textContent).toBe('Soạn mô tả bằng AI (10)');
      expect(box(r, 'Trống 11').disabled).toBe(true);
    });

    it('"Chọn các dòng trống mô tả" lấy tối đa 10 dòng đầu trong danh sách đang hiện', async () => {
      vi.stubGlobal('fetch', mockFetch(routes({ '/admin/catalog-quality/audit': auditBody(MANY) })).fn);
      const r = mount(<CatalogQualityTab />);
      await runCheck(r);
      const pick = byText(r.container, 'button', 'Chọn các dòng trống mô tả')!;
      expect(pick.textContent).toBe('Chọn các dòng trống mô tả (10)');
      click(pick);
      const checked = Array.from(r.container.querySelectorAll<HTMLInputElement>('ul[aria-label="Sản phẩm cần sửa"] input[type="checkbox"]')).map((c) => c.checked);
      expect(checked).toEqual([...Array(10).fill(true), false, false]);
      expect(composeBtn(r).textContent).toBe('Soạn mô tả bằng AI (10)');
    });

    it('lưu thành công: chạy lại kiểm tra, dòng vừa lưu hết "trống mô tả" và rời khỏi phần đã chọn', async () => {
      let audits = 0;
      const after = PRODUCTS.map((p) => (p.id === 'p-trong' ? { ...p, description: 'Đã có chữ mới', hasIngredients: true } : p));
      const m = mockFetch(
        routes({
          '/admin/catalog-quality/audit': () => auditBody(++audits === 1 ? PRODUCTS : after),
          '/admin/catalog-quality/copy-drafts': {
            body: { drafts: [{ id: 'p-trong', slug: 'sp-trong-mo-ta', name: 'Sản phẩm trống mô tả', shortDesc: 'Ngắn', description: 'Đã có chữ mới', ingredients: ['Dứa'], source: 'ai', warnings: [] }], failed: [] },
          },
          '/admin/catalog-quality/copy-approve': { body: { saved: ['p-trong'], rejected: [] } },
        }),
      );
      vi.stubGlobal('fetch', m.fn);
      const r = mount(<CatalogQualityTab />);
      await runCheck(r);
      click(box(r, 'Sản phẩm trống mô tả'));
      click(composeBtn(r));
      await flush(20);
      click(byText(r.container, 'button', 'Duyệt & Lưu vào DB'));
      await flush(30);
      const approve = m.calls.find((c) => c.url.includes('copy-approve'))!;
      expect(JSON.parse(String(approve.init!.body))).toEqual({ items: [{ id: 'p-trong', shortDesc: 'Ngắn', description: 'Đã có chữ mới', ingredients: ['Dứa'] }] });
      expect(audits).toBe(2);
      expect(r.container.textContent).toContain('Đã kiểm 6 sản phẩm: 4 sản phẩm cần sửa');
      expect(listItems(r).some((li) => li.textContent?.includes('Sản phẩm trống mô tả'))).toBe(false);
      expect(composeBtn(r).textContent).toBe('Soạn mô tả bằng AI (0)');
    });
  });

  it('thẻ SKU Pancake báo giá 0đ rồi thẻ AI tư vấn khách nằm dưới phần Kiểm tra, tự tải khi mở tab', async () => {
    const m = mockFetch(routes({ '/admin/ai-advisor/stats': { body: { ...STATS, total: 5, ok: 4, fallback: 1, latencyP95Ms: 3200, latencySamples: 5, topSkus: [{ slug: 'a', name: 'Sản phẩm A', count: 3 }] } } }));
    vi.stubGlobal('fetch', m.fn);
    const r = mount(<CatalogQualityTab />);
    await flush(10);
    const sections = Array.from(r.container.querySelectorAll('section'));
    expect(sections.map((s) => s.querySelector('h2')?.textContent)).toEqual(['Kiểm tra chất lượng CatalogThu gọn', 'SKU Pancake báo giá 0đ', 'AI tư vấn khách']);
    expect(sections[2]!.textContent).toContain('Sản phẩm A');
    expect(m.calls.filter((c) => c.url.includes('/admin/ai-advisor/stats'))).toHaveLength(1);
    expect(m.calls.filter((c) => c.url.includes('/admin/catalog-quality/pancake-zero-price'))).toHaveLength(1);
  });
});

describe('CatalogQualityTab — bổ sung thành phần và ảnh ngay tại tab', () => {
  const NO_ING = [
    P({ id: 'p-a', slug: 'mat-co-dac', name: 'Mật cô đặc', hasIngredients: false }),
    P({ id: 'p-b', slug: 'xoai-say', name: 'Xoài sấy', hasIngredients: false }),
    P({ id: 'p-c', slug: 'da-du', name: 'Đã đủ thành phần', hasIngredients: true }),
    P({ id: 'p-d', slug: 'dang-an', name: 'Đang ẩn thiếu thành phần', hasIngredients: false, isActive: false }),
  ];
  const block = (r: Rendered) => r.container.querySelector<HTMLElement>('[role="region"][aria-labelledby="ingredients-fill-title"]');
  const progress = (r: Rendered) => r.container.querySelector('[data-testid="ingredients-progress"]')?.textContent;

  it('chỉ hiện sau khi đã kiểm; liệt kê sản phẩm ĐANG BÁN mà thiếu thành phần (bỏ sản phẩm ẩn), tiến độ tính trên sản phẩm đang bán', async () => {
    const m = mockFetch(routes({ '/admin/catalog-quality/audit': auditBody(NO_ING) }));
    vi.stubGlobal('fetch', m.fn);
    const r = mount(<CatalogQualityTab />);
    await flush();
    expect(block(r)).toBeNull();
    await runCheck(r);
    expect(block(r)).not.toBeNull();
    expect(Array.from(r.container.querySelectorAll('[data-testid^="ingredients-row-"]')).map((e) => e.getAttribute('data-testid'))).toEqual(['ingredients-row-p-a', 'ingredients-row-p-b']);
    expect(progress(r)).toBe('Đã đủ thành phần 1/3 sản phẩm.');
  });

  it('lưu một sản phẩm: gọi API thành phần rồi kiểm lại catalog, sản phẩm đó rời danh sách và tiến độ tăng', async () => {
    let audits = 0;
    const m = mockFetch(
      routes({
        '/admin/catalog-quality/audit': () => {
          audits += 1;
          return auditBody(audits === 1 ? NO_ING : NO_ING.map((p) => (p.id === 'p-a' ? { ...p, hasIngredients: true } : p)));
        },
        '/ingredients': { body: { id: 'p-a', ingredients: ['Đường', 'Muối'], added: 2 } },
      }),
    );
    vi.stubGlobal('fetch', m.fn);
    const r = mount(<CatalogQualityTab />);
    await runCheck(r);
    const row = r.container.querySelector<HTMLElement>('[data-testid="ingredients-row-p-a"]')!;
    typeInto(row.querySelector('textarea'), 'Đường, Muối');
    click(byText(row, 'button', 'Lưu thành phần'));
    await flush(20);
    expect(m.calls.filter((c) => c.url.includes('/admin/catalog-quality/p-a/ingredients') && c.init?.method === 'POST')).toHaveLength(1);
    expect(auditCalls(m)).toHaveLength(2);
    expect(r.container.querySelector('[data-testid="ingredients-row-p-a"]')).toBeNull();
    expect(r.container.querySelector('[data-testid="ingredients-row-p-b"]')).not.toBeNull();
    expect(progress(r)).toBe('Đã đủ thành phần 2/3 sản phẩm.');
  });

  it('có lối vào trang bổ sung ảnh hàng loạt (kéo-thả, dán) ngay cạnh bộ lọc "Thiếu ảnh"', async () => {
    const m = mockFetch(routes());
    vi.stubGlobal('fetch', m.fn);
    const r = mount(<CatalogQualityTab />);
    await runCheck(r);
    const link = r.container.querySelector<HTMLAnchorElement>('a[href="/admin/catalog-wp-images"]');
    expect(link?.textContent).toBe('Bổ sung ảnh hàng loạt (kéo-thả, dán ảnh)');
    expect(/min-h-\[44px\]/.test(link!.className)).toBe(true);
  });
});

describe('CatalogQualityTab — duyệt SEO hàng loạt (W160)', () => {
  const SEO_ROWS = [
    { id: 'p-a', slug: 'mat-co-dac', name: 'Mật cô đặc', brand: 'Tubu Tree', metaTitle: null, metaDesc: null, titleLength: 0, descLength: 0, missingTitle: true, missingDesc: true, tooLongTitle: false, tooLongDesc: false, suggested: { metaTitle: 'Mật cô đặc | Tubu Tree', metaDesc: 'Mật cô đặc. Mua tại Tubu Tree.' } },
    { id: 'p-b', slug: 'xoai-say', name: 'Xoài sấy', brand: 'Tubu Tree', metaTitle: 'Xoài sấy | Tubu Tree', metaDesc: 'Xoài sấy. Mua tại Tubu Tree.', titleLength: 20, descLength: 28, missingTitle: false, missingDesc: false, tooLongTitle: false, tooLongDesc: false, suggested: { metaTitle: 'Xoài sấy | Tubu Tree', metaDesc: 'Xoài sấy. Mua tại Tubu Tree.' } },
  ];
  const region = (r: Rendered) => r.container.querySelector<HTMLElement>('[role="region"][aria-labelledby="seo-bulk-title"]');
  const seoGets = (m: ReturnType<typeof mockFetch>) => m.calls.filter((c) => c.url.endsWith('/admin/catalog-quality/seo'));

  it('chỉ hiện sau khi đã kiểm; không tự gọi API SEO, bấm "Mở bảng SEO" mới đọc và liệt kê dòng thiếu SEO', async () => {
    const m = mockFetch(routes({ '/admin/catalog-quality/seo': { body: { rows: SEO_ROWS, total: 2, missing: 1, truncated: false } } }));
    vi.stubGlobal('fetch', m.fn);
    const r = mount(<CatalogQualityTab />);
    await flush();
    expect(region(r)).toBeNull();
    await runCheck(r);
    expect(region(r)).not.toBeNull();
    expect(seoGets(m)).toHaveLength(0);
    click(byText(region(r)!, 'button', 'Mở bảng SEO'));
    await flush(10);
    expect(seoGets(m)).toHaveLength(1);
    expect(Array.from(r.container.querySelectorAll('[data-testid^="seo-row-"]')).map((e) => e.getAttribute('data-testid'))).toEqual(['seo-row-p-a']);
  });

  it('bảng SEO nằm ngay sau khối bổ sung thành phần, trong cùng thẻ Kiểm tra', async () => {
    vi.stubGlobal('fetch', mockFetch(routes()).fn);
    const r = mount(<CatalogQualityTab />);
    await runCheck(r);
    const ids = Array.from(r.container.querySelectorAll('[role="region"][aria-labelledby]')).map((e) => e.getAttribute('aria-labelledby'));
    const iIng = ids.indexOf('ingredients-fill-title');
    const iSeo = ids.indexOf('seo-bulk-title');
    expect(iIng).toBeGreaterThanOrEqual(0);
    expect(iSeo).toBe(iIng + 1);
  });
});
