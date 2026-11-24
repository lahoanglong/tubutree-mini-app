// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import { SearchTermsCard } from './search-terms-card';
import { parsePopularTerms, popularTermsError, type SearchSynonym, type ZeroResultTerm } from './search-terms-api';

const row = (over: Partial<SearchSynonym> = {}): SearchSynonym => ({
  id: 's1',
  term: 'nuoc rua bat',
  canonical: 'nuoc rua chen',
  isActive: true,
  updatedAt: '2026-11-18T01:00:00.000Z',
  ...over,
});

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const zeroRow = (over: Partial<ZeroResultTerm> = {}): ZeroResultTerm => ({
  term: 'nước tẩy bồn cầu',
  count: 12,
  people: 7,
  lastSeenAt: '2026-11-22T03:00:00.000Z',
  synonym: null,
  suggestions: [],
  ...over,
});

const mount = async (
  items: SearchSynonym[],
  popular: unknown = ['nước giặt', 'rửa tay'],
  zero: { status?: number; body: unknown } = { body: { days: 14, items: [] } },
) => {
  const m = mockFetch({
    // Trước '/admin/search-synonyms': mockFetch lấy khoá đầu tiên nằm trong URL.
    '/admin/search-synonyms/zero-results': zero,
    '/admin/search-synonyms/s1': (init) => ({ body: init?.method === 'DELETE' ? { ok: true } : row({ isActive: false }) }),
    '/admin/search-synonyms': (init) => ({ body: init?.method === 'POST' ? row({ id: 's9', term: 'xa phong', canonical: 'xa bong' }) : { items } }),
    '/admin/config': (init) => ({ body: init?.method === 'PUT' ? { ok: true } : [{ key: 'catalog.search_popular_terms', value: popular }, { key: 'catalog.other', value: 1 }] }),
  });
  vi.stubGlobal('fetch', m.fn);
  const r = render(<SearchTermsCard />);
  mounted.push(r);
  await flush(8);
  return { c: r.container, calls: m.calls };
};
const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body ?? 'null'));
const submit = (form: HTMLFormElement) =>
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

describe('SearchTermsCard', () => {
  it('liệt kê từ đồng nghĩa, dòng tắt có nhãn "Đang tắt"; ô cụm phổ biến điền sẵn mỗi dòng một cụm, nút Lưu khoá khi chưa sửa', async () => {
    const { c, calls } = await mount([row(), row({ id: 's2', term: 'bot giat', canonical: 'nuoc giat', isActive: false })]);
    expect(calls.some((x) => x.url.includes('/admin/config?category=catalog'))).toBe(true);
    const items = c.querySelectorAll('ul[aria-label="Từ đồng nghĩa"] li');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('nuoc rua bat → nuoc rua chen');
    expect(items[1]!.textContent).toContain('Đang tắt');
    expect(c.querySelector('textarea')!.value).toBe('nước giặt\nrửa tay');
    expect(byText(c, 'button', 'Lưu cụm phổ biến')!.hasAttribute('disabled')).toBe(true);
    for (const input of c.querySelectorAll<HTMLInputElement>('input')) expect(input.maxLength).toBe(60);
  });

  it('thêm: POST đúng hai vế đã cắt khoảng trắng, xong thì xoá ô và tải lại danh sách', async () => {
    const { c, calls } = await mount([]);
    expect(c.textContent).toContain('Chưa có từ đồng nghĩa nào.');
    typeInto(c.querySelector('input[name="term"]'), '  xà phòng ');
    typeInto(c.querySelector('input[name="canonical"]'), 'xà bông');
    submit(c.querySelector('form')!);
    await flush(6);
    const post = calls.find((x) => x.init?.method === 'POST')!;
    expect(post.url).toContain('/admin/search-synonyms');
    expect(bodyOf(post.init)).toEqual({ term: 'xà phòng', canonical: 'xà bông' });
    expect(c.querySelector<HTMLInputElement>('input[name="term"]')!.value).toBe('');
    expect(calls.filter((x) => x.url.endsWith('/admin/search-synonyms') && (x.init?.method ?? 'GET') === 'GET')).toHaveLength(2);
  });

  it('Tắt gửi PATCH isActive=false; Xoá hỏi xác nhận rồi mới gửi DELETE', async () => {
    const { c, calls } = await mount([row()]);
    click(byText(c, 'button', 'Tắt'));
    await flush(6);
    const patch = calls.find((x) => x.init?.method === 'PATCH')!;
    expect(patch.url).toContain('/admin/search-synonyms/s1');
    expect(bodyOf(patch.init)).toEqual({ isActive: false });
    click(byText(c, 'button', 'Xoá'));
    await flush(2);
    answerConfirm(false);
    await flush(2);
    expect(calls.some((x) => x.init?.method === 'DELETE')).toBe(false);
    click(byText(c, 'button', 'Xoá'));
    await flush(2);
    answerConfirm(true);
    await flush(6);
    expect(calls.filter((x) => x.init?.method === 'DELETE').map((x) => x.url)).toEqual([expect.stringContaining('/admin/search-synonyms/s1')]);
  });

  it('cụm phổ biến: quá 12 cụm thì báo lỗi và khoá Lưu; hợp lệ thì PUT /admin/config với danh sách đã gọn', async () => {
    const { c, calls } = await mount([]);
    const area = c.querySelector('textarea')!;
    typeInto(area, Array.from({ length: 13 }, (_, i) => `cum ${i + 1}`).join('\n'));
    expect(c.textContent).toContain('Tối đa 12 cụm (đang có 13).');
    expect(area.getAttribute('aria-invalid')).toBe('true');
    expect(byText(c, 'button', 'Lưu cụm phổ biến')!.hasAttribute('disabled')).toBe(true);
    typeInto(area, ' nước  giặt \n\nrửa tay\nnước giặt\ncho bé');
    submit(c.querySelectorAll('form')[1]!);
    await flush(6);
    const put = calls.find((x) => x.init?.method === 'PUT')!;
    expect(put.url).toContain('/admin/config');
    expect(bodyOf(put.init)).toEqual({ key: 'catalog.search_popular_terms', value: ['nước giặt', 'rửa tay', 'cho bé'] });
  });

  it('từ khoá tìm chưa ra: gọi đúng 14 ngày, bày lượt/người/ngày; cụm đã có từ đồng nghĩa ghi "Đã có" thay cho nút', async () => {
    const { c, calls } = await mount([], undefined, {
      body: { days: 14, items: [zeroRow(), zeroRow({ term: 'nuoc rua bat', count: 3, people: 2, synonym: { canonical: 'nuoc rua chen', isActive: false } }), { count: 1 }] },
    });
    expect(calls.some((x) => x.url.includes('/admin/search-synonyms/zero-results?days=14'))).toBe(true);
    expect(c.textContent).toContain('Từ khoá tìm chưa ra (14 ngày)');
    const rows = c.querySelectorAll('ul[aria-label="Từ khoá tìm chưa ra"] li');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('nước tẩy bồn cầu · 12 lượt · 7 người · gần nhất 22/11/2026');
    expect(rows[0]!.querySelector('button')!.textContent).toBe('Tạo từ đồng nghĩa');
    expect(rows[1]!.querySelector('button')).toBeNull();
    expect(rows[1]!.textContent).toContain('Đã có → nuoc rua chen (đang tắt)');
  });

  it('"Tạo từ đồng nghĩa" điền sẵn cụm khách gõ vào form, xoá vế thay cũ, đưa con trỏ vào ô Cụm tìm thay; Thêm gửi đúng cụm đó rồi tải lại bảng tìm chưa ra', async () => {
    const { c, calls } = await mount([], undefined, { body: { days: 14, items: [zeroRow()] } });
    typeInto(c.querySelector('input[name="canonical"]'), 'cụm cũ');
    click(byText(c, 'button', 'Tạo từ đồng nghĩa'));
    await flush(2);
    const term = c.querySelector<HTMLInputElement>('input[name="term"]')!;
    const canonical = c.querySelector<HTMLInputElement>('input[name="canonical"]')!;
    expect(term.value).toBe('nước tẩy bồn cầu');
    expect(canonical.value).toBe('');
    expect(document.activeElement).toBe(canonical);
    typeInto(canonical, 'tẩy rửa toilet');
    submit(c.querySelector('form')!);
    await flush(6);
    const post = calls.find((x) => x.init?.method === 'POST')!;
    expect(bodyOf(post.init)).toEqual({ term: 'nước tẩy bồn cầu', canonical: 'tẩy rửa toilet' });
    expect(calls.filter((x) => x.url.includes('/zero-results'))).toHaveLength(2);
  });

  it('gợi ý một chạm: mỗi cụm gợi ý là một nút; chạm là POST đúng cặp, không đụng form đang gõ, tải lại bảng; chạm đúp chỉ gửi một lần', async () => {
    const { c, calls } = await mount([], undefined, { body: { days: 14, items: [zeroRow({ suggestions: ['nước tẩy rửa', 'tẩy toilet'] })] } });
    const li = c.querySelector('ul[aria-label="Từ khoá tìm chưa ra"] li')!;
    expect(Array.from(li.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['→ nước tẩy rửa', '→ tẩy toilet', 'Tự gõ']);
    const chip = li.querySelector<HTMLButtonElement>(`button[aria-label='Tạo từ đồng nghĩa: "nước tẩy bồn cầu" tìm thêm "nước tẩy rửa"']`)!;
    expect(chip).not.toBeNull();
    typeInto(c.querySelector('input[name="canonical"]'), 'đang gõ dở');
    click(chip);
    click(chip);
    await flush(8);
    const posts = calls.filter((x) => x.init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(bodyOf(posts[0]!.init)).toEqual({ term: 'nước tẩy bồn cầu', canonical: 'nước tẩy rửa' });
    expect(c.textContent).toContain('Đã thêm: "xa phong" → "xa bong".');
    expect(c.querySelector<HTMLInputElement>('input[name="canonical"]')!.value).toBe('đang gõ dở');
    expect(calls.filter((x) => x.url.includes('/zero-results'))).toHaveLength(2);
    expect(calls.filter((x) => x.url.endsWith('/admin/search-synonyms') && (x.init?.method ?? 'GET') === 'GET')).toHaveLength(2);
    // Khoá nhả sau khi bảng tải lại: chạm lần nữa vẫn gửi được.
    click(li.querySelector('button')!);
    await flush(8);
    expect(calls.filter((x) => x.init?.method === 'POST')).toHaveLength(2);
  });

  it('"Tự gõ" của dòng có gợi ý vẫn điền sẵn form; API cũ thiếu hay gửi hỏng suggestions thì chỉ có nút "Tạo từ đồng nghĩa"', async () => {
    const legacy = { term: 'xà bông cục', count: 2, people: 2, lastSeenAt: '2026-11-22T03:00:00.000Z', synonym: null };
    const { c } = await mount([], undefined, {
      body: { days: 14, items: [zeroRow({ suggestions: ['nước tẩy rửa'] }), legacy, { ...legacy, term: 'xà bông thơm', suggestions: 'hỏng' }, { ...legacy, term: 'bàn chải', suggestions: [1, ' ', null] }] },
    });
    const rows = c.querySelectorAll('ul[aria-label="Từ khoá tìm chưa ra"] li');
    expect(rows).toHaveLength(4);
    for (const r of Array.from(rows).slice(1)) {
      expect(Array.from(r.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Tạo từ đồng nghĩa']);
    }
    click(byText(rows[0]!, 'button', 'Tự gõ'));
    await flush(2);
    expect(c.querySelector<HTMLInputElement>('input[name="term"]')!.value).toBe('nước tẩy bồn cầu');
    expect(document.activeElement).toBe(c.querySelector('input[name="canonical"]'));
  });

  it('từ khoá tìm chưa ra lỗi hay rỗng: báo riêng ở khối đó, phần từ đồng nghĩa vẫn dùng được', async () => {
    const failed = await mount([row()], undefined, { status: 503, body: { message: 'bận' } });
    expect(failed.c.querySelector('[data-testid="zero-result-terms"]')!.textContent).toContain('Thử lại');
    expect(failed.c.querySelectorAll('ul[aria-label="Từ đồng nghĩa"] li')).toHaveLength(1);
    mounted.pop()!.unmount();
    const empty = await mount([]);
    expect(empty.c.textContent).toContain('14 ngày qua chưa có lượt tìm nào ra trống.');
  });

  it('cấu hình chưa có khoá hay không phải mảng: ô trống', async () => {
    const { c } = await mount([], 'hỏng');
    expect(c.querySelector('textarea')!.value).toBe('');
  });
});

describe('parsePopularTerms / popularTermsError', () => {
  it('mỗi dòng một cụm, gộp khoảng trắng, bỏ dòng trống và cụm trùng', () => {
    expect(parsePopularTerms(' a  b \n\n c\na b\n')).toEqual(['a b', 'c']);
  });

  it('chặn quá 12 cụm, cụm ngắn hơn 2 hay dài hơn 40 ký tự, email và số điện thoại', () => {
    expect(popularTermsError(['nước giặt', 'rửa tay'])).toBeNull();
    expect(popularTermsError(Array.from({ length: 13 }, (_, i) => `cum ${i}`))).toContain('Tối đa 12');
    expect(popularTermsError(['a'])).toContain('2 tới 40');
    expect(popularTermsError(['x'.repeat(41)])).toContain('2 tới 40');
    expect(popularTermsError(['a@b.vn'])).toContain('email');
    expect(popularTermsError(['0912 345 678'])).toContain('số điện thoại');
  });
});
