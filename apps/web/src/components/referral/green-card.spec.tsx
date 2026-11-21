// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

const mocks = vi.hoisted(() => ({ get: vi.fn(), track: vi.fn(), write: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/analytics', () => ({ trackWebEvent: mocks.track }));

import GreenCardBlock from './green-card';

const CARD = {
  referralCode: 'LAN123',
  album: { seen: 12, total: 40 },
  wasteItems: 7,
  firstOrderReward: { points: 100, minOrderAmount: 199_000 },
  earnsPoints: true,
};

let view: Rendered | null = null;
const mount = async (actions: boolean) => {
  view = render(<GreenCardBlock actions={actions} />);
  await flush();
  return view.container;
};
const button = (root: ParentNode, text: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) ?? null;

beforeEach(() => {
  mocks.get.mockImplementation(async (path: string) =>
    path === '/me/green-card' ? CARD : { inviteLandingEnabled: false },
  );
  mocks.write.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.write },
  });
});
afterEach(() => {
  view?.unmount();
  view = null;
  vi.clearAllMocks();
});

describe('GreenCardBlock (web)', () => {
  it('Sổ tay Xanh: số thẻ, số vỏ, dòng thưởng và hai nút đủ 44px có tên', async () => {
    const root = await mount(true);
    expect(root.querySelector('[data-testid="green-card"]')).not.toBeNull();
    expect(root.textContent).toContain('12 thẻ xanh đã mở · 7 vỏ đã đổi');
    expect(root.textContent).toContain('cả hai nhận +100 Điểm Xanh');
    expect(unnamedControls(root)).toEqual([]);
    expect(smallTouchTargets(root)).toEqual([]);
  });

  it('sao chép: ghi đúng link mời có mã, báo đã chép, đo sự kiện method=copy', async () => {
    const root = await mount(true);
    click(button(root, 'Sao chép link'));
    await act(async () => {
      await flush();
    });
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls[0]?.[0]).toContain('LAN123');
    expect(mocks.track).toHaveBeenCalledWith('green_card_shared', { method: 'copy' });
    expect(root.querySelector('[role="status"]')!.textContent).not.toBe('');
  });

  it('khối mời ở Tài khoản: chỉ một dòng số, không lặp thưởng (thẻ chia sẻ đã nêu), không thêm nút', async () => {
    const root = await mount(false);
    expect(root.querySelector('[data-testid="green-card-stats"]')!.textContent).toBe(
      '12 thẻ xanh đã mở · 7 vỏ đã đổi',
    );
    expect(root.querySelectorAll('button')).toHaveLength(0);
  });

  it('API lỗi hoặc cờ tắt (404): không vẽ gì', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/me/green-card') throw new Error('404');
      return {};
    });
    const root = await mount(true);
    expect(root.innerHTML).toBe('');
  });
});
