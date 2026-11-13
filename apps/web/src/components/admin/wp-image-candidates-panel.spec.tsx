// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AdminToastProvider } from './admin-toast';
import { WpImageCandidatesPanel } from './wp-image-candidates-panel';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
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
  productSlug: 'mat-co-dac',
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
  counts: { PENDING: items.filter((i) => i.state === 'PENDING').length, SKIPPED: items.filter((i) => i.state === 'SKIPPED').length, APPLIED: items.filter((i) => i.state === 'APPLIED').length, HAS_IMAGES: hasImages },
});

function setup(initial: WpImageList, opts: { onChanged?: () => void; toast?: boolean; approve?: { status?: number; body: unknown }; hold?: Promise<void> } = {}) {
  let data = initial;
  const m = mockFetch({
    '/approve': () => opts.approve ?? { body: { productId: 'p1', state: 'APPLIED', appliedCount: 3 } },
    '/skip': { body: { productId: 'p1', state: 'SKIPPED' } },
    '/restore': { body: { productId: 'p1', state: 'PENDING' } },
    '/admin/catalog-wp-images': () => ({ body: data }),
  });
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (opts.hold && url.includes('/approve')) await opts.hold;
    return m.fn(url, init);
  });
  vi.stubGlobal('fetch', fn);
  const panel = <WpImageCandidatesPanel onChanged={opts.onChanged} />;
  const r = render(opts.toast ? <AdminToastProvider>{panel}</AdminToastProvider> : panel);
  mounted.push(r);
  return { m, container: r.container, setData: (next: WpImageList) => (data = next) };
}

const posts = (m: ReturnType<typeof mockFetch>, part: string) => m.calls.filter((c) => c.url.includes(part) && c.init?.method === 'POST');
const open = async (container: HTMLElement) => {
  click(byText(container, 'button', 'ứng viên ảnh từ WordPress cũ'));
  await flush();
};

describe('WpImageCandidatesPanel (duyệt ảnh WordPress cho sản phẩm chưa có ảnh)', () => {
  it('đóng sẵn: chưa hỏi WordPress lần nào, nút mở có aria-expanded=false', async () => {
    const { m, container } = setup(list([row()]));
    await flush();
    expect(m.calls).toEqual([]);
    expect(byText(container, 'button', 'ứng viên ảnh từ WordPress cũ')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('mở ra mới gọi ?live=1, chỉ hiện sản phẩm chờ duyệt kèm nhóm, ghi chú, phân loại và ảnh WordPress đã chọn sẵn', async () => {
    const { m, container } = setup(
      list([row(), row({ productId: 'p2', name: 'Đã nạp rồi', state: 'APPLIED', appliedCount: 3, wp: null, defaultImageUrls: null }), row({ productId: 'p3', name: 'Có ảnh sẵn', state: 'HAS_IMAGES', wp: null, defaultImageUrls: null })], 1),
    );
    await open(container);
    expect(m.calls.filter((c) => c.url.includes('/admin/catalog-wp-images?live=1'))).toHaveLength(1);
    expect(container.textContent).toContain('Mật cô đặc 250g');
    expect(container.textContent).toContain('Chắc chắn cùng sản phẩm');
    expect(container.textContent).toContain('Cùng tên và cùng 250g.');
    expect(container.textContent).toContain('Phân loại: 250g');
    expect(container.textContent).toContain('WordPress: Mật hoa dừa cô đặc');
    expect(container.querySelectorAll('img')).toHaveLength(3);
    expect(Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).every((c) => c.checked)).toBe(true);
    expect(container.textContent).toContain('Duyệt dùng 3 ảnh');
    expect(container.textContent).not.toContain('Có ảnh sẵn');
    expect(container.textContent).toContain('Đã nạp ảnh: Đã nạp rồi (3 ảnh)');
    expect(container.textContent).toContain('1 sản phẩm trong danh sách đã có ảnh');
  });

  it('nhóm chắc chắn duyệt thẳng không hỏi lại, gửi đúng bộ ảnh, báo thành công, nạp lại danh sách và báo tab làm mới', async () => {
    const onChanged = vi.fn();
    const { m, container } = setup(list([row()]), { onChanged });
    await open(container);
    click(byText(container, 'button', 'Duyệt dùng 3 ảnh'));
    await flush();
    expect(confirmDialog()).toBeNull();
    const sent = posts(m, '/p1/approve');
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0]!.init!.body))).toEqual({ imageUrls: [wpUrl('a'), wpUrl('b'), wpUrl('c')] });
    expect(container.textContent).toContain('Đã lưu 3 ảnh vào "Mật cô đặc 250g".');
    expect(m.calls.filter((c) => c.url.includes('?live=1')).length).toBeGreaterThanOrEqual(2);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('bỏ chọn một ảnh thì chỉ gửi các ảnh còn lại; bỏ hết thì nút duyệt khoá', async () => {
    const { m, container } = setup(list([row()]));
    await open(container);
    click(container.querySelector('input[aria-label^="Dùng ảnh 2"]'));
    expect(container.textContent).toContain('Duyệt dùng 2 ảnh');
    click(byText(container, 'button', 'Duyệt dùng 2 ảnh'));
    await flush();
    expect(JSON.parse(String(posts(m, '/approve')[0]!.init!.body))).toEqual({ imageUrls: [wpUrl('a'), wpUrl('c')] });

    const second = setup(list([row()]));
    await open(second.container);
    for (const label of ['Dùng ảnh 1', 'Dùng ảnh 2', 'Dùng ảnh 3']) click(second.container.querySelector(`input[aria-label^="${label}"]`));
    const btn = byText(second.container, 'button', 'Duyệt dùng 0 ảnh') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('nhóm không chắc chắn phải qua hộp xác nhận: huỷ thì không gửi gì, đồng ý mới gửi', async () => {
    const { m, container } = setup(list([row({ tier: 'SAME_LINE', tierLabel: 'Cùng dòng, khác quy cách' })]));
    await open(container);
    click(byText(container, 'button', 'Duyệt dùng 3 ảnh'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('Cùng dòng, khác quy cách');
    answerConfirm(false);
    await flush();
    expect(posts(m, '/approve')).toHaveLength(0);

    click(byText(container, 'button', 'Duyệt dùng 3 ảnh'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(posts(m, '/approve')).toHaveLength(1);
  });

  it('đang lưu thì mọi nút và ô chọn khoá, bấm lần hai không gửi thêm', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const { m, container } = setup(list([row(), row({ productId: 'p2', name: 'SP hai', productSlug: 'sp-hai' })]), { hold });
    await open(container);
    click(container.querySelector('button[aria-label^="Duyệt dùng 3 ảnh cho Mật cô đặc"]'));
    await flush();
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('li button'));
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).every((c) => c.disabled)).toBe(true);
    click(container.querySelector('button[aria-label^="Duyệt dùng 3 ảnh cho SP hai"]'));
    release();
    await flush();
    expect(posts(m, '/approve')).toHaveLength(1);
  });

  it('bỏ qua gọi /skip và báo; đã bỏ qua thì gập sẵn, mở ra bấm "Xem lại" gọi /restore', async () => {
    const { m, container, setData } = setup(list([row()]));
    await open(container);
    // Máy chủ đổi trạng thái khi nhận /skip; lần nạp lại sau đó phải thấy dòng đã bỏ qua.
    setData(list([row({ state: 'SKIPPED', wp: null, defaultImageUrls: null })]));
    click(container.querySelector('button[aria-label="Bỏ qua Mật cô đặc 250g"]'));
    await flush();
    expect(posts(m, '/p1/skip')).toHaveLength(1);
    expect(container.textContent).toContain('Đã bỏ qua "Mật cô đặc 250g".');
    expect(container.textContent).not.toContain('Duyệt dùng');
    expect(container.querySelector('button[aria-label="Xem lại Mật cô đặc 250g"]')).toBeNull();
    click(byText(container, 'button', '1 sản phẩm đã bỏ qua'));
    click(container.querySelector('button[aria-label="Xem lại Mật cô đặc 250g"]'));
    await flush();
    expect(posts(m, '/p1/restore')).toHaveLength(1);
    expect(container.textContent).toContain('Đã đưa "Mật cô đặc 250g" về danh sách chờ duyệt.');
  });

  it('máy chủ từ chối (WordPress tắt): hiện lỗi dạng alert, nạp lại danh sách, vẫn báo tab làm mới', async () => {
    const onChanged = vi.fn();
    const { m, container } = setup(list([row()]), { onChanged, approve: { status: 502, body: { message: 'Không đọc được ảnh từ WordPress.' } } });
    await open(container);
    click(byText(container, 'button', 'Duyệt dùng 3 ảnh'));
    await flush();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('WordPress');
    expect(m.calls.filter((c) => c.url.includes('?live=1')).length).toBeGreaterThanOrEqual(2);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('WordPress báo lỗi cho dòng (trang cũ đã tắt): hiện cảnh báo và khoá nút duyệt, vẫn cho bỏ qua', async () => {
    const dead = row({ wp: [{ id: 8454, slug: 'mat-hoa-dua-co-dac', name: null, imageUrls: [], error: 'Không gọi được WordPress.' }], defaultImageUrls: [] });
    const { container } = setup(list([dead]));
    await open(container);
    expect(container.textContent).toContain('Không gọi được WordPress.');
    expect((container.querySelector('button[aria-label^="Duyệt dùng 0 ảnh"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('button[aria-label^="Bỏ qua"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('không tải được danh sách: lỗi có nút Thử lại gọi lại', async () => {
    const m = mockFetch({ '/admin/catalog-wp-images': { status: 500, body: { message: 'Lỗi máy chủ' } } });
    vi.stubGlobal('fetch', vi.fn(m.fn));
    const r = render(<WpImageCandidatesPanel />);
    mounted.push(r);
    await open(r.container);
    expect(r.container.querySelector('[role="alert"]')).not.toBeNull();
    const before = m.calls.length;
    click(byText(r.container, 'button', 'Thử lại'));
    await flush();
    expect(m.calls.length).toBeGreaterThan(before);
  });

  it('không còn gì chờ duyệt thì nói rõ', async () => {
    const { container } = setup(list([], 4));
    await open(container);
    expect(container.textContent).toContain('Không còn sản phẩm nào chờ duyệt ảnh từ WordPress.');
  });

  it('thông báo đẩy lên toast khi có provider, không đọc hai lần', async () => {
    const { container } = setup(list([row()]), { toast: true });
    await open(container);
    click(byText(container, 'button', 'Duyệt dùng 3 ảnh'));
    await flush();
    const region = document.querySelector('[data-admin-toast-region]');
    expect(region?.textContent).toContain('Đã lưu 3 ảnh vào "Mật cô đặc 250g".');
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
