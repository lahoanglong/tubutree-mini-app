import type { HttpClient } from '../http';
import { getAttendanceStatus, getHistory } from '../api/attendance';

export const attendanceStatusQuery = (http: HttpClient) => ({
  queryKey: ['attn-status'] as const,
  queryFn: () => getAttendanceStatus(http),
});
export const myAttendanceHistoryQuery = (http: HttpClient, year: number, month: number, fromISO: string, toISO: string) => ({
  queryKey: ['my-attn-history', year, month] as const,
  queryFn: () => getHistory(http, fromISO, toISO),
});
