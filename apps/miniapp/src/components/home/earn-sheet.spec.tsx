import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), role: undefined as string | undefined }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: { user: { role: string } | null }) => unknown) => sel({ user: mocks.role ? { role: mocks.role } : null }),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../ui/bottom-sheet', () => ({
  BottomSheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
}));

import { EarnSheet } from './earn-sheet';

describe('EarnSheet Mini App: Học viện chỉ mời vai được vào', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = undefined;
  });

  it('khách thường và khách chưa đăng nhập không thấy Học viện, vẫn thấy CTV và Đại lý', () => {
    for (const role of ['CUSTOMER', undefined]) {
      mocks.role = role;
      const { unmount } = render(<EarnSheet open onClose={vi.fn()} />);
      expect(screen.queryByText('Học viện Tubu')).toBeNull();
      expect(screen.getByText('Cộng tác viên')).toBeTruthy();
      expect(screen.getByText('Đại lý')).toBeTruthy();
      unmount();
    }
  });

  it('CTV, đại lý, nhân viên, quản trị thấy Học viện và bấm đi /academy', () => {
    for (const role of ['AFFILIATE', 'DEALER', 'STAFF', 'ADMIN']) {
      mocks.role = role;
      mocks.navigate.mockClear();
      const { unmount } = render(<EarnSheet open onClose={vi.fn()} />);
      fireEvent.click(screen.getByText('Học viện Tubu'));
      expect(mocks.navigate).toHaveBeenCalledWith('/academy');
      unmount();
    }
  });
});
