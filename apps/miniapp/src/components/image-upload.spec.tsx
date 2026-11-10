import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('MultiImageUpload: form cha đang gửi (disabled) khoá ô "Thêm ảnh" và mọi nút "Xoá ảnh", tệp chen vào bị bỏ; hết gửi thì dùng lại được', async () => {
    const { MultiImageUpload } = await loadConfigured();
    const net = pendingFetch();
    const onChange = vi.fn();
    const busy: boolean[] = [];
    const props = { value: ['https://i/1.jpg', 'https://i/2.jpg'], onChange, onBusyChange: (b: boolean) => busy.push(b), max: 4 };
    const { container, rerender } = render(<MultiImageUpload {...props} disabled />);
    const openPicker = vi.spyOn(fileInput(container), 'click');
    const addButton = () => container.querySelector('button.tubu-press') as HTMLButtonElement;
    const removeButtons = () => screen.getAllByRole('button', { name: 'Xoá ảnh' }) as HTMLButtonElement[];
    expect(addButton().disabled).toBe(true);
    expect(removeButtons().map((b) => b.disabled)).toEqual([true, true]);
    fireEvent.click(addButton());
    fireEvent.click(removeButtons()[0]!);
    expect(openPicker).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();

    pickFiles(container, [png('a.png')]);
    await settle();
    expect(net.fetchMock).not.toHaveBeenCalled();
    expect(busy).toEqual([]);

    rerender(<MultiImageUpload {...props} disabled={false} />);
    expect(addButton().disabled).toBe(false);
    expect(removeButtons().map((b) => b.disabled)).toEqual([false, false]);
    fireEvent.click(removeButtons()[0]!);
    expect(onChange).toHaveBeenCalledWith(['https://i/2.jpg']);
  });

  it('MultiImageUpload: Cloudinary im quá 120 giây thì huỷ lượt tải, rơi về ảnh nén tại chỗ và nhả khoá (không treo nút Gửi của form cha)', async () => {
    class FakeReader {
      onload: ((e: { target: { result: string } }) => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        queueMicrotask(() => this.onload?.({ target: { result: 'data:image/png;base64,Zm9v' } }));
      }
    }
    class FakeImage {
      width = 800;
      height = 600;
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
    const { MultiImageUpload } = await loadConfigured();
    vi.useFakeTimers();
    try {
      const busy: boolean[] = [];
      const onChange = vi.fn();
      const { container } = render(<MultiImageUpload value={[]} onChange={onChange} onBusyChange={(b) => busy.push(b)} />);
      pickFiles(container, [png('a.png')]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(busy).toEqual([true]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(119_999);
      });
      expect(busy).toEqual([true]);
      expect(onChange).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(busy).toEqual([true, false]);
      expect(onChange).toHaveBeenCalledWith(['data:image/png;base64,Zm9v']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('MultiImageUpload: nhãn đếm "n/tối đa" dùng số đều để không nhảy khi số ảnh đổi', async () => {
    const { MultiImageUpload } = await loadConfigured();
    render(<MultiImageUpload value={['https://i/1.jpg']} onChange={() => {}} />);
    expect(screen.getByText('Ảnh đính kèm (1/6)').style.fontVariantNumeric).toBe('tabular-nums');
  });
});

describe('W90A — ô ảnh đơn và ô video: báo bận, khoá khi form cha đang lưu, có hạn chờ', () => {
  afterEach(() => {
    vi.useRealTimers();
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
  const fileInput = (c: HTMLElement) => c.querySelector('input[type="file"]') as HTMLInputElement;
  const pickFiles = (c: HTMLElement, files: File[]) => fireEvent.change(fileInput(c), { target: { files } });
  const png = (name: string) => new File(['x'], name, { type: 'image/png' });
  const mp4 = (name = 'v.mp4') => new File(['x'], name, { type: 'video/mp4' });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const pendingFetch = () => {
    let finish!: (res: unknown) => void;
    const fetchMock = vi.fn().mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, finish: (url: string) => finish({ ok: true, json: async () => ({ secure_url: url, duration: 10 }) }) };
  };
  /** fetch treo tới khi bị huỷ bằng signal, như mạng chết giữa chừng. */
  const hangingFetch = () => {
    const fetchMock = vi.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  /** Phản hồi về nhanh nhưng thân phản hồi không bao giờ về: hạn chót phải huỷ cả lúc đọc thân. */
  const hangingBodyFetch = () => {
    const fetchMock = vi.fn(
      async (_url: string, init: { signal: AbortSignal }) => ({
        ok: true,
        json: () => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  const fakeLocalDecode = () => {
    class FakeReader {
      onload: ((e: { target: { result: string } }) => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        queueMicrotask(() => this.onload?.({ target: { result: 'data:image/png;base64,Zm9v' } }));
      }
    }
    class FakeImage {
      width = 800;
      height = 600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('FileReader', FakeReader);
    vi.stubGlobal('Image', FakeImage);
  };
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const oversized = () => {
    const f = new File(['x'], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(f, 'size', { value: 21 * 1024 * 1024 });
    return f;
  };

  describe('ImageUpload (ảnh đơn)', () => {
    it('báo form cha đang tải rồi tải xong; chọn chen vào lúc đang tải không báo bận lần hai', async () => {
      const { ImageUpload } = await loadConfigured();
      const net = pendingFetch();
      const busy: boolean[] = [];
      const onChange = vi.fn();
      const { container } = render(<ImageUpload label="Ảnh" value="" onChange={onChange} onBusyChange={(b) => busy.push(b)} />);
      pickFiles(container, [png('a.png')]);
      await waitFor(() => expect(busy).toEqual([true]));
      expect(onChange).not.toHaveBeenCalled();
      pickFiles(container, [png('b.png')]);
      await settle();
      expect(busy).toEqual([true]);
      expect(net.fetchMock).toHaveBeenCalledTimes(1);

      net.finish('https://res.cloudinary.com/demo/a.png');
      await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://res.cloudinary.com/demo/a.png'));
      await waitFor(() => expect(busy).toEqual([true, false]));
    });

    it('tải thất bại cũng báo xong (không để form cha khoá mãi); ảnh quá 20MB dừng trước khi báo bận', async () => {
      const { ImageUpload } = await loadConfigured();
      class BrokenImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_v: string) {
          queueMicrotask(() => this.onerror?.());
        }
      }
      vi.stubGlobal('Image', BrokenImage);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
      const busy: boolean[] = [];
      const { container } = render(<ImageUpload label="Ảnh" value="" onChange={() => {}} onBusyChange={(b) => busy.push(b)} />);
      pickFiles(container, [png('a.png')]);
      expect((await screen.findByRole('alert')).textContent).toBe('Tải ảnh thất bại. Hãy chọn lại tệp ảnh khác.');
      expect(busy).toEqual([true, false]);

      pickFiles(container, [oversized()]);
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Ảnh quá lớn (tối đa 20MB). Hãy chọn ảnh khác nhé.'));
      expect(busy).toEqual([true, false]);
    });

    it('form cha đang lưu (disabled): ô chọn ảnh và "Đổi ảnh khác" khoá, tệp chen vào bị bỏ; hết lưu thì dùng lại được', async () => {
      const { ImageUpload } = await loadConfigured();
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const busy: boolean[] = [];
      const onChange = vi.fn();
      const props = { label: 'Ảnh', value: 'https://i/cu.jpg', onChange, onBusyChange: (b: boolean) => busy.push(b) };
      const { container, rerender } = render(<ImageUpload {...props} disabled />);
      const openPicker = vi.spyOn(fileInput(container), 'click');
      const tile = () => container.querySelector('button.tubu-press') as HTMLButtonElement;
      const change = () => screen.getByRole('button', { name: 'Đổi ảnh khác' }) as HTMLButtonElement;
      expect(tile().disabled).toBe(true);
      expect(change().disabled).toBe(true);
      fireEvent.click(tile());
      fireEvent.click(change());
      expect(openPicker).not.toHaveBeenCalled();
      pickFiles(container, [png('a.png')]);
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(busy).toEqual([]);

      rerender(<ImageUpload {...props} disabled={false} />);
      expect(tile().disabled).toBe(false);
      expect(change().disabled).toBe(false);
      fireEvent.click(tile());
      expect(openPicker).toHaveBeenCalledTimes(1);
    });

    it('Cloudinary im quá 120 giây: huỷ lượt tải, rơi về ảnh nén tại chỗ và báo xong (không treo nút Lưu của form cha)', async () => {
      fakeLocalDecode();
      const fetchMock = hangingFetch();
      const { ImageUpload } = await loadConfigured();
      vi.useFakeTimers();
      const busy: boolean[] = [];
      const onChange = vi.fn();
      const { container } = render(<ImageUpload label="Ảnh" value="" onChange={onChange} onBusyChange={(b) => busy.push(b)} />);
      await act(async () => {
        pickFiles(container, [png('a.png')]);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(busy).toEqual([true]);

      await advance(119_999);
      expect(busy).toEqual([true]);
      expect(onChange).not.toHaveBeenCalled();

      await advance(1);
      expect(busy).toEqual([true, false]);
      expect(onChange).toHaveBeenCalledWith('data:image/png;base64,Zm9v');
    });
  });

  describe('uploadToCloudinary (dùng chung với ảnh đơn, chat hỗ trợ, đổi ảnh đại diện)', () => {
    it('Cloudinary im quá 120 giây thì huỷ yêu cầu và trả null để nơi gọi rơi về bản tại chỗ', async () => {
      const fetchMock = hangingFetch();
      const { uploadToCloudinary } = await loadConfigured();
      vi.useFakeTimers();
      let result: string | null | undefined;
      void uploadToCloudinary(png('a.png')).then((r) => (result = r));
      await advance(119_999);
      expect(result).toBeUndefined();
      await advance(1);
      expect(result).toBeNull();
      expect((fetchMock.mock.calls[0]![1] as { signal: AbortSignal }).signal.aborted).toBe(true);
    });

    it('tải xong sớm thì không còn hẹn giờ huỷ nào treo lại', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/a.png' }) }));
      const { uploadToCloudinary } = await loadConfigured();
      vi.useFakeTimers();
      await expect(uploadToCloudinary(png('a.png'))).resolves.toBe('https://res.cloudinary.com/demo/a.png');
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('VideoUpload', () => {
    it('video 50MB trên mạng yếu: Cloudinary im quá 300 giây thì huỷ, báo lỗi, nhả khoá và chọn lại được', async () => {
      const fetchMock = hangingFetch();
      const { VideoUpload } = await loadConfigured();
      vi.useFakeTimers();
      const busy: boolean[] = [];
      const onChange = vi.fn();
      const { container } = render(<VideoUpload value="" onChange={onChange} onBusyChange={(b) => busy.push(b)} />);
      await act(async () => {
        pickFiles(container, [mp4()]);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(busy).toEqual([true]);

      await advance(299_999);
      expect(busy).toEqual([true]);
      expect(screen.queryByRole('alert')).toBeNull();

      await advance(1);
      expect(busy).toEqual([true, false]);
      expect(screen.getByRole('alert').textContent).toBe('Tải video thất bại, thử lại.');
      expect(onChange).not.toHaveBeenCalled();
      expect((screen.getByRole('button', { name: /video/i }) as HTMLButtonElement).disabled).toBe(false);
      expect(vi.getTimerCount()).toBe(0);

      // Lần chọn lại sau khi hết hạn chạy được như bình thường.
      fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/lai.mp4', duration: 9 }) }));
      await act(async () => {
        pickFiles(container, [mp4('lai.mp4')]);
      });
      expect(onChange).toHaveBeenCalledWith('https://res.cloudinary.com/demo/lai.mp4');
      expect(busy).toEqual([true, false, true, false]);
    });

    it('hạn chót phủ cả lúc đọc thân phản hồi: phản hồi đã về mà thân không về thì sau 300 giây vẫn nhả khoá', async () => {
      hangingBodyFetch();
      const { VideoUpload } = await loadConfigured();
      vi.useFakeTimers();
      const busy: boolean[] = [];
      const { container } = render(<VideoUpload value="" onChange={() => {}} onBusyChange={(b) => busy.push(b)} />);
      await act(async () => {
        pickFiles(container, [mp4()]);
      });
      await advance(299_999);
      expect(busy).toEqual([true]);
      await advance(1);
      expect(busy).toEqual([true, false]);
      expect(screen.getByRole('alert').textContent).toBe('Tải video thất bại, thử lại.');
    });

    it('tải xong sớm thì không còn hẹn giờ 300 giây nào treo lại', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/v.mp4', duration: 10 }) }));
      const { VideoUpload } = await loadConfigured();
      vi.useFakeTimers();
      const onChange = vi.fn();
      const { container } = render(<VideoUpload value="" onChange={onChange} />);
      await act(async () => {
        pickFiles(container, [mp4()]);
      });
      expect(onChange).toHaveBeenCalledWith('https://res.cloudinary.com/demo/v.mp4');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('form cha đang gửi (disabled): ô chọn video khoá, tệp chen vào bị bỏ; hết gửi thì dùng lại được', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const { VideoUpload } = await loadConfigured();
      const busy: boolean[] = [];
      const props = { value: '', onChange: vi.fn(), onBusyChange: (b: boolean) => busy.push(b) };
      const { container, rerender } = render(<VideoUpload {...props} disabled />);
      const openPicker = vi.spyOn(fileInput(container), 'click');
      const pickButton = () => screen.getByRole('button', { name: /video/i }) as HTMLButtonElement;
      expect(pickButton().disabled).toBe(true);
      fireEvent.click(pickButton());
      expect(openPicker).not.toHaveBeenCalled();
      pickFiles(container, [mp4()]);
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(busy).toEqual([]);

      rerender(<VideoUpload {...props} disabled={false} />);
      expect(pickButton().disabled).toBe(false);
      fireEvent.click(pickButton());
      expect(openPicker).toHaveBeenCalledTimes(1);
    });

    it('đã có video mà form cha đang gửi: "Đổi video" và "Xoá video" khoá, không xoá giữa lúc gửi', async () => {
      vi.stubGlobal('fetch', vi.fn());
      const { VideoUpload } = await loadConfigured();
      const onChange = vi.fn();
      render(<VideoUpload value="https://res.cloudinary.com/demo/cu.mp4" onChange={onChange} disabled />);
      const change = screen.getByRole('button', { name: 'Đổi video' }) as HTMLButtonElement;
      const remove = screen.getByRole('button', { name: 'Xoá video' }) as HTMLButtonElement;
      expect(change.disabled).toBe(true);
      expect(remove.disabled).toBe(true);
      fireEvent.click(remove);
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
