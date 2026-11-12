import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phân loại không đặt tên (86/154 phân loại trên PROD): dòng chọn món để đổi/trả không mở đầu bằng " · " và nhãn trình đọc màn hình không thừa khoảng trắng.

const mocks = vi.hoisted(() => ({ requestReturn: vi.fn(), fetchRefundBank: vi.fn(), estimateReturn: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/shop-api', () => ({
  requestReturn: mocks.requestReturn,
  fetchRefundBank: mocks.fetchRefundBank,
  estimateReturn: mocks.estimateReturn,
}));
vi.mock('../image-upload', () => ({ MultiImageUpload: () => null }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { ReturnRequestSheet } from './return-request-sheet';

const orderWith = (names: (string | null)[]) =>
  ({
    id: 'o1', code: 'TB1', status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 282_000,
    items: names.map((variationName, i) => ({ id: `i${i}`, productName: `Nước giặt ${i + 1}`, variationName, quantity: 3, total: 267_000 })),
  }) as never;

function renderSheet(names: (string | null)[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReturnRequestSheet open onClose={vi.fn()} order={orderWith(names)} returns={[] as never} returnDays={7} />
    </QueryClientProvider>,
  );
}
const lineTexts = () =>
  screen.getAllByRole('checkbox').map((box) => {
    const row = box.closest('div[style*="border-bottom"]') as HTMLElement;
    return { label: box.getAttribute('aria-label'), caption: Array.from(row.querySelectorAll('div')).filter((d) => d.children.length === 0).map((d) => d.textContent).find((t) => /còn trả được/.test(t ?? '')) };
  });

describe('ReturnRequestSheet Mini — phân loại không có tên', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchRefundBank.mockResolvedValue(null);
    mocks.estimateReturn.mockResolvedValue({ refund: 0, goods: 0, shipping: 0, isFull: false, moneyRefundable: true, pointsUsedBack: 0, lines: [] });
  });

  it('có tên: nhãn "Trả tên phân loại" và dòng "phân loại · còn trả được n" như trước', () => {
    renderSheet(['Chai 1L']);
    expect(lineTexts()).toEqual([{ label: 'Trả Nước giặt 1 Chai 1L', caption: 'Chai 1L · còn trả được 3' }]);
  });

  it('tên trống, toàn khoảng trắng hay null: nhãn chỉ "Trả tên", dòng chỉ "còn trả được n", không " · " mở đầu', () => {
    renderSheet(['', '   ', null]);
    expect(lineTexts()).toEqual([
      { label: 'Trả Nước giặt 1', caption: 'còn trả được 3' },
      { label: 'Trả Nước giặt 2', caption: 'còn trả được 3' },
      { label: 'Trả Nước giặt 3', caption: 'còn trả được 3' },
    ]);
  });
});
