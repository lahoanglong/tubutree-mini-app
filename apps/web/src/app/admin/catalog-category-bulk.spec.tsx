// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { CatalogCategoryBulk } from './catalog-category-bulk';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { CategorySuggestionList, CategorySuggestionRow } from './catalog-quality-api';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const CATEGORIES = [
  { id: 'cat-cleaning', name: 'Tẩy rửa sinh học' },
  { id: 'cat-baby', name: 'Cho bé' },
  { id: 'cat-personal', name: 'Chăm sóc cá nhân' },
];
const T = '2026-11-16T10:00:00.000Z';

const row = (id: string, over: Partial<CategorySuggestionRow> = {}): CategorySuggestionRow => ({
  id,
  name: `Sản phẩm ${id}`,
  slug: `sp-${id}`,
  brand: 'Tubu Tree',
  thumbnail: `https://img.example/${id}.jpg`,
  hasImage: true,
  onSale: true,
  updatedAt: T,
  suggestion: { categoryIds: [], confidence: 0, matches: [] },
  ...over,
});
const sure = (categoryId: string, confidence: number, rule: string) => ({
  categoryIds: [categoryId],
  confidence,
  matches: [{ categoryId, confidence, ruleId: rule, rule }],
});

const A = row('a', {
  name: 'Nước rửa chén Fuwa3e',
  brand: 'Fuwa3e',
  suggestion: sure('cat-cleaning', 0.97, 'Fuwa3e + từ khoá tẩy rửa'),
});
const B = row('b', {
  name: 'Bọt rửa tay cho bé Pineboo',
  brand: 'Pineboo',
  suggestion: {
    categoryIds: ['cat-baby', 'cat-personal'],
    confidence: 0.8,
    matches: [
      { categoryId: 'cat-baby', confidence: 0.95, ruleId: 'cho-be', rule: 'Tên có "cho bé"' },
      { categoryId: 'cat-personal', confidence: 0.85, ruleId: 'rua-tay', rule: 'Rửa tay' },
    ],
  },
});
const C = row('c', { name: 'Quà tặng bí ẩn', thumbnail: null, hasImage: false, onSale: false });
const D = row('d', {
  name: 'Nước lau sàn Fuwa3e',
  brand: 'Fuwa3e',
  suggestion: sure('cat-cleaning', 0.95, 'Fuwa3e + từ khoá tẩy rửa'),
});

const listBody = (items: CategorySuggestionRow[]): CategorySuggestionList => {
  const auto = items.filter(
    (r) => r.suggestion.categoryIds.length > 0 && r.suggestion.confidence >= 0.9,
  );
  return {
    categories: CATEGORIES,
    items,
    autoMin: 0.9,
    summary: {
      total: items.length,
      onSale: items.filter((r) => r.onSale).length,
      autoReady: auto.length,
      needsReview: items.length - auto.length,
      autoReadyOnSale: 0,
      needsReviewOnSale: 0,
    },
    truncated: false,
  };
};

interface Opts {
  lists?: CategorySuggestionRow[][];
  listError?: boolean;
  apply?: { status?: number; body: unknown };
  holdApply?: Promise<void>;
}

function setup(opts: Opts = {}) {
  const lists = opts.lists ?? [[A, B, C, D]];
  let n = 0;
  const m = mockFetch({
    '/category-suggestions/apply': opts.apply ?? { body: { applied: 2, items: [] } },
    '/category-suggestions': () =>
      opts.listError
        ? { status: 500, body: { message: 'Máy chủ lỗi' } }
        : { body: listBody(lists[Math.min(n++, lists.length - 1)]!) },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (opts.holdApply && url.includes('/apply')) await opts.holdApply;
      return m.fn(url, init);
    }),
  );
  const r = render(<CatalogCategoryBulk />);
  mounted.push(r);
  return { m, container: r.container };
}

const posts = (m: ReturnType<typeof mockFetch>) =>
  m.calls.filter((c) => c.url.includes('/category-suggestions/apply') && c.init?.method === 'POST');
const gets = (m: ReturnType<typeof mockFetch>) =>
  m.calls.filter((c) => c.url.endsWith('/admin/catalog/category-suggestions'));
const bodyOf = (call: { init?: RequestInit }) => JSON.parse(String(call.init?.body));
const rowEl = (c: HTMLElement, id: string) =>
  c.querySelector<HTMLElement>(`[data-testid="category-row-${id}"]`);
const checkbox = (c: HTMLElement, id: string) =>
  rowEl(c, id)!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const catChip = (c: HTMLElement, id: string, name: string) =>
  byText(rowEl(c, id)!, 'button', name)!;
const chosenText = (c: HTMLElement, id: string) =>
  c.querySelector(`[data-testid="category-chosen-${id}"]`)?.textContent ?? null;
const visibleIds = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('[data-testid^="category-row-"]')).map((e) =>
    e.getAttribute('data-testid')!.replace('category-row-', ''),
  );
const applyBtn = (c: HTMLElement) => byText(c, 'button', 'Áp dụng')!;
const selectAutoBtn = (c: HTMLElement) => byText(c, 'button', 'Chọn mọi gợi ý')!;
const chip = (c: HTMLElement, text: string) => byText(c, 'button', text)!;
const open = async (c: HTMLElement) => {
  click(byText(c, 'button', 'Mở bảng gợi ý')!);
  await flush();
};

describe('CatalogCategoryBulk — gán danh mục hàng loạt theo gợi ý', () => {
  it('chưa bấm mở thì không gọi API; mở rồi đọc /admin/catalog/category-suggestions và hiện số đếm', async () => {
    const { m, container } = setup();
    expect(m.calls).toHaveLength(0);
    await open(container);
    expect(gets(m)).toHaveLength(1);
    expect(visibleIds(container)).toEqual(['a', 'b', 'c', 'd']);
    const summary = container.querySelector('[data-testid="category-bulk-summary"]')!.textContent!;
    expect(summary).toContain('4 sản phẩm chưa có danh mục (3 đang bán)');
    expect(summary).toContain('2 gợi ý chắc chắn (từ 90%)');
    expect(summary).toContain('2 cần xem');
  });

  it('lọc Chắc chắn / Cần xem kèm số đếm; tìm không phân biệt dấu theo tên hoặc thương hiệu', async () => {
    const { container } = setup();
    await open(container);
    expect(chip(container, 'Chắc chắn').textContent).toContain('(2)');
    expect(chip(container, 'Cần xem').textContent).toContain('(2)');
    click(chip(container, 'Chắc chắn'));
    expect(visibleIds(container)).toEqual(['a', 'd']);
    click(chip(container, 'Cần xem'));
    expect(visibleIds(container)).toEqual(['b', 'c']);
    click(chip(container, 'Tất cả'));
    typeInto(container.querySelector<HTMLInputElement>('input[type="search"]')!, 'PINEBOO bot rua');
    expect(visibleIds(container)).toEqual([]);
    typeInto(container.querySelector<HTMLInputElement>('input[type="search"]')!, 'bot rua tay');
    expect(visibleIds(container)).toEqual(['b']);
  });

  it('mỗi dòng có ảnh (hoặc ô "Chưa có ảnh"), tên, thương hiệu, độ tin cậy kèm lý do, nhãn "Đang ẩn", danh mục đang chọn', async () => {
    const { container } = setup();
    await open(container);
    expect(rowEl(container, 'a')!.querySelector('img')?.getAttribute('src')).toBe(
      'https://img.example/a.jpg',
    );
    expect(rowEl(container, 'a')!.textContent).toContain('Fuwa3e');
    expect(container.querySelector('[data-testid="category-confidence-a"]')!.textContent).toBe(
      'Chắc chắn 97% · Fuwa3e + từ khoá tẩy rửa',
    );
    expect(container.querySelector('[data-testid="category-confidence-b"]')!.textContent).toContain(
      'Cần xem 80%',
    );
    expect(container.querySelector('[data-testid="category-confidence-c"]')!.textContent).toBe(
      'Chưa có gợi ý: chọn tay',
    );
    expect(rowEl(container, 'c')!.querySelector('img')).toBeNull();
    expect(rowEl(container, 'c')!.textContent).toContain('Chưa có ảnh');
    expect(rowEl(container, 'c')!.textContent).toContain('Đang ẩn');
    expect(rowEl(container, 'a')!.textContent).not.toContain('Đang ẩn');
    expect(chosenText(container, 'a')).toBe('Tẩy rửa sinh học');
    expect(chosenText(container, 'b')).toBe('Cho bé, Chăm sóc cá nhân');
    expect(chosenText(container, 'c')).toBe('Chưa chọn danh mục');
    expect(catChip(container, 'a', 'Tẩy rửa sinh học').getAttribute('aria-pressed')).toBe('true');
    expect(catChip(container, 'a', 'Cho bé').getAttribute('aria-pressed')).toBe('false');
  });

  it('nút Áp dụng khoá khi chưa chọn dòng nào; "Chọn mọi gợi ý từ 90%" chọn đúng các dòng chắc chắn và nút đổi thành "Áp dụng 2 sản phẩm"', async () => {
    const { m, container } = setup();
    await open(container);
    expect(applyBtn(container).textContent).toBe('Áp dụng 0 sản phẩm');
    expect(applyBtn(container).getAttribute('aria-disabled')).toBe('true');
    click(applyBtn(container));
    await flush();
    expect(posts(m)).toHaveLength(0);
    expect(selectAutoBtn(container).textContent).toContain('(2)');
    click(selectAutoBtn(container));
    expect(checkbox(container, 'a').checked).toBe(true);
    expect(checkbox(container, 'd').checked).toBe(true);
    expect(checkbox(container, 'b').checked).toBe(false);
    expect(checkbox(container, 'c').checked).toBe(false);
    expect(applyBtn(container).textContent).toBe('Áp dụng 2 sản phẩm');
    expect(applyBtn(container).getAttribute('aria-disabled')).toBeNull();
  });

  it('Áp dụng gửi {items:[{productId, categoryIds, expectedUpdatedAt}]} của các dòng đã chọn, báo kết quả và tải lại', async () => {
    const { m, container } = setup({
      lists: [
        [A, B, C, D],
        [B, C],
      ],
    });
    await open(container);
    click(selectAutoBtn(container));
    click(applyBtn(container));
    await flush();
    expect(posts(m)).toHaveLength(1);
    expect(bodyOf(posts(m)[0]!)).toEqual({
      items: [
        { productId: 'a', categoryIds: ['cat-cleaning'], expectedUpdatedAt: T },
        { productId: 'd', categoryIds: ['cat-cleaning'], expectedUpdatedAt: T },
      ],
    });
    expect(container.textContent).toContain('Đã gán danh mục cho 2 sản phẩm');
    expect(gets(m)).toHaveLength(2);
    expect(visibleIds(container)).toEqual(['b', 'c']);
    expect(applyBtn(container).textContent).toBe('Áp dụng 0 sản phẩm');
  });

  it('sửa chip: bật/tắt danh mục đổi danh mục gửi đi và tự chọn dòng; dòng chọn mà không còn danh mục nào thì không gửi', async () => {
    const { m, container } = setup();
    await open(container);
    click(catChip(container, 'b', 'Chăm sóc cá nhân'));
    expect(chosenText(container, 'b')).toBe('Cho bé');
    expect(checkbox(container, 'b').checked).toBe(true);
    click(catChip(container, 'c', 'Tẩy rửa sinh học'));
    expect(checkbox(container, 'c').checked).toBe(true);
    click(catChip(container, 'c', 'Tẩy rửa sinh học'));
    expect(chosenText(container, 'c')).toBe('Chưa chọn danh mục');
    click(applyBtn(container));
    await flush();
    expect(posts(m)).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('"Quà tặng bí ẩn"');

    click(checkbox(container, 'c'));
    click(applyBtn(container));
    await flush();
    expect(bodyOf(posts(m)[0]!)).toEqual({
      items: [{ productId: 'b', categoryIds: ['cat-baby'], expectedUpdatedAt: T }],
    });
  });

  it('409 (sản phẩm vừa có danh mục hoặc vừa bị sửa): hiện lời máy chủ, tự tải lại, dòng đã có danh mục rời bảng, dòng còn lại giữ lựa chọn', async () => {
    const changedD = { ...D, updatedAt: '2026-11-16T11:00:00.000Z' };
    const { m, container } = setup({
      lists: [
        [A, B, C, D],
        [B, C, changedD],
      ],
      apply: {
        status: 409,
        body: {
          statusCode: 409,
          code: 'CATEGORY_APPLY_STALE',
          message: '1 sản phẩm vừa thay đổi từ lúc bạn mở danh sách. Chưa ghi sản phẩm nào.',
          conflicts: [{ productId: 'a', reason: 'categorized' }],
        },
      },
    });
    await open(container);
    click(selectAutoBtn(container));
    click(applyBtn(container));
    await flush(3);
    expect(posts(m)).toHaveLength(1);
    const alert = container.querySelector('[role="alert"]')!.textContent!;
    expect(alert).toContain('vừa thay đổi');
    expect(alert).toContain('Bảng đã tải lại');
    expect(gets(m)).toHaveLength(2);
    expect(visibleIds(container)).toEqual(['b', 'c', 'd']);
    expect(checkbox(container, 'd').checked).toBe(true);
    expect(applyBtn(container).textContent).toBe('Áp dụng 1 sản phẩm');
  });

  it('lỗi khác (400): hiện lời máy chủ, không tải lại, giữ lựa chọn', async () => {
    const { m, container } = setup({
      apply: {
        status: 400,
        body: {
          message:
            'Danh mục không gán được (đã xoá hoặc đã có mục con): Cho bé. Tải lại danh sách.',
        },
      },
    });
    await open(container);
    click(selectAutoBtn(container));
    click(applyBtn(container));
    await flush();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('đã có mục con');
    expect(gets(m)).toHaveLength(1);
    expect(checkbox(container, 'a').checked).toBe(true);
  });

  it('bấm Áp dụng hai lần khi đang gửi chỉ gửi MỘT yêu cầu', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const { m, container } = setup({ holdApply: hold });
    await open(container);
    click(selectAutoBtn(container));
    const btn = applyBtn(container);
    click(btn);
    click(btn);
    await flush(2);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.textContent).toContain('Đang áp dụng');
    act(() => release());
    await flush();
    expect(posts(m)).toHaveLength(1);
  });

  it('lỗi tải danh sách: hiện lỗi kèm nút Thử lại', async () => {
    const { m, container } = setup({ listError: true });
    await open(container);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    click(byText(container, 'button', 'Thử lại')!);
    await flush();
    expect(gets(m)).toHaveLength(2);
  });

  it('không còn sản phẩm nào thiếu danh mục: báo rõ, không hiện nút áp dụng', async () => {
    const { container } = setup({ lists: [[]] });
    await open(container);
    expect(container.textContent).toContain('Mọi sản phẩm đều đã có danh mục');
    expect(byText(container, 'button', 'Áp dụng')).toBeFalsy();
  });

  it('chạm 44px: nút, ô tìm, dòng mở sửa danh mục giữ min-h 44px ở mọi cỡ màn; ô chọn nằm trong nhãn 44x44', async () => {
    const { container } = setup();
    await open(container);
    const controls = [
      ...Array.from(container.querySelectorAll<HTMLElement>('button')),
      ...Array.from(container.querySelectorAll<HTMLElement>('input[type="search"], summary')),
    ];
    expect(controls.length).toBeGreaterThan(10);
    for (const el of controls) {
      expect(el.className, el.outerHTML.slice(0, 80)).toContain('min-h-[44px]');
      expect(el.className, el.outerHTML.slice(0, 80)).not.toMatch(/sm:min-h-\[36px\]/);
    }
    const label = checkbox(container, 'a').closest('label')!;
    expect(label.className).toContain('min-w-[44px]');
  });

  it('tên dài không làm tràn ngang (min-w-0, break-words)', async () => {
    const long = row('x', {
      name: 'Tên sản phẩm rất dài '.repeat(10),
      brand: 'ThươngHiệuKhôngDấuCáchRấtDàiThươngHiệuKhôngDấuCáchRấtDài',
    });
    const { container } = setup({ lists: [[long]] });
    await open(container);
    const r = rowEl(container, 'x')!;
    expect(r.className).toContain('min-w-0');
    expect(r.querySelectorAll('.break-words').length).toBeGreaterThanOrEqual(3);
  });
});
