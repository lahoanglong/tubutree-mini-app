import { StaffAttendanceCard } from '../components/staff-attendance-card';
import { useAuthStore } from '../store/auth';
import WebPortalRedirectPage from './web-portal-redirect';

/** `/staff`: xếp ca và lương đã chuyển sang website, riêng chấm công (cần vị trí Zalo) vẫn làm trong Mini App cho nhân viên và quản trị. */
export default function StaffPortalPage() {
  const role = useAuthStore((s) => s.user?.role);
  return <WebPortalRedirectPage screen="/staff">{role === 'STAFF' || role === 'ADMIN' ? <StaffAttendanceCard /> : null}</WebPortalRedirectPage>;
}
