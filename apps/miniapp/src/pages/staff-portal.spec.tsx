import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/staff-attendance-card', () => ({ StaffAttendanceCard: () => <div data-testid="attendance-card" /> }));
vi.mock('./web-portal-redirect', () => ({
  default: ({ screen: key, children }: { screen: string; children?: ReactNode }) => <div data-testid="portal" data-screen={key}>{children}</div>,
}));

import { useAuthStore } from '../store/auth';
import StaffPortalPage from './staff-portal';

function withRole(role: string | undefined) {
  useAuthStore.setState({ user: role ? ({ role } as never) : null });
}

beforeEach(() => withRole(undefined));

describe('StaffPortalPage — /staff: thẻ chuyển web kèm chấm công cho nhân viên', () => {
  it.each(['STAFF', 'ADMIN'])('%s: thấy thẻ chấm công trong thẻ chuyển web của /staff', (role) => {
    withRole(role);
    render(<StaffPortalPage />);
    expect(screen.getByTestId('portal')).toHaveAttribute('data-screen', '/staff');
    expect(screen.getByTestId('attendance-card')).toBeInTheDocument();
  });

  it.each(['CUSTOMER', 'DEALER', undefined])('%s: chỉ có thẻ chuyển web, không gọi chấm công', (role) => {
    withRole(role);
    render(<StaffPortalPage />);
    expect(screen.getByTestId('portal')).toHaveAttribute('data-screen', '/staff');
    expect(screen.queryByTestId('attendance-card')).toBeNull();
  });
});
