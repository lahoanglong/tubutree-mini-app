// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import { SearchTermsCard } from './search-terms-card';
import { parsePopularTerms, popularTermsError, type SearchSynonym } from './search-terms-api';

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

const mount = async (items: SearchSynonym[], popular: unknown = ['nước giặt', 'rửa tay']) => {
  const m = mockFetch({
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
    const items = c.querySelectorAll('li');
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
