// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InviteShareStat } from '@tubutree/app-core/referral/share-card';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Thẻ chia sẻ ở khối "Mời bạn sống xanh" của Tài khoản (web): lời mời đọc thưởng đơn đầu của máy chủ, ô số tiến độ, sao chép / chia sẻ một chạm
// có đường lùi, và báo sự kiện green_card_shared (surface account) để Trung tâm tăng trưởng đếm lượt gửi.

const mocks = vi.hoisted(() => ({ get: vi.fn(), track: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/analytics', () => ({ trackWebEvent: mocks.track }));

import { InviteShareCard } from './invite-share-card';

const CARD = { referralCode: 'AN1', album: null, wasteItems: 0, firstOrderReward: { points: 100, minOrderAmount: 199_000 }, earnsPoints: true };
const STATS: InviteShareStat[] = [
  { key: 'friends', value: '12', label: 'Bạn bè đã mời' },
  { key: 'points', value: '5.000', label: 'Điểm Xanh đã nhận' },
];
const URL = 'https://tubutree.com/moi/AN1';

let mounted: Rendered[] = [];
const mount = async (o: { viral?: boolean; stats?: InviteShareStat[] } = {}) => {
  const r = render(
    <InviteShareCard code="AN1" shareUrl={() => URL} fallbackText="Tubu Tree tặng khách mới mã 30.000đ cho đơn đầu từ 199k" viral={o.viral ?? true} stats={o.stats ?? STATS}>
      <p data-testid="slot">dòng tiến độ</p>
    </InviteShareCard>,
  );
  mounted.push(r);
  await flush(6);
  return r.container;
};
const status = (c: HTMLElement) => c.querySelector('[role="status"]')!.textContent;

beforeEach(() => {
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/me/green-card') return CARD;
    throw new Error(`đường dẫn lạ ${path}`);
  });
  mocks.track.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

describe('InviteShareCard (web)', () => {
  it('lời mời đọc đúng số máy chủ trả: +100 Điểm Xanh, đơn đầu từ 199.000đ', async () => {
    const c = await mount();
    const card = c.querySelector('[data-testid="invite-share-card"]')!;
    expect(card.querySelector('h3')!.textContent).toBe('Tặng bạn trải nghiệm thuần khiết');
    expect(card.querySelector('[data-testid="invite-share-offer"]')!.textContent).toBe('Nhận +100 Điểm Xanh khi bạn đặt đơn đầu từ 199.000đ');
    expect(mocks.get).toHaveBeenCalledWith('/me/green-card');
  });

  it('Admin đổi thưởng thì chữ đổi theo; tài khoản không nhận thưởng thì không hứa', async () => {
    mocks.get.mockResolvedValue({ ...CARD, firstOrderReward: { points: 250, minOrderAmount: 300_000 } });
    const c = await mount();
    expect(c.querySelector('[data-testid="invite-share-offer"]')!.textContent).toBe('Nhận +250 Điểm Xanh khi bạn đặt đơn đầu từ 300.000đ');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    mocks.get.mockResolvedValue({ ...CARD, earnsPoints: false });
    const c2 = await mount();
    expect(c2.querySelector('[data-testid="invite-share-offer"]')).toBeNull();
  });

  it('cờ viral tắt: không gọi /me/green-card, không có lời mời; nút vẫn đủ', async () => {
    const c = await mount({ viral: false });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(c.querySelector('h3')).toBeNull();
    expect(byText(c, 'button', 'Chia sẻ qua Zalo')).not.toBeNull();
    expect(byText(c, 'button', 'Sao chép link mời bạn')).not.toBeNull();
  });

  it('ô số tiến độ dùng số canh cột (tabular-nums), nhãn đọc được; chỗ cắm dòng tiến độ nằm trong thẻ', async () => {
    const c = await mount();
    const stats = c.querySelector('[data-testid="invite-share-stats"]') as HTMLElement;
    expect(Array.from(stats.querySelectorAll('dd')).map((d) => d.textContent)).toEqual(['12', '5.000']);
    expect(Array.from(stats.querySelectorAll('dt')).map((d) => d.textContent)).toEqual(['Bạn bè đã mời', 'Điểm Xanh đã nhận']);
    expect(stats.style.fontVariantNumeric).toBe('tabular-nums');
    expect(c.querySelector('[data-testid="invite-share-card"] [data-testid="slot"]')).not.toBeNull();
    const none = await mount({ stats: [] });
    expect(none.querySelector('[data-testid="invite-share-stats"]')).toBeNull();
  });

  it('sao chép một chạm: chép đúng link, báo ngay ở role=status, ghi sự kiện chép ở Tài khoản', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const c = await mount();
    expect(c.textContent).toContain('Mã của bạn: AN1');
    click(byText(c, 'button', 'Sao chép link mời bạn'));
    await flush(3);
    expect(writeText).toHaveBeenCalledWith(URL);
    expect(status(c)).toBe('Đã sao chép link mời bạn');
    expect(mocks.track).toHaveBeenCalledWith('green_card_shared', { method: 'copy', surface: 'account' });
  });

  it('chép lỗi: báo mã để tự chép', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const c = await mount();
    click(byText(c, 'button', 'Sao chép link mời bạn'));
    await flush(3);
    expect(status(c)).toBe('Không sao chép được. Mã của bạn: AN1');
  });

  it('chia sẻ: Web Share API nhận lời mời thưởng thật kèm link; ghi sự kiện chia sẻ', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() }, share });
    const c = await mount();
    click(byText(c, 'button', 'Chia sẻ qua Zalo'));
    await flush(3);
    expect(share).toHaveBeenCalledWith({
      title: 'Tubu Tree: trồng cây, nhận quà',
      text: 'Tặng bạn trải nghiệm thuần khiết — nhận +100 Điểm Xanh khi bạn đặt đơn đầu từ 199.000đ',
      url: URL,
    });
    expect(mocks.track).toHaveBeenCalledWith('green_card_shared', { method: 'share', surface: 'account' });
  });

  it('chia sẻ khi không có lời mời thưởng: dùng lời mời mã chào mừng', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() }, share });
    const c = await mount({ viral: false });
    click(byText(c, 'button', 'Chia sẻ qua Zalo'));
    await flush(3);
    expect(share.mock.calls[0]![0].text).toBe('Tubu Tree tặng khách mới mã 30.000đ cho đơn đầu từ 199k');
  });

  it('máy không có hộp chia sẻ: chép lời mời kèm link (đường lùi), báo đã chép; khách đóng hộp thì không chép', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const c = await mount();
    click(byText(c, 'button', 'Chia sẻ qua Zalo'));
    await flush(3);
    expect(writeText).toHaveBeenCalledWith(`Sống xanh cùng mình nhé, vào Tubu Tree bằng link này: ${URL}`);
    expect(status(c)).toBe('Đã sao chép link mời bạn');
    writeText.mockClear();
    vi.stubGlobal('navigator', { clipboard: { writeText }, share: vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError')) });
    click(byText(c, 'button', 'Chia sẻ qua Zalo'));
    await flush(3);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('nút đủ 44px, có tên đọc', async () => {
    const c = await mount();
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});
