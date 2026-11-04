// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

const getDealerAppImage = vi.fn();
vi.mock('@/lib/admin-client', () => ({ getDealerAppImage: (...a: unknown[]) => getDealerAppImage(...a) }));

import { DealerAppImage, resolveDealerImage } from './dealer-app-image';

let mounted: Rendered[] = [];
beforeEach(() => {
  getDealerAppImage.mockReset();
  URL.createObjectURL = vi.fn(() => 'blob:cccd');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

const jsonRes = (body: unknown) => ({ type: 'application/json', blob: new Blob([JSON.stringify(body)], { type: 'application/json' }) });

describe('resolveDealerImage', () => {
  it('byte raster → blob URL', async () => {
    expect(await resolveDealerImage({ type: 'image/jpeg', blob: new Blob(['x']) })).toEqual({ src: 'blob:cccd', revoke: true });
  });
  it('image/jpg (API phục vụ data URL jpg) → blob URL', async () => {
    expect(await resolveDealerImage({ type: 'image/jpg', blob: new Blob(['x']) })).toEqual({ src: 'blob:cccd', revoke: true });
  });
  it('JSON { url } https → hiện ảnh', async () => {
    const url = 'https://res.cloudinary.com/tubu/image/upload/v1/a.jpg';
    expect(await resolveDealerImage(jsonRes({ url }))).toEqual({ src: url, revoke: false });
  });
  it.each([['javascript:alert(1)'], ['http://x/a.jpg'], ['/returns/a/images/0?v=0123456789abcdef'], [123]])('JSON { url: %p } ngoài allowlist → null', async (url) => {
    expect(await resolveDealerImage(jsonRes({ url }))).toBeNull();
  });
  it('SVG/HTML → null', async () => {
    expect(await resolveDealerImage({ type: 'image/svg+xml', blob: new Blob(['<svg/>']) })).toBeNull();
    expect(await resolveDealerImage({ type: 'text/html', blob: new Blob(['<h1/>']) })).toBeNull();
  });
});

describe('DealerAppImage', () => {
  it('chưa bấm xem → không gọi API, không có img', () => {
    const m = render(<DealerAppImage appId="a1" field="cccdFront" label="CCCD trước" />);
    mounted.push(m);
    expect(getDealerAppImage).not.toHaveBeenCalled();
    expect(m.container.querySelector('img')).toBeNull();
  });
  it('bấm xem → tải qua route admin rồi hiện img blob', async () => {
    getDealerAppImage.mockResolvedValue({ type: 'image/png', blob: new Blob(['x']) });
    const m = render(<DealerAppImage appId="a1" field="cccdFront" label="CCCD trước" />);
    mounted.push(m);
    click(byText(m.container, 'button', /Xem CCCD trước/));
    await flush();
    expect(getDealerAppImage).toHaveBeenCalledWith('a1', 'cccdFront');
    expect(m.container.querySelector('img')?.getAttribute('src')).toBe('blob:cccd');
  });
  it('API trả URL ngoài allowlist → không render img, báo lỗi', async () => {
    getDealerAppImage.mockResolvedValue(jsonRes({ url: 'javascript:alert(1)' }));
    const m = render(<DealerAppImage appId="a1" field="cccdBack" label="CCCD sau" />);
    mounted.push(m);
    click(byText(m.container, 'button', /Xem CCCD sau/));
    await flush();
    expect(m.container.querySelector('img')).toBeNull();
    expect(m.container.textContent).toContain('Không tải được ảnh');
  });
});
