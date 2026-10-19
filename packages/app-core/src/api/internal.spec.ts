import { describe, expect, it } from 'vitest';
import { fakeHttp, type RecordedCall } from './fake-http';
import * as d from './dealer';
import * as s from './staff';
import * as sh from './shifts';
import * as at from './attendance';
import * as p from './payroll';
import * as bo from './brand-owner';
import type { HttpClient } from '../http';

const key = { headers: { 'Idempotency-Key': 'key-1' } };

describe('miền nội bộ — đúng route, query, body, Idempotency-Key', () => {
  it.each<[string, (h: HttpClient) => unknown, Partial<RecordedCall>]>([
    ['getDealerMe', (h) => d.getDealerMe(h), { method: 'get', path: '/dealer/me' }],
    ['applyDealer', (h) => d.applyDealer(h, { businessName: 'A' } as d.DealerApplyInput), { method: 'post', path: '/dealer/apply', body: { businessName: 'A' } }],
    ['getPricelist', (h) => d.getPricelist(h), { method: 'get', path: '/dealer/pricelist' }],
    [
      'placeDealerOrder(key)',
      (h) => d.placeDealerOrder(h, [{ variationId: 'v', quantity: 2 }], 'CREDIT', 'n', 'key-1'),
      { method: 'post', path: '/dealer/orders', body: { items: [{ variationId: 'v', quantity: 2 }], paymentMethod: 'CREDIT', note: 'n' }, opts: key },
    ],
    [
      'placeDealerOrder(không key)',
      (h) => d.placeDealerOrder(h, [], 'PREPAID'),
      { method: 'post', path: '/dealer/orders', body: { items: [], paymentMethod: 'PREPAID', note: undefined } },
    ],
    ['getDealerOrders', (h) => d.getDealerOrders(h), { method: 'get', path: '/dealer/orders' }],
    ['getCreditLedger', (h) => d.getCreditLedger(h), { method: 'get', path: '/dealer/credit-ledger' }],
    ['payCredit', (h) => d.payCredit(h, 500, 'key-1', 'ck'), { method: 'post', path: '/dealer/credit-payment', body: { amount: 500, note: 'ck' }, opts: key }],
    ['getQuarterlyReport', (h) => d.getQuarterlyReport(h), { method: 'get', path: '/dealer/quarterly-report' }],
    ['getDealerRewards', (h) => d.getDealerRewards(h), { method: 'get', path: '/dealer/rewards' }],
    [
      'claimDealerReward',
      (h) => d.claimDealerReward(h, 'r/1', 'Q3/2026', 'n'),
      { method: 'post', path: '/dealer/rewards/r%2F1/claim', body: { periodKey: 'Q3/2026', note: 'n' } },
    ],
    ['getTemplates', (h) => d.getTemplates(h), { method: 'get', path: '/dealer/templates' }],
    ['saveTemplate', (h) => d.saveTemplate(h, 'M', [{ variationId: 'v', quantity: 1 }]), { method: 'post', path: '/dealer/templates', body: { name: 'M', items: [{ variationId: 'v', quantity: 1 }] } }],
    ['deleteTemplate(dealer)', (h) => d.deleteTemplate(h, 't1'), { method: 'delete', path: '/dealer/templates/t1' }],

    ['listStaff', (h) => s.listStaff(h), { method: 'get', path: '/admin/staff' }],
    ['grantStaff', (h) => s.grantStaff(h, '0901234567', 'STAFF'), { method: 'post', path: '/admin/staff/grant', body: { phone: '0901234567', role: 'STAFF' } }],
    ['revokeStaff', (h) => s.revokeStaff(h, '0901234567'), { method: 'post', path: '/admin/staff/revoke', body: { phone: '0901234567' } }],

    ['getShiftTemplates', (h) => sh.getShiftTemplates(h), { method: 'get', path: '/staff/shift-templates' }],
    ['getShifts', (h) => sh.getShifts(h, 'a', 'b'), { method: 'get', path: '/staff/shifts', opts: { query: { from: 'a', to: 'b' } } }],
    ['createShifts', (h) => sh.createShifts(h, [{ workDate: '2026-10-19', startAt: 'a', endAt: 'b' }]), { method: 'post', path: '/staff/shifts', body: { items: [{ workDate: '2026-10-19', startAt: 'a', endAt: 'b' }] } }],
    ['updateShift', (h) => sh.updateShift(h, 's1', { startAt: 'a' }), { method: 'patch', path: '/staff/shifts/s1', body: { startAt: 'a' } }],
    ['deleteShift', (h) => sh.deleteShift(h, 's1'), { method: 'delete', path: '/staff/shifts/s1' }],
    ['copyWeek', (h) => sh.copyWeek(h, 'w1', 'w2'), { method: 'post', path: '/staff/shifts/copy-week', body: { sourceWeekStart: 'w1', targetWeekStart: 'w2' } }],
    ['cancelShift', (h) => sh.cancelShift(h, 's1', { reason: 'r', isEmergency: true }), { method: 'post', path: '/staff/shifts/s1/cancel', body: { reason: 'r', isEmergency: true } }],
    ['adminGetShifts', (h) => sh.adminGetShifts(h, 'a', 'b', 'u1'), { method: 'get', path: '/admin/shifts', opts: { query: { from: 'a', to: 'b', staffId: 'u1' } } }],
    ['approveShift', (h) => sh.approveShift(h, 's1', { approvedStart: 'a' }), { method: 'post', path: '/admin/shifts/s1/approve', body: { approvedStart: 'a' } }],
    ['approveShift()', (h) => sh.approveShift(h, 's1'), { method: 'post', path: '/admin/shifts/s1/approve', body: {} }],
    ['rejectShift', (h) => sh.rejectShift(h, 's1', 'r'), { method: 'post', path: '/admin/shifts/s1/reject', body: { reason: 'r' } }],
    ['bulkApproveShifts', (h) => sh.bulkApproveShifts(h, ['a', 'b']), { method: 'post', path: '/admin/shifts/bulk-approve', body: { ids: ['a', 'b'] } }],
    ['adminGetTemplates', (h) => sh.adminGetTemplates(h), { method: 'get', path: '/admin/shift-templates' }],
    ['createTemplate', (h) => sh.createTemplate(h, { name: 'Ca', startMin: 480, endMin: 720 }), { method: 'post', path: '/admin/shift-templates', body: { name: 'Ca', startMin: 480, endMin: 720 } }],
    ['deleteTemplate(ca)', (h) => sh.deleteTemplate(h, 't1'), { method: 'delete', path: '/admin/shift-templates/t1' }],

    ['getAttendanceStatus', (h) => at.getAttendanceStatus(h), { method: 'get', path: '/staff/attendance/status' }],
    ['checkin', (h) => at.checkin(h, { shiftId: 's1', lat: 1, lng: 2 }), { method: 'post', path: '/staff/attendance/checkin', body: { shiftId: 's1', lat: 1, lng: 2 } }],
    ['checkout()', (h) => at.checkout(h), { method: 'post', path: '/staff/attendance/checkout', body: {} }],
    ['checkout(at)', (h) => at.checkout(h, 'T'), { method: 'post', path: '/staff/attendance/checkout', body: { at: 'T' } }],
    ['heartbeat', (h) => at.heartbeat(h, { locationToken: 't' }), { method: 'post', path: '/staff/attendance/heartbeat', body: { locationToken: 't' } }],
    ['getHistory', (h) => at.getHistory(h, 'a', 'b'), { method: 'get', path: '/staff/attendance/history', opts: { query: { from: 'a', to: 'b' } } }],
    ['adminEditSession', (h) => at.adminEditSession(h, 'x1', { checkoutAt: 'c' }), { method: 'post', path: '/admin/attendance/session/x1/edit', body: { checkoutAt: 'c' } }],

    ['getMyPayroll', (h) => p.getMyPayroll(h, 2026, 9), { method: 'get', path: '/staff/payroll', opts: { query: { year: 2026, month: 9 } } }],
    ['updateBank', (h) => p.updateBank(h, { bankBin: '970' }), { method: 'put', path: '/staff/bank', body: { bankBin: '970' } }],
    ['adminGetPayroll', (h) => p.adminGetPayroll(h, 2026, 9), { method: 'get', path: '/admin/payroll', opts: { query: { year: 2026, month: 9 } } }],
    ['adminGetDetail', (h) => p.adminGetDetail(h, 'u1', 2026, 9), { method: 'get', path: '/admin/payroll/u1/detail', opts: { query: { year: 2026, month: 9 } } }],
    ['setRate', (h) => p.setRate(h, 'u1', 30000), { method: 'put', path: '/admin/staff/u1/rate', body: { hourlyRate: 30000 } }],
    ['finalizePayroll', (h) => p.finalizePayroll(h, 'u1', 2026, 9), { method: 'post', path: '/admin/payroll/u1/finalize', body: { year: 2026, month: 9 } }],
    ['reopenPayroll', (h) => p.reopenPayroll(h, 'u1', 2026, 9), { method: 'post', path: '/admin/payroll/u1/reopen?year=2026&month=9' }],
    ['markPaid', (h) => p.markPaid(h, 'u1', { year: 2026, month: 9, proofImageUrl: 'u', note: 'n' }), { method: 'post', path: '/admin/payroll/u1/mark-paid', body: { year: 2026, month: 9, proofImageUrl: 'u', note: 'n' } }],

    ['getOwnedBrand', (h) => bo.getOwnedBrand(h), { method: 'get', path: '/brand/owner/me' }],
    ['updateOwnedBrand', (h) => bo.updateOwnedBrand(h, { tagline: 't' }), { method: 'patch', path: '/brand/owner/me', body: { tagline: 't' } }],
    ['createOwnedPromotion', (h) => bo.createOwnedPromotion(h, { title: 'T', startAt: 'a', endAt: 'b' }), { method: 'post', path: '/brand/owner/me/promotions', body: { title: 'T', startAt: 'a', endAt: 'b' } }],
    ['updateOwnedPromotion', (h) => bo.updateOwnedPromotion(h, 'p1', { isActive: false }), { method: 'patch', path: '/brand/owner/me/promotions/p1', body: { isActive: false } }],
    ['deleteOwnedPromotion', (h) => bo.deleteOwnedPromotion(h, 'p1'), { method: 'delete', path: '/brand/owner/me/promotions/p1' }],
    ['getOwnedBrandSales', (h) => bo.getOwnedBrandSales(h, '30d'), { method: 'get', path: '/brand/owner/me/sales', opts: { query: { period: '30d' } } }],
  ])('%s', async (_name, call, expected) => {
    const { http, calls } = fakeHttp();
    await call(http);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expected);
  });
});
