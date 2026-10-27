import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import * as w from './waste';
import type { HttpClient } from '../http';

const lines = [{ itemId: 'item-carton', declaredQty: 5 }];
const key = { headers: { 'Idempotency-Key': 'key-1' } };

describe('waste — đúng route, body, header (bảng của spec Mini App)', () => {
  it.each([
    ['getWasteMe', (h: HttpClient) => w.getWasteMe(h), { method: 'get', path: '/waste/me' }],
    ['getWasteCatalogue', (h: HttpClient) => w.getWasteCatalogue(h), { method: 'get', path: '/waste/catalogue' }],
    ['getWasteItems', (h: HttpClient) => w.getWasteItems(h), { method: 'get', path: '/waste/items' }],
    ['getWastePoints()', (h: HttpClient) => w.getWastePoints(h), { method: 'get', path: '/waste/points', opts: { query: {} } }],
    ['getWastePoints(79)', (h: HttpClient) => w.getWastePoints(h, '79'), { method: 'get', path: '/waste/points', opts: { query: { provinceCode: '79' } } }],
    ['getNearbyWastePoints', (h: HttpClient) => w.getNearbyWastePoints(h, { locationToken: 'loc', zaloAccessToken: 'acc' }), { method: 'post', path: '/waste/points/nearby', body: { locationToken: 'loc', zaloAccessToken: 'acc' } }],
    ['previewWaste', (h: HttpClient) => w.previewWaste(h, { lines, method: 'MAIL_IN' }), { method: 'post', path: '/waste/preview', body: { lines, method: 'MAIL_IN' } }],
    ['createWasteRequest', (h: HttpClient) => w.createWasteRequest(h, { method: 'DROP_OFF', lines, pointId: 'pt-1', consent: true }, 'key-1'), { method: 'post', path: '/waste/requests', body: { method: 'DROP_OFF', lines, pointId: 'pt-1', consent: true }, opts: key }],
    ['editWasteRequest', (h: HttpClient) => w.editWasteRequest(h, 'r/1', { lines }), { method: 'patch', path: '/waste/requests/r%2F1', body: { lines } }],
    ['setWasteTracking', (h: HttpClient) => w.setWasteTracking(h, 'req-1', { carrier: 'GHN', trackingCode: 'GHN123' }), { method: 'put', path: '/waste/requests/req-1/tracking', body: { carrier: 'GHN', trackingCode: 'GHN123' } }],
    ['cancelWasteRequest', (h: HttpClient) => w.cancelWasteRequest(h, 'req-1'), { method: 'post', path: '/waste/requests/req-1/cancel' }],
    ['listWasteRequests', (h: HttpClient) => w.listWasteRequests(h), { method: 'get', path: '/waste/requests' }],
    ['getWasteRequest', (h: HttpClient) => w.getWasteRequest(h, 'req-1'), { method: 'get', path: '/waste/requests/req-1' }],
    ['getWasteRequestByOrder', (h: HttpClient) => w.getWasteRequestByOrder(h, 'ord-1'), { method: 'get', path: '/waste/requests/by-order/ord-1' }],
    ['getWasteRules', (h: HttpClient) => w.getWasteRules(h), { method: 'get', path: '/waste/rules' }],
    ['getDeskPoints', (h: HttpClient) => w.getDeskPoints(h), { method: 'get', path: '/waste/desk/points' }],
    ['deskLookup', (h: HttpClient) => w.deskLookup(h, '  TR-8K2M9 '), { method: 'post', path: '/waste/desk/lookup', body: { code: 'TR-8K2M9' } }],
    ['deskConfirm', (h: HttpClient) => w.deskConfirm(h, 'req-1', { lines: [{ itemId: 'item-carton', declaredQty: 5, receivedQty: 5 }] }), { method: 'post', path: '/waste/desk/requests/req-1/confirm', body: { lines: [{ itemId: 'item-carton', declaredQty: 5, receivedQty: 5 }] } }],
    ['deskReject', (h: HttpClient) => w.deskReject(h, 'req-1', { rejectionReason: 'WET' }), { method: 'post', path: '/waste/desk/requests/req-1/reject', body: { rejectionReason: 'WET' } }],
    ['deskFulfilGift', (h: HttpClient) => w.deskFulfilGift(h, { code: 'QG-8K2M9P4T', pointId: 'wh-1' }), { method: 'post', path: '/waste/desk/gifts/fulfil', body: { code: 'QG-8K2M9P4T', pointId: 'wh-1' } }],
    ['getDeskPointReport', (h: HttpClient) => w.getDeskPointReport(h, 'pt-1', '2026-10'), { method: 'get', path: '/waste/desk/points/pt-1/report', opts: { query: { month: '2026-10' } } }],
    ['submitDeskPerk', (h: HttpClient) => w.submitDeskPerk(h, 'pt-1', { perkText: 'Giảm 10%' }), { method: 'put', path: '/waste/desk/points/pt-1/perk', body: { perkText: 'Giảm 10%' } }],
  ] as const)('%s', async (_n, call, expected) => {
    const { http, calls } = fakeHttp();
    await call(http);
    expect(calls).toEqual([expected]);
  });

  it('khoá query giữ đúng hình của Mini App', () => {
    expect(w.WASTE_QUERY_KEYS.all).toEqual(['waste']);
    expect(w.WASTE_QUERY_KEYS.me).toEqual(['waste', 'me']);
    expect(w.WASTE_QUERY_KEYS.items).toEqual(['waste', 'items']);
    expect(w.WASTE_QUERY_KEYS.points(null)).toEqual(['waste', 'points', null]);
    expect(w.WASTE_QUERY_KEYS.requests).toEqual(['waste', 'requests']);
    expect(w.WASTE_QUERY_KEYS.request('r1')).toEqual(['waste', 'request', 'r1']);
    expect(w.WASTE_QUERY_KEYS.desk).toEqual(['waste', 'desk']);
    expect(w.WASTE_QUERY_KEYS.rewards).toEqual(['loyalty-rewards']);
    expect(w.WASTE_QUERY_KEYS.rewardsMine).toEqual(['loyalty-rewards', 'mine']);
  });

  it('token vị trí chỉ nằm trong body, không bao giờ trên URL', async () => {
    const { http, calls } = fakeHttp();
    await w.getNearbyWastePoints(http, { provinceCode: '79', locationToken: 'secret-loc', zaloAccessToken: 'secret-acc' });
    expect(calls[0]!.path).not.toMatch(/secret/);
  });
});

describe('waste — tập khoá phải làm mới sau khi ghi', () => {
  it('ghi đổi rác làm mới waste, loyalty, points-txn, game', () => {
    expect(w.WASTE_WRITE_INVALIDATE_KEYS).toEqual([['waste'], ['loyalty'], ['points-txn'], ['game']]);
  });
  it('đổi quà làm mới thêm loyalty-rewards và coupons', () => {
    expect(w.WASTE_REDEEM_INVALIDATE_KEYS).toEqual([
      ['waste'], ['loyalty'], ['points-txn'], ['game'], ['loyalty-rewards'], ['coupons'],
    ]);
  });
});
