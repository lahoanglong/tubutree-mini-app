import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  openSnackbar: vi.fn(),
  shareLink: vi.fn(),
  copyText: vi.fn(),
  fetchContentKit: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? <div data-testid="sheet">{children}</div> : null,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/zmp-bridge', () => ({ shareLink: mocks.shareLink }));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ fetchContentKit: mocks.fetchContentKit }));

import { ContentKitSheet } from './content-kit-sheet';

describe('ContentKitSheet — chia sẻ lỗi không bị nuốt (C-067)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.copyText.mockResolvedValue(true);
    mocks.fetchContentKit.mockResolvedValue({
      productName: 'Trà xanh', images: [], usps: ['Lá trà sạch'], faqs: [], videoUrls: [],
      captions: ['Trà xanh ngon lắm https://shop.tubutree.com/product/tra-xanh?ref=ABC123'],
      shareLink: '/product/tra-xanh?ref=ABC123',
    });
  });

  it('shareLink reject: chép bài mẫu kèm liên kết có mã và báo snackbar', async () => {
    mocks.shareLink.mockRejectedValue(new Error('zalo từ chối'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ContentKitSheet visible onClose={() => {}} productSlug="tra-xanh" />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ Zalo/ }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    expect(mocks.copyText).toHaveBeenCalledWith(expect.stringContaining('?ref=ABC123'));
    expect((mocks.openSnackbar.mock.calls[0]![0] as { text: string }).text).toMatch(/Chưa chia sẻ được qua Zalo/);
  });

  function renderKit() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ContentKitSheet visible onClose={() => {}} productSlug="tra-xanh" />
      </QueryClientProvider>,
    );
  }

  it('bài mẫu soạn tay không có {link}: chép kèm liên kết giới thiệu tuyệt đối, không mất mã ref', async () => {
    mocks.fetchContentKit.mockResolvedValue({
      productName: 'Trà xanh', images: [], usps: [], faqs: [], videoUrls: [],
      captions: ['Trà xanh ngon lắm, mua đi'],
      shareLink: '/product/tra-xanh?ref=ABC123',
    });
    mocks.shareLink.mockRejectedValue(new Error('zalo từ chối'));
    renderKit();
    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ Zalo/ }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
    expect(mocks.copyText).toHaveBeenCalledWith(
      'Trà xanh ngon lắm, mua đi https://shop.tubutree.com/product/tra-xanh?ref=ABC123',
    );
  });

  it('không có bài mẫu nào: chép riêng liên kết tuyệt đối', async () => {
    mocks.fetchContentKit.mockResolvedValue({
      productName: 'Trà xanh', images: [], usps: [], faqs: [], videoUrls: [], captions: [],
      shareLink: '/product/tra-xanh?ref=ABC123',
    });
    mocks.shareLink.mockRejectedValue(new Error('zalo từ chối'));
    renderKit();
    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ Zalo/ }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
    expect(mocks.copyText).toHaveBeenCalledWith('https://shop.tubutree.com/product/tra-xanh?ref=ABC123');
  });

  it('nút Sao chép liên kết cũng chép liên kết tuyệt đối khi API trả đường dẫn tương đối', async () => {
    mocks.fetchContentKit.mockResolvedValue({
      productName: 'Trà xanh', images: [], usps: [], faqs: [], videoUrls: [], captions: [],
      shareLink: '/product/tra-xanh?ref=ABC123',
    });
    renderKit();
    fireEvent.click(await screen.findByRole('button', { name: /Sao chép/ }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
    expect(mocks.copyText).toHaveBeenCalledWith('https://shop.tubutree.com/product/tra-xanh?ref=ABC123');
  });
});
