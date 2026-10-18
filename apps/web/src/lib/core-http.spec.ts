import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('./client-api', () => ({ apiFetch }));
import { coreHttp } from './core-http';

beforeEach(() => apiFetch.mockReset().mockResolvedValue('DATA'));

describe('core-http (web client) — bọc apiFetch', () => {
  it('get không opts: đường dẫn nguyên, method GET, không body, không headers', async () => {
    await expect(coreHttp.get('/waste/me')).resolves.toBe('DATA');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith('/waste/me', { method: 'GET' });
  });

  it('get có query: dựng chuỗi, bỏ null/undefined', async () => {
    await coreHttp.get('/waste/points', { query: { provinceCode: '79', x: null, y: undefined, page: 2 } });
    expect(apiFetch).toHaveBeenCalledWith('/waste/points?provinceCode=79&page=2', { method: 'GET' });
  });

  it('get có query toàn rỗng thì không để lại dấu ?', async () => {
    await coreHttp.get('/waste/points', { query: { provinceCode: undefined } });
    expect(apiFetch).toHaveBeenCalledWith('/waste/points', { method: 'GET' });
  });

  it('get chuyển headers', async () => {
    await coreHttp.get('/x', { headers: { 'X-A': '1' } });
    expect(apiFetch).toHaveBeenCalledWith('/x', { method: 'GET', headers: { 'X-A': '1' } });
  });

  it('delete dựng query như get', async () => {
    await coreHttp.delete('/cart/items/i1', { query: { storefront: 's' } });
    expect(apiFetch).toHaveBeenCalledWith('/cart/items/i1?storefront=s', { method: 'DELETE' });
  });

  it.each([
    ['post', 'POST'],
    ['put', 'PUT'],
    ['patch', 'PATCH'],
  ] as const)('%s gửi body và Idempotency-Key nguyên vẹn', async (verb, method) => {
    const body = { lines: [{ itemId: 'a', declaredQty: 5 }] };
    await expect(coreHttp[verb]('/waste/requests', body, { headers: { 'Idempotency-Key': 'key-1' } })).resolves.toBe('DATA');
    expect(apiFetch).toHaveBeenCalledWith('/waste/requests', { method, body, headers: { 'Idempotency-Key': 'key-1' } });
  });

  it('post không body: không có khoá body (apiFetch không đặt Content-Type)', async () => {
    await coreHttp.post('/waste/requests/r1/cancel');
    expect(apiFetch).toHaveBeenCalledWith('/waste/requests/r1/cancel', { method: 'POST' });
  });

  it('post có query dựng vào đường dẫn', async () => {
    await coreHttp.post('/x', { a: 1 }, { query: { k: 'v', n: null } });
    expect(apiFetch).toHaveBeenCalledWith('/x?k=v', { method: 'POST', body: { a: 1 } });
  });

  it('lỗi của apiFetch (ApiError/NetworkError) đi thẳng ra ngoài, không bọc', async () => {
    const err = new Error('boom');
    apiFetch.mockRejectedValueOnce(err);
    await expect(coreHttp.get('/x')).rejects.toBe(err);
  });

  it('chuỗi query không mã hoá được trả về promise bị từ chối, không ném đồng bộ', async () => {
    const pending = coreHttp.get('/search', { query: { q: '\uD83D' } });
    await expect(pending).rejects.toThrow(URIError);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
