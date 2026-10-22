import { describe, expect, it } from 'vitest';
import type { HttpClient } from '../http';
import { fakeHttp } from '../api/fake-http';
import * as dealer from './dealer';
import * as staff from './staff';
import * as shifts from './shifts';
import * as attendance from './attendance';
import * as payroll from './payroll';
import * as brandOwner from './brand-owner';

type Q = { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> };
type Case = [name: string, make: (h: HttpClient) => Q, key: readonly unknown[], path: string];

/** queryKey phải GIỐNG HỆT key Mini App đang dùng (cache dùng chung, invalidate theo tiền tố). */
const cases: Case[] = [
  ['dealerMe', (h) => dealer.dealerMeQuery(h), ['dealer-me'], '/dealer/me'],
  ['dealerPricelist', (h) => dealer.dealerPricelistQuery(h), ['dealer-pricelist'], '/dealer/pricelist'],
  ['dealerTemplates', (h) => dealer.dealerTemplatesQuery(h), ['dealer-templates'], '/dealer/templates'],
  ['dealerOrders', (h) => dealer.dealerOrdersQuery(h), ['dealer-orders'], '/dealer/orders'],
  ['dealerCredit', (h) => dealer.dealerCreditQuery(h), ['dealer-credit'], '/dealer/credit-ledger'],
  ['dealerReport', (h) => dealer.dealerReportQuery(h), ['dealer-report'], '/dealer/quarterly-report'],
  ['dealerRewards', (h) => dealer.dealerRewardsQuery(h), ['dealer-rewards'], '/dealer/rewards'],
  ['adminStaff', (h) => staff.adminStaffQuery(h), ['admin-staff'], '/admin/staff'],
  ['shiftTemplates', (h) => shifts.shiftTemplatesQuery(h), ['shift-templates'], '/staff/shift-templates'],
  ['myShifts', (h) => shifts.myShiftsQuery(h, '2026-10-19', 'a', 'b'), ['my-shifts', '2026-10-19'], '/staff/shifts'],
  ['adminShifts', (h) => shifts.adminShiftsQuery(h, '2026-10-19', 'a', 'b'), ['admin-shifts', '2026-10-19'], '/admin/shifts'],
  ['adminShiftTemplates', (h) => shifts.adminShiftTemplatesQuery(h), ['admin-templates'], '/admin/shift-templates'],
  ['attendanceStatus', (h) => attendance.attendanceStatusQuery(h), ['attn-status'], '/staff/attendance/status'],
  ['myAttendanceHistory', (h) => attendance.myAttendanceHistoryQuery(h, 2026, 10, 'a', 'b'), ['my-attn-history', 2026, 10], '/staff/attendance/history'],
  ['myPayroll', (h) => payroll.myPayrollQuery(h, 2026, 10), ['my-payroll', 2026, 10], '/staff/payroll'],
  ['adminPayroll', (h) => payroll.adminPayrollQuery(h, 2026, 10), ['admin-payroll', 2026, 10], '/admin/payroll'],
  ['adminPayrollDetail', (h) => payroll.adminPayrollDetailQuery(h, 'u1', 2026, 10), ['admin-payroll-detail', 'u1', 2026, 10], '/admin/payroll/u1/detail'],
  ['ownedBrand', (h) => brandOwner.ownedBrandQuery(h), ['owned-brand'], '/brand/owner/me'],
  ['ownedBrandProfile', (h) => brandOwner.ownedBrandProfileQuery(h), ['owned-brand', 'profile'], '/brand/owner/me'],
  ['ownedBrandSales', (h) => brandOwner.ownedBrandSalesQuery(h, '30d'), ['owned-brand-sales', '30d'], '/brand/owner/me/sales'],
];

describe('queries miền nội bộ — queryKey giống Mini App, queryFn gọi đúng route', () => {
  it.each(cases)('%s', async (_name, make, key, path) => {
    const { http, calls } = fakeHttp();
    const q = make(http);
    expect(q.queryKey).toEqual(key);
    await q.queryFn();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'get', path });
  });

  it('ownedBrandProfile: 404 -> null, lỗi khác ném lại', async () => {
    const notFound = fakeHttp(() => {
      throw { status: 404 };
    });
    await expect(brandOwner.ownedBrandProfileQuery(notFound.http).queryFn()).resolves.toBeNull();
    const boom = fakeHttp(() => {
      throw { status: 500 };
    });
    await expect(brandOwner.ownedBrandProfileQuery(boom.http).queryFn()).rejects.toEqual({ status: 500 });
  });

  it('ownsBrand: thiếu cờ -> null (API cũ), có cờ giữ nguyên, lỗi ném lại', async () => {
    const old = fakeHttp(() => ({ id: 'u1' }));
    expect(brandOwner.ownsBrandQuery(old.http).queryKey).toEqual(['auth-me', 'owns-brand']);
    await expect(brandOwner.ownsBrandQuery(old.http).queryFn()).resolves.toBeNull();
    expect(old.calls[0]).toMatchObject({ method: 'get', path: '/auth/me' });
    const no = fakeHttp(() => ({ ownsBrand: false }));
    await expect(brandOwner.ownsBrandQuery(no.http).queryFn()).resolves.toBe(false);
    const yes = fakeHttp(() => ({ ownsBrand: true }));
    await expect(brandOwner.ownsBrandQuery(yes.http).queryFn()).resolves.toBe(true);
    const boom = fakeHttp(() => {
      throw { status: 500 };
    });
    await expect(brandOwner.ownsBrandQuery(boom.http).queryFn()).rejects.toEqual({ status: 500 });
  });
});
