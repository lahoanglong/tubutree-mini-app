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

  it('base64: PNG/WebP nhỏ và cạnh dài vừa trả data URL gốc, không qua canvas (giữ trong suốt)', async () => {
    const { toDataURL } = stubCanvasPipeline({ width: 800, height: 600 });
    for (const type of ['image/png', 'image/webp']) {
      const m = await mount(false, { maxDim: 1000 });
      m.pick(file(type, 100 * 1024, 'logo'));
      await waitFor(() => expect(m.onChange).toHaveBeenCalled());
      expect(m.onChange.mock.calls[0]![0]).toMatch(new RegExp(`^data:${type};base64,`));
      expect(toDataURL).not.toHaveBeenCalled();
    }
  });

  it('base64: PNG quá 400KB hoặc cạnh dài quá maxDim vẫn nén JPEG nền trắng', async () => {
    const big = stubCanvasPipeline({ width: 800, height: 600 });
    const a = await mount(false, { maxDim: 1000 });
    a.pick(file('image/png', 401 * 1024, 'big.png'));
    await waitFor(() => expect(a.onChange).toHaveBeenCalledWith(COMPRESSED));
    expect(big.calls).toContain('fillRect');
    vi.restoreAllMocks();
    const wide = stubCanvasPipeline({ width: 3000, height: 2000 });
    const b = await mount(false, { maxDim: 1000 });
    b.pick(file('image/png', 50 * 1024, 'wide.png'));
    await waitFor(() => expect(b.onChange).toHaveBeenCalledWith(COMPRESSED));
    expect(wide.calls).toContain('fillRect');
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

describe('W60B — khoá khi đang tải, lời báo lỗi role="alert", số đếm đều', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const loadConfigured = async () => {
    vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', 'demo');
    vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', 'unsigned');
    vi.resetModules();
    return import('./image-upload');
  };
  const pendingFetch = () => {
    let finish!: (res: unknown) => void;
    const fetchMock = vi.fn().mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, finish: (url: string, extra: object = {}) => finish({ ok: true, json: async () => ({ secure_url: url, ...extra }) }) };
  };
  const fileInput = (c: HTMLElement) => c.querySelector('input[type="file"]') as HTMLInputElement;
  const pickFiles = (c: HTMLElement, files: File[]) => fireEvent.change(fileInput(c), { target: { files } });
  const png = (name: string) => new File(['x'], name, { type: 'image/png' });
  const oversized = (name = 'big.jpg') => {
    const f = new File(['x'], name, { type: 'image/jpeg' });
    Object.defineProperty(f, 'size', { value: 21 * 1024 * 1024 });
    return f;
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('ImageUpload: đang tải thì nút chọn ảnh khoá + aria-busy, tệp thứ hai chọn chen vào không chạy thêm lần tải', async () => {
    const { ImageUpload } = await loadConfigured();
    const net = pendingFetch();
    const onChange = vi.fn();
    const { container } = render(<ImageUpload label="Ảnh" value="" onChange={onChange} />);
    const openPicker = vi.spyOn(fileInput(container), 'click');
    const button = () => screen.getByRole('button') as HTMLButtonElement;
    expect(button().disabled).toBe(false);
    expect(button().hasAttribute('aria-busy')).toBe(false);
    fireEvent.click(button());
    expect(openPicker).toHaveBeenCalledTimes(1);

    pickFiles(container, [png('a.png')]);
    await waitFor(() => expect(button().disabled).toBe(true));
    expect(button().getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button());
    expect(openPicker).toHaveBeenCalledTimes(1);
    pickFiles(container, [png('b.png')]);
    await settle();
    expect(net.fetchMock).toHaveBeenCalledTimes(1);

    net.finish('https://res.cloudinary.com/demo/a.png');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://res.cloudinary.com/demo/a.png'));
    expect(onChange).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(button().disabled).toBe(false));
    expect(button().hasAttribute('aria-busy')).toBe(false);
  });

  it('ImageUpload: ảnh quá 20MB và tải thất bại đều báo qua role="alert"', async () => {
    const { ImageUpload } = await loadConfigured();
    const first = render(<ImageUpload label="Ảnh" value="" onChange={() => {}} />);
    expect(screen.queryByRole('alert')).toBeNull();
    pickFiles(first.container, [oversized()]);
    expect((await screen.findByRole('alert')).textContent).toBe('Ảnh quá lớn (tối đa 20MB). Hãy chọn ảnh khác nhé.');
    first.unmount();

    class BrokenImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', BrokenImage);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const second = render(<ImageUpload label="Ảnh" value="" onChange={() => {}} />);
    pickFiles(second.container, [png('a.png')]);
    expect((await screen.findByRole('alert')).textContent).toBe('Tải ảnh thất bại. Hãy chọn lại tệp ảnh khác.');
  });

  it('VideoUpload: tệp thứ hai chọn chen vào lúc đang tải bị bỏ, không báo bận hai lần, lỗi hiện qua role="alert"', async () => {
    const { VideoUpload } = await loadConfigured();
    const net = pendingFetch();
    const busy: boolean[] = [];
    const { container } = render(<VideoUpload value="" onChange={() => {}} onBusyChange={(b) => busy.push(b)} />);
    expect(screen.queryByRole('alert')).toBeNull();
    pickFiles(container, [new File(['x'], 'v.mp4', { type: 'video/mp4' })]);
    await waitFor(() => expect(busy).toEqual([true]));
    pickFiles(container, [new File(['x'], 'v2.mp4', { type: 'video/mp4' })]);
    await settle();
    expect(net.fetchMock).toHaveBeenCalledTimes(1);
    expect(busy).toEqual([true]);

    net.finish('https://res.cloudinary.com/demo/v.mp4', { duration: 95 });
    expect((await screen.findByRole('alert')).textContent).toBe('Video dài quá 60 giây. Hãy cắt ngắn lại rồi chọn lại nhé.');
    expect(busy).toEqual([true, false]);
  });

  it('MultiImageUpload: đang tải thì ô "Thêm ảnh" và mọi nút "Xoá ảnh" khoá, xoá giữa chừng không gọi onChange, tệp chen vào bị bỏ', async () => {
    const { MultiImageUpload } = await loadConfigured();
    const net = pendingFetch();
    const onChange = vi.fn();
    const { container } = render(<MultiImageUpload value={['https://i/1.jpg', 'https://i/2.jpg']} onChange={onChange} max={4} />);
    const openPicker = vi.spyOn(fileInput(container), 'click');
    const addButton = () => container.querySelector('button.tubu-press') as HTMLButtonElement;
    const removeButtons = () => screen.getAllByRole('button', { name: 'Xoá ảnh' }) as HTMLButtonElement[];
    expect(addButton().disabled).toBe(false);
    expect(addButton().hasAttribute('aria-busy')).toBe(false);
    fireEvent.click(addButton());
    expect(openPicker).toHaveBeenCalledTimes(1);

    pickFiles(container, [png('a.png')]);
    await waitFor(() => expect(addButton().disabled).toBe(true));
    expect(addButton().getAttribute('aria-busy')).toBe('true');
    expect(addButton().textContent).toBe('Đang tải…');
    expect(removeButtons().map((b) => b.disabled)).toEqual([true, true]);
    fireEvent.click(removeButtons()[0]!);
    fireEvent.click(addButton());
    expect(onChange).not.toHaveBeenCalled();
    expect(openPicker).toHaveBeenCalledTimes(1);
    pickFiles(container, [png('b.png')]);
    await settle();
    expect(net.fetchMock).toHaveBeenCalledTimes(1);

    net.finish('https://res.cloudinary.com/demo/a.png');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['https://i/1.jpg', 'https://i/2.jpg', 'https://res.cloudinary.com/demo/a.png']));
    expect(onChange).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(addButton().disabled).toBe(false));
    expect(addButton().hasAttribute('aria-busy')).toBe(false);
    expect(removeButtons().map((b) => b.disabled)).toEqual([false, false]);
  });

  it('MultiImageUpload: ảnh quá 20MB bị bỏ qua và lời báo là role="alert"', async () => {
    const { MultiImageUpload } = await loadConfigured();
    const onChange = vi.fn();
    const { container } = render(<MultiImageUpload value={[]} onChange={onChange} />);
    expect(screen.queryByRole('alert')).toBeNull();
    pickFiles(container, [oversized()]);
    expect((await screen.findByRole('alert')).textContent).toBe('Đã bỏ qua 1 ảnh quá lớn (tối đa 20MB/ảnh).');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('MultiImageUpload: báo form cha đang tải rồi tải xong (kể cả khi mọi ảnh bị bỏ vì quá lớn) để khoá nút gửi trong lúc chờ (W85A)', async () => {
    const { MultiImageUpload } = await loadConfigured();
    const net = pendingFetch();
    const busy: boolean[] = [];
    const onChange = vi.fn();
    const { container } = render(<MultiImageUpload value={[]} onChange={onChange} onBusyChange={(b) => busy.push(b)} />);
    pickFiles(container, [png('a.png')]);
    await waitFor(() => expect(busy).toEqual([true]));
    expect(onChange).not.toHaveBeenCalled();
    net.finish('https://res.cloudinary.com/demo/a.png');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['https://res.cloudinary.com/demo/a.png']));
    await waitFor(() => expect(busy).toEqual([true, false]));

    pickFiles(container, [oversized()]);
    await waitFor(() => expect(busy).toEqual([true, false, true, false]));
  });

  it('MultiImageUpload: nhãn đếm "n/tối đa" dùng số đều để không nhảy khi số ảnh đổi', async () => {
    const { MultiImageUpload } = await loadConfigured();
    render(<MultiImageUpload value={['https://i/1.jpg']} onChange={() => {}} />);
    expect(screen.getByText('Ảnh đính kèm (1/6)').style.fontVariantNumeric).toBe('tabular-nums');
  });
});
