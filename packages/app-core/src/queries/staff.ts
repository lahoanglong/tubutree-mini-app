import type { HttpClient } from '../http';
import { listStaff } from '../api/staff';

export const adminStaffQuery = (http: HttpClient) => ({
  queryKey: ['admin-staff'] as const,
  queryFn: () => listStaff(http),
});
