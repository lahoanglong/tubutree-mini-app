import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ haptic: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => vi.fn() }));
vi.mock('../../utils/haptic', () => ({ haptic: mocks.haptic }));

import { homeCopy } from '@tubutree/app-core/home-copy';
import { MemberCardUnavailable } from './member-card';

describe('MemberCardUnavailable', () => {
  it('hiện đúng chữ báo lỗi và nút Thử lại gọi onRetry', () => {
    const onRetry = vi.fn();
    render(<MemberCardUnavailable onRetry={onRetry} />);
    expect(screen.getByRole('region', { name: homeCopy.member.cardLabel })).toHaveTextContent(homeCopy.member.offline);
    fireEvent.click(screen.getByRole('button', { name: homeCopy.member.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
