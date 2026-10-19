import { describe, it, expect, vi, beforeEach } from 'vitest';
const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() }));
vi.mock('./api', () => ({ api: http }));
import * as w from './waste-api';

beforeEach(() => { for (const f of Object.values(http)) f.mockReset().mockResolvedValue({ data: 'DATA' }); });

describe('waste-api — đúng route, body, header (registry §5)', () => {
  const lines = [{ itemId: 'item-carton', declaredQty: 5 }];
  it.each([
    ['getWasteMe', () => w.getWasteMe(), 'get', ['/waste/me']],
    ['getWasteItems', () => w.getWasteItems(), 'get', ['/waste/items']],
    ['getWastePoints()', () => w.getWastePoints(), 'get', ['/waste/points', { params: {} }]],
    ['getWastePoints(79)', () => w.getWastePoints('79'), 'get', ['/waste/points', { params: { provinceCode: '79' } }]],
    ['getNearbyWastePoints', () => w.getNearbyWastePoints({ locationToken: 'loc', zaloAccessToken: 'acc' }), 'post', ['/waste/points/nearby', { locationToken: 'loc', zaloAccessToken: 'acc' }]],
    ['previewWaste', () => w.previewWaste({ lines, method: 'MAIL_IN' }), 'post', ['/waste/preview', { lines, method: 'MAIL_IN' }]],
    ['createWasteRequest', () => w.createWasteRequest({ method: 'DROP_OFF', lines, pointId: 'pt-1', consent: true }, 'key-1'), 'post', ['/waste/requests', { method: 'DROP_OFF', lines, pointId: 'pt-1', consent: true }, { headers: { 'Idempotency-Key': 'key-1' } }]],
    ['editWasteRequest', () => w.editWasteRequest('r/1', { lines }), 'patch', ['/waste/requests/r%2F1', { lines }]],
    ['setWasteTracking', () => w.setWasteTracking('req-1', { carrier: 'GHN', trackingCode: 'GHN123' }), 'put', ['/waste/requests/req-1/tracking', { carrier: 'GHN', trackingCode: 'GHN123' }]],
    ['cancelWasteRequest', () => w.cancelWasteRequest('req-1'), 'post', ['/waste/requests/req-1/cancel']],
    ['listWasteRequests', () => w.listWasteRequests(), 'get', ['/waste/requests']],
    ['getWasteRequest', () => w.getWasteRequest('req-1'), 'get', ['/waste/requests/req-1']],
    ['getWasteRequestByOrder', () => w.getWasteRequestByOrder('ord-1'), 'get', ['/waste/requests/by-order/ord-1']],
    ['getWasteRules', () => w.getWasteRules(), 'get', ['/waste/rules']],
    ['getDeskPoints', () => w.getDeskPoints(), 'get', ['/waste/desk/points']],
    ['deskLookup', () => w.deskLookup('  TR-8K2M9 '), 'post', ['/waste/desk/lookup', { code: 'TR-8K2M9' }]],
    ['deskConfirm', () => w.deskConfirm('req-1', { lines: [{ itemId: 'item-carton', declaredQty: 5, receivedQty: 5 }] }), 'post', ['/waste/desk/requests/req-1/confirm', { lines: [{ itemId: 'item-carton', declaredQty: 5, receivedQty: 5 }] }]],
    ['deskReject', () => w.deskReject('req-1', { rejectionReason: 'WET' }), 'post', ['/waste/desk/requests/req-1/reject', { rejectionReason: 'WET' }]],
    ['deskFulfilGift', () => w.deskFulfilGift({ code: 'QG-8K2M9P4T', pointId: 'wh-1' }), 'post', ['/waste/desk/gifts/fulfil', { code: 'QG-8K2M9P4T', pointId: 'wh-1' }]],
    ['getDeskPointReport', () => w.getDeskPointReport('pt-1', '2026-10'), 'get', ['/waste/desk/points/pt-1/report', { params: { month: '2026-10' } }]],
    ['submitDeskPerk', () => w.submitDeskPerk('pt-1', { perkText: 'Giảm 10%' }), 'put', ['/waste/desk/points/pt-1/perk', { perkText: 'Giảm 10%' }]],
  ] as const)('%s', async (_n, call, verb, args) => {
    await expect(call()).resolves.toBe('DATA');
    expect(http[verb]).toHaveBeenCalledTimes(1);
    expect(http[verb]).toHaveBeenCalledWith(...args);
  });

  it('token vị trí chỉ nằm trong body, không bao giờ trên URL (§16.1)', async () => {
    await w.getNearbyWastePoints({ provinceCode: '79', locationToken: 'secret-loc', zaloAccessToken: 'secret-acc' });
    expect(String(http.post.mock.calls[0]?.[0])).not.toMatch(/secret/);
  });
});

describe('invalidate helpers (§16.1: từng khoá một)', () => {
  it('invalidateAfterWasteWrite: waste, loyalty, points-txn, game', async () => {
    const qc = { invalidateQueries: vi.fn().mockResolvedValue(undefined) };
    await w.invalidateAfterWasteWrite(qc as never);
    expect(qc.invalidateQueries.mock.calls.map((c) => c[0].queryKey)).toEqual([['waste'], ['loyalty'], ['points-txn'], ['game']]);
  });
  it('invalidateAfterRedeem: thêm loyalty-rewards và coupons', async () => {
    const qc = { invalidateQueries: vi.fn().mockResolvedValue(undefined) };
    await w.invalidateAfterRedeem(qc as never);
    expect(qc.invalidateQueries.mock.calls.map((c) => c[0].queryKey)).toEqual([['waste'], ['loyalty'], ['points-txn'], ['game'], ['loyalty-rewards'], ['coupons']]);
  });
  it('query keys giữ đúng hình registry §4.11', () => {
    expect(w.WASTE_QUERY_KEYS.me).toEqual(['waste', 'me']);
    expect(w.WASTE_QUERY_KEYS.items).toEqual(['waste', 'items']);
    expect(w.WASTE_QUERY_KEYS.points('79')).toEqual(['waste', 'points', '79']);
    expect(w.WASTE_QUERY_KEYS.points(null)).toEqual(['waste', 'points', null]);
    expect(w.WASTE_QUERY_KEYS.requests).toEqual(['waste', 'requests']);
    expect(w.WASTE_QUERY_KEYS.request('req-1')).toEqual(['waste', 'request', 'req-1']);
    expect(w.WASTE_QUERY_KEYS.desk).toEqual(['waste', 'desk']);
    expect(w.WASTE_QUERY_KEYS.rewards).toEqual(['loyalty-rewards']);
    expect(w.WASTE_QUERY_KEYS.rewardsMine).toEqual(['loyalty-rewards', 'mine']);
  });
});
