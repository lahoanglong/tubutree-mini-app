import type { HttpClient } from '../http';
import { adminGetDetail, adminGetPayroll, getMyPayroll } from '../api/payroll';

export const myPayrollQuery = (http: HttpClient, year: number, month: number) => ({
  queryKey: ['my-payroll', year, month] as const,
  queryFn: () => getMyPayroll(http, year, month),
});
export const adminPayrollQuery = (http: HttpClient, year: number, month: number) => ({
  queryKey: ['admin-payroll', year, month] as const,
  queryFn: () => adminGetPayroll(http, year, month),
});
export const adminPayrollDetailQuery = (http: HttpClient, staffId: string, year: number, month: number) => ({
  queryKey: ['admin-payroll-detail', staffId, year, month] as const,
  queryFn: () => adminGetDetail(http, staffId, year, month),
});
