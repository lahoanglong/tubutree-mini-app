// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { ExternalInsertQrCard } from './external-insert-qr-card';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { SITE_URL } from '@/lib/site';
import { insertQrCardPngBlob, insertQrCardSvg, printInsertQrCard } from '@/lib/insert-qr-card';

const getConfigMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/admin-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin-client')>()),
  getConfig: getConfigMock,
}));
const earnRow = (value: unknown) => [{ key: 'loyalty.marketplace_earn_pct', value, description: null, category: 'loyalty' }];

vi.mock('@/lib/insert-qr-card', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/insert-qr-card')>()),
  insertQrCardPngBlob: vi.fn(),
  printInsertQrCard: vi.fn(),
}));

let mounted: Rendered[] = [];
beforeEach(() => {
  getConfigMock.mockReset();
  getConfigMock.mockResolvedValue(earnRow(5));
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.restoreAllMocks();
  vi.mocked(insertQrCardPngBlob).mockReset();
  vi.mocked(printInsertQrCard).mockReset();
});

const mount = () => {
  const r = render(<ExternalInsertQrCard />);
  mounted.push(r);
  return r;
};
const exactButton = (root: ParentNode, text: string) =>
  Array.from(root.querySelectorAll<HTMLElement>('button')).find((b) => b.textContent?.trim() === text) ?? null;
const linkText = (root: ParentNode) => root.querySelector('code')?.textContent ?? null;

describe('ExternalInsertQrCard', () => {
  it('mặc định Shopee, không đợt thẻ: link /quet-ma?utm_source=shopee và ảnh thẻ A6 dạng SVG', () => {
    const r = mount();
    expect(linkText(r.container)).toBe(`${SITE_URL}/quet-ma?utm_source=shopee`);
    const img = r.container.querySelector('img')!;
    expect(img.getAttribute('src')!.startsWith('data:image/svg+xml')).toBe(true);
    expect(img.getAttribute('alt')).toBe(`Thẻ A6 Shopee, mã QR dẫn tới ${SITE_URL}/quet-ma?utm_source=shopee`);
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
    click(exactButton(r.container, 'Tải PNG'));
    await flush();
    expect(r.container.querySelector('[role="alert"]')!.textContent).toBe('Trình duyệt không vẽ được ảnh.');
  });

  it('có hai nút thẻ A6 đúng chữ của PO, trước nút "Chỉ mã QR"; tag sai thì không có nút nào', () => {
    const r = mount();
    const labels = Array.from(r.container.querySelectorAll('button'))
      .map((b) => b.textContent!.trim())
      .filter((t) => /A6|SVG|PNG/.test(t));
    expect(labels).toEqual(['Tải PNG thẻ A6 sẵn in (300 DPI)', 'In / Lưu PDF thẻ A6 (10×15cm)', 'Tải SVG', 'Tải PNG']);
    typeInto(r.container.querySelector('input'), 'có dấu');
    expect(exactButton(r.container, 'Tải PNG thẻ A6 sẵn in (300 DPI)')).toBeNull();
    expect(exactButton(r.container, 'In / Lưu PDF thẻ A6 (10×15cm)')).toBeNull();
  });

  it('Tải PNG thẻ A6: vẽ từ SVG của đúng sàn rồi tải tệp tubu-the-a6-<sàn>-<đợt>.png', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    vi.mocked(insertQrCardPngBlob).mockResolvedValue(png);
    const blobs: Blob[] = [];
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: (b: Blob) => (blobs.push(b), 'blob:card') });
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
    await flush();
    click(byText(r.container, 'button', 'Lazada'));
    typeInto(r.container.querySelector('input'), 'box-2026-11');
    click(exactButton(r.container, 'Tải PNG thẻ A6 sẵn in (300 DPI)'));
    await flush();
    expect(vi.mocked(insertQrCardPngBlob)).toHaveBeenCalledWith(insertQrCardSvg(`${SITE_URL}/quet-ma?utm_source=lazada&card=box-2026-11`, 'lazada', { earnPct: 5 }));
    expect(names).toEqual(['tubu-the-a6-lazada-box-2026-11.png']);
    expect(blobs[0]).toBe(png);
  });

  it('Tải PNG thẻ A6 lỗi: báo lỗi, nút mở lại, không tải gì', async () => {
    vi.mocked(insertQrCardPngBlob).mockRejectedValue(new Error('Trình duyệt không dựng được ảnh thẻ.'));
    const r = mount();
    click(exactButton(r.container, 'Tải PNG thẻ A6 sẵn in (300 DPI)'));
    await flush();
    expect(r.container.querySelector('[role="alert"]')!.textContent).toBe('Trình duyệt không dựng được ảnh thẻ.');
    expect((exactButton(r.container, 'Tải PNG thẻ A6 sẵn in (300 DPI)') as HTMLButtonElement).disabled).toBe(false);
  });

  it('In / Lưu PDF: gửi SVG cỡ mm của đúng sàn tới hộp thoại in; lỗi in thì báo lỗi', async () => {
    vi.mocked(printInsertQrCard).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Trình duyệt không mở được trang in.'));
    const r = mount();
    await flush();
    click(byText(r.container, 'button', 'TikTok Shop'));
    click(exactButton(r.container, 'In / Lưu PDF thẻ A6 (10×15cm)'));
    await flush();
    expect(vi.mocked(printInsertQrCard)).toHaveBeenCalledTimes(1);
    const svg = vi.mocked(printInsertQrCard).mock.calls[0]![0];
    expect(svg).toBe(insertQrCardSvg(`${SITE_URL}/quet-ma?utm_source=tiktok`, 'tiktok', { unit: 'mm', earnPct: 5 }));
    expect(svg).toContain('width="105mm" height="148mm"');
    expect(r.container.querySelector('[role="alert"]')).toBeNull();
    click(exactButton(r.container, 'In / Lưu PDF thẻ A6 (10×15cm)'));
    await flush();
    expect(r.container.querySelector('[role="alert"]')!.textContent).toBe('Trình duyệt không mở được trang in.');
  });
  it('con số trên thẻ theo tỉ lệ tích điểm đang cấu hình (lẻ dùng dấu phẩy), đổi theo khi cấu hình đổi', async () => {
    getConfigMock.mockResolvedValue(earnRow(2.5));
    const r = mount();
    await flush();
    expect(r.container.querySelector('[data-card-earn-pct]')!.textContent).toBe('Thẻ ghi "Nhận 2,5% Điểm Xanh" theo cài đặt hiện tại; đổi tỉ lệ thì tải lại thẻ.');
    const src = decodeURIComponent(r.container.querySelector('img')!.getAttribute('src')!.split(',').slice(1).join(','));
    expect(src).toContain('Nhận 2,5%');
    expect(src).not.toContain('Nhận 5%');
  });

  it('bảng cấu hình chưa có dòng tỉ lệ: dùng mặc định API 5%; không đọc được cấu hình: thẻ chỉ ghi "Nhận Điểm Xanh" và nói rõ', async () => {
    getConfigMock.mockResolvedValue([]);
    const withDefault = mount();
    await flush();
    expect(withDefault.container.querySelector('[data-card-earn-pct]')!.textContent).toContain('Nhận 5% Điểm Xanh');

    getConfigMock.mockRejectedValue(new Error('offline'));
    const failed = mount();
    await flush();
    expect(failed.container.querySelector('[data-card-earn-pct]')!.textContent).toBe('Chưa đọc được tỉ lệ tích điểm nên thẻ chỉ ghi "Nhận Điểm Xanh".');
    const src = decodeURIComponent(failed.container.querySelector('img')!.getAttribute('src')!.split(',').slice(1).join(','));
    expect(src).not.toMatch(/Nhận \d/);
  });
});
