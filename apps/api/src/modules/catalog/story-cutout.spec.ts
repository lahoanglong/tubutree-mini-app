import sharp from 'sharp';
import { cutoutWhite } from './story-cutout';

async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
  };
  return { at };
}

describe('cutoutWhite', () => {
  it('cutoutWhite makes white border pixels alpha 0 and keeps dark centre and white inside product', async () => {
    // Nền trắng 40x40; thân tối 20x20 ở giữa (10..29) có một ô trắng 4x4 khép kín bên trong.
    const size = 40;
    const buf = Buffer.alloc(size * size * 3, 255);
    const set = (x: number, y: number, v: number) => {
      const i = (y * size + x) * 3;
      buf[i] = buf[i + 1] = buf[i + 2] = v;
    };
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) set(x, y, 20);
    for (let y = 18; y < 22; y++) for (let x = 18; x < 22; x++) set(x, y, 255);
    const input = await sharp(buf, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();

    const out = await cutoutWhite(input);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('png');
    const px = await pixels(out);
    expect(px.at(0, 0).a).toBe(0);
    expect(px.at(39, 39).a).toBe(0);
    expect(px.at(5, 20).a).toBe(0);
    expect(px.at(12, 12).a).toBe(255);
    expect(px.at(20, 20)).toMatchObject({ r: 255, a: 255 });
  });
});
