import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { StorefrontEdit } from '../../services/storefront-api';
import type { ProfileSheet as ProfileSheetComponent } from './profile-sheet';
import { vi as t } from '../../i18n/vi';

// Ô ảnh THẬT (không giả): kiểm hợp đồng giữa ImageUpload và form, gồm cả lúc Cloudinary im và form phải tự gỡ khoá.
const mocks = vi.hoisted(() => ({ openSnackbar: vi.fn(), updateStorefront: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/storefront-api', () => ({ updateStorefront: mocks.updateStorefront }));
vi.mock('../../services/api', () => ({ getErrorMessage: (e: unknown) => (e as Error).message }));

const sf = { id: 's1', avatarUrl: 'https://i/a.jpg', coverUrl: 'https://i/c.jpg', headerNote: 'Xin chào' } as unknown as StorefrontEdit;
const png = (name: string) => new File(['x'], name, { type: 'image/png' });

// Cấu hình Cloudinary chốt lúc nạp module nên nạp một lần cho cả file (nạp lại mỗi ca vừa chậm vừa dễ quá hạn).
let ProfileSheet: typeof ProfileSheetComponent;
beforeAll(async () => {
  vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', 'demo');
  vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', 'unsigned');
  vi.resetModules();
  ({ ProfileSheet } = await import('./profile-sheet'));
}, 60_000);
afterAll(() => vi.unstubAllEnvs());

function mountSheet() {
  const qc = new QueryClient();
  const utils = render(
    <QueryClientProvider client={qc}>
      <ProfileSheet sf={sf} onClose={() => {}} onSaved={() => {}} />
    </QueryClientProvider>,
  );
  const inputs = () => Array.from(utils.container.querySelectorAll<HTMLInputElement>('input[type="file"]'));
  // Nút Lưu là nút ZaUI; ô ảnh đang tải cũng mang tên "Đang tải ảnh…" nên tìm theo lớp của nút.
  const saveButton = () => Array.from(utils.container.querySelectorAll<HTMLButtonElement>('button.zaui-btn')).find((b) => b.textContent !== 'Đóng')!;
  const tiles = () => Array.from(utils.container.querySelectorAll<HTMLButtonElement>('button.tubu-press'));
  return { ...utils, inputs, saveButton, tiles };
}

describe('ProfileSheet với ô ảnh thật: Lưu hồ sơ chờ ảnh còn đang lên (W90A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateStorefront.mockReset().mockResolvedValue({});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('đang đổi ảnh đại diện: Lưu khoá + đổi nhãn, bấm không gọi updateStorefront; tải xong thì lưu kèm ảnh MỚI (ảnh bìa giữ nguyên)', async () => {
    let finish!: (res: unknown) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(new Promise((resolve) => (finish = resolve))));
    const m = mountSheet();
    expect(m.saveButton().textContent).toBe('Lưu hồ sơ');

    fireEvent.change(m.inputs()[0]!, { target: { files: [png('moi.png')] } });
    await waitFor(() => expect(m.saveButton().textContent).toBe(t.common.imagesUploading));
    expect(m.saveButton()).toBeDisabled();
    fireEvent.click(m.saveButton());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(mocks.updateStorefront).not.toHaveBeenCalled();

    await act(async () => finish({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/moi.png' }) }));
    await waitFor(() => expect(m.saveButton().textContent).toBe('Lưu hồ sơ'));
    expect(m.saveButton()).toBeEnabled();
    fireEvent.click(m.saveButton());
    await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(1));
    expect(mocks.updateStorefront).toHaveBeenCalledWith({
      avatarUrl: 'https://res.cloudinary.com/demo/moi.png',
      coverUrl: 'https://i/c.jpg',
      headerNote: 'Xin chào',
    });
  });

  it('Cloudinary im quá 120 giây: lượt tải bị huỷ, ảnh nén tại chỗ vào form và Lưu tự mở lại (không treo mãi)', async () => {
    class FakeReader {
      onload: ((e: { target: { result: string } }) => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        queueMicrotask(() => this.onload?.({ target: { result: 'data:image/png;base64,Zm9v' } }));
      }
    }
    class FakeImage {
      width = 400;
      height = 300;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('FileReader', FakeReader);
    vi.stubGlobal('Image', FakeImage);
    const fetchMock = vi.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    vi.stubGlobal('fetch', fetchMock);
    const m = mountSheet();
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.change(m.inputs()[0]!, { target: { files: [png('moi.png')] } });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(m.saveButton().textContent).toBe(t.common.imagesUploading);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(119_999);
    });
    expect(m.saveButton().textContent).toBe(t.common.imagesUploading);
    expect(m.saveButton()).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(m.saveButton().textContent).toBe('Lưu hồ sơ');
    expect(m.saveButton()).toBeEnabled();
  });

  it('đang lưu thì cả hai ô ảnh khoá: chọn tệp chen vào lúc này không chạy lượt tải nào', async () => {
    let release!: (v: unknown) => void;
    mocks.updateStorefront.mockReturnValueOnce(new Promise((r) => (release = r)));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const m = mountSheet();
    expect(m.tiles().map((b) => b.disabled)).toEqual([false, false]);
    fireEvent.click(m.saveButton());
    await waitFor(() => expect(mocks.updateStorefront).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(m.tiles().map((b) => b.disabled)).toEqual([true, true]));
    fireEvent.change(m.inputs()[1]!, { target: { files: [png('chen.png')] } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => release({}));
    await waitFor(() => expect(m.tiles().map((b) => b.disabled)).toEqual([false, false]));
  });
});
