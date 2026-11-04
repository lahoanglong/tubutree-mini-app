// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ checkIn: vi.fn(), get: vi.fn(), fullName: 'Lan' as string | null, pending: false, message: null as { text: string } | null }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1', fullName: mocks.fullName, pointsBalance: 120 } }) }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, loyalty: { vndPerPointRedeem: 1000 } }) }));
vi.mock('@/lib/use-check-in', () => ({
  useCheckIn: () => ({ view: { canCheckIn: true, buttonLabel: 'Điểm danh' }, pending: mocks.pending, checkIn: mocks.checkIn, message: mocks.message }),
}));

import { HOME_HERO_HEIGHT } from '@tubutree/app-core/home-layout';
import { MemberCard, MemberCardSkeleton, MemberCardUnavailable } from './member-card';
import { HomeBlockErrorSuppressed } from './home-block-error';

let mounted: Rendered | null = null;
const mount = async (ui: React.ReactElement) => {
  mounted = render(ui);
  await flush(5);
  return mounted.container;
};
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  mocks.checkIn.mockReset();
  mocks.get.mockReset();
  mocks.fullName = 'Lan';
  mocks.pending = false;
  mocks.message = null;
});

describe('MemberCard web — nền sáng như Mini App (HM-05)', () => {
  it('thẻ cao bằng HOME_HERO_HEIGHT, nền bề mặt có viền, không có nền gradient; nút Điểm danh là điểm màu duy nhất', async () => {
    mocks.get.mockResolvedValue({ tier: { name: 'Mầm Xanh' }, pointsBalance: 120, pointsConvertedBalance: 0 });
    const c = await mount(<MemberCard />);
    const section = c.querySelector('section[aria-label="Thẻ thành viên"]')!;
    const card = section.firstElementChild as HTMLElement;
    expect(card.style.height).toBe(`${HOME_HERO_HEIGHT}px`);
    expect(card.style.background).not.toContain('gradient');
    expect(card.style.border).not.toBe('');
    const checkIn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Điểm danh')!;
    expect(checkIn.style.background).toContain('--color-action-primary-bg');
    click(checkIn);
    expect(mocks.checkIn).toHaveBeenCalledTimes(1);
  });

  it('khung chờ và thẻ báo mất mạng cùng kiểu thẻ sáng, cao bằng thẻ thật', async () => {
    const skeleton = await mount(<MemberCardSkeleton />);
    expect(skeleton.querySelector('[data-testid="member-card-loading"]')).not.toBeNull();
    mounted!.unmount();
    const offline = await mount(<MemberCardUnavailable onRetry={() => undefined} />);
    const card = offline.querySelector('section')!.firstElementChild as HTMLElement;
    expect(card.style.height).toBe(`${HOME_HERO_HEIGHT}px`);
    expect(card.style.background).not.toContain('gradient');
  });
});

describe('MemberCard web — lời chào bằng tên gọi (P2 #7)', () => {
  it('họ tên dài chào bằng từ cuối, không cắt "Chào Nguyễ…"', async () => {
    mocks.fullName = 'Nguyễn Thị Quay Lại';
    mocks.get.mockResolvedValue({ tier: { name: 'Mầm Xanh' }, pointsBalance: 120, pointsConvertedBalance: 0 });
    const c = await mount(<MemberCard />);
    expect(c.textContent).toContain('Chào Lại');
    expect(c.textContent).not.toContain('Nguyễn');
  });

  it('tên gọi ngắn không dính dấu chấm giữa vào hạng: khoảng trắng giữa lời chào và hạng là ký tự văn bản thật (flex không vẽ)', async () => {
    mocks.fullName = 'Trần Văn An';
    mocks.get.mockResolvedValue({ tier: { name: 'Mầm Xanh' }, pointsBalance: 120, pointsConvertedBalance: 0 });
    const c = await mount(<MemberCard />);
    const tier = Array.from(c.querySelectorAll('span')).find((s) => s.textContent?.includes('Mầm Xanh') && s.children.length > 0)!;
    expect(tier.textContent).toMatch(/^· /);
    expect(tier.previousSibling?.textContent).toBe(' ');
  });

  it('chưa có họ tên thì chào bạn', async () => {
    mocks.fullName = null;
    mocks.get.mockResolvedValue({ tier: { name: 'Mầm Xanh' }, pointsBalance: 120, pointsConvertedBalance: 0 });
    const c = await mount(<MemberCard />);
    expect(c.textContent).toContain('Chào bạn');
  });
});

describe('MemberCard web — tên bậc dài và dải lỗi cấp trang', () => {
  it('tên bậc dài không bóp lời chào: lời chào không co, tên bậc nhận phần còn lại', async () => {
    mocks.fullName = 'Trần Văn An';
    mocks.get.mockResolvedValue({ tier: { name: 'Đại Sứ Vườn Xanh Bậc Cao Nhất' }, pointsBalance: 120, pointsConvertedBalance: 0 });
    const c = await mount(<MemberCard />);
    const greeting = Array.from(c.querySelectorAll('span')).find((s) => s.textContent === 'Chào An')!;
    expect(greeting.style.flexShrink).toBe('0');
    const tier = Array.from(c.querySelectorAll('span')).find((s) => s.textContent?.includes('Đại Sứ') && s.children.length > 0)!;
    expect(tier.style.flexGrow).toBe('1');
  });

  it('chưa có tên bậc (loyalty lỗi): lời chào dài một chữ vẫn co được để có "…", không tràn đè nút', async () => {
    mocks.fullName = 'Thanhthuy1990shopmyphamthiennhien';
    mocks.get.mockRejectedValue(new Error('500'));
    const c = await mount(<MemberCard />);
    const greeting = Array.from(c.querySelectorAll('span')).find((s) => s.textContent?.startsWith('Chào Thanhthuy'))!;
    expect(greeting.style.flexShrink).not.toBe('0');
    expect(greeting.style.overflow).toBe('hidden');
  });

  it('điểm lỗi: Trang chủ đã có dải lỗi cấp trang thì không còn nút Thử lại thứ hai', async () => {
    mocks.get.mockRejectedValue(new Error('500'));
    const c = await mount(<MemberCard />);
    expect(Array.from(c.querySelectorAll('button')).some((b) => b.textContent === 'Thử lại')).toBe(true);
    mounted!.unmount();
    const c2 = await mount(
      <HomeBlockErrorSuppressed.Provider value>
        <MemberCard />
      </HomeBlockErrorSuppressed.Provider>,
    );
    expect(Array.from(c2.querySelectorAll('button')).some((b) => b.textContent === 'Thử lại')).toBe(false);
  });
});

describe('MemberCard web — vùng báo và nút điểm danh (A11Y-02, A11Y-03)', () => {
  const checkInButton = (c: HTMLElement) => Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Điểm danh')!;

  it('A11Y-02: vùng role=status có sẵn lúc chưa có lời báo; lời báo đến thì CHÍNH nút DOM đó chứa chữ (không dựng vùng mới)', async () => {
    mocks.get.mockResolvedValue({ tier: { name: 'Mầm Xanh' }, pointsBalance: 120, pointsConvertedBalance: 0 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mounted = render(<MemberCard />, client);
    await flush(5);
    const status = mounted.container.querySelector('[role="status"]')!;
    expect(status).not.toBeNull();
    expect(status.textContent).toBe('');
    mocks.message = { text: 'Đã điểm danh +10 điểm' };
    act(() => mounted!.root.render(<QueryClientProvider client={client}><MemberCard /></QueryClientProvider>));
    await flush(2);
    expect(status.isConnected).toBe(true);
    expect(mounted.container.querySelector('[role="status"]')).toBe(status);
    expect(status.textContent).toBe('Đã điểm danh +10 điểm');
  });

  it('A11Y-03: đang gửi thì nút chỉ aria-disabled (không disabled) nên vẫn giữ focus; bấm lúc đó không gọi điểm danh lần nữa', async () => {
    mocks.get.mockResolvedValue({ tier: { name: 'Mầm Xanh' }, pointsBalance: 120, pointsConvertedBalance: 0 });
    mocks.pending = true;
    const c = await mount(<MemberCard />);
    const btn = checkInButton(c);
    btn.focus();
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.disabled).toBe(false);
    click(btn);
    expect(mocks.checkIn).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(btn);
  });
});
