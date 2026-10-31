import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ haptic: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => vi.fn() }));
vi.mock('../../utils/haptic', () => ({ haptic: mocks.haptic }));

import { homeCopy } from '@tubutree/app-core/home-copy';
import { MemberCardSkeleton, MemberCardUnavailable } from './member-card';

describe('MemberCardUnavailable', () => {
  it('hiện đúng chữ báo lỗi và nút Thử lại gọi onRetry', () => {
    const onRetry = vi.fn();
    render(<MemberCardUnavailable onRetry={onRetry} />);
    expect(screen.getByRole('region', { name: homeCopy.member.cardLabel })).toHaveTextContent(homeCopy.member.offline);
    fireEvent.click(screen.getByRole('button', { name: homeCopy.member.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('thẻ thành viên nền sáng (HM-05)', () => {
  it('khung thẻ Thử lại không còn gradient xanh đậm và cao đúng HOME_HERO_HEIGHT', () => {
    render(<MemberCardUnavailable onRetry={vi.fn()} />);
    const card = screen.getByRole('region', { name: homeCopy.member.cardLabel }).firstElementChild as HTMLElement;
    expect(card.style.background).not.toContain('gradient');
    expect(card.style.background).toContain('--color-bg-surface');
    expect(card.style.border).toContain('--color-border-subtle');
    expect(card).toHaveStyle({ height: '64px' });
  });

  it('khung chờ không có đệm dưới (vỏ khối giữ khoảng cách)', () => {
    render(<MemberCardSkeleton />);
    expect(screen.getByTestId('member-card-loading').style.padding).toBe('0px 16px');
  });
});
