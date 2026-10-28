import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { MultiImageUpload } from './image-upload';

const px = (v: string) => Number.parseFloat(v);

describe('MultiImageUpload — ô thêm ảnh (R5-BUYER-5)', () => {
  it('nhãn ngắn vừa ô 72px và chừa lề hai bên, không dính viền nét đứt', () => {
    render(<MultiImageUpload value={[]} onChange={() => {}} />);
    const tile = screen.getByRole('button', { name: 'Thêm ảnh' });
    expect(tile.textContent).toBe('Thêm ảnh');
    expect(px(tile.style.paddingLeft)).toBeGreaterThanOrEqual(4);
    expect(px(tile.style.paddingRight)).toBeGreaterThanOrEqual(4);
  });
});

describe('MultiImageUpload — nút "Xoá ảnh"', () => {
  it('vùng chạm >= 44x44 nhưng nằm gọn trong ô ảnh 72px, không lấn sang ô kế tiếp', () => {
    render(<MultiImageUpload value={['https://i/1.jpg', 'https://i/2.jpg']} onChange={() => {}} />);
    const buttons = screen.getAllByRole('button', { name: 'Xoá ảnh' });
    expect(buttons).toHaveLength(2);
    for (const btn of buttons) {
      expect(px(btn.style.width)).toBeGreaterThanOrEqual(44);
      expect(px(btn.style.height)).toBeGreaterThanOrEqual(44);
      // Ô ảnh rộng 72px, khoảng cách giữa các ô 10px: lệch ra ngoài ô là chạm nhầm ô bên cạnh.
      expect(px(btn.style.top)).toBeGreaterThanOrEqual(0);
      expect(px(btn.style.right)).toBeGreaterThanOrEqual(0);
      expect(px(btn.style.width)).toBeLessThanOrEqual(72);
      expect(px(btn.style.height)).toBeLessThanOrEqual(72);
    }
  });

  it('chạm xoá đúng ảnh được chọn', () => {
    const onChange = vi.fn();
    render(<MultiImageUpload value={['https://i/1.jpg', 'https://i/2.jpg']} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Xoá ảnh' })[1]!);
    expect(onChange).toHaveBeenCalledWith(['https://i/1.jpg']);
  });
});

describe('VideoUpload — dùng chung hàm tải Cloudinary với web', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const loadConfigured = async () => {
    vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', 'demo');
    vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', 'unsigned');
    vi.resetModules();
    return (await import('./image-upload')).VideoUpload;
  };
  const pickFile = (container: HTMLElement, file: File) => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
  };

  it('tải đúng URL video của Cloudinary rồi trả secure_url', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/v.mp4', duration: 12 }) });
    vi.stubGlobal('fetch', fetchMock);
    const VideoUpload = await loadConfigured();
    const onChange = vi.fn();
    const { container } = render(<VideoUpload value="" onChange={onChange} />);
    pickFile(container, new File(['x'], 'v.mp4', { type: 'video/mp4' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://res.cloudinary.com/demo/v.mp4'));
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.cloudinary.com/v1_1/demo/video/upload');
  });

  it('video quá 60 giây (Cloudinary báo độ dài) bị chặn bằng lời báo rõ', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/v.mp4', duration: 95 }) }));
    const VideoUpload = await loadConfigured();
    const onChange = vi.fn();
    const { container } = render(<VideoUpload value="" onChange={onChange} />);
    pickFile(container, new File(['x'], 'v.mp4', { type: 'video/mp4' }));
    expect(await screen.findByText('Video dài quá 60 giây. Hãy cắt ngắn lại rồi chọn lại nhé.')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});
