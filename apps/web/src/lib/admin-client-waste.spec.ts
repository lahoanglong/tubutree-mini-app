// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '@/test-utils/dom';

vi.mock('./client-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client-api')>()),
  apiDownload: vi.fn(async () => ({ filename: 'doi-rac-2026-10.csv', bytes: 1 })),
}));
import * as A from './admin-client';
import { apiDownload } from './client-api';

afterEach(() => vi.unstubAllGlobals());

type Row = [name: string, call: () => Promise<unknown>, method: string, path: string, body: unknown];
const ITEM = { code: 'CARTON', name: 'Thùng carton cũ', unitLabel: 'thùng', unitsPerPoint: 1, pointsPerGroup: 1000, monthlyCapQty: 60 };
const POINT = { kind: 'PARTNER' as const, name: 'Tạp hoá Cô Ba', addressLine: '12 Lê Lợi', provinceCode: '84_VN79', provinceName: 'TP. Hồ Chí Minh', communeCode: '84_VN79_26734', communeName: 'Phường Bến Thành', monthlyQuotaPoints: 100_000 };
const ROWS: Row[] = [
  ['getWasteOverview', () => A.getWasteOverview(), 'GET', '/admin/waste/overview', undefined],
  ['listWasteItems', () => A.listWasteItems(), 'GET', '/admin/waste/items', undefined],
  ['createWasteItem', () => A.createWasteItem(ITEM), 'POST', '/admin/waste/items', ITEM],
  ['updateWasteItem', () => A.updateWasteItem('i1', { status: 'COMING_SOON' }), 'PATCH', '/admin/waste/items/i1', { status: 'COMING_SOON' }],
  ['reorderWasteItems', () => A.reorderWasteItems(['i2', 'i1']), 'PUT', '/admin/waste/items/order', { ids: ['i2', 'i1'] }],
  ['listWastePoints()', () => A.listWastePoints(), 'GET', '/admin/waste/points', undefined],
  ['listWastePoints(filters)', () => A.listWastePoints({ status: 'PENDING', perkPending: true }), 'GET', '/admin/waste/points?status=PENDING&perkPending=true', undefined],
  ['getWastePointReport', () => A.getWastePointReport('p1', '2026-10'), 'GET', '/admin/waste/points/p1/report?month=2026-10', undefined],
  ['createWastePoint', () => A.createWastePoint(POINT), 'POST', '/admin/waste/points', POINT],
  ['updateWastePoint', () => A.updateWastePoint('p1', { monthlyQuotaPoints: 300_000 }), 'PATCH', '/admin/waste/points/p1', { monthlyQuotaPoints: 300_000 }],
  ['reorderWastePoints', () => A.reorderWastePoints(['p2', 'p1']), 'PUT', '/admin/waste/points/order', { ids: ['p2', 'p1'] }],
  ['addWastePointStaff', () => A.addWastePointStaff('p1', { userId: 'u9', role: 'OWNER' }), 'POST', '/admin/waste/points/p1/staff', { userId: 'u9', role: 'OWNER' }],
  ['removeWastePointStaff', () => A.removeWastePointStaff('p1', 'u9'), 'DELETE', '/admin/waste/points/p1/staff/u9', undefined],
  ['approveWastePerk', () => A.approveWastePerk('p1', 'Giảm 10%'), 'POST', '/admin/waste/points/p1/perk/approve', { expectedPendingText: 'Giảm 10%' }],
  ['rejectWastePerk', () => A.rejectWastePerk('p1', 'Giảm 10%'), 'POST', '/admin/waste/points/p1/perk/reject', { expectedPendingText: 'Giảm 10%' }],
  ['listWasteRequests()', () => A.listWasteRequests(), 'GET', '/admin/waste/requests', undefined],
  ['listWasteRequests(filters)', () => A.listWasteRequests({ method: 'MAIL_IN', filter: 'TO_COUNT', limit: 50 }), 'GET', '/admin/waste/requests?method=MAIL_IN&filter=TO_COUNT&limit=50', undefined],
  ['listWasteRequests(credit log)', () => A.listWasteRequests({ status: 'COMPLETED', pointId: 'p1', cursor: 'c2' }), 'GET', '/admin/waste/requests?status=COMPLETED&pointId=p1&cursor=c2', undefined],
  ['lookupWasteRequests', () => A.lookupWasteRequests('TR-7K3M9Q'), 'GET', '/admin/waste/requests/lookup?code=TR-7K3M9Q', undefined],
  ['getWasteRequest', () => A.getWasteRequest('r1'), 'GET', '/admin/waste/requests/r1', undefined],
  ['receiveWasteRequest', () => A.receiveWasteRequest('r1', { match: { parcelCode: 'TR-7K3M9Q' }, receivedWeightGrams: 1200 }), 'POST', '/admin/waste/requests/r1/receive', { match: { parcelCode: 'TR-7K3M9Q' }, receivedWeightGrams: 1200 }],
  ['confirmWasteRequest', () => A.confirmWasteRequest('r1', { lines: [{ itemId: 'i1', declaredQty: 10, receivedQty: 8, shortfallReason: 'WET' }], receivedWeightGrams: 2500 }), 'POST', '/admin/waste/requests/r1/confirm', { lines: [{ itemId: 'i1', declaredQty: 10, receivedQty: 8, shortfallReason: 'WET' }], receivedWeightGrams: 2500 }],
  ['rejectWasteRequest', () => A.rejectWasteRequest('r1', { rejectionReason: 'OTHER', rejectionNote: 'Lẫn đá' }), 'POST', '/admin/waste/requests/r1/reject', { rejectionReason: 'OTHER', rejectionNote: 'Lẫn đá' }],
  ['reverseWasteRequest', () => A.reverseWasteRequest('r1', { reason: 'Khai khống' }), 'POST', '/admin/waste/requests/r1/reverse', { reason: 'Khai khống' }],
  ['setWasteRequestCost', () => A.setWasteRequestCost('r1', { carrierCostVnd: 32000 }), 'PATCH', '/admin/waste/requests/r1/cost', { carrierCostVnd: 32000 }],
  ['closeLostWasteRequest', () => A.closeLostWasteRequest('r1', { reason: 'Hãng báo thất lạc' }), 'POST', '/admin/waste/requests/r1/close-lost', { reason: 'Hãng báo thất lạc' }],
  ['reopenWasteRequest', () => A.reopenWasteRequest('r1', { reason: 'Kiện về muộn', unmatchedId: 'un1' }), 'POST', '/admin/waste/requests/r1/reopen', { reason: 'Kiện về muộn', unmatchedId: 'un1' }],
  ['listWasteUnmatched()', () => A.listWasteUnmatched(), 'GET', '/admin/waste/unmatched', undefined],
  ['listWasteUnmatched(RESOLVED)', () => A.listWasteUnmatched('RESOLVED'), 'GET', '/admin/waste/unmatched?status=RESOLVED', undefined],
  ['createWasteUnmatched', () => A.createWasteUnmatched({ carrier: 'GHN', trackingCode: 'GHN123', description: 'Thùng carton, băng keo xanh' }), 'POST', '/admin/waste/unmatched', { carrier: 'GHN', trackingCode: 'GHN123', description: 'Thùng carton, băng keo xanh' }],
  ['resolveWasteUnmatched', () => A.resolveWasteUnmatched('un1', { action: 'MATCH', requestId: 'r1', note: 'Khớp mã TR trên kiện' }), 'POST', '/admin/waste/unmatched/un1/resolve', { action: 'MATCH', requestId: 'r1', note: 'Khớp mã TR trên kiện' }],
  ['getWasteUserFlags', () => A.getWasteUserFlags('u1'), 'GET', '/admin/waste/users/u1/flags', undefined],
  ['setWasteUserFlags', () => A.setWasteUserFlags('u1', { blocked: true, reason: 'Gian lận' }), 'PUT', '/admin/waste/users/u1/flags', { blocked: true, reason: 'Gian lận' }],
  ['listWasteGifts', () => A.listWasteGifts(), 'GET', '/admin/waste/gifts', undefined],
  ['createWasteGift', () => A.createWasteGift({ kind: 'GIFT', name: 'Bình nước Tubu', pointsCost: 120_000, stock: 30 }), 'POST', '/admin/waste/gifts', { kind: 'GIFT', name: 'Bình nước Tubu', pointsCost: 120_000, stock: 30 }],
  ['updateWasteGift', () => A.updateWasteGift('gift-1', { status: 'HIDDEN' }), 'PATCH', '/admin/waste/gifts/gift-1', { status: 'HIDDEN' }],
  ['reorderWasteGifts', () => A.reorderWasteGifts(['gift-2', 'gift-1']), 'PUT', '/admin/waste/gifts/order', { ids: ['gift-2', 'gift-1'] }],
  ['listGiftRedemptions()', () => A.listGiftRedemptions(), 'GET', '/admin/waste/gift-redemptions', undefined],
  ['listGiftRedemptions(filters)', () => A.listGiftRedemptions({ status: 'READY', overdue: true }), 'GET', '/admin/waste/gift-redemptions?status=READY&overdue=true', undefined],
  ['fulfilGiftRedemption', () => A.fulfilGiftRedemption('gr1', 'QG-AB12CD'), 'POST', '/admin/waste/gift-redemptions/gr1/fulfil', { code: 'QG-AB12CD' }],
  ['cancelGiftRedemption', () => A.cancelGiftRedemption('gr1', { reason: 'Hết hàng', refundPoints: true }), 'POST', '/admin/waste/gift-redemptions/gr1/cancel', { reason: 'Hết hàng', refundPoints: true }],
];

describe('admin-client — hàm Đổi rác gọi đúng route admin (registry 4.11, 5)', () => {
  it.each(ROWS)('%s', async (_name, call, method, path, body) => {
    const api = mockFetch({ '/admin/waste': { body: {} } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    await call();
    expect(api.calls).toHaveLength(1);
    const c = api.calls[0]!;
    expect(c.url.endsWith(path)).toBe(true);
    expect(c.init?.method ?? 'GET').toBe(method);
    expect(c.init?.body === undefined ? undefined : JSON.parse(String(c.init.body))).toEqual(body);
  });

  it('listWastePoints({ perkPending: false }) không gửi tham số rỗng', async () => {
    const api = mockFetch({ '/admin/waste': { body: [] } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    await A.listWastePoints({ perkPending: false });
    expect(api.calls[0]!.url.endsWith('/admin/waste/points')).toBe(true);
  });

  it('lookupWasteRequests mã hoá ký tự đặc biệt', async () => {
    const api = mockFetch({ '/admin/waste': { body: [] } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    await A.lookupWasteRequests('GHN 12/3');
    expect(api.calls[0]!.url.endsWith('/admin/waste/requests/lookup?code=GHN%2012%2F3')).toBe(true);
  });

  it('id có ký tự đặc biệt được mã hoá trong đường dẫn', async () => {
    const api = mockFetch({ '/admin/waste': { body: {} } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    await A.getWasteRequest('a/b c');
    expect(api.calls[0]!.url.endsWith('/admin/waste/requests/a%2Fb%20c')).toBe(true);
  });

  it('downloadWasteMonthlyCsv tải CSV tháng với tên mặc định doi-rac-<tháng>.csv', async () => {
    await A.downloadWasteMonthlyCsv('2026-10');
    expect(apiDownload).toHaveBeenCalledWith('/admin/waste/reports/monthly?month=2026-10', 'doi-rac-2026-10.csv');
  });
});
