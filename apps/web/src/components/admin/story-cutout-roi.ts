/**
 * Cắt khung (ROI) rồi tách nền sáng, chạy ngay trong trình duyệt trên điểm ảnh RGBA.
 *
 * Ảnh poster của nhãn hàng thường có khung màu chạm mép ảnh: thuật toán loang từ 4 cạnh (cùng thuật toán `cutoutWhite` ở máy chủ,
 * apps/api/src/modules/catalog/story-cutout.ts) gặp khung là dừng nên tách được 0% nền. Admin khoanh phần bên trong khung (chai, túi)
 * trước, rồi mới loang từ mép khung cắt, nơi nền quanh sản phẩm còn trắng.
 */

/** Khung cắt chuẩn hoá 0..1 so với ảnh gốc; gốc toạ độ ở góc trên trái. */
export interface Roi {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Rgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export const FULL_ROI: Roi = { x: 0, y: 0, width: 1, height: 1 };
/** Cạnh tối thiểu của khung (25% ảnh): ở màn 360px sân khấu rộng khoảng 270px nên khung còn ~67px, đủ để bốn tay nắm 44px không chồng lên nhau mà che hết khung. */
export const ROI_MIN = 0.25;
/** Cạnh dài tối đa của bản xem trước trực tiếp: ảnh 1600px thì mỗi lần kéo cấp phát hàng chục MB, nên chỉ ảnh cuối cùng mới tính ở cỡ đầy đủ. */
export const PREVIEW_EDGE = 480;
/** Trần độ dài data URL của ảnh sân khấu; thấp hơn một chút `IMAGE_MAX` (1_500_000) của apps/api/src/modules/catalog/product-admin.controller.ts để Lưu không bị 400. */
export const ROI_DATA_URL_MAX = 1_400_000;
/** Ngưỡng "gần trắng", cùng giá trị với máy chủ: ảnh chụp nền trắng hay có viền xám nhạt do nén. */
export const LIGHT = 235;
/** Điểm ảnh gần trong suốt coi là nền (ảnh đã được máy chủ tách một phần). */
const SEE_THROUGH = 16;

export type RoiHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function clampRoi(roi: Roi, min = ROI_MIN): Roi {
  const width = clamp(roi.width, min, 1);
  const height = clamp(roi.height, min, 1);
  return { x: clamp(roi.x, 0, 1 - width), y: clamp(roi.y, 0, 1 - height), width, height };
}

/** Khung thụt vào đều `pct`% mỗi cạnh ("Cắt viền 10%"). `pct` ngoài 0..37,5 bị kẹp để khung còn ít nhất 25% mỗi chiều (`ROI_MIN`). */
export function insetRoi(pct: number): Roi {
  const p = clamp(pct, 0, ((1 - ROI_MIN) / 2) * 100) / 100;
  return { x: p, y: p, width: 1 - 2 * p, height: 1 - 2 * p };
}

/**
 * Kéo một tay nắm (`dx`, `dy` tính theo tỉ lệ ảnh) từ khung `start`. Góc kéo hai cạnh kề nó, cạnh đối diện đứng yên; `move` tịnh tiến cả khung.
 * Kết quả luôn nằm trong ảnh và không nhỏ hơn `min`.
 */
export function dragRoi(start: Roi, handle: RoiHandle, dx: number, dy: number, min = ROI_MIN): Roi {
  if (handle === 'move') return clampRoi({ ...start, x: start.x + dx, y: start.y + dy }, min);
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle === 'nw' || handle === 'sw') left = clamp(left + dx, 0, right - min);
  else right = clamp(right + dx, left + min, 1);
  if (handle === 'nw' || handle === 'ne') top = clamp(top + dy, 0, bottom - min);
  else bottom = clamp(bottom + dy, top + min, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Đổi khung chuẩn hoá sang hình chữ nhật điểm ảnh nguyên, nằm trong ảnh và dày ít nhất 1 điểm. */
export function roiRect(roi: Roi, width: number, height: number): PixelRect {
  const left = clamp(Math.round(roi.x * width), 0, Math.max(0, width - 1));
  const top = clamp(Math.round(roi.y * height), 0, Math.max(0, height - 1));
  return {
    left,
    top,
    width: clamp(Math.round(roi.width * width), 1, Math.max(1, width - left)),
    height: clamp(Math.round(roi.height * height), 1, Math.max(1, height - top)),
  };
}

/** Thu nhỏ bằng điểm gần nhất để cạnh dài không quá `maxEdge`; ảnh đã nhỏ hơn thì trả lại chính nó. Chỉ dùng cho bản xem trước nhanh, không cho ảnh xuất ra. */
export function downscaleRgba(src: Rgba, maxEdge: number): Rgba {
  const longest = Math.max(src.width, src.height);
  if (longest <= maxEdge || maxEdge < 1) return src;
  const k = maxEdge / longest;
  const width = Math.max(1, Math.round(src.width * k));
  const height = Math.max(1, Math.round(src.height * k));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / k));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / k));
      const from = (sy * src.width + sx) * 4;
      data.set(src.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

export function cropRgba(src: Rgba, rect: PixelRect): Rgba {
  const out = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    const from = ((rect.top + y) * src.width + rect.left) * 4;
    out.set(src.data.subarray(from, from + rect.width * 4), y * rect.width * 4);
  }
  return { data: out, width: rect.width, height: rect.height };
}

export interface CutoutResult {
  image: Rgba;
  /** Số điểm ảnh nền đã thành trong suốt (kể cả điểm đã trong suốt sẵn nối với mép). */
  removed: number;
  /** `removed` trên tổng điểm ảnh của ảnh đã cắt, 0..100. */
  removedPct: number;
}

/**
 * Tách nền sáng: chỉ điểm ảnh sáng (hoặc đã trong suốt) NỐI LIỀN với mép ảnh, loang 4 hướng từ 4 cạnh, thành trong suốt.
 * Vùng sáng kín trong thân sản phẩm (nhãn trắng, ánh sáng) không nối ra mép nên được giữ. Không sửa `src`.
 */
export function cutoutLight(src: Rgba): CutoutResult {
  const { width, height } = src;
  const data = new Uint8ClampedArray(src.data);
  const total = width * height;
  const isBackground = (p: number) => {
    const i = p * 4;
    return (
      (data[i + 3] ?? 255) < SEE_THROUGH ||
      ((data[i] ?? 0) >= LIGHT && (data[i + 1] ?? 0) >= LIGHT && (data[i + 2] ?? 0) >= LIGHT)
    );
  };
  const seen = new Uint8Array(total);
  const stack = new Int32Array(total);
  let top = 0;
  let removed = 0;
  const push = (p: number) => {
    if (seen[p] || !isBackground(p)) return;
    seen[p] = 1;
    stack[top++] = p;
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (top > 0) {
    const p = stack[--top] as number;
    const x = p % width;
    data[p * 4 + 3] = 0;
    removed++;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < width * (height - 1)) push(p + width);
  }
  return {
    image: { data, width, height },
    removed,
    removedPct: total === 0 ? 0 : (removed / total) * 100,
  };
}

/** Cắt theo `roi` rồi tách nền. `FULL_ROI` cho đúng kết quả của việc tách nền không cắt. */
export function applyRoiCutout(src: Rgba, roi: Roi): CutoutResult {
  return cutoutLight(cropRgba(src, roiRect(roi, src.width, src.height)));
}

/** "85,9" kiểu Việt Nam, một chữ số thập phân; không dùng `toLocaleString` để kết quả không đổi theo bộ ICU của máy. */
export function formatPct(pct: number): string {
  return clamp(pct, 0, 100).toFixed(1).replace('.', ',');
}
