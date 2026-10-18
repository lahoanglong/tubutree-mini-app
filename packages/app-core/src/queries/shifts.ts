import type { HttpClient } from '../http';
import { adminGetShifts, adminGetTemplates, getShifts, getShiftTemplates } from '../api/shifts';

export const shiftTemplatesQuery = (http: HttpClient) => ({
  queryKey: ['shift-templates'] as const,
  queryFn: () => getShiftTemplates(http),
});
// Key chỉ chứa mondayKey (tuần), from/to suy ra từ tuần đó ở nơi gọi.
export const myShiftsQuery = (http: HttpClient, mondayKey: string, fromISO: string, toISO: string) => ({
  queryKey: ['my-shifts', mondayKey] as const,
  queryFn: () => getShifts(http, fromISO, toISO),
});
export const adminShiftsQuery = (http: HttpClient, mondayKey: string, fromISO: string, toISO: string) => ({
  queryKey: ['admin-shifts', mondayKey] as const,
  queryFn: () => adminGetShifts(http, fromISO, toISO),
});
export const adminShiftTemplatesQuery = (http: HttpClient) => ({
  queryKey: ['admin-templates'] as const,
  queryFn: () => adminGetTemplates(http),
});
