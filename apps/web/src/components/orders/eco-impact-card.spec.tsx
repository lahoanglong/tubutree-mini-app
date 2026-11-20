// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderEcoImpact } from '@tubutree/app-core/eco/order-impact';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

const mocks = vi.hoisted(() => ({ get: vi.fn(), track: vi.fn(), write: vi.fn(), share: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/analytics', () => ({ trackWebEvent: mocks.track }));

import OrderEcoImpactCard from './eco-impact-card';

const IMPACT: OrderEcoImpact = {
  orderCode: 'TB-9',
  bottlesSaved: 5,
  plasticGrams: 0,
  refillPacks: 2,
  points: 120,
  pointsCredited: true,
  referralCode: 'LAN123',
  inviteReward: { points: 100, minOrderAmount: 199_000 },
};

let view: Rendered | null = null;
const mount = async (impact: OrderEcoImpact = IMPACT) => {
  view = render(<OrderEcoImpactCard impact={impact} />);
  await flush();
  return view.container;
};
const button = (root: ParentNode, text: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) ?? null;

beforeEach(() => {
  mocks.get.mockResolvedValue({ referralShareCardEnabled: false });
  mocks.write.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.write } });
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
});
afterEach(() => {
  view?.unmount();
  view = null;
  vi.clearAllMocks();
});

describe('OrderEcoImpactCard (web)', () => {
  it('số chai là tiêu đề, Điểm Xanh của đơn, câu thưởng mời; hai nút đủ 44px có tên', async () => {
    const root = await mount();
    expect(root.querySelector('h2')!.textContent).toBe('Đơn này bạn đã giảm 5 chai nhựa dùng 1 lần');
    expect(root.textContent).toContain('+120 Điểm Xanh từ đơn này');
    expect(root.textContent).toContain('Bạn bè mua đơn đầu từ 199k, cả hai nhận +100 Điểm Xanh');
    expect(root.querySelectorAll('button')).toHaveLength(2);
    expect(unnamedControls(root)).toEqual([]);
    expect(smallTouchTargets(root)).toEqual([]);
  });

  it('0 điểm: không có dòng điểm', async () => {
    const root = await mount({ ...IMPACT, points: 0 });
    expect(root.textContent).not.toContain('Điểm Xanh từ đơn này');
  });

  it('sao chép: ghi link mời có mã, báo đã chép, đo green_card_shared surface=order', async () => {
    const root = await mount();
    click(button(root, 'Sao chép link'));
    await act(async () => {
      await flush();
    });
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls[0]?.[0]).toContain('LAN123');
    expect(mocks.track).toHaveBeenCalledWith('green_card_shared', { method: 'copy', surface: 'order' });
    expect(root.querySelector('[role="status"]')!.textContent).not.toBe('');
  });

  it('chia sẻ trên máy có navigator.share: câu kể số chai + câu mời, link riêng', async () => {
    mocks.share.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: mocks.share });
    const root = await mount();
    click(button(root, 'Chia sẻ'));
    await act(async () => {
      await flush();
    });
    const arg = mocks.share.mock.calls[0]?.[0] as { text: string; url: string };
    expect(arg.text).toBe('Mình vừa giảm 5 chai nhựa dùng 1 lần nhờ mua Refill ở Tubu Tree 🌱 Bạn bè mua đơn đầu từ 199k, cả hai nhận +100 Điểm Xanh');
    expect(arg.url).toContain('LAN123');
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith('green_card_shared', { method: 'share', surface: 'order' });
  });

  it('máy không có navigator.share: chép cả câu kể lẫn link', async () => {
    const root = await mount();
    click(button(root, 'Chia sẻ'));
    await act(async () => {
      await flush();
    });
    const text = mocks.write.mock.calls[0]?.[0] as string;
    expect(text.startsWith('Mình vừa giảm 5 chai nhựa dùng 1 lần')).toBe(true);
    expect(text).toContain('LAN123');
  });
});
