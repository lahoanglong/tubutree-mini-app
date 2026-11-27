// @vitest-environment jsdom
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { ExternalInsertQrCard } from './external-insert-qr-card';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { SITE_URL } from '@/lib/site';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.restoreAllMocks();
});

const mount = () => {
  const r = render(<ExternalInsertQrCard />);
  mounted.push(r);
  return r;
};
const linkText = (root: ParentNode) => root.querySelector('code')?.textContent ?? null;

describe('ExternalInsertQrCard', () => {
  it('mặc định Shopee, không đợt thẻ: link /quet-ma?utm_source=shopee và ảnh QR dạng SVG', () => {
    const r = mount();
    expect(linkText(r.container)).toBe(`${SITE_URL}/quet-ma?utm_source=shopee`);
    const img = r.container.querySelector('img')!;
    expect(img.getAttribute('src')!.startsWith('data:image/svg+xml')).toBe(true);
    expect(img.getAttribute('alt')).toBe(`Mã QR dẫn tới ${SITE_URL}/quet-ma?utm_source=shopee`);
    expect(byText(r.container, 'button', 'Shopee')!.getAttribute('aria-pressed')).toBe('true');
    expect(r.container.textContent).not.toMatch(/funnel|o2o/i);
  });

  it('chọn sàn và gõ đợt thẻ: link và mã đổi theo', () => {
    const r = mount();
    const before = r.container.querySelector('img')!.getAttribute('src');
    click(byText(r.container, 'button', 'TikTok Shop'));
    typeInto(r.container.querySelector('input'), 'Box-2026-11');
    expect(linkText(r.container)).toBe(`${SITE_URL}/quet-ma?utm_source=tiktok&card=box-2026-11`);
    expect(r.container.querySelector('img')!.getAttribute('src')).not.toBe(before);
  });

  it('ô đợt thẻ chặn 35 ký tự, có nhãn nhìn thấy; tag sai thì báo lỗi và không có mã để tải', () => {
    const r = mount();
    const input = r.container.querySelector('input')!;
    expect(input.maxLength).toBe(35);
    expect(input.closest('label')!.textContent).toContain('Tên đợt thẻ (không bắt buộc)');
    typeInto(input, 'có dấu');
    expect(r.container.querySelector('[role="alert"]')!.textContent).toContain('chữ thường không dấu');
    expect(r.container.querySelector('img')).toBeNull();
    expect(byText(r.container, 'button', 'Tải SVG')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('Tải SVG: tải tệp image/svg+xml tên theo sàn và đợt thẻ', async () => {
    const blobs: Blob[] = [];
    // jsdom không có URL.createObjectURL/revokeObjectURL.
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: (b: Blob) => {
        blobs.push(b);
        return 'blob:qr';
      },
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => undefined });
    onTestFinished(() => {
      delete (URL as { createObjectURL?: unknown }).createObjectURL;
      delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
    });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    const r = mount();
    typeInto(r.container.querySelector('input'), 'box-2026-11');
    click(byText(r.container, 'button', 'Tải SVG'));
    await flush();
    expect(names).toEqual(['tubu-qr-shopee-box-2026-11.svg']);
    expect(blobs[0]!.type).toBe('image/svg+xml');
    expect(await blobs[0]!.text()).toContain('shape-rendering="crispEdges"');
  });

  it('Tải PNG lỗi (trình duyệt không vẽ được): báo lỗi, không ném ra ngoài', async () => {
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? { width: 0, height: 0, getContext: () => null } : realCreate(tag)) as typeof document.createElement);
    const r = mount();
    click(byText(r.container, 'button', 'Tải PNG'));
    await flush();
    expect(r.container.querySelector('[role="alert"]')!.textContent).toBe('Trình duyệt không vẽ được ảnh.');
  });
});
