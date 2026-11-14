// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { useState } from 'react';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { StoryRoiCutout } from './story-roi-cutout';
import { PREVIEW_EDGE, ROI_DATA_URL_MAX } from './story-cutout-roi';

// jsdom không có canvas thật: giả getContext/toDataURL trên prototype và lớp Image. Poster 100x100 giống spec thuần:
// khung đỏ dày 8 chạm mép, nền trắng bên trong, sản phẩm tối 30x30 ở giữa có ô trắng kín.
const SIZE = 100;
function posterPixels(scale = 1) {
  const base = basePoster();
  if (scale === 1) return base;
  const edge = SIZE * scale;
  const out = new Uint8ClampedArray(edge * edge * 4);
  for (let y = 0; y < edge; y++) {
    for (let x = 0; x < edge; x++) {
      const from = (Math.floor(y / scale) * SIZE + Math.floor(x / scale)) * 4;
      out.set(base.subarray(from, from + 4), (y * edge + x) * 4);
    }
  }
  return out;
}
function basePoster() {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  const put = (x: number, y: number, r: number, g: number, b: number) => data.set([r, g, b, 255], (y * SIZE + x) * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const frame = x < 8 || y < 8 || x >= SIZE - 8 || y >= SIZE - 8;
      if (frame) put(x, y, 200, 30, 30);
      else put(x, y, innerBg, innerBg, innerBg);
    }
  }
  for (let y = 35; y < 65; y++) for (let x = 35; x < 65; x++) put(x, y, 30, 30, 30);
  for (let y = 47; y < 53; y++) for (let x = 47; x < 53; x++) put(x, y, 255, 255, 255);
  return data;
}

const canvasDraws: { width: number; height: number; alphaZero: number }[] = [];
let imageFails = false;
// Độ sáng nền bên trong khung poster (255 = trắng tinh); ca nền xám hạ xuống để thử thanh độ lệch màu.
let innerBg = 255;
let noContext = false;
// Hệ số phóng ảnh poster (1 = 100x100, 6 = 600x600 để vượt PREVIEW_EDGE) và độ dài data URL giả do toDataURL trả.
let imageScale = 1;
let dataUrlLength: ((w: number, h: number) => number) | null = null;
const encodedSizes: { width: number; height: number }[] = [];

function installCanvas() {
  canvasDraws.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (noContext) return null;
    return {
      drawImage: () => undefined,
      getImageData: () => ({ data: posterPixels(imageScale), width: SIZE * imageScale, height: SIZE * imageScale }),
      createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
      putImageData: (img: { data: Uint8ClampedArray; width: number; height: number }) => {
        let alphaZero = 0;
        for (let i = 3; i < img.data.length; i += 4) if (img.data[i] === 0) alphaZero++;
        canvasDraws.push({ width: img.width, height: img.height, alphaZero });
      },
    } as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
    encodedSizes.push({ width: this.width, height: this.height });
    if (dataUrlLength) return `data:image/png;base64,${'A'.repeat(dataUrlLength(this.width, this.height))}`;
    return `data:image/webp;base64,ROI${this.width}x${this.height}`;
  });
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = SIZE * imageScale;
      naturalHeight = SIZE * imageScale;
      set src(_v: string) {
        queueMicrotask(() => (imageFails ? this.onerror?.() : this.onload?.()));
      }
    },
  );
}

let mounted: Rendered[] = [];
beforeEach(() => {
  imageFails = false;
  innerBg = 255;
  noContext = false;
  imageScale = 1;
  dataUrlLength = null;
  encodedSizes.length = 0;
  installCanvas();
  // jsdom không dàn trang: mọi phần tử rộng 200x200 để đổi toạ độ chuột sang tỉ lệ ảnh.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, toJSON: () => ({}) });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(over: Partial<Parameters<typeof StoryRoiCutout>[0]> = {}) {
  const onUse = vi.fn();
  const onClose = vi.fn();
  const r = render(<StoryRoiCutout src="data:image/webp;base64,AAAA" onUse={onUse} onClose={onClose} {...over} />);
  mounted.push(r);
  await flush();
  return { onUse, onClose, root: r.container };
}
const pctText = () => document.querySelector('[data-testid="story-roi-pct"]')?.textContent;
const rect = () => document.querySelector<HTMLElement>('[data-testid="story-roi-rect"]')!;
const handle = (h: string) => document.querySelector<HTMLElement>(`[data-testid="story-roi-handle-${h}"]`)!;
const quick = (label: string) => byText(document.body, 'button', label)!;
const tolerance = () => document.querySelector<HTMLInputElement>('[data-testid="story-roi-tolerance"]')!;
/** Sự kiện con trỏ; jsdom có thể thiếu PointerEvent nên lùi về MouseEvent mang thêm pointerId. */
function pointer(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, button = 0) {
  const init = { bubbles: true, clientX: x, clientY: y, pointerId: 7, button };
  const ev = typeof PointerEvent === 'function' ? new PointerEvent(type, init) : Object.assign(new MouseEvent(type, init), { pointerId: 7 });
  act(() => {
    el.dispatchEvent(ev);
  });
}
const styleOf = (el: HTMLElement) => ({ left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height });

describe('StoryRoiCutout — khoanh khung rồi tách nền', () => {
  it('nguyên ảnh poster: tách 0,0% và nói rõ vì sao; khung phủ cả ảnh', async () => {
    await mount();
    expect(pctText()).toBe('0,0%');
    expect(document.body.textContent).toContain('Chưa tách được nền');
    expect(styleOf(rect())).toEqual({ left: '0%', top: '0%', width: '100%', height: '100%' });
    expect(canvasDraws.at(-1)).toMatchObject({ width: SIZE, height: SIZE, alphaZero: 0 });
  });

  it('số % nền đã tách dùng chữ số đều (tabular-nums)', async () => {
    await mount();
    expect(document.querySelector('[data-testid="story-roi-pct"]')?.className).toContain('tabular-nums');
  });

  it('"Cắt viền 10%" tách hơn 40% nền rồi "Đặt lại" về 0,0%; vẽ lại đúng ảnh đã cắt', async () => {
    await mount();
    click(quick('Cắt viền 10%'));
    await flush();
    expect(pctText()).toBe('85,9%');
    expect(document.body.textContent).not.toContain('Chưa tách được nền');
    expect(styleOf(rect())).toEqual({ left: '10%', top: '10%', width: '80%', height: '80%' });
    expect(canvasDraws.at(-1)).toMatchObject({ width: 80, height: 80, alphaZero: 80 * 80 - 900 });
    click(quick('Đặt lại'));
    await flush();
    expect(pctText()).toBe('0,0%');
    expect(canvasDraws.at(-1)).toMatchObject({ width: SIZE, height: SIZE, alphaZero: 0 });
  });

  it('"Cắt viền 18%" cho khung 64% và tách hơn 40%', async () => {
    await mount();
    click(quick('Cắt viền 18%'));
    await flush();
    expect(pctText()).toBe('78,0%');
    expect(styleOf(rect())).toEqual({ left: '18%', top: '18%', width: '64%', height: '64%' });
  });

  it('mọi nút chạm và tay nắm cao/rộng ít nhất 44px (khổ điện thoại)', async () => {
    await mount();
    for (const h of ['nw', 'ne', 'sw', 'se']) {
      expect(handle(h).className).toContain('h-[44px]');
      expect(handle(h).className).toContain('w-[44px]');
    }
    for (const label of ['Cắt viền 10%', 'Cắt viền 18%', 'Đặt lại', 'Dùng ảnh đã cắt làm ảnh sân khấu', 'Đóng']) {
      expect(quick(label).className, label).toContain('min-h-[44px]');
    }
  });

  it('"Bỏ viền khung poster (co 12%)" cắt khung đỏ chỉ với một chạm rồi tách phần nền còn lại', async () => {
    await mount();
    click(quick('Bỏ viền khung poster (co 12%)'));
    await flush();
    expect(styleOf(rect())).toEqual({ left: '12%', top: '12%', width: '76%', height: '76%' });
    expect(pctText()).toBe('84,4%');
    expect(canvasDraws.at(-1)).toMatchObject({ width: 76, height: 76, alphaZero: 76 * 76 - 900 });
  });

  it('"Khung dọc trung tâm (60%×82%)" đặt khung đứng chính giữa và tách nền', async () => {
    await mount();
    click(quick('Khung dọc trung tâm (60%×82%)'));
    await flush();
    expect(styleOf(rect())).toEqual({ left: '20%', top: '9%', width: '60%', height: '82%' });
    expect(pctText()).toBe('81,7%');
    expect(canvasDraws.at(-1)).toMatchObject({ width: 60, height: 82, alphaZero: 60 * 82 - 900 });
  });

  it('hai nút khung nhanh và thanh độ lệch đạt chuẩn chạm 44px', async () => {
    await mount();
    for (const label of ['Bỏ viền khung poster (co 12%)', 'Khung dọc trung tâm (60%×82%)']) expect(quick(label).className, label).toContain('min-h-[44px]');
    const slider = tolerance();
    expect(slider.type).toBe('range');
    expect(slider.className).toContain('h-[44px]');
    expect(slider.getAttribute('aria-label')).toBe('Độ lệch màu nền');
  });

  it('thanh độ lệch màu nền: mặc định 20, từ 0 đến 60, ghi số đang chọn', async () => {
    await mount();
    const slider = tolerance();
    expect([slider.min, slider.max, slider.value]).toEqual(['0', '60', '20']);
    expect(document.querySelector('[data-testid="story-roi-tolerance-value"]')?.textContent).toBe('20');
    typeInto(slider, '35');
    await flush();
    expect(document.querySelector('[data-testid="story-roi-tolerance-value"]')?.textContent).toBe('35');
  });

  it('nền xám 220 trong khung: mặc định không tách, kéo thanh lên 40 thì tách sạch; ảnh cuối cùng dùng cùng độ lệch', async () => {
    innerBg = 220;
    const { onUse } = await mount();
    click(quick('Cắt viền 10%'));
    await flush();
    expect(pctText()).toBe('0,0%');
    expect(document.body.textContent).toContain('Chưa tách được nền');
    typeInto(tolerance(), '40');
    await flush();
    expect(pctText()).toBe('85,9%');
    click(quick('Dùng ảnh đã cắt làm ảnh sân khấu'));
    expect(canvasDraws.at(-1)).toMatchObject({ width: 80, height: 80, alphaZero: 80 * 80 - 900 });
    expect(onUse).toHaveBeenCalledWith('data:image/webp;base64,ROI80x80');
  });

  it('"Đặt lại" trả cả khung lẫn độ lệch về mặc định', async () => {
    await mount();
    click(quick('Bỏ viền khung poster (co 12%)'));
    typeInto(tolerance(), '50');
    await flush();
    click(quick('Đặt lại'));
    await flush();
    expect(styleOf(rect())).toEqual({ left: '0%', top: '0%', width: '100%', height: '100%' });
    expect(tolerance().value).toBe('20');
  });

  it('kéo góc bằng con trỏ (chuột hoặc cảm ứng) đổi khung theo tỉ lệ ảnh và tách theo khung mới', async () => {
    await mount();
    pointer(handle('nw'), 'pointerdown', 0, 0);
    pointer(handle('nw'), 'pointermove', 20, 20);
    pointer(handle('nw'), 'pointerup', 20, 20);
    await flush();
    expect(styleOf(rect())).toEqual({ left: '10%', top: '10%', width: '90%', height: '90%' });
    // Khung 10%..100% (90x90): mép trên/trái đã là nền trắng nên loang vào được; khung đỏ còn lại ở mép phải/dưới chỉ không bị tách. Nền trắng 82x82 trừ sản phẩm 900 điểm.
    expect(pctText()).toBe('71,9%');
    pointer(handle('se'), 'pointerdown', 200, 200);
    pointer(handle('se'), 'pointermove', 180, 180);
    pointer(handle('se'), 'pointerup', 180, 180);
    await flush();
    expect(styleOf(rect())).toEqual({ left: '10%', top: '10%', width: '80%', height: '80%' });
    expect(pctText()).toBe('85,9%');
  });

  it('kéo cả khung bằng thân khung: dịch nhưng không trượt khỏi ảnh', async () => {
    await mount();
    click(quick('Cắt viền 10%'));
    pointer(rect(), 'pointerdown', 100, 100);
    pointer(rect(), 'pointermove', 300, 100);
    pointer(rect(), 'pointerup', 300, 100);
    await flush();
    expect(styleOf(rect())).toEqual({ left: '20%', top: '10%', width: '80%', height: '80%' });
  });

  it('con trỏ di chuyển khi chưa nhấn không đổi khung', async () => {
    await mount();
    pointer(handle('nw'), 'pointermove', 50, 50);
    await flush();
    expect(styleOf(rect())).toEqual({ left: '0%', top: '0%', width: '100%', height: '100%' });
  });

  it('phím mũi tên trên tay nắm dịch 1%', async () => {
    await mount();
    act(() => {
      handle('se').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    });
    await flush();
    expect(styleOf(rect()).width).toBe('99%');
    act(() => {
      handle('nw').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    });
    expect(styleOf(rect()).top).toBe('1%');
  });

  it('"Dùng ảnh đã cắt" trả data URL của ảnh đã cắt và tách nền theo khung hiện tại', async () => {
    const { onUse } = await mount();
    click(quick('Cắt viền 10%'));
    await flush();
    click(quick('Dùng ảnh đã cắt làm ảnh sân khấu'));
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledWith('data:image/webp;base64,ROI80x80');
  });

  it('"Đóng" gọi onClose', async () => {
    const { onClose, onUse } = await mount();
    click(quick('Đóng'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUse).not.toHaveBeenCalled();
  });

  it('đang khoá (disabled): nút và tay nắm khoá, kéo không đổi khung, không dùng được', async () => {
    const { onUse } = await mount({ disabled: true });
    for (const label of ['Cắt viền 10%', 'Cắt viền 18%', 'Bỏ viền khung poster (co 12%)', 'Khung dọc trung tâm (60%×82%)', 'Đặt lại', 'Dùng ảnh đã cắt làm ảnh sân khấu']) expect((quick(label) as HTMLButtonElement).disabled, label).toBe(true);
    expect(tolerance().disabled).toBe(true);
    expect((handle('nw') as HTMLButtonElement).disabled).toBe(true);
    pointer(rect(), 'pointerdown', 100, 100);
    pointer(rect(), 'pointermove', 150, 150);
    await flush();
    expect(styleOf(rect())).toEqual({ left: '0%', top: '0%', width: '100%', height: '100%' });
    expect(onUse).not.toHaveBeenCalled();
  });

  it('không đọc được ảnh: báo lỗi, không có khung và không dùng được', async () => {
    imageFails = true;
    const { onUse } = await mount();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Không đọc được ảnh này để cắt');
    expect(document.querySelector('[data-testid="story-roi-stage"]')).toBeNull();
    expect((quick('Dùng ảnh đã cắt làm ảnh sân khấu') as HTMLButtonElement).disabled).toBe(true);
    expect(onUse).not.toHaveBeenCalled();
  });

  it('môi trường không có canvas: báo lỗi thay vì treo ở "Đang đọc ảnh…"', async () => {
    noContext = true;
    await mount();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Không đọc được ảnh này để cắt');
    expect(document.body.textContent).not.toContain('Đang đọc ảnh');
  });

  it('nút chuột phải hoặc giữa không bắt đầu kéo', async () => {
    await mount();
    pointer(handle('nw'), 'pointerdown', 0, 0, 2);
    pointer(handle('nw'), 'pointermove', 40, 40);
    pointer(rect(), 'pointerdown', 100, 100, 1);
    pointer(rect(), 'pointermove', 150, 150);
    await flush();
    expect(styleOf(rect())).toEqual({ left: '0%', top: '0%', width: '100%', height: '100%' });
    pointer(handle('nw'), 'pointerdown', 0, 0, 0);
    pointer(handle('nw'), 'pointermove', 40, 40);
    await flush();
    expect(styleOf(rect()).left).toBe('20%');
  });

  it('bị khoá giữa lúc đang kéo: các lần di chuyển sau đó không đổi khung nữa', async () => {
    let lock: (v: boolean) => void = () => undefined;
    function Harness() {
      const [disabled, setDisabled] = useState(false);
      lock = setDisabled;
      return <StoryRoiCutout src="data:image/webp;base64,AAAA" onUse={() => undefined} onClose={() => undefined} disabled={disabled} />;
    }
    const r = render(<Harness />);
    mounted.push(r);
    await flush();
    // Khung phủ cả ảnh thì không còn chỗ để dịch: thụt viền trước cho khung có chỗ trượt.
    click(quick('Cắt viền 10%'));
    pointer(rect(), 'pointerdown', 100, 100);
    pointer(rect(), 'pointermove', 110, 100);
    await flush();
    const before = styleOf(rect());
    expect(before.left).toBe('15%');
    act(() => lock(true));
    pointer(rect(), 'pointermove', 140, 100);
    await flush();
    expect(styleOf(rect())).toEqual(before);
  });

  describe('ảnh lớn hơn bản xem trước', () => {
    it('xem trước và số % tính trên bản thu nhỏ, ảnh cuối cùng vẫn đủ kích thước', async () => {
      imageScale = 6; // 600x600 > PREVIEW_EDGE (480)
      const { onUse } = await mount();
      click(quick('Cắt viền 10%'));
      await flush();
      const preview = canvasDraws.at(-1)!;
      expect(Math.max(preview.width, preview.height)).toBeLessThanOrEqual(PREVIEW_EDGE);
      // Khung 80% của bản 480px là 384px.
      expect(preview).toMatchObject({ width: 384, height: 384 });
      expect(pctText()).toBe('85,9%');
      click(quick('Dùng ảnh đã cắt làm ảnh sân khấu'));
      // Ảnh xuất ra cắt từ bản 600px: 80% = 480px, không bị thu nhỏ xuống cỡ xem trước.
      expect(encodedSizes.at(-1)).toEqual({ width: 480, height: 480 });
      expect(onUse).toHaveBeenCalledWith('data:image/webp;base64,ROI480x480');
    });

    it('ảnh nhỏ hơn bản xem trước: xem trước dùng đúng ảnh gốc, không làm mờ', async () => {
      await mount();
      expect(canvasDraws.at(-1)).toMatchObject({ width: SIZE, height: SIZE });
    });
  });

  describe('data URL vượt trần của máy chủ (Safari trả PNG thay vì WebP)', () => {
    it('quá nặng thì thu nhỏ dần tới khi vừa rồi mới trả về', async () => {
      imageScale = 6;
      // 8 byte mỗi điểm ảnh: 480x480 = 1,84 triệu (quá), 360x360 = 1,04 triệu (vừa).
      dataUrlLength = (w, h) => w * h * 8;
      const { onUse } = await mount();
      click(quick('Cắt viền 10%'));
      await flush();
      click(quick('Dùng ảnh đã cắt làm ảnh sân khấu'));
      expect(encodedSizes.map((e) => e.width)).toEqual([480, 360]);
      expect(onUse).toHaveBeenCalledTimes(1);
      expect(onUse.mock.calls[0]![0].length).toBeLessThanOrEqual(ROI_DATA_URL_MAX);
      expect(document.querySelector('[role="alert"]')).toBeNull();
    });

    it('thu nhỏ mãi vẫn nặng: báo lỗi, không gọi onUse, kéo khung thì lời báo biến mất', async () => {
      dataUrlLength = () => ROI_DATA_URL_MAX + 1;
      const { onUse } = await mount();
      click(quick('Dùng ảnh đã cắt làm ảnh sân khấu'));
      expect(onUse).not.toHaveBeenCalled();
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('quá nặng');
      expect(encodedSizes.length).toBeGreaterThan(1);
      click(quick('Cắt viền 10%'));
      await flush();
      expect(document.querySelector('[role="alert"]')).toBeNull();
    });

    it('ảnh nhẹ ngay lần đầu: mã hoá đúng một lần', async () => {
      const { onUse } = await mount();
      click(quick('Dùng ảnh đã cắt làm ảnh sân khấu'));
      expect(encodedSizes).toHaveLength(1);
      expect(onUse).toHaveBeenCalledTimes(1);
    });
  });
});
