// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

// Wave 101B: bảng mã giảm giá đóng được lúc lệnh áp mã còn bay. Lệnh xong muộn của lần mở trước không được đóng bảng vừa mở lại hay xoá mã khách đang gõ.

const state = vi.hoisted(() => ({
  applyGate: null as Promise<void> | null,
  applyError: null as Error | null,
  applied: [] as string[],
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getMyCoupons: async () => [],
  getCouponPreviews: async () => [],
  applyCoupon: async (code: string) => {
    await state.applyGate;
    if (state.applyError) throw state.applyError;
    state.applied.push(code);
    return { items: [], couponCode: code, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 };
  },
}));

import { MD_DOWN } from '@/lib/use-media-query';
import { CouponBox } from './coupon-box';

let mounted: Rendered | null = null;
beforeEach(() => {
  state.applyGate = null;
  state.applyError = null;
  state.applied = [];
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  delete (window as { matchMedia?: unknown }).matchMedia;
});

const phone = () => {
  window.matchMedia = ((q: string) => ({
    matches: q === MD_DOWN,
    media: q,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

const MODES = [
  { name: 'bảng trượt (điện thoại)', sheet: true },
  { name: 'bung tại chỗ (máy tính)', sheet: false },
];

describe.each(MODES)('CouponBox $name', ({ sheet }) => {
  const row = () => document.querySelector<HTMLElement>(sheet ? 'button[aria-haspopup="dialog"]' : 'button[aria-controls="coupon-panel"]')!;
  const input = () => document.querySelector<HTMLInputElement>('input[name="coupon-code"]')!;
  const panelOpen = () => (sheet ? document.querySelector('[role="dialog"]') !== null : !document.querySelector<HTMLElement>('#coupon-panel')!.hidden);
  const closePanel = () => click(sheet ? document.querySelector('[data-sheet-backdrop]') : row());
  const applyBtn = () => byText(sheet ? document.querySelector<HTMLElement>('[role="dialog"]')! : document.body, 'button', 'Áp dụng');
  const gate = () => {
    let release!: () => void;
    state.applyGate = new Promise<void>((r) => (release = r));
    return release;
  };
  const mountBox = async () => {
    if (sheet) phone();
    mounted = render(<CouponBox sheet={sheet} currentCode={null} subtotal={300000} />);
    await flush(6);
    click(row());
    await flush(2);
  };

  it('đóng bảng rồi mở lại và gõ mã khác lúc lệnh cũ còn bay: lệnh cũ xong muộn không đóng bảng, không xoá mã đang gõ', async () => {
    await mountBox();
    const release = gate();
    typeInto(input(), 'aaa');
    click(applyBtn());
    await flush();
    closePanel();
    click(row());
    typeInto(input(), 'bbb');
    release();
    await flush(4);
    expect(state.applied).toEqual(['AAA']);
    expect(panelOpen()).toBe(true);
    expect(input().value).toBe('bbb');
  });

  it('không đóng chen giữa: lệnh xong thì bảng đóng và ô nhập sạch như trước', async () => {
    await mountBox();
    const release = gate();
    typeInto(input(), 'aaa');
    click(applyBtn());
    await flush();
    release();
    await flush(4);
    expect(panelOpen()).toBe(false);
    click(row());
    await flush(2);
    expect(input().value).toBe('');
  });

  it('đóng bảng lúc lệnh bay và không mở lại: lệnh xong vẫn xoá ô nhập, bảng vẫn đóng', async () => {
    await mountBox();
    const release = gate();
    typeInto(input(), 'aaa');
    click(applyBtn());
    await flush();
    closePanel();
    release();
    await flush(4);
    expect(panelOpen()).toBe(false);
    click(row());
    await flush(2);
    expect(input().value).toBe('');
  });

  it('lệnh cũ bị từ chối khi khách đã đóng và không mở lại: bảng mở ra cùng lời báo như trước', async () => {
    await mountBox();
    state.applyError = new Error('Mã giảm giá đã hết lượt dùng.');
    const release = gate();
    typeInto(input(), 'aaa');
    click(applyBtn());
    await flush();
    closePanel();
    release();
    await flush(4);
    expect(panelOpen()).toBe(true);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Mã giảm giá đã hết lượt dùng.');
  });

  it('lệnh cũ bị từ chối khi khách đã mở lại và đang gõ: mã đang gõ còn nguyên', async () => {
    await mountBox();
    state.applyError = new Error('Mã giảm giá đã hết lượt dùng.');
    const release = gate();
    typeInto(input(), 'aaa');
    click(applyBtn());
    await flush();
    closePanel();
    click(row());
    typeInto(input(), 'bbb');
    await act(async () => release());
    await flush(4);
    expect(panelOpen()).toBe(true);
    expect(input().value).toBe('bbb');
  });
});
