// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { BrandImageField } from './brand-image-field';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
});

describe('BrandImageField — diện mạo Mini App ở điện thoại', () => {
  it('nhãn đậm như Text label, khung viền đứt 1.5px nền canvas', () => {
    const r = render(<BrandImageField label="Logo" value="" onChange={() => undefined} />);
    mounted.push(r);
    const label = Array.from(r.container.querySelectorAll('div')).find((d) => d.textContent === 'Logo' && d.children.length === 0)!;
    expect(label.className).toContain('max-md:font-semibold');
    const drop = r.container.querySelector<HTMLElement>('button[aria-label="Tải ảnh logo lên"]')!;
    expect(drop.className).toContain('max-md:border-[1.5px]');
    expect(drop.className).toContain('max-md:bg-[color:var(--color-bg-canvas)]');
  });
});
