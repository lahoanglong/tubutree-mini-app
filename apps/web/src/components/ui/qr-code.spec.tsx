// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

const toDataURL = vi.hoisted(() => vi.fn());
vi.mock('qrcode', () => ({ default: { toDataURL } }));

import { QrCode } from './qr-code';

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  toDataURL.mockReset();
});

describe('QrCode', () => {
  it('sinh ảnh đúng kích thước từ giá trị, trong lúc chờ có khung giữ chỗ', async () => {
    toDataURL.mockResolvedValue('data:image/png;base64,AAA');
    const { container } = mount(<QrCode value="TUBU-123" size={200} />);
    expect(container.querySelector('[data-qr-placeholder]')).not.toBeNull();
    await flush();
    expect(toDataURL).toHaveBeenCalledWith('TUBU-123', { width: 200, margin: 1 });
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAA');
    expect(img.getAttribute('alt')).toBe('QR');
    expect(img.getAttribute('width')).toBe('200');
  });

  it('sinh lỗi thì giữ khung giữ chỗ, không ném lỗi', async () => {
    toDataURL.mockRejectedValue(new Error('x'));
    const { container } = mount(<QrCode value="a" />);
    await flush();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-qr-placeholder]')).not.toBeNull();
  });
});
