// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// mv-order: chi tiết đơn giống Mini App (order-detail.tsx). Gốc: C-025 (A1-014): web khách chưa có trang chi tiết đơn — QR chuyển khoản chỉ hiện một lần ngay sau khi đặt,
// mất tab là khách không trả được tiền. Trang này mở lại được từ "Đơn hàng của tôi" và dựng lại QR cho đơn
// chuyển khoản còn chờ thanh toán.

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'u' } as null | Record<string, unknown>, status: 'authenticated' as string },
  params: { code: 'TB-9' } as Record<string, string>,
  order: null as unknown,
  orderCalls: [] as string[],
  qr: { paymentStatus: 'UNPAID' as string, calls: 0, paymentDeadline: undefined as string | undefined },
  support: { hotline: '0984 606 774', email: 'tubutree@gmail.com' } as Record<string, string> | Error,
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getPublicSupport: async () => {
    if (mocks.support instanceof Error) throw mocks.support;
    return mocks.support;
  },
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ useParams: () => mocks.params, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  fetchOrder: async (code: string) => {
    mocks.orderCalls.push(code);
    if (mocks.order instanceof Error) throw mocks.order;
    return typeof mocks.order === 'function' ? (mocks.order as () => unknown)() : mocks.order;
  },
  fetchMyReturns: async () => [],
  getBankQr: async () => {
    mocks.qr.calls += 1;
    return {
      orderCode: 'TB-9', amount: 330000, paymentStatus: mocks.qr.paymentStatus, paymentDeadline: mocks.qr.paymentDeadline,
      bank: { bin: '970407', name: 'Techcombank', accountNo: '9984606774', accountName: 'CONG TY TUBU TREE' },
      memo: 'TB-9', qrString: 'x', qrImageUrl: 'https://img.vietqr.io/x.png',
    };
  },
}));

import { ApiError } from '@/lib/client-api';
import OrderDetailPage from './page';

const ORDER = {
  code: 'TB-9',
  status: 'PENDING_PAYMENT',
  subtotal: 300000,
  discount: 30000,
  couponDiscount: 30000,
  comboDiscount: 0,
  tierDiscount: 0,
  pointsDiscount: 0,
  shippingFee: 30000,
  total: 300000,
  paymentMethod: 'BANK_TRANSFER',
  paymentStatus: 'UNPAID',
  createdAt: '2026-10-01T03:00:00Z',
  couponCode: 'WELCOME30',
  pointsUsed: 0,
  note: null,
  shippingAddress: {
    recipient: 'Nguyễn An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ',
  },
  shippingPartner: null,
  shippingCode: null,
  trackingLink: null,
  items: [
    { productName: 'Dầu gội bồ kết', variationName: '500ml', unitPrice: 150000, quantity: 2, total: 300000, thumbnail: null },
  ],
};

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<OrderDetailPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const buttons = (c: HTMLElement) => Array.from(c.querySelectorAll('button'));

beforeEach(() => {
  mocks.auth = { user: { id: 'u' }, status: 'authenticated' };
  mocks.params = { code: 'TB-9' };
  mocks.order = structuredClone(ORDER);
  mocks.orderCalls = [];
  mocks.qr = { paymentStatus: 'UNPAID', calls: 0, paymentDeadline: undefined };
  mocks.support = { hotline: '0984 606 774', email: 'tubutree@gmail.com' };
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

const COD_DELIVERED = {
  ...ORDER,
  status: 'DELIVERED',
  paymentMethod: 'COD',
  paymentStatus: 'PAID',
  deliveredAt: '2026-10-05T03:00:00Z',
  shippingFee: 0,
  items: [{ id: 'i1', productName: 'Serum Visante', variationName: '30ml', unitPrice: 289000, quantity: 1, total: 289000, thumbnail: null, productSlug: 'serum', reviewable: true }],
};
const text = (c: HTMLElement) => c.textContent ?? '';

describe('chi tiết đơn như Mini App', () => {
  it('h1 "Chi tiết đơn hàng" kèm mã đơn làm phụ đề', async () => {
    const { container } = await mount();
    expect(container.querySelector('h1')!.textContent).toBe('Chi tiết đơn hàng');
    expect(text(container)).toContain('TB-9');
    expect(container.querySelector('[data-page-bleed]')).not.toBeNull();
  });

  it('dải trạng thái: nền theo trạng thái, mốc thời gian đứng trên nhãn', async () => {
    mocks.order = structuredClone(COD_DELIVERED);
    const { container } = await mount();
    const hero = container.querySelector('[data-testid="status-hero"]') as HTMLElement;
    expect(hero.className).toContain('max-md:bg-[var(--hero-bg)]');
    expect(hero.style.getPropertyValue('--hero-bg')).toBe('var(--color-status-success-bg)');
    expect(hero.firstElementChild!.className).toContain('max-md:flex-col-reverse');
    expect(text(hero)).toContain('Giao thành công');
  });

  it('hành trình: đơn COD bỏ bước chờ thanh toán, nhãn như Mini App', async () => {
    mocks.order = structuredClone(COD_DELIVERED);
    const { container } = await mount();
    const steps = [...container.querySelectorAll('#order-timeline-title ~ ol > li')].map((li) => li.textContent!.replace(/ — .*/, ''));
    expect(steps).toEqual(['Đã xác nhận', 'Đang đóng gói', 'Đang giao', 'Giao thành công']);
  });

  it('hành trình: đơn chuyển khoản mở đầu bằng "Chờ thanh toán"', async () => {
    const { container } = await mount();
    const steps = [...container.querySelectorAll('#order-timeline-title ~ ol > li')].map((li) => li.textContent!.replace(/ — .*/, ''));
    expect(steps).toHaveLength(5);
    expect(steps[0]).toBe('Chờ thanh toán');
  });

  it('khối tiền: nhãn "Thanh toán" với tên phương thức của Mini App, không có dòng "Tình trạng"', async () => {
    mocks.order = structuredClone(COD_DELIVERED);
    const { container } = await mount();
    const t = text(container);
    expect(t).toContain('Khi nhận hàng (COD)');
    expect(t).not.toContain('Thanh toán khi nhận hàng (COD)');
    expect(t).not.toContain('Phương thức');
    expect(t).not.toContain('Tình trạng');
  });

  it('sản phẩm: một dòng "tên · phân loại ×SL", giá bên phải; đánh giá không gạch chân', async () => {
    mocks.order = structuredClone(COD_DELIVERED);
    const { container } = await mount();
    expect(text(container)).toContain('Serum Visante · 30ml ×1');
    const review = [...container.querySelectorAll('a')].find((a) => a.textContent === 'Viết đánh giá')!;
    expect(review.className).toContain('max-md:no-underline');
  });
});
