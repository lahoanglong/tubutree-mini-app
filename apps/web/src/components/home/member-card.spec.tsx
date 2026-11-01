// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ checkIn: vi.fn(), get: vi.fn(), fullName: 'Lan' as string | null }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1', fullName: mocks.fullName, pointsBalance: 120 } }) }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, loyalty: { vndPerPointRedeem: 1000 } }) }));
vi.mock('@/lib/use-check-in', () => ({
  useCheckIn: () => ({ view: { canCheckIn: true, buttonLabel: 'Điểm danh' }, pending: false, checkIn: mocks.checkIn, message: null }),
}));

import { MemberCard, MemberCardSkeleton, MemberCardUnavailable } from './member-card';

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
});

describe('MemberCard web — nền sáng như Mini App (HM-05)', () => {
  it('thẻ cao 64, nền bề mặt có viền, không có nền gradient; nút Điểm danh là điểm màu duy nhất', async () => {
    mocks.get.mockResolvedValue({ tier: { name: 'Mầm Xanh' }, pointsBalance: 120, pointsConvertedBalance: 0 });
    const c = await mount(<MemberCard />);
    const section = c.querySelector('section[aria-label="Thẻ thành viên"]')!;
    const card = section.firstElementChild as HTMLElement;
    expect(card.style.height).toBe('64px');
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
    expect(card.style.height).toBe('64px');
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

  it('chưa có họ tên thì chào bạn', async () => {
    mocks.fullName = null;
    mocks.get.mockResolvedValue({ tier: { name: 'Mầm Xanh' }, pointsBalance: 120, pointsConvertedBalance: 0 });
    const c = await mount(<MemberCard />);
    expect(c.textContent).toContain('Chào bạn');
  });
});
