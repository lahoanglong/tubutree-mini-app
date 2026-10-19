import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchSupportContact: vi.fn(), callPhone: vi.fn() }));
vi.mock('../../pages/about-data', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchSupportContact: mocks.fetchSupportContact,
}));
vi.mock('../../services/zmp-bridge', () => ({ callPhone: mocks.callPhone }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { EmptyState, ErrorState } from './empty-state';

function withClient(ui: JSX.Element) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('EmptyState', () => {
  it('CTA loading state actually shows the spinner (regression test for the disabled+loading bug)', () => {
    render(<EmptyState art="box" heading="Chưa có đơn" ctaLabel="Mua ngay" onCta={() => {}} ctaLoading />);
    const btn = screen.getByText('Mua ngay').closest('.zaui-btn') as HTMLElement;
    expect(btn.className).toContain('loading');
    expect(btn.getAttribute('disabled')).toBeNull(); // NOT disabled — old bug set disabled={ctaLoading} too
  });

  it('variant="inline" uses tighter padding than the default "page"', () => {
    const { rerender } = render(<EmptyState art="leaf" heading="x" variant="inline" />);
    expect(screen.getByText('x').closest('.tubu-rise')).toHaveStyle({ padding: '16px' });
    rerender(<EmptyState art="leaf" heading="x" />);
    expect(screen.getByText('x').closest('.tubu-rise')).toHaveStyle({ padding: '40px 32px' });
  });
});

describe('ErrorState', () => {
  it('có onHome (lỗi 404) thì hiện "Về trang chủ", không có "Thử lại" (R6-BUYER-6)', () => {
    const onHome = vi.fn();
    const onRetry = vi.fn();
    render(<ErrorState message="Không tìm thấy" onRetry={onRetry} onHome={onHome} />);
    expect(screen.queryByText('Thử lại')).toBeNull();
    fireEvent.click(screen.getByText('Về trang chủ'));
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retry button text-on-secondary-bg is the new forest tone, not the old orange', () => {
    render(<ErrorState message="Lỗi mạng" onRetry={() => {}} />);
    // style is applied to the outer .zaui-btn root, not the inner text node — same convention
    // as button.spec.tsx's assertions on rendered zmp-ui Button output.
    const btn = screen.getByText('Thử lại').closest('.zaui-btn') as HTMLElement;
    expect(btn.style.color).toBe('var(--color-action-secondary-fg)');
  });
});

describe('ErrorState — khác trạng thái rỗng (D7 mục 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchSupportContact.mockResolvedValue({ hotline: '0984 606 774', email: null, zaloOaName: null });
  });

  it('icon cảnh báo riêng, không dùng minh hoạ lá/rổ/hộp của trạng thái rỗng', () => {
    const { container: err } = render(<ErrorState message="Lỗi mạng" onRetry={() => {}} />);
    expect(err.querySelector('[data-testid="error-state-icon"]')).not.toBeNull();
    expect(err.querySelector('svg[width="120"]')).toBeNull();
    const { container: empty } = render(<EmptyState art="leaf" heading="Trống" />);
    expect(empty.querySelector('[data-testid="error-state-icon"]')).toBeNull();
    expect(empty.querySelector('svg[width="120"]')).not.toBeNull();
  });

  it('có tiêu đề riêng, mô tả đi kèm; lỗi 404 (onHome) có tiêu đề "không tìm thấy"', () => {
    const { rerender } = render(<ErrorState message="Máy chủ đang bận, thử lại nhé." onRetry={() => {}} />);
    expect(screen.getByText('Chưa tải được trang này')).toBeInTheDocument();
    expect(screen.getByText('Máy chủ đang bận, thử lại nhé.')).toBeInTheDocument();
    rerender(<ErrorState message="Không có sản phẩm này." onRetry={() => {}} onHome={() => {}} />);
    expect(screen.getByText('Không tìm thấy')).toBeInTheDocument();
    expect(screen.queryByText('Chưa tải được trang này')).toBeNull();
  });

  it('title tuỳ biến thay tiêu đề mặc định', () => {
    render(<ErrorState title="Chưa tải được Trang chủ" message="x" onRetry={() => {}} />);
    expect(screen.getByText('Chưa tải được Trang chủ')).toBeInTheDocument();
  });

  it('lỗi cả trang: dòng "Cần hỗ trợ? Gọi <hotline đọc từ cấu hình>" bấm là gọi', async () => {
    render(withClient(<ErrorState message="Lỗi" onRetry={() => {}} />));
    const call = await screen.findByRole('button', { name: /Gọi 0984 606 774/ });
    expect(screen.getByText('Cần hỗ trợ?')).toBeInTheDocument();
    fireEvent.click(call);
    expect(mocks.callPhone).toHaveBeenCalledWith('0984 606 774');
  });

  it('cấu hình không có hotline → không có dòng hỗ trợ', async () => {
    mocks.fetchSupportContact.mockResolvedValue({ hotline: null, email: 'a@b.vn', zaloOaName: null });
    render(withClient(<ErrorState message="Lỗi" onRetry={() => {}} />));
    await waitFor(() => expect(mocks.fetchSupportContact).toHaveBeenCalled());
    expect(screen.queryByText('Cần hỗ trợ?')).toBeNull();
  });

  it('không đọc được cấu hình → rơi về hotline mặc định, vẫn còn đường liên hệ', async () => {
    mocks.fetchSupportContact.mockRejectedValue(new Error('boom'));
    render(withClient(<ErrorState message="Lỗi" onRetry={() => {}} />));
    expect(await screen.findByRole('button', { name: /Gọi 0984 606 774/ })).toBeInTheDocument();
  });

  it('khối nhúng trong mục (inline) gọn: không có dòng hỗ trợ và không gọi cấu hình', () => {
    render(withClient(<ErrorState variant="inline" message="Lỗi" onRetry={() => {}} />));
    expect(screen.queryByText('Cần hỗ trợ?')).toBeNull();
    expect(mocks.fetchSupportContact).not.toHaveBeenCalled();
  });

  it('showSupport bật dòng hỗ trợ cho khối inline (dải lỗi cấp trang)', async () => {
    render(withClient(<ErrorState variant="inline" showSupport message="Lỗi" onRetry={() => {}} />));
    expect(await screen.findByText('Cần hỗ trợ?')).toBeInTheDocument();
  });

  it('không có QueryClientProvider (test cũ) cũng không vỡ, chỉ không có dòng hỗ trợ', () => {
    render(<ErrorState message="Lỗi" onRetry={() => {}} />);
    expect(screen.getByText('Thử lại')).toBeInTheDocument();
    expect(screen.queryByText('Cần hỗ trợ?')).toBeNull();
  });

  it('retrying: nút báo đang tải và bấm thêm không gọi lại onRetry', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Lỗi" onRetry={onRetry} retrying />);
    const btn = screen.getByText('Thử lại').closest('.zaui-btn') as HTMLElement;
    expect(btn).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(btn);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('nút "Thử lại" vẫn cao >= 44px', () => {
    render(<ErrorState message="Lỗi" onRetry={() => {}} />);
    const btn = screen.getByText('Thử lại').closest('.zaui-btn') as HTMLElement;
    expect(parseInt(btn.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });
});
