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

  it('báo form cha đang tải rồi tải xong, kể cả khi lỗi, để khoá nút gửi trong lúc chờ', async () => {
    let finish!: (res: unknown) => void;
    const fetchMock = vi.fn().mockReturnValueOnce(new Promise((resolve) => (finish = resolve))).mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const VideoUpload = await loadConfigured();
    const busy: boolean[] = [];
    const { container } = render(<VideoUpload value="" onChange={() => {}} onBusyChange={(b) => busy.push(b)} />);
    pickFile(container, new File(['x'], 'v.mp4', { type: 'video/mp4' }));
    await waitFor(() => expect(busy).toEqual([true]));
    finish({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/v.mp4', duration: 12 }) });
    await waitFor(() => expect(busy).toEqual([true, false]));
    pickFile(container, new File(['x'], 'v2.mp4', { type: 'video/mp4' }));
    await waitFor(() => expect(busy).toEqual([true, false, true, false]));
  });
  it('đang tải thì nút chọn video khoá và chạm lần hai không mở hộp chọn tệp: không có hai lần tải chạy song song', async () => {
    let finish!: (res: unknown) => void;
    const fetchMock = vi.fn().mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    vi.stubGlobal('fetch', fetchMock);
    const VideoUpload = await loadConfigured();
    const busy: boolean[] = [];
    const { container } = render(<VideoUpload value="" onChange={() => {}} onBusyChange={(b) => busy.push(b)} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const openPicker = vi.spyOn(input, 'click');
    const pickButton = () => screen.getByRole('button', { name: /video/i }) as HTMLButtonElement;
    fireEvent.click(pickButton());
    expect(openPicker).toHaveBeenCalledTimes(1);
    pickFile(container, new File(['x'], 'v.mp4', { type: 'video/mp4' }));
    await waitFor(() => expect(busy).toEqual([true]));
    expect(pickButton().disabled).toBe(true);
    fireEvent.click(pickButton());
    expect(openPicker).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/v.mp4', duration: 12 }) });
    await waitFor(() => expect(busy).toEqual([true, false]));
    expect(pickButton().disabled).toBe(false);
  });

  it('đã có video mà đang tải video khác: "Đổi video" và "Xoá video" khoá, không xoá giữa chừng', async () => {
    let finish!: (res: unknown) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(new Promise((resolve) => (finish = resolve))));
    const VideoUpload = await loadConfigured();
    const onChange = vi.fn();
    const { container } = render(<VideoUpload value="https://res.cloudinary.com/demo/cu.mp4" onChange={onChange} />);
    pickFile(container, new File(['x'], 'v.mp4', { type: 'video/mp4' }));
    const change = await screen.findByRole('button', { name: /Đang tải video/ });
    expect((change as HTMLButtonElement).disabled).toBe(true);
    const remove = screen.getByRole('button', { name: 'Xoá video' }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    fireEvent.click(remove);
    expect(onChange).not.toHaveBeenCalled();
    finish({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/moi.mp4', duration: 12 }) });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://res.cloudinary.com/demo/moi.mp4'));
  });
});

describe('ImageUpload — chính sách ảnh gửi đi (F11)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const COMPRESSED = 'data:image/jpeg;base64,' + btoa('nho');

  function stubCanvasPipeline(size = { width: 4000, height: 3000 }, decodeFails = false) {
    class FakeImage {
      width = size.width;
      height = size.height;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => (decodeFails ? this.onerror?.() : this.onload?.()));
      }
    }
    vi.stubGlobal('Image', FakeImage);
    const calls: string[] = [];
    const drawn: number[][] = [];
    const ctx = {
      set fillStyle(_v: string) {
        calls.push('fillStyle');
      },
      fillRect: () => void calls.push('fillRect'),
      drawImage: (...a: number[]) => {
        calls.push('drawImage');
        drawn.push(a);
      },
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => {
      calls.push('toDataURL');
      return COMPRESSED;
    });
    return { drawn, calls, toDataURL };
  }

  async function mount(configured: boolean, props: { maxDim?: number; quality?: number } = {}) {
    if (configured) {
      vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', 'demo');
      vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', 'unsigned');
    }
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/a.jpg' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { ImageUpload } = await import('./image-upload');
    const onChange = vi.fn();
    const { container } = render(<ImageUpload label="Ảnh" value="" onChange={onChange} {...props} />);
    const pick = (file: File) => fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    const sent = () => (fetchMock.mock.calls[0]![1] as { body: FormData }).body.get('file') as Blob;
    return { onChange, pick, fetchMock, sent };
  }
  const file = (type: string, bytes: number, name = 'a') => new File([new Uint8Array(bytes)], name, { type });

  it('Cloudinary: PNG gửi nguyên file, không đụng canvas', async () => {
    const { toDataURL } = stubCanvasPipeline();
    const m = await mount(true);
    const png = file('image/png', 3 * 1024 * 1024, 'qr.png');
    m.pick(png);
    await waitFor(() => expect(m.onChange).toHaveBeenCalledWith('https://res.cloudinary.com/demo/a.jpg'));
    expect(m.sent()).toBe(png);
    expect(toDataURL).not.toHaveBeenCalled();
  });

  it('Cloudinary: JPEG nhỏ và cạnh dài vừa gửi nguyên', async () => {
    const { toDataURL } = stubCanvasPipeline({ width: 1200, height: 900 });
    const m = await mount(true);
    const jpg = file('image/jpeg', 200 * 1024, 'a.jpg');
    m.pick(jpg);
    await waitFor(() => expect(m.onChange).toHaveBeenCalled());
    expect(m.sent()).toBe(jpg);
    expect(toDataURL).not.toHaveBeenCalled();
  });

  it('Cloudinary: JPEG lớn nén cạnh dài 1600 bất kể maxDim của nơi gọi', async () => {
    const { drawn } = stubCanvasPipeline();
    const m = await mount(true, { maxDim: 1000, quality: 0.5 });
    const big = file('image/jpeg', 6 * 1024 * 1024, 'big.jpg');
    m.pick(big);
    await waitFor(() => expect(m.onChange).toHaveBeenCalledWith('https://res.cloudinary.com/demo/a.jpg'));
    expect(m.sent().size).toBeLessThan(1024);
    expect(m.sent().type).toBe('image/jpeg');
    expect(drawn[0]!.slice(3)).toEqual([1600, 1200]);
  });

  it('Cloudinary: không giải mã được (HEIC, quá lớn) thì gửi nguyên file, không báo lỗi', async () => {
    stubCanvasPipeline({ width: 4000, height: 3000 }, true);
    const m = await mount(true);
    const heic = file('image/jpeg', 6 * 1024 * 1024, 'x.jpg');
    m.pick(heic);
    await waitFor(() => expect(m.onChange).toHaveBeenCalledWith('https://res.cloudinary.com/demo/a.jpg'));
    expect(m.sent()).toBe(heic);
    expect(screen.queryByText(/Tải ảnh thất bại/)).toBeNull();
  });

  it('Cloudinary lỗi: rơi về base64 đã nén', async () => {
    stubCanvasPipeline();
    const m = await mount(true);
    m.fetchMock.mockResolvedValue({ ok: false });
    m.pick(file('image/png', 1000, 'a.png'));
    await waitFor(() => expect(m.onChange).toHaveBeenCalledWith(COMPRESSED));
  });

  it('base64 (chưa cấu hình Cloudinary): phủ nền trắng trước khi vẽ, tôn trọng maxDim', async () => {
    const { calls, drawn } = stubCanvasPipeline();
    const m = await mount(false, { maxDim: 1000 });
    m.pick(file('image/png', 1000, 'logo.png'));
    await waitFor(() => expect(m.onChange).toHaveBeenCalledWith(COMPRESSED));
    expect(m.fetchMock).not.toHaveBeenCalled();
    expect(calls.indexOf('fillRect')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('fillRect')).toBeLessThan(calls.indexOf('drawImage'));
    expect(drawn[0]!.slice(3)).toEqual([1000, 750]);
  });
});
