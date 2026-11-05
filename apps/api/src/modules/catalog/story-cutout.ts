import sharp from 'sharp';

// Ngưỡng "gần trắng": ảnh sản phẩm chụp nền trắng hay có viền xám nhạt do nén, 235 vẫn coi là nền.
const LIGHT = 235;

/**
 * Tách nền sáng: chỉ pixel sáng NỐI LIỀN với viền ảnh (flood fill 4 hướng từ 4 cạnh) thành trong suốt.
 * Vùng sáng nằm kín trong thân sản phẩm (nhãn trắng, ánh sáng) không bị xoá vì không nối ra viền.
 */
export async function cutoutWhite(buf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const isLight = (p: number) => (data[p * 4] ?? 0) >= LIGHT && (data[p * 4 + 1] ?? 0) >= LIGHT && (data[p * 4 + 2] ?? 0) >= LIGHT;
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;
  const push = (p: number) => {
    if (seen[p] || !isLight(p)) return;
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
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < width * (height - 1)) push(p + width);
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
