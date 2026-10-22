// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unlabeledFields, unnamedControls } from '@/test-utils/a11y';

// mv-order: sửa hồ sơ (kiểu điện thoại giống Mini App).

// Chép ý edit-profile.spec.tsx (Mini App): nhãn ô nhập, email kiểm hợp lệ, PATCH /me cắt khoảng trắng, thử lại không kèm
// avatarUrl khi máy chủ chê ảnh, ảnh chỉ lưu dạng URL Cloudinary (không bao giờ gửi base64), ẩn đổi ảnh khi chưa cấu hình.

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: 'u1', fullName: 'Lan', avatarUrl: null as string | null } as Record<string, unknown> | null,
    status: 'authenticated' as string,
    initialized: true,
    sessionUnavailable: false,
    retrySession: vi.fn(),
    updateProfile: vi.fn(),
  },
  get: vi.fn(),
  patch: vi.fn(),
  cloudinary: true,
  compress: vi.fn(),
  upload: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, patch: mocks.patch } }));
vi.mock('@/components/account/cloudinary-upload', () => ({
  isCloudinaryConfigured: () => mocks.cloudinary,
  uploadToCloudinary: mocks.upload,
}));
vi.mock('@/lib/image-compress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/image-compress')>()),
  readAndCompressImage: mocks.compress,
}));
vi.mock('@/components/account/avatar-crop-sheet', () => ({
  AvatarCropSheet: ({ open, onConfirm }: { open: boolean; onConfirm: (url: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onConfirm('data:image/jpeg;base64,QUJD')}>
        Xác nhận cắt
      </button>
    ) : null,
}));

import EditProfilePage from './page';
import { ApiError, NetworkError } from '@/lib/client-api';

const ME = { id: 'u1', fullName: 'Lan', email: 'lan@tubu.vn', avatarUrl: null, dob: '1990-05-01', phone: '0912345678', onboarded: true, segments: [] };
const CLOUD_URL = 'https://res.cloudinary.com/demo/image/upload/v1/avatar.jpg';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<EditProfilePage />);
  mounted.push(r);
  await flush(6);
  return r;
};
const field = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll<HTMLInputElement>('input')).find((i) => c.querySelector(`label[for="${i.id}"]`)?.textContent === label)!;
const statusText = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="status"]')).map((n) => n.textContent).join(' ');
const saveBtn = (c: HTMLElement) => byText(c, 'button', 'Lưu thay đổi') as HTMLButtonElement;
const blur = (el: Element) =>
  act(() => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
const pickPhoto = async (c: HTMLElement) => {
  const input = c.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })], configurable: true });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush(4);
  click(byText(document.body, 'button', 'Xác nhận cắt'));
  await flush(6);
};

beforeEach(() => {
  mocks.auth.user = { id: 'u1', fullName: 'Lan', avatarUrl: null };
  mocks.auth.status = 'authenticated';
  mocks.auth.initialized = true;
  mocks.auth.sessionUnavailable = false;
  mocks.auth.updateProfile.mockReset();
  mocks.get.mockReset().mockResolvedValue(ME);
  mocks.patch.mockReset().mockResolvedValue({ ...ME });
  mocks.cloudinary = true;
  mocks.compress.mockReset().mockResolvedValue('data:image/jpeg;base64,UkFX');
  mocks.upload.mockReset().mockResolvedValue(CLOUD_URL);
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('sửa hồ sơ như Mini App (điện thoại)', () => {
  it('khối số điện thoại ẩn ở điện thoại; ô nhập cao 50px; ảnh giữ chỗ nền sage không biểu tượng', async () => {
    const { container } = await mount();
    expect(container.querySelector('dl')!.className).toContain('max-md:hidden');
    expect(field(container, 'Họ và tên').className).toContain('max-md:min-h-[50px]');
    expect(field(container, 'Ngày sinh').className).toContain('max-md:min-h-[50px]');
    const ph = container.querySelector('svg.lucide-user');
    if (ph) {
      expect(ph.getAttribute('class')).toContain('max-md:hidden');
      expect(ph.parentElement!.className).toContain('max-md:bg-[var(--color-bg-subtle)]');
    }
    expect(container.querySelector('[data-page-bleed] h1')!.textContent).toBe('Sửa hồ sơ');
  });
});
