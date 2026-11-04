// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useSizedImage, type SizedImage } from './image-src';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OLD = 'https://content.pancake.vn/2-26/old.jpg';
const NEW = 'https://content.pancake.vn/2-26/new.jpg';

describe('useSizedImage: cờ lùi-về-gốc gắn với đúng src', () => {
  it('/img của src cũ lỗi → ảnh gốc của src cũ; đổi sang src mới thì ngay lượt render đầu vẫn là bản đổi cỡ của src mới, không phải ảnh gốc của nó', () => {
    const seen: (SizedImage | null)[] = [];
    let fallBack: () => boolean = () => false;
    function Probe({ src }: { src: string }) {
      const r = useSizedImage(src, 128);
      seen.push(r.img);
      fallBack = r.fallBack;
      return null;
    }
    const box = document.createElement('div');
    const root = createRoot(box);
    act(() => root.render(<Probe src={OLD} />));
    expect(seen.at(-1)!.src).toContain('/img?');
    act(() => void fallBack());
    expect(seen.at(-1)!.src).toBe(OLD);
    seen.length = 0;
    act(() => root.render(<Probe src={NEW} />));
    expect(seen.length).toBeGreaterThan(0);
    for (const img of seen) {
      expect(img!.src).not.toBe(NEW);
      expect(img!.src).toContain('/img?');
    }
    act(() => root.unmount());
  });
});
