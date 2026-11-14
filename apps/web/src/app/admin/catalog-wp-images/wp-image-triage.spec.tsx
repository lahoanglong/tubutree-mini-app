// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WpImageTriage } from './wp-image-triage';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { WpImageList, WpImageRow } from '@/lib/wp-image-candidates';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const wpUrl = (n: string) => `https://tubutree.com/wp-content/uploads/2024/05/${n}.png`;
const row = (over: Partial<WpImageRow> = {}): WpImageRow => ({
  productId: 'p1',
  productSlug: 'mat-co-dac-sokfarm-250g-3c395c',
  name: 'Mật cô đặc 250g',
  isActive: true,
  variations: ['250g'],
  tier: 'EXACT',
  tierLabel: 'Chắc chắn cùng sản phẩm',
  note: 'Cùng tên và cùng 250g.',
  state: 'PENDING',
  decidedBy: null,
  decidedAt: null,
  appliedCount: null,
  wp: [{ id: 8454, slug: 'mat-hoa-dua-co-dac', name: 'Mật hoa dừa cô đặc', imageUrls: [wpUrl('a'), wpUrl('b'), wpUrl('c')], error: null }],
  defaultImageUrls: [wpUrl('a'), wpUrl('b'), wpUrl('c')],
  ...over,
});
const list = (items: WpImageRow[], hasImages = 0): WpImageList => ({
  items,
  counts: {
    PENDING: items.filter((i) => i.state === 'PENDING').length,
    SKIPPED: items.filter((i) => i.state === 'SKIPPED').length,
    APPLIED: items.filter((i) => i.state === 'APPLIED').length,
    HAS_IMAGES: hasImages + items.filter((i) => i.state === 'HAS_IMAGES').length,
  },
});

function setup(initial: WpImageList, opts: { approve?: { status?: number; body: unknown }; hold?: Promise<void>; listError?: boolean } = {}) {
  let data = initial;
  const m = mockFetch({
    '/approve': () => opts.approve ?? { body: { productId: 'p1', state: 'APPLIED', appliedCount: 3 } },
    '/skip': { body: { productId: 'p1', state: 'SKIPPED' } },
    '/restore': { body: { productId: 'p1', state: 'PENDING' } },
    '/admin/catalog-wp-images': () => (opts.listError ? { status: 500, body: { message: 'Lỗi máy chủ' } } : { body: data }),
  });
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (opts.hold && url.includes('/approve')) await opts.hold;
    return m.fn(url, init);
  });
  vi.stubGlobal('fetch', fn);
  const r = render(<WpImageTriage />);
  mounted.push(r);
  return { m, container: r.container, setData: (next: WpImageList) => (data = next) };
}

const posts = (m: ReturnType<typeof mockFetch>, part: string) => m.calls.filter((c) => c.url.includes(part) && c.init?.method === 'POST');
const pill = (c: HTMLElement, key: string) => c.querySelector<HTMLButtonElement>(`[data-testid="wp-triage-pill-${key}"]`)!;
const cards = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-testid="wp-triage-card"]'));

describe('WpImageTriage (trang duyệt ảnh WordPress)', () => {
  it('hỏi WordPress một lần khi mở (?live=1), mặc định lọc "Chờ duyệt", tám nhóm kèm số đều chữ số', async () => {
    const { m, container } = setup(
      list([
        row(),
        row({ productId: 'p2', productSlug: 'sp-hai', name: 'SP hai', tier: 'SAME_LINE', tierLabel: 'Cùng dòng, khác quy cách' }),
        row({ productId: 'p3', productSlug: 'sp-ba', name: 'SP ba', state: 'SKIPPED' }),
        row({ productId: 'p4', productSlug: 'sp-bon', name: 'SP bốn', state: 'APPLIED', appliedCount: 3, wp: null, defaultImageUrls: null }),
        row({ productId: 'p5', productSlug: 'sp-nam', name: 'SP năm', state: 'HAS_IMAGES', wp: null, defaultImageUrls: null }),
      ]),
    );
    await flush();
    expect(m.calls.filter((c) => c.url.includes('/admin/catalog-wp-images?live=1'))).toHaveLength(1);
    const pills = Array.from(container.querySelectorAll('[data-testid^="wp-triage-pill-"]'));
    expect(pills.map((p) => p.textContent)).toEqual(['Tất cả5', 'Chờ duyệt2', 'Khớp chính xác4', 'Đã duyệt1', 'Đã bỏ qua1', 'Chưa có ảnh3', 'Có ảnh gợi ý3', 'Chưa có gợi ý0']);
    expect(pills.every((p) => p.querySelector('.tabular-nums'))).toBe(true);
    expect(pills.every((p) => /min-h-\[44px\]/.test(p.className) && /min-w-\[44px\]/.test(p.className))).toBe(true);
    expect(pill(container, 'pending').getAttribute('aria-pressed')).toBe('true');
    expect(cards(container).map((c) => c.getAttribute('data-state'))).toEqual(['PENDING', 'PENDING']);
  });

  it('chuyển nhóm lọc đổi danh sách thẻ; nhóm rỗng nói rõ', async () => {
    const { container } = setup(list([row(), row({ productId: 'p3', productSlug: 'sp-ba', name: 'SP ba', state: 'SKIPPED' })]));
    await flush();
    click(pill(container, 'skipped'));
    expect(cards(container).map((c) => c.getAttribute('data-state'))).toEqual(['SKIPPED']);
    click(pill(container, 'applied'));
    expect(cards(container)).toHaveLength(0);
    expect(container.textContent).toContain('Không có sản phẩm nào trong nhóm này.');
    click(pill(container, 'all'));
    expect(cards(container)).toHaveLength(2);
  });

  it('thẻ đặt ảnh Tubu Tree ("Chưa có ảnh") cạnh ảnh WordPress, kèm mã sản phẩm, hạng khớp, ghi chú, phân loại', async () => {
    const { container } = setup(list([row()]));
    await flush();
    const card = cards(container)[0]!;
    expect(card.textContent).toContain('Mật cô đặc 250g');
    expect(card.textContent).toContain('Mã sản phẩm: mat-co-dac-sokfarm-250g-3c395c');
    expect(card.textContent).toContain('Chắc chắn cùng sản phẩm');
    expect(card.textContent).toContain('Cùng tên và cùng 250g.');
    expect(card.textContent).toContain('Phân loại: 250g');
    expect(card.querySelector('[role="img"][aria-label="Chưa có ảnh"]')).not.toBeNull();
    expect(card.querySelectorAll('img')).toHaveLength(3);
    expect(Array.from(card.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).every((c) => c.checked)).toBe(true);
    expect(card.textContent).toContain('Đã chọn 3/3 ảnh.');
    expect(card.querySelector('section[aria-label="Ảnh trên Tubu Tree"]')).not.toBeNull();
    expect(card.querySelector('section[aria-label="Ảnh ứng viên ở WordPress"]')).not.toBeNull();
  });

  it('khớp chính xác duyệt thẳng không hỏi, gửi đúng bộ ảnh; báo thành công và nạp lại danh sách', async () => {
    const { m, container } = setup(list([row()]));
    await flush();
    click(byText(container, 'button', 'Duyệt dùng ảnh này'));
    await flush();
    expect(confirmDialog()).toBeNull();
    const sent = posts(m, '/p1/approve');
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0]!.init!.body))).toEqual({ imageUrls: [wpUrl('a'), wpUrl('b'), wpUrl('c')] });
    expect(container.textContent).toContain('Đã lưu 3 ảnh vào "Mật cô đặc 250g".');
    expect(m.calls.filter((c) => c.url.includes('?live=1')).length).toBeGreaterThanOrEqual(2);
  });

  it('cập nhật lạc quan: trong lúc chờ máy chủ thẻ đã sang "Đã duyệt" và số đếm đã đổi', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const { container } = setup(list([row(), row({ productId: 'p2', productSlug: 'sp-hai', name: 'SP hai' })]), { hold });
    await flush();
    click(container.querySelector('button[aria-label="Duyệt dùng ảnh này cho Mật cô đặc 250g"]'));
    await flush();
    expect(pill(container, 'pending').textContent).toBe('Chờ duyệt1');
    expect(pill(container, 'applied').textContent).toBe('Đã duyệt1');
    expect(cards(container)).toHaveLength(1);
    release();
    await flush();
  });

  it('bỏ chọn một ảnh thì chỉ gửi ảnh còn lại; bỏ hết thì nút duyệt khoá', async () => {
    const { m, container } = setup(list([row()]));
    await flush();
    click(container.querySelector('input[aria-label^="Dùng ảnh 2"]'));
    expect(container.textContent).toContain('Đã chọn 2/3 ảnh.');
    click(byText(container, 'button', 'Duyệt dùng ảnh này'));
    await flush();
    expect(JSON.parse(String(posts(m, '/approve')[0]!.init!.body))).toEqual({ imageUrls: [wpUrl('a'), wpUrl('c')] });

    const second = setup(list([row()]));
    await flush();
    for (const label of ['Dùng ảnh 1', 'Dùng ảnh 2', 'Dùng ảnh 3']) click(second.container.querySelector(`input[aria-label^="${label}"]`));
    expect((byText(second.container, 'button', 'Duyệt dùng ảnh này') as HTMLButtonElement).disabled).toBe(true);
  });

  it('hạng không chắc chắn phải qua hộp xác nhận: huỷ thì không gửi gì, đồng ý mới gửi', async () => {
    const { m, container } = setup(list([row({ tier: 'SAME_LINE', tierLabel: 'Cùng dòng, khác quy cách' })]));
    await flush();
    click(byText(container, 'button', 'Duyệt dùng ảnh này'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('Cùng dòng, khác quy cách');
    answerConfirm(false);
    await flush();
    expect(posts(m, '/approve')).toHaveLength(0);
    click(byText(container, 'button', 'Duyệt dùng ảnh này'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(posts(m, '/approve')).toHaveLength(1);
  });

  it('đang lưu thì mọi nút báo bận (aria-disabled), ô chọn khoá, bấm lần hai không gửi thêm', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const { m, container } = setup(list([row(), row({ productId: 'p2', productSlug: 'sp-hai', name: 'SP hai' })]), { hold });
    await flush();
    click(container.querySelector('button[aria-label="Duyệt dùng ảnh này cho Mật cô đặc 250g"]'));
    await flush();
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('li button'));
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.getAttribute('aria-disabled') === 'true' || b.disabled)).toBe(true);
    expect(Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).every((c) => c.disabled)).toBe(true);
    click(container.querySelector('button[aria-label="Duyệt dùng ảnh này cho SP hai"]'));
    click(container.querySelector('button[aria-label="Bỏ qua SP hai"]'));
    release();
    await flush();
    expect(posts(m, '/approve')).toHaveLength(1);
    expect(posts(m, '/skip')).toHaveLength(0);
  });

  it('bỏ qua gọi /skip; thẻ sang nhóm "Đã bỏ qua", ở đó chỉ còn nút "Đưa về chờ duyệt" gọi /restore', async () => {
    const { m, container, setData } = setup(list([row()]));
    await flush();
    setData(list([row({ state: 'SKIPPED' })]));
    click(container.querySelector('button[aria-label="Bỏ qua Mật cô đặc 250g"]'));
    await flush();
    expect(posts(m, '/p1/skip')).toHaveLength(1);
    expect(container.textContent).toContain('Đã bỏ qua "Mật cô đặc 250g".');
    expect(cards(container)).toHaveLength(0);
    click(pill(container, 'skipped'));
    expect(byText(container, 'button', 'Duyệt dùng ảnh này')).toBeNull();
    setData(list([row()]));
    click(container.querySelector('button[aria-label="Đưa Mật cô đặc 250g về chờ duyệt"]'));
    await flush();
    expect(posts(m, '/p1/restore')).toHaveLength(1);
    expect(container.textContent).toContain('Đã đưa "Mật cô đặc 250g" về danh sách chờ duyệt.');
  });

  it('máy chủ từ chối: trả thẻ về chỗ cũ, hiện lỗi dạng alert, nạp lại danh sách, nút mở khoá', async () => {
    const { m, container } = setup(list([row()]), { approve: { status: 502, body: { message: 'Không đọc được ảnh từ WordPress.' } } });
    await flush();
    click(byText(container, 'button', 'Duyệt dùng ảnh này'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('WordPress');
    expect(cards(container).map((c) => c.getAttribute('data-state'))).toEqual(['PENDING']);
    expect(pill(container, 'pending').textContent).toBe('Chờ duyệt1');
    expect(m.calls.filter((c) => c.url.includes('?live=1')).length).toBeGreaterThanOrEqual(2);
    expect((byText(container, 'button', 'Duyệt dùng ảnh này') as HTMLButtonElement).getAttribute('aria-disabled')).toBeNull();
  });

  it('WordPress báo lỗi cho dòng (trang cũ đã tắt): hiện cảnh báo, khoá nút duyệt, vẫn cho bỏ qua', async () => {
    const dead = row({ wp: [{ id: 8454, slug: 'mat-hoa-dua-co-dac', name: null, imageUrls: [], error: 'Không gọi được WordPress.' }], defaultImageUrls: [] });
    const { container } = setup(list([dead]));
    await flush();
    expect(container.textContent).toContain('Không gọi được WordPress.');
    expect((container.querySelector('button[aria-label^="Duyệt dùng ảnh này"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('button[aria-label^="Bỏ qua"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('thẻ đã duyệt / đã có ảnh: không có nút thao tác, nói rõ trạng thái', async () => {
    const { container } = setup(
      list([
        row({ productId: 'p4', productSlug: 'sp-bon', name: 'SP bốn', state: 'APPLIED', appliedCount: 3, wp: null, defaultImageUrls: null }),
        row({ productId: 'p5', productSlug: 'sp-nam', name: 'SP năm', state: 'HAS_IMAGES', wp: null, defaultImageUrls: null }),
      ]),
    );
    await flush();
    click(pill(container, 'all'));
    expect(cards(container)).toHaveLength(2);
    expect(container.querySelectorAll('li button')).toHaveLength(0);
    expect(container.textContent).toContain('Đã lưu 3 ảnh vào sản phẩm');
    expect(container.textContent).toContain('Sản phẩm đã có ảnh nên không cần ảnh từ WordPress.');
    expect(container.querySelector('[role="img"][aria-label="Chưa có ảnh"]')).toBeNull();
  });

  it('không tải được danh sách: lỗi có nút Thử lại gọi lại', async () => {
    const { m, container } = setup(list([]), { listError: true });
    await flush();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    const before = m.calls.length;
    click(byText(container, 'button', 'Thử lại'));
    await flush();
    expect(m.calls.length).toBeGreaterThan(before);
  });

  describe('ô tìm, nhóm gợi ý và dòng chưa có gợi ý', () => {
    const none = row({
      productId: 'p9',
      productSlug: 'xoai-say-deo-bh-nong-5f75de',
      name: 'Xoài sấy dẻo BH.NONG',
      tier: 'NONE',
      tierLabel: 'Chưa có gợi ý',
      note: 'Chưa thấy sản phẩm nào ở WordPress đủ giống tên để gợi ý ảnh. Cần ảnh mới: tải lên ở trang sản phẩm.',
      wp: null,
      defaultImageUrls: null,
    });
    const cand = row({
      productId: 'p8',
      productSlug: 'granola-mix-nuts-tui-tien-loi-bh-nong-3b8792',
      name: 'Granola mix nuts túi tiện lợi BH.NONG',
      tier: 'CANDIDATE',
      tierLabel: 'Gợi ý theo tên, chưa kiểm',
      note: 'Gợi ý tự động theo tên, chưa ai kiểm bao bì: "Granola mix trái cây sấy BH.NONG" (khớp 62%). Đối chiếu bao bì trước khi duyệt.',
    });
    const search = (c: HTMLElement) => c.querySelector<HTMLInputElement>('[data-testid="wp-triage-search"]')!;

    it('có ô tìm cỡ chạm 44px, nhãn rõ', async () => {
      const { container } = setup(list([row()]));
      await flush();
      const input = search(container);
      expect(input.type).toBe('search');
      expect(input.getAttribute('aria-label')).toBe('Tìm sản phẩm theo tên hoặc mã');
      expect(input.className).toMatch(/min-h-\[44px\]/);
    });

    it('gõ không dấu ra sản phẩm có dấu; số đếm của nhóm tính trên kết quả tìm; báo số khớp; xoá ô thì trả đủ', async () => {
      const { container } = setup(list([row(), row({ productId: 'p2', productSlug: 'ca-phe-muoi-tui-50x16g-9fbabb', name: 'Cà phê muối túi 50x16g' })]));
      await flush();
      expect(cards(container)).toHaveLength(2);
      expect(container.querySelector('[role="status"]')).toBeNull();
      typeInto(search(container), 'ca phe');
      await flush();
      expect(cards(container)).toHaveLength(1);
      expect(cards(container)[0]!.textContent).toContain('Cà phê muối túi 50x16g');
      expect(pill(container, 'pending').textContent).toBe('Chờ duyệt1');
      expect(pill(container, 'all').textContent).toBe('Tất cả1');
      expect(container.querySelector('[role="status"]')?.textContent).toBe('Tìm “ca phe”: 1/2 sản phẩm khớp.');
      typeInto(search(container), '');
      await flush();
      expect(cards(container)).toHaveLength(2);
      expect(container.querySelector('[role="status"]')).toBeNull();
    });

    it('tìm theo mã sản phẩm; không có gì khớp thì nói rõ từ đang tìm', async () => {
      const { container } = setup(list([row(), row({ productId: 'p2', productSlug: 'ca-phe-muoi-tui-50x16g-9fbabb', name: 'Cà phê muối túi 50x16g' })]));
      await flush();
      typeInto(search(container), '9fbabb');
      await flush();
      expect(cards(container).map((c) => c.textContent)).toEqual([expect.stringContaining('Mã sản phẩm: ca-phe-muoi-tui-50x16g-9fbabb')]);
      typeInto(search(container), 'không có đâu');
      await flush();
      expect(cards(container)).toHaveLength(0);
      expect(container.textContent).toContain('Không có sản phẩm nào khớp “không có đâu”.');
    });

    it('tìm và nhóm lọc cùng áp; đang lưu thì ô tìm vẫn gõ được nhưng không gửi thêm việc', async () => {
      let release!: () => void;
      const hold = new Promise<void>((r) => (release = r));
      const { m, container } = setup(list([row(), row({ productId: 'p2', productSlug: 'sp-hai', name: 'SP hai' })]), { hold });
      await flush();
      click(container.querySelector('button[aria-label="Duyệt dùng ảnh này cho Mật cô đặc 250g"]'));
      await flush();
      typeInto(search(container), 'hai');
      await flush();
      expect(search(container).disabled).toBe(false);
      expect(cards(container).map((c) => c.getAttribute('data-state'))).toEqual(['PENDING']);
      release();
      await flush();
      expect(posts(m, '/approve')).toHaveLength(1);
    });

    it('nhóm "Có ảnh gợi ý" và "Chưa có gợi ý" tách đúng, số đếm và dòng tổng khớp nhau', async () => {
      const { container } = setup(list([row(), cand, none]));
      await flush();
      expect(pill(container, 'pending').textContent).toBe('Chờ duyệt2');
      expect(pill(container, 'suggested').textContent).toBe('Có ảnh gợi ý2');
      expect(pill(container, 'noSuggestion').textContent).toBe('Chưa có gợi ý1');
      expect(pill(container, 'noImage').textContent).toBe('Chưa có ảnh3');
      expect(cards(container).map((c) => c.querySelector('h2')?.textContent)).toEqual(['Mật cô đặc 250g', 'Granola mix nuts túi tiện lợi BH.NONG']);
      click(pill(container, 'noSuggestion'));
      expect(cards(container).map((c) => c.querySelector('h2')?.textContent)).toEqual(['Xoài sấy dẻo BH.NONG']);
      expect(container.textContent).toContain('Tổng 3 sản phẩm; 3 chưa có ảnh (2 có ảnh gợi ý, 1 chưa có gợi ý).');
    });

    it('dòng chưa có gợi ý: nói cần ảnh mới, không có nút duyệt hay bỏ qua, không có ô chọn ảnh', async () => {
      const { container } = setup(list([none]));
      await flush();
      click(pill(container, 'noSuggestion'));
      const card = cards(container)[0]!;
      expect(card.textContent).toContain('Chưa có gợi ý');
      expect(card.textContent).toContain('Cần ảnh mới: tải lên ở trang sản phẩm.');
      expect(card.textContent).toContain('Không có ảnh WordPress để chọn cho sản phẩm này.');
      expect(card.textContent).not.toContain('Chưa hỏi được WordPress');
      expect(card.querySelectorAll('button, input[type="checkbox"]')).toHaveLength(0);
      expect(card.querySelector('[role="img"][aria-label="Chưa có ảnh"]')).not.toBeNull();
    });

    it('dòng gợi ý theo tên: hiện hạng và lý do khớp, duyệt phải qua hộp xác nhận nêu hạng', async () => {
      const { m, container } = setup(list([cand]));
      await flush();
      const card = cards(container)[0]!;
      expect(card.textContent).toContain('Gợi ý theo tên, chưa kiểm');
      expect(card.textContent).toContain('khớp 62%');
      click(byText(container, 'button', 'Duyệt dùng ảnh này'));
      await flush();
      expect(confirmDialog()?.textContent).toContain('Gợi ý theo tên, chưa kiểm');
      answerConfirm(false);
      await flush();
      expect(posts(m, '/approve')).toHaveLength(0);
      click(byText(container, 'button', 'Duyệt dùng ảnh này'));
      await flush();
      answerConfirm(true);
      await flush();
      expect(posts(m, '/p8/approve')).toHaveLength(1);
    });
  });

  it('bảng ứng viên rỗng thì nói rõ; nút Tải lại gọi lại danh sách', async () => {
    const { m, container } = setup(list([]));
    await flush();
    expect(container.textContent).toContain('Chưa có sản phẩm nào cần duyệt ảnh WordPress.');
    const before = m.calls.length;
    click(byText(container, 'button', 'Tải lại'));
    await flush();
    expect(m.calls.length).toBeGreaterThan(before);
  });
});
