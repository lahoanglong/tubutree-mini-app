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
  ...(await importOriginal<Record<string, unknown>>()),
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
      captions: ['Trà xanh ngon lắm https://app.tubutree.com/product/tra-xanh?ref=ABC123'],
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
      'Trà xanh ngon lắm, mua đi https://app.tubutree.com/san-pham/tra-xanh?ref=ABC123',
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
    expect(mocks.copyText).toHaveBeenCalledWith('https://app.tubutree.com/san-pham/tra-xanh?ref=ABC123');
  });

  it('nút Sao chép liên kết cũng chép liên kết tuyệt đối khi API trả đường dẫn tương đối', async () => {
    mocks.fetchContentKit.mockResolvedValue({
      productName: 'Trà xanh', images: [], usps: [], faqs: [], videoUrls: [], captions: [],
      shareLink: '/product/tra-xanh?ref=ABC123',
    });
    renderKit();
    fireEvent.click(await screen.findByRole('button', { name: /Sao chép/ }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
    // Đường dẫn tương đối (app.miniapp_base_url trống) đi tới domain WEB, nơi trang sản phẩm là /san-pham/<slug>
    // (route /product/<slug> của web chỉ là redirect 307 cho link đã chia sẻ trước đây).
    expect(mocks.copyText).toHaveBeenCalledWith('https://app.tubutree.com/san-pham/tra-xanh?ref=ABC123');
  });

  it('nút Chia sẻ Zalo giữ `path` là đường dẫn trong Mini App (/product/<slug>), không phải đường web', async () => {
    mocks.fetchContentKit.mockResolvedValue({
      productName: 'Trà xanh', images: [], usps: [], faqs: [], videoUrls: [], captions: [],
      shareLink: '/product/tra-xanh?ref=ABC123',
    });
    mocks.shareLink.mockResolvedValue(undefined);
    renderKit();
    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ Zalo/ }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(1));
    expect(mocks.shareLink).toHaveBeenCalledWith(expect.objectContaining({ path: '/product/tra-xanh?ref=ABC123' }));
  });

  it('{link} trong bài mẫu do API chèn là đường dẫn tương đối: bài mẫu hiện và chép với link web tuyệt đối, giữ mã ref', async () => {
    mocks.fetchContentKit.mockResolvedValue({
      productName: 'Trà xanh', images: [], usps: [], faqs: [], videoUrls: [],
      captions: ['Mua ngay /product/tra-xanh?ref=ABC123 nhé', 'Bài không có link'],
      shareLink: '/product/tra-xanh?ref=ABC123',
    });
    renderKit();
    const caption = await screen.findByRole('button', { name: /Mua ngay/ });
    expect(caption).toHaveTextContent('Mua ngay https://app.tubutree.com/san-pham/tra-xanh?ref=ABC123 nhé');
    fireEvent.click(caption);
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
    expect(mocks.copyText).toHaveBeenCalledWith('Mua ngay https://app.tubutree.com/san-pham/tra-xanh?ref=ABC123 nhé');
    fireEvent.click(screen.getByRole('button', { name: 'Bài không có link' }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenLastCalledWith('Bài không có link'));
  });

  it('API trả URL tuyệt đối (app.miniapp_base_url trỏ Mini App): giữ nguyên /product/<slug> của Mini App, không đổi sang đường web', async () => {
    const miniappLink = 'https://zalo.me/s/123/product/tra-xanh?ref=ABC123';
    mocks.fetchContentKit.mockResolvedValue({
      productName: 'Trà xanh', images: [], usps: [], faqs: [], videoUrls: [],
      captions: [`Mua ngay ${miniappLink}`],
      shareLink: miniappLink,
    });
    renderKit();
    fireEvent.click(await screen.findByRole('button', { name: /Sao chép/ }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith(miniappLink));
    fireEvent.click(await screen.findByRole('button', { name: /Mua ngay/ }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenLastCalledWith(`Mua ngay ${miniappLink}`));
  });

  it('tiêu đề sheet là h2 thật, có nút Đóng gọi onClose', async () => {
    const onClose = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ContentKitSheet visible onClose={onClose} productSlug="tra-xanh" />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Nội dung bán hàng' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await screen.findByRole('button', { name: /Chia sẻ Zalo/ });
  });

  it('hai nút chính có vùng chạm >= 44px (DS v2 Button)', async () => {
    renderKit();
    const share = await screen.findByRole('button', { name: /Chia sẻ Zalo/ });
    const copyBtn = screen.getByRole('button', { name: /Sao chép link/ });
    expect(parseFloat(share.style.minHeight)).toBeGreaterThanOrEqual(44);
    expect(parseFloat(copyBtn.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('bài mẫu, điểm bán hàng, hỏi đáp và video: hiện đủ, mỗi mục là một khối có tiêu đề h3', async () => {
    mocks.fetchContentKit.mockResolvedValue({
      productName: 'Trà xanh', images: ['https://cdn.example/a.jpg'], usps: ['Lá trà sạch', 'Không phẩm màu'],
      faqs: [{ q: 'Dùng thế nào?', a: 'Pha nước 80 độ.' }],
      videoUrls: ['https://video.example/v1'],
      captions: ['Trà xanh ngon lắm https://app.tubutree.com/product/tra-xanh?ref=ABC123'],
      shareLink: '/product/tra-xanh?ref=ABC123',
    });
    renderKit();
    await screen.findByRole('button', { name: /Chia sẻ Zalo/ });
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Bài mẫu (chạm để sao chép)',
      'Điểm bán hàng',
      'Câu hỏi thường gặp',
      'Video tham khảo',
    ]);
    expect(screen.getByText('Lá trà sạch')).toBeInTheDocument();
    expect(screen.getByText('Không phẩm màu')).toBeInTheDocument();
    expect(screen.getByText('Dùng thế nào?')).toBeInTheDocument();
    expect(screen.getByText('Pha nước 80 độ.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Trà xanh' })).toHaveAttribute('src', 'https://cdn.example/a.jpg');
  });

  it('chạm bài mẫu hoặc video: nút thật cao >= 44px, chép đúng nội dung và báo đã sao chép', async () => {
    mocks.fetchContentKit.mockResolvedValue({
      productName: 'Trà xanh', images: [], usps: [], faqs: [], videoUrls: ['https://video.example/v1'],
      captions: ['Trà xanh ngon lắm https://app.tubutree.com/product/tra-xanh?ref=ABC123'],
      shareLink: '/product/tra-xanh?ref=ABC123',
    });
    renderKit();
    const caption = await screen.findByRole('button', { name: /Trà xanh ngon lắm/ });
    expect(parseFloat(caption.style.minHeight)).toBeGreaterThanOrEqual(44);
    fireEvent.click(caption);
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
    expect(mocks.copyText).toHaveBeenLastCalledWith(
      'Trà xanh ngon lắm https://app.tubutree.com/product/tra-xanh?ref=ABC123',
    );
    expect(mocks.openSnackbar).toHaveBeenLastCalledWith({ text: 'Đã sao chép', type: 'success' });

    const video = screen.getByRole('button', { name: 'https://video.example/v1' });
    expect(parseFloat(video.style.minHeight)).toBeGreaterThanOrEqual(44);
    fireEvent.click(video);
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(2));
    expect(mocks.copyText).toHaveBeenLastCalledWith('https://video.example/v1');
  });

  it('chưa có nội dung mẫu nào: hiện câu báo rỗng', async () => {
    mocks.fetchContentKit.mockResolvedValue({
      productName: 'Trà xanh', images: [], usps: [], faqs: [], videoUrls: [], captions: [],
      shareLink: '/product/tra-xanh?ref=ABC123',
    });
    renderKit();
    expect(await screen.findByText('Sản phẩm này chưa có nội dung mẫu.')).toBeInTheDocument();
  });

  it('tải lỗi: hiện thông báo lỗi và nút Thử lại gọi lại API', async () => {
    mocks.fetchContentKit.mockRejectedValueOnce(new Error('mạng lỗi'));
    renderKit();
    const retry = await screen.findByRole('button', { name: /Thử lại/ });
    expect(mocks.fetchContentKit).toHaveBeenCalledTimes(1);
    mocks.fetchContentKit.mockResolvedValue({
      productName: 'Trà xanh', images: [], usps: [], faqs: [], videoUrls: [], captions: [],
      shareLink: '/product/tra-xanh?ref=ABC123',
    });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.fetchContentKit).toHaveBeenCalledTimes(2));
  });

  it('copy thất bại: báo lỗi hướng dẫn chép tay, không báo đã sao chép', async () => {
    mocks.copyText.mockResolvedValue(false);
    renderKit();
    fireEvent.click(await screen.findByRole('button', { name: /Sao chép link/ }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    expect(mocks.openSnackbar.mock.calls[0]![0]).toMatchObject({ type: 'error' });
  });
});
