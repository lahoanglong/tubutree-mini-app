// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Phân loại không đặt tên (86/154 phân loại trên PROD): dòng sản phẩm của chi tiết đơn không treo " · " sau tên, không dòng phân loại trống,
// và đoạn tóm tắt "Sao chép thông tin đơn" không ghi "()" sau tên.

const mocks = vi.hoisted(() => ({ order: null as unknown, copied: [] as string[] }));
vi.mock('@/lib/copy-text', () => ({
  copyText: async (t: string) => {
    mocks.copied.push(t);
    return true;
  },
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getPublicSupport: async () => ({ hotline: '0984 606 774', email: 'tubutree@gmail.com' }),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated' }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({ code: 'TB-9' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  fetchOrder: async () => mocks.order,
  fetchMyReturns: async () => [],
}));

import OrderDetailPage from './page';

const orderWith = (variationNames: (string | null)[]) => ({
  code: 'TB-9', status: 'DELIVERED', subtotal: 300000, discount: 0, couponDiscount: 0, comboDiscount: 0, tierDiscount: 0, pointsDiscount: 0, shippingFee: 0, total: 300000,
  paymentMethod: 'COD', paymentStatus: 'PAID', createdAt: '2026-10-01T03:00:00Z', deliveredAt: '2026-10-05T03:00:00Z', couponCode: null, pointsUsed: 0, note: null,
  shippingAddress: { recipient: 'Nguyễn An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ' },
  shippingPartner: null, shippingCode: null, trackingLink: null,
  items: variationNames.map((variationName, i) => ({
    id: `i${i}`, productName: `Dầu gội ${i + 1}`, variationName, unitPrice: 150000, quantity: 2, total: 300000, thumbnail: null, productSlug: `dau-goi-${i + 1}`, reviewable: false,
  })),
});

let mounted: Rendered[] = [];
const mount = async (variationNames: (string | null)[]) => {
  mocks.order = orderWith(variationNames);
  const r = render(<OrderDetailPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const phoneLines = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-testid="mini-line"]')).map((l) => l.textContent);
const wideColumn = (c: HTMLElement, i: number) => Array.from(c.querySelectorAll<HTMLElement>('[data-testid="mini-line"]')[i]!.parentElement!.children).map((n) => n.textContent);

beforeEach(() => {
  mocks.copied = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('chi tiết đơn — phân loại không có tên', () => {
  it('có tên: dòng điện thoại "tên · phân loại ×SL", khung từ md có dòng phân loại riêng', async () => {
    const c = await mount(['500ml']);
    expect(phoneLines(c)).toEqual(['Dầu gội 1 · 500ml ×2']);
    expect(wideColumn(c, 0).slice(0, 3)).toEqual(['Dầu gội 1 · 500ml ×2', 'Dầu gội 1', '500ml']);
  });

  it('tên trống, toàn khoảng trắng hay null: dòng điện thoại chỉ "tên ×SL" (không " · "), khung từ md không dòng phân loại trống', async () => {
    const c = await mount(['', '   ', null, '500ml']);
    expect(phoneLines(c)).toEqual(['Dầu gội 1 ×2', 'Dầu gội 2 ×2', 'Dầu gội 3 ×2', 'Dầu gội 4 · 500ml ×2']);
    for (const i of [0, 1, 2]) {
      expect(wideColumn(c, i).slice(0, 2)).toEqual([phoneLines(c)[i], `Dầu gội ${i + 1}`]);
      expect(wideColumn(c, i)).toHaveLength(wideColumn(c, 3).length - 1);
    }
  });

  it('đoạn tóm tắt "Sao chép thông tin đơn": tên trống không ghi "()" hay khoảng trắng thừa; có tên giữ "(phân loại)"', async () => {
    const c = await mount(['', '   ', '500ml']);
    const copy = Array.from(c.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Sao chép thông tin đơn');
    expect(copy).toBeTruthy();
    click(copy!);
    await flush(2);
    const text = mocks.copied[0]!;
    expect(text).toContain('Dầu gội 1');
    expect(text).not.toContain('()');
    expect(text).not.toContain('( )');
    expect(text).toContain('Dầu gội 3 (500ml)');
    expect(text.split('\n').filter((l) => /Dầu gội [12]/.test(l)).every((l) => !/[()]/.test(l))).toBe(true);
  });
});
