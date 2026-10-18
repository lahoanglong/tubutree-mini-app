import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { fetchFaqs, fetchSupportContact, getPublicConfig } from './config';

describe('config — hợp đồng gọi API', () => {
  it('GET /config/public', async () => {
    const { http, calls } = fakeHttp();
    await getPublicConfig(http);
    expect(calls).toEqual([{ method: 'get', path: '/config/public' }]);
  });

  it('fetchFaqs: GET /faqs, danh mục rỗng/null/khoảng trắng ra Chung', async () => {
    const { http, calls } = fakeHttp(() => ({
      data: [
        { id: '1', category: null, question: 'q1', answer: 'a1' },
        { id: '2', category: '  ', question: 'q2', answer: 'a2' },
        { id: '3', category: ' Đổi trả ', question: 'q3', answer: 'a3' },
      ],
    }));
    const out = await fetchFaqs(http);
    expect(calls).toEqual([{ method: 'get', path: '/faqs' }]);
    expect(out).toEqual([
      { q: 'q1', a: 'a1', cat: 'Chung' },
      { q: 'q2', a: 'a2', cat: 'Chung' },
      { q: 'q3', a: 'a3', cat: 'Đổi trả' },
    ]);
  });

  it('fetchSupportContact: cắt khoảng trắng, rỗng hoặc sai kiểu ra null', async () => {
    const { http } = fakeHttp(() => ({ support: { hotline: ' 0900 ', email: '', zaloOaName: 5 } }));
    expect(await fetchSupportContact(http)).toEqual({ hotline: '0900', email: null, zaloOaName: null });
  });
});
