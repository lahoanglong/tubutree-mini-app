import { describe, expect, it } from 'vitest';
import { applyRoiCutout, centerPortraitRoi, clampRoi, cropRgba, cutoutLight, downscaleRgba, dragRoi, formatPct, FULL_ROI, insetRoi, lightThreshold, PREVIEW_EDGE, posterFrameRoi, ROI_DATA_URL_MAX, ROI_MIN, roiRect, TOLERANCE_DEFAULT, TOLERANCE_MAX, type Rgba } from './story-cutout-roi';

/**
 * Poster 100x100: khung đỏ dày 8 chạm mép ảnh, bên trong nền trắng, một sản phẩm tối 30x30 ở giữa (35..64) có ô trắng 6x6 kín bên trong (47..52).
 * Giống ảnh PROD của Sokfarm/BH.NONG/Pơ Lang/Fuwa3e: khung màu chặn thuật toán loang từ mép nên tách nguyên ảnh được 0%.
 */
const SIZE = 100;
const BORDER = 8;
function poster(): Rgba {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  const put = (x: number, y: number, r: number, g: number, b: number) => data.set([r, g, b, 255], (y * SIZE + x) * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const frame = x < BORDER || y < BORDER || x >= SIZE - BORDER || y >= SIZE - BORDER;
      if (frame) put(x, y, 200, 30, 30);
      else put(x, y, 255, 255, 255);
    }
  }
  for (let y = 35; y < 65; y++) for (let x = 35; x < 65; x++) put(x, y, 30, 30, 30);
  for (let y = 47; y < 53; y++) for (let x = 47; x < 53; x++) put(x, y, 255, 255, 255);
  return { data, width: SIZE, height: SIZE };
}
const alphaAt = (img: Rgba, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];

describe('cutoutLight / applyRoiCutout — poster có khung màu chạm mép', () => {
  it('nguyên ảnh: khung đỏ chặn loang nên tách đúng 0% nền', () => {
    const r = applyRoiCutout(poster(), FULL_ROI);
    expect(r.removed).toBe(0);
    expect(r.removedPct).toBe(0);
    expect(alphaAt(r.image, 20, 20)).toBe(255);
  });

  it('cắt viền 10% (vừa khít trong khung đỏ): tách hơn 40% nền, đúng phần trắng quanh sản phẩm', () => {
    const r = applyRoiCutout(poster(), insetRoi(10));
    expect(r.image.width).toBe(80);
    expect(r.image.height).toBe(80);
    // 80x80 điểm, sản phẩm 30x30 = 900 điểm (kể cả ô trắng kín bên trong) được giữ.
    expect(r.removed).toBe(80 * 80 - 900);
    expect(r.removedPct).toBeGreaterThan(40);
    expect(r.removedPct).toBeCloseTo(85.9375, 4);
  });

  it('cắt viền 18%: vẫn tách hơn 40% và giữ nguyên thân sản phẩm', () => {
    const r = applyRoiCutout(poster(), insetRoi(18));
    expect(r.image.width).toBe(64);
    expect(r.removed).toBe(64 * 64 - 900);
    expect(r.removedPct).toBeGreaterThan(40);
  });

  it('thân sản phẩm và ô trắng kín bên trong không bị xoá', () => {
    const { image } = applyRoiCutout(poster(), insetRoi(10));
    // Toạ độ trong ảnh đã cắt = toạ độ poster trừ 10.
    expect(alphaAt(image, 30 - 10 + 5, 30 - 10 + 5)).toBe(255);
    expect(alphaAt(image, 50 - 10, 50 - 10)).toBe(255);
    expect(alphaAt(image, 0, 0)).toBe(0);
    expect(alphaAt(image, 79, 79)).toBe(0);
  });

  it('khung quá chặt (nằm trong thân sản phẩm): không còn nền để tách', () => {
    const r = applyRoiCutout(poster(), { x: 0.4, y: 0.4, width: 0.2, height: 0.2 });
    expect(r.removed).toBe(0);
  });

  it('không sửa ảnh gốc', () => {
    const src = poster();
    const before = new Uint8ClampedArray(src.data);
    applyRoiCutout(src, insetRoi(10));
    expect(Array.from(src.data)).toEqual(Array.from(before));
  });

  it('điểm đã trong suốt sẵn nối với mép cũng tính là nền (ảnh máy chủ đã tách một phần)', () => {
    const img = poster();
    for (let i = 0; i < SIZE * SIZE; i++) if (img.data[i * 4] === 200) img.data[i * 4 + 3] = 0;
    const r = cutoutLight(img);
    expect(r.removed).toBe(SIZE * SIZE - 900);
    expect(alphaAt(r.image, 50, 50)).toBe(255);
  });

  it('ảnh rỗng không chia cho 0', () => {
    expect(cutoutLight({ data: new Uint8ClampedArray(0), width: 0, height: 0 }).removedPct).toBe(0);
  });
});

describe('roiRect / cropRgba', () => {
  it('FULL_ROI cho cả ảnh; khung nhỏ sát mép vẫn dày ít nhất 1 điểm và nằm trong ảnh', () => {
    expect(roiRect(FULL_ROI, 100, 50)).toEqual({ left: 0, top: 0, width: 100, height: 50 });
    const edge = roiRect({ x: 0.999, y: 0.999, width: 0.001, height: 0.001 }, 100, 50);
    expect(edge.width).toBeGreaterThanOrEqual(1);
    expect(edge.height).toBeGreaterThanOrEqual(1);
    expect(edge.left + edge.width).toBeLessThanOrEqual(100);
    expect(edge.top + edge.height).toBeLessThanOrEqual(50);
  });

  it('cắt đúng vùng điểm ảnh, giữ thứ tự hàng', () => {
    const w = 4;
    const data = new Uint8ClampedArray(w * 3 * 4);
    for (let i = 0; i < w * 3; i++) data.set([i, i, i, 255], i * 4);
    const out = cropRgba({ data, width: w, height: 3 }, { left: 1, top: 1, width: 2, height: 2 });
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect([0, 1, 2, 3].map((i) => out.data[i * 4])).toEqual([5, 6, 9, 10]);
  });
});

describe('khung kéo', () => {
  it('insetRoi thụt đều bốn cạnh và kẹp để khung còn ít nhất 25% mỗi chiều', () => {
    expect(insetRoi(10)).toEqual({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    expect(insetRoi(18).width).toBeCloseTo(0.64, 10);
    expect(insetRoi(40)).toEqual({ x: 0.375, y: 0.375, width: 0.25, height: 0.25 });
    expect(insetRoi(99).width).toBeCloseTo(ROI_MIN, 10);
    expect(insetRoi(99).x).toBeCloseTo((1 - ROI_MIN) / 2, 10);
    expect(insetRoi(-5)).toEqual(FULL_ROI);
  });

  it('kéo góc trên trái: hai cạnh kề dịch, cạnh đối diện đứng yên', () => {
    const r = dragRoi(FULL_ROI, 'nw', 0.2, 0.3);
    expect(r).toEqual({ x: 0.2, y: 0.3, width: 0.8, height: 0.7 });
  });

  it('kéo góc dưới phải ra ngoài ảnh bị kẹp ở mép, không nhỏ hơn cạnh tối thiểu', () => {
    const start = insetRoi(10);
    const out = dragRoi(start, 'se', 5, 5);
    expect(out.x + out.width).toBeCloseTo(1, 10);
    expect(out.y + out.height).toBeCloseTo(1, 10);
    const squash = dragRoi(start, 'se', -5, -5);
    expect(squash.width).toBeCloseTo(ROI_MIN, 10);
    expect(squash.height).toBeCloseTo(ROI_MIN, 10);
    expect(squash.x).toBeCloseTo(0.1, 10);
  });

  it('kéo góc trên phải và dưới trái chỉ đổi đúng hai cạnh kề', () => {
    const start = insetRoi(10);
    const ne = dragRoi(start, 'ne', -0.1, 0.1);
    expect(ne.x).toBeCloseTo(0.1, 10);
    expect(ne.y).toBeCloseTo(0.2, 10);
    expect(ne.x + ne.width).toBeCloseTo(0.8, 10);
    expect(ne.y + ne.height).toBeCloseTo(0.9, 10);
    const sw = dragRoi(start, 'sw', 0.1, -0.1);
    expect(sw.x).toBeCloseTo(0.2, 10);
    expect(sw.y).toBeCloseTo(0.1, 10);
    expect(sw.x + sw.width).toBeCloseTo(0.9, 10);
    expect(sw.y + sw.height).toBeCloseTo(0.8, 10);
  });

  it('kéo cả khung giữ nguyên kích thước và không trượt ra ngoài ảnh', () => {
    const start = insetRoi(10);
    const moved = dragRoi(start, 'move', 0.5, -0.5);
    expect(moved.width).toBeCloseTo(0.8, 10);
    expect(moved.height).toBeCloseTo(0.8, 10);
    expect(moved.x).toBeCloseTo(0.2, 10);
    expect(moved.y).toBeCloseTo(0, 10);
  });

  it('clampRoi sửa khung hỏng về trong ảnh', () => {
    const r = clampRoi({ x: 2, y: -1, width: 5, height: 0 });
    expect(r.width).toBe(1);
    expect(r.height).toBe(ROI_MIN);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });
});

describe('downscaleRgba — bản xem trước nhanh', () => {
  const ramp = (w: number, h: number): Rgba => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x % 256, y % 256, 7, 255], (y * w + x) * 4);
    return { data, width: w, height: h };
  };

  it('ảnh không dài hơn giới hạn thì trả lại đúng đối tượng cũ, không sao chép', () => {
    const src = ramp(40, 30);
    expect(downscaleRgba(src, 40)).toBe(src);
    expect(downscaleRgba(src, 480)).toBe(src);
  });

  it('cạnh dài về đúng giới hạn, giữ tỉ lệ khung hình', () => {
    const out = downscaleRgba(ramp(200, 100), 50);
    expect(out.width).toBe(50);
    expect(out.height).toBe(25);
    expect(out.data.length).toBe(50 * 25 * 4);
    const tall = downscaleRgba(ramp(100, 300), 60);
    expect(tall.height).toBe(60);
    expect(tall.width).toBe(20);
  });

  it('lấy điểm gần nhất: mỗi điểm ra là một điểm có thật của ảnh gốc, vị trí tỉ lệ đúng', () => {
    const out = downscaleRgba(ramp(100, 100), 10);
    const at = (x: number, y: number) => Array.from(out.data.subarray((y * 10 + x) * 4, (y * 10 + x) * 4 + 4));
    expect(at(0, 0)).toEqual([0, 0, 7, 255]);
    expect(at(5, 3)).toEqual([50, 30, 7, 255]);
    expect(at(9, 9)).toEqual([90, 90, 7, 255]);
  });

  it('giữ nguyên khung đỏ chạm mép và nền trắng nên số % tách vẫn gần bản đầy đủ', () => {
    const full = poster();
    const big: Rgba = { data: new Uint8ClampedArray(SIZE * 6 * SIZE * 6 * 4), width: SIZE * 6, height: SIZE * 6 };
    for (let y = 0; y < big.height; y++) {
      for (let x = 0; x < big.width; x++) {
        const from = (Math.floor(y / 6) * SIZE + Math.floor(x / 6)) * 4;
        big.data.set(full.data.subarray(from, from + 4), (y * big.width + x) * 4);
      }
    }
    const small = downscaleRgba(big, PREVIEW_EDGE);
    expect(Math.max(small.width, small.height)).toBe(PREVIEW_EDGE);
    const a = applyRoiCutout(big, insetRoi(10)).removedPct;
    const b = applyRoiCutout(small, insetRoi(10)).removedPct;
    expect(a).toBeCloseTo(85.9375, 1);
    expect(Math.abs(a - b)).toBeLessThan(0.5);
  });

  it('giới hạn không hợp lệ thì không thu nhỏ', () => {
    const src = ramp(20, 20);
    expect(downscaleRgba(src, 0)).toBe(src);
  });
});

describe('hằng số giới hạn', () => {
  it('trần data URL thấp hơn IMAGE_MAX của máy chủ (1_500_000) và bản xem trước đủ nhỏ để kéo mượt', () => {
    expect(ROI_DATA_URL_MAX).toBeLessThan(1_500_000);
    expect(PREVIEW_EDGE).toBeLessThanOrEqual(640);
  });
});

describe('formatPct', () => {
  it('một chữ số thập phân, dấu phẩy, kẹp 0..100', () => {
    expect(formatPct(85.9375)).toBe('85,9');
    expect(formatPct(0)).toBe('0,0');
    expect(formatPct(-3)).toBe('0,0');
    expect(formatPct(140)).toBe('100,0');
  });
});

describe('posterFrameRoi — nút "Bỏ viền khung poster (co 12%)"', () => {
  it('co đều 12% mỗi cạnh, bằng insetRoi(12)', () => {
    const r = posterFrameRoi();
    expect(r).toEqual(insetRoi(12));
    expect(r.x).toBeCloseTo(0.12, 10);
    expect(r.width).toBeCloseTo(0.76, 10);
  });

  it('khung đỏ dày 8% của poster thử nằm gọn ngoài vùng cắt: tách hơn 40% nền và giữ thân sản phẩm', () => {
    const r = applyRoiCutout(poster(), posterFrameRoi());
    expect(r.image.width).toBe(76);
    expect(r.removed).toBe(76 * 76 - 900);
    expect(r.removedPct).toBeGreaterThan(40);
  });
});

describe('centerPortraitRoi — nút "Khung dọc trung tâm (60%×82%)"', () => {
  it('rộng 60%, cao 82%, nằm chính giữa ảnh', () => {
    const r = centerPortraitRoi();
    expect(r.width).toBeCloseTo(0.6, 10);
    expect(r.height).toBeCloseTo(0.82, 10);
    expect(r.x).toBeCloseTo(0.2, 10);
    expect(r.y).toBeCloseTo(0.09, 10);
    expect(clampRoi(r)).toEqual(r);
  });

  it('cắt ảnh vuông 100x100 ra 60x82 và vẫn tách được nền quanh sản phẩm ở giữa', () => {
    const r = applyRoiCutout(poster(), centerPortraitRoi());
    expect(r.image.width).toBe(60);
    expect(r.image.height).toBe(82);
    expect(r.removed).toBe(60 * 82 - 900);
  });
});

describe('ngưỡng độ lệch màu nền (tolerance)', () => {
  /** Nền xám nhạt `bg` thay cho nền trắng, không có khung: ảnh chụp nền hơi xám do nén. */
  function greyShot(bg: number): Rgba {
    const data = new Uint8ClampedArray(SIZE * SIZE * 4);
    for (let i = 0; i < SIZE * SIZE; i++) data.set([bg, bg, bg, 255], i * 4);
    for (let y = 35; y < 65; y++) for (let x = 35; x < 65; x++) data.set([30, 30, 30, 255], (y * SIZE + x) * 4);
    return { data, width: SIZE, height: SIZE };
  }

  it('mặc định 20 (ngưỡng 235) khớp thuật toán máy chủ; tối đa 60; ngưỡng = 255 − độ lệch, kẹp 0..60', () => {
    expect(TOLERANCE_DEFAULT).toBe(20);
    expect(TOLERANCE_MAX).toBe(60);
    expect(lightThreshold(TOLERANCE_DEFAULT)).toBe(235);
    expect(lightThreshold(0)).toBe(255);
    expect(lightThreshold(-5)).toBe(255);
    expect(lightThreshold(999)).toBe(255 - TOLERANCE_MAX);
    expect(lightThreshold(Number.NaN)).toBe(235);
  });

  it('nền xám 220 không tách ở mặc định nhưng tách sạch khi nới độ lệch lên 40', () => {
    const src = greyShot(220);
    expect(cutoutLight(src).removed).toBe(0);
    const loose = cutoutLight(src, 40);
    expect(loose.removed).toBe(SIZE * SIZE - 900);
    expect(loose.image.data[(50 * SIZE + 50) * 4 + 3]).toBe(255);
  });

  it('độ lệch 0 chỉ tách trắng tinh: nền 250 còn nguyên, nền 255 mất', () => {
    expect(cutoutLight(greyShot(250), 0).removed).toBe(0);
    expect(cutoutLight(greyShot(255), 0).removed).toBe(SIZE * SIZE - 900);
  });

  it('không truyền độ lệch thì ra đúng kết quả cũ của poster (không đổi hành vi)', () => {
    expect(applyRoiCutout(poster(), insetRoi(10)).removed).toBe(80 * 80 - 900);
    expect(applyRoiCutout(poster(), insetRoi(10), TOLERANCE_DEFAULT).removed).toBe(80 * 80 - 900);
  });
});
