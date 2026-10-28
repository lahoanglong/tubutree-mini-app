// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ push: vi.fn(), role: undefined as string | undefined }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: mocks.role ? { role: mocks.role } : null }) }));

import { EarnSheet } from './earn-sheet';

let mounted: Rendered | null = null;
const mount = () => {
  mounted = render(<EarnSheet open onClose={vi.fn()} />);
  return document.body;
};

beforeEach(() => {
  mocks.push.mockReset();
  mocks.role = undefined;
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('EarnSheet web: Học viện chỉ mời vai được vào', () => {
  it('khách thường và khách chưa đăng nhập không thấy Học viện, vẫn thấy CTV và Đại lý', () => {
    for (const role of ['CUSTOMER', undefined]) {
      mocks.role = role;
      const body = mount();
      expect(body.textContent).not.toContain('Học viện Tubu');
      expect(body.textContent).toContain('Cộng tác viên');
      expect(body.textContent).toContain('Đại lý');
      mounted?.unmount();
    }
  });

  it('CTV, đại lý, nhân viên, quản trị thấy Học viện và bấm đi /hoc-vien', () => {
    for (const role of ['AFFILIATE', 'DEALER', 'STAFF', 'ADMIN']) {
      mocks.role = role;
      mocks.push.mockReset();
      const body = mount();
      click(byText(body, '[role="button"], button', 'Học viện Tubu'));
      expect(mocks.push).toHaveBeenCalledWith('/hoc-vien');
      mounted?.unmount();
    }
  });
});
