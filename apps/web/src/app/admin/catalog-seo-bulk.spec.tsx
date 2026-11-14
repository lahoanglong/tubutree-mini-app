// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { CatalogSeoBulk } from './catalog-seo-bulk';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { CatalogSeoRow } from './catalog-quality-api';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const row = (id: string, over: Partial<CatalogSeoRow> = {}): CatalogSeoRow => ({
  id,
  slug: `sp-${id}`,
  name: `Sản phẩm ${id}`,
  brand: 'Tubu Tree',
  metaTitle: null,
  metaDesc: null,
  titleLength: 0,
  descLength: 0,
  missingTitle: true,
  missingDesc: true,
  tooLongTitle: false,
  tooLongDesc: false,
  suggested: { metaTitle: `Sản phẩm ${id} | Tubu Tree`, metaDesc: `Sản phẩm ${id}. Mua tại Tubu Tree.` },
  ...over,
});

const A = row('a', { name: 'Dầu gội bồ kết', brand: 'Xanh Việt', suggested: { metaTitle: 'Dầu gội bồ kết | Xanh Việt', metaDesc: 'Dầu gội bồ kết của Xanh Việt. Mua tại Tubu Tree.' } });
const B = row('b', { name: 'Mật ong rừng', metaTitle: 'Mật ong rừng | Tubu Tree', metaDesc: 'Mật ong rừng. Mua tại Tubu Tree.', titleLength: 24, descLength: 32, missingTitle: false, missingDesc: false });
const C = row('c', { name: 'Trà gừng', metaTitle: 'Trà gừng tay | Tubu Tree', titleLength: 24, missingTitle: false });

interface Opts {
  rows?: CatalogSeoRow[];
  list?: { status?: number; body: unknown } | (() => { status?: number; body: unknown });
  apply?: { status?: number; body: unknown } | (() => { status?: number; body: unknown });
  holdApply?: Promise<void>;
}

const listBody = (rows: CatalogSeoRow[]) => ({ rows, total: rows.length, missing: rows.filter((r) => r.missingTitle || r.missingDesc).length, truncated: false });

function setup(opts: Opts = {}) {
  const rows = opts.rows ?? [A, B, C];
  const m = mockFetch({
    '/seo/apply': opts.apply ?? { body: { updated: 1, skippedIds: [] } },
    '/catalog-quality/seo': opts.list ?? { body: listBody(rows) },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (opts.holdApply && url.includes('/seo/apply')) await opts.holdApply;
      return m.fn(url, init);
    }),
  );
  const r = render(<CatalogSeoBulk />);
  mounted.push(r);
  return { m, container: r.container };
}

const posts = (m: ReturnType<typeof mockFetch>) => m.calls.filter((c) => c.url.includes('/seo/apply') && c.init?.method === 'POST');
const gets = (m: ReturnType<typeof mockFetch>) => m.calls.filter((c) => c.url.endsWith('/catalog-quality/seo'));
const bodyOf = (call: { init?: RequestInit }) => JSON.parse(String(call.init?.body));
const rowEl = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-testid="seo-row-${id}"]`);
const titleIn = (c: HTMLElement, id: string) => rowEl(c, id)!.querySelector<HTMLInputElement>('input[type="text"]')!;
const descIn = (c: HTMLElement, id: string) => rowEl(c, id)!.querySelector<HTMLTextAreaElement>('textarea')!;
const checkbox = (c: HTMLElement, id: string) => rowEl(c, id)!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const countOf = (c: HTMLElement, id: string, kind: 'title' | 'desc') => c.querySelector(`[data-testid="seo-${kind}-count-${id}"]`)?.textContent ?? null;
const visibleIds = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-testid^="seo-row-"]')).map((e) => e.getAttribute('data-testid')!.replace('seo-row-', ''));
const openBtn = (c: HTMLElement) => byText(c, 'button', 'Mở bảng SEO')!;
const saveBtn = (c: HTMLElement) => byText(c, 'button', 'Lưu các mục đã chọn')!;
const fillBtn = (c: HTMLElement) => byText(c, 'button', 'Điền nháp cho các dòng đang trống')!;
const chip = (c: HTMLElement, text: string) => byText(c, 'button', text)!;
const searchBox = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[type="search"]')!;
const open = async (c: HTMLElement) => {
  click(openBtn(c));
  await flush();
};

describe('CatalogSeoBulk — duyệt và sửa SEO hàng loạt', () => {
  it('chưa bấm mở thì không gọi API; mở rồi mới đọc /admin/catalog-quality/seo', async () => {
    const { m, container } = setup();
    expect(m.calls).toHaveLength(0);
    expect(visibleIds(container)).toEqual([]);
    await open(container);
    expect(gets(m)).toHaveLength(1);
    expect(visibleIds(container).length).toBeGreaterThan(0);
  });

  it('mặc định lọc "Thiếu SEO" (dòng thiếu tiêu đề hoặc mô tả); "Tất cả" hiện đủ; số đếm đúng trên chip', async () => {
    const { container } = setup();
    await open(container);
    expect(chip(container, 'Thiếu SEO').textContent).toContain('(2)');
    expect(chip(container, 'Tất cả').textContent).toContain('(3)');
    expect(chip(container, 'Thiếu SEO').getAttribute('aria-pressed')).toBe('true');
    expect(visibleIds(container)).toEqual(['a', 'c']);
    click(chip(container, 'Tất cả'));
    expect(visibleIds(container)).toEqual(['a', 'b', 'c']);
    expect(chip(container, 'Tất cả').getAttribute('aria-pressed')).toBe('true');
  });

  it('tìm theo tên hoặc thương hiệu, không phân biệt hoa thường và dấu', async () => {
    const { container } = setup();
    await open(container);
    click(chip(container, 'Tất cả'));
    typeInto(searchBox(container), 'XANH viet');
    expect(visibleIds(container)).toEqual(['a']);
    typeInto(searchBox(container), 'mat ong');
    expect(visibleIds(container)).toEqual(['b']);
    typeInto(searchBox(container), 'không có sản phẩm này');
    expect(visibleIds(container)).toEqual([]);
    expect(container.textContent).toContain('Không có sản phẩm nào khớp');
  });

  it('mỗi dòng có ô tiêu đề và mô tả đã gắn nhãn, đếm ký tự dạng n/65 và n/155 trong phần tử tabular-nums', async () => {
    const { container } = setup();
    await open(container);
    click(chip(container, 'Tất cả'));
    expect(titleIn(container, 'b').value).toBe('Mật ong rừng | Tubu Tree');
    expect(descIn(container, 'b').value).toBe('Mật ong rừng. Mua tại Tubu Tree.');
    expect(countOf(container, 'b', 'title')).toBe('24/65');
    expect(countOf(container, 'b', 'desc')).toBe('32/155');
    expect(countOf(container, 'a', 'title')).toBe('0/65');
    expect(container.querySelector('[data-testid="seo-title-count-b"]')!.className).toContain('tabular-nums');
    expect(container.querySelector('[data-testid="seo-desc-count-b"]')!.className).toContain('tabular-nums');
    const label = rowEl(container, 'b')!.querySelector(`label[for="${titleIn(container, 'b').id}"]`);
    expect(label?.textContent).toContain('Tiêu đề SEO');
    expect(label?.textContent).toContain('Mật ong rừng');
  });

  it('gõ vào ô thì bộ đếm đổi theo; vượt trần thì ô báo aria-invalid và bộ đếm đổi màu cảnh báo', async () => {
    const { container } = setup();
    await open(container);
    typeInto(titleIn(container, 'a'), 'x'.repeat(66));
    expect(countOf(container, 'a', 'title')).toBe('66/65');
    expect(titleIn(container, 'a').getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('[data-testid="seo-title-count-a"]')!.className).toContain('text-danger-fg');
    typeInto(titleIn(container, 'a'), 'x'.repeat(65));
    expect(titleIn(container, 'a').getAttribute('aria-invalid')).toBeNull();
    typeInto(descIn(container, 'a'), 'y'.repeat(156));
    expect(descIn(container, 'a').getAttribute('aria-invalid')).toBe('true');
    expect(countOf(container, 'a', 'desc')).toBe('156/155');
  });

  it('"Điền nháp cho các dòng đang trống" chỉ điền ô trống từ bản đề xuất, không đè chữ đã có hay đang gõ, và tự chọn dòng vừa điền', async () => {
    const { container } = setup();
    await open(container);
    typeInto(descIn(container, 'a'), 'Mô tả tôi đang gõ.');
    click(fillBtn(container));
    expect(titleIn(container, 'a').value).toBe('Dầu gội bồ kết | Xanh Việt');
    expect(descIn(container, 'a').value).toBe('Mô tả tôi đang gõ.');
    expect(titleIn(container, 'c').value).toBe('Trà gừng tay | Tubu Tree');
    expect(descIn(container, 'c').value).toBe('Sản phẩm c. Mua tại Tubu Tree.');
    expect(checkbox(container, 'a').checked).toBe(true);
    expect(checkbox(container, 'c').checked).toBe(true);
    expect(container.textContent).toContain('Đã điền nháp cho 2 dòng');
  });

  it('điền nháp xong không có gì để điền thì báo rõ và không chọn dòng nào', async () => {
    const { container } = setup({ rows: [B] });
    await open(container);
    click(chip(container, 'Tất cả'));
    click(fillBtn(container));
    expect(checkbox(container, 'b').checked).toBe(false);
    expect(container.textContent).toContain('Không có ô trống nào để điền');
  });

  it('nút Lưu bị khoá khi chưa chọn dòng nào và hiện số dòng đã chọn; khoá thì bấm không gọi API', async () => {
    const { m, container } = setup();
    await open(container);
    expect(saveBtn(container).getAttribute('aria-disabled')).toBe('true');
    click(saveBtn(container));
    await flush();
    expect(posts(m)).toHaveLength(0);
    click(checkbox(container, 'c'));
    expect(saveBtn(container).getAttribute('aria-disabled')).toBeNull();
    expect(saveBtn(container).textContent).toContain('(1)');
  });

  it('Lưu gửi đúng {items:[{productId, metaTitle, metaDesc}]} của các dòng đã chọn (đã cắt khoảng trắng), báo kết quả, tải lại và bỏ chọn', async () => {
    const { m, container } = setup();
    await open(container);
    click(fillBtn(container));
    typeInto(titleIn(container, 'c'), '  Trà gừng | Tubu Tree  ');
    click(checkbox(container, 'a'));
    click(saveBtn(container));
    await flush();
    expect(posts(m)).toHaveLength(1);
    expect(bodyOf(posts(m)[0]!)).toEqual({
      items: [{ productId: 'c', metaTitle: 'Trà gừng | Tubu Tree', metaDesc: 'Sản phẩm c. Mua tại Tubu Tree.' }],
    });
    expect(container.textContent).toContain('Đã lưu 1 mục');
    expect(gets(m)).toHaveLength(2);
    expect(checkbox(container, 'c')?.checked ?? false).toBe(false);
  });

  it('dòng đã chọn mà trống hoặc vượt trần: không gửi gì, nêu rõ sản phẩm nào sai', async () => {
    const { m, container } = setup();
    await open(container);
    click(checkbox(container, 'a'));
    click(saveBtn(container));
    await flush();
    expect(posts(m)).toHaveLength(0);
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Dầu gội bồ kết');
    expect(alert.textContent).toContain('đang trống');

    typeInto(titleIn(container, 'a'), 'T'.repeat(66));
    typeInto(descIn(container, 'a'), 'ok');
    click(saveBtn(container));
    await flush();
    expect(posts(m)).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('65');
  });

  it('máy chủ từ chối (400): hiện đúng lời máy chủ, giữ nguyên chữ đã gõ và dòng đã chọn', async () => {
    const { m, container } = setup({ apply: { status: 400, body: { message: 'Dầu gội bồ kết: Mô tả SEO có tuyên bố y tế.' } } });
    await open(container);
    typeInto(titleIn(container, 'a'), 'Dầu gội | Xanh Việt');
    typeInto(descIn(container, 'a'), 'Chữa bệnh.');
    click(checkbox(container, 'a'));
    click(saveBtn(container));
    await flush();
    expect(posts(m)).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('tuyên bố y tế');
    expect(descIn(container, 'a').value).toBe('Chữa bệnh.');
    expect(checkbox(container, 'a').checked).toBe(true);
    expect(gets(m)).toHaveLength(1);
  });

  it('có mục bị bỏ qua (đối tác hoặc đã xoá): báo số mục bỏ qua', async () => {
    const { container } = setup({ apply: { body: { updated: 0, skippedIds: ['c'] } } });
    await open(container);
    click(fillBtn(container));
    click(saveBtn(container));
    await flush();
    expect(container.textContent).toContain('bỏ qua 1');
  });

  it('bấm Lưu hai lần liên tiếp khi đang lưu chỉ gửi MỘT yêu cầu', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const { m, container } = setup({ holdApply: hold });
    await open(container);
    click(fillBtn(container));
    const btn = saveBtn(container);
    click(btn);
    click(btn);
    await flush(2);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.textContent).toContain('Đang lưu');
    act(() => release());
    await flush();
    expect(posts(m)).toHaveLength(1);
  });

  it('lỗi tải danh sách: hiện lỗi kèm nút Thử lại và bấm thì tải lại', async () => {
    const { m, container } = setup({ list: { status: 500, body: { message: 'Máy chủ lỗi' } } });
    await open(container);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    const retry = byText(container, 'button', 'Thử lại')!;
    click(retry);
    await flush();
    expect(gets(m).length).toBe(2);
  });

  it('không có dòng nào thiếu: báo đã đủ SEO ở bộ lọc mặc định', async () => {
    const { container } = setup({ rows: [B] });
    await open(container);
    expect(container.textContent).toContain('Mọi sản phẩm đang bán đều đã có tiêu đề và mô tả SEO');
  });

  it('chạm 44px: mọi nút, ô nhập, vùng chọn đều có min-h 44px không bị hạ ở màn rộng; ô chọn nằm trong nhãn 44x44', async () => {
    const { container } = setup();
    await open(container);
    const controls = [
      ...Array.from(container.querySelectorAll<HTMLElement>('button')),
      ...Array.from(container.querySelectorAll<HTMLElement>('input[type="text"], input[type="search"], textarea')),
    ];
    expect(controls.length).toBeGreaterThan(6);
    for (const el of controls) {
      expect(el.className, el.outerHTML.slice(0, 80)).toContain('min-h-[44px]');
      expect(el.className, el.outerHTML.slice(0, 80)).not.toMatch(/sm:min-h-\[36px\]/);
    }
    const label = checkbox(container, 'a').closest('label')!;
    expect(label.className).toContain('min-h-[44px]');
    expect(label.className).toContain('min-w-[44px]');
  });

  it('khung dòng không để nội dung dài làm tràn ngang (min-w-0, break-words)', async () => {
    const long = row('x', { name: 'Tên sản phẩm rất dài '.repeat(10), brand: 'ThươngHiệuKhôngDấuCáchRấtDàiThươngHiệuKhôngDấuCáchRấtDài' });
    const { container } = setup({ rows: [long] });
    await open(container);
    const r = rowEl(container, 'x')!;
    expect(r.querySelector('.break-words')).not.toBeNull();
    expect(r.querySelectorAll('.min-w-0').length).toBeGreaterThanOrEqual(3);
  });
});
