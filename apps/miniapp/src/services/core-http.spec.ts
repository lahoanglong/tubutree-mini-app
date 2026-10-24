import { describe, it, expect, vi, beforeEach } from 'vitest';
const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('./api', () => ({ api: http }));
import { getSupportChatPage } from '@tubutree/app-core/api/support-chat';
import { coreHttp } from './core-http';

beforeEach(() => { for (const f of Object.values(http)) f.mockReset().mockResolvedValue({ data: 'DATA' }); });

// Mảng đối số phải trùng từng ký tự với cách service Mini App gọi api (xem waste-api.spec.ts, shop-api.spec.ts),
// để service chuyển sang app-core không làm spec cũ đỏ.
describe('core-http (Mini App) — chỉ chuyển tham số được truyền cho api', () => {
  it.each([
    ['get(path) → api.get(path) một đối số', () => coreHttp.get('/waste/me'), 'get', ['/waste/me']],
    ['get(path, {}) vẫn một đối số', () => coreHttp.get('/waste/me', {}), 'get', ['/waste/me']],
    ['get có query → params', () => coreHttp.get('/waste/points', { query: { provinceCode: '79' } }), 'get', ['/waste/points', { params: { provinceCode: '79' } }]],
    ['get query rỗng giữ { params: {} }', () => coreHttp.get('/waste/points', { query: {} }), 'get', ['/waste/points', { params: {} }]],
    ['get có headers', () => coreHttp.get('/x', { headers: { 'X-A': '1' } }), 'get', ['/x', { headers: { 'X-A': '1' } }]],
    ['get có query và headers', () => coreHttp.get('/x', { query: { a: 1 }, headers: { 'X-A': '1' } }), 'get', ['/x', { params: { a: 1 }, headers: { 'X-A': '1' } }]],
    ['delete(path) một đối số', () => coreHttp.delete('/x/1'), 'delete', ['/x/1']],
    ['delete có query', () => coreHttp.delete('/x/1', { query: { a: 'b' } }), 'delete', ['/x/1', { params: { a: 'b' } }]],
    ['post(path) không body: một đối số', () => coreHttp.post('/waste/requests/req-1/cancel'), 'post', ['/waste/requests/req-1/cancel']],
    ['post(path, body) hai đối số', () => coreHttp.post('/waste/preview', { method: 'MAIL_IN' }), 'post', ['/waste/preview', { method: 'MAIL_IN' }]],
    ['post có headers (Idempotency-Key)', () => coreHttp.post('/waste/requests', { consent: true }, { headers: { 'Idempotency-Key': 'key-1' } }), 'post', ['/waste/requests', { consent: true }, { headers: { 'Idempotency-Key': 'key-1' } }]],
    ['post có query', () => coreHttp.post('/x', { a: 1 }, { query: { k: 'v' } }), 'post', ['/x', { a: 1 }, { params: { k: 'v' } }]],
    ['post không body nhưng có headers: body undefined', () => coreHttp.post('/x', undefined, { headers: { 'X-A': '1' } }), 'post', ['/x', undefined, { headers: { 'X-A': '1' } }]],
    ['put(path, body)', () => coreHttp.put('/waste/requests/req-1/tracking', { carrier: 'GHN' }), 'put', ['/waste/requests/req-1/tracking', { carrier: 'GHN' }]],
    ['patch(path, body)', () => coreHttp.patch('/waste/requests/r%2F1', { lines: [] }), 'patch', ['/waste/requests/r%2F1', { lines: [] }]],
  ] as const)('%s', async (_n, call, verb, args) => {
    await expect(call()).resolves.toBe('DATA');
    expect(http[verb]).toHaveBeenCalledTimes(1);
    expect(http[verb]).toHaveBeenCalledWith(...args);
    expect(http[verb].mock.calls[0]).toHaveLength(args.length);
  });

  it('getSupportChatPage({ after: undefined }): params không có khoá after', async () => {
    await getSupportChatPage(coreHttp, { after: undefined });
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(Object.keys(http.get.mock.calls[0]![1].params)).toEqual([]);
  });

  it('lỗi HttpError đi thẳng ra ngoài, không bọc', async () => {
    const err = new Error('boom');
    http.get.mockRejectedValueOnce(err);
    await expect(coreHttp.get('/x')).rejects.toBe(err);
  });
});
