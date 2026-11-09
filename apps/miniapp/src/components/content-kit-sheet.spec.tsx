import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentType, ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonProps } from './ui/button';

const mocks = vi.hoisted(() => ({
  openSnackbar: vi.fn(),
  shareLink: vi.fn(),
  copyText: vi.fn(),
  fetchContentKit: vi.fn(),
  haptic: vi.fn(),
}));
// Bọc Button và ErrorState để đọc props mới nhất: aria-disabled và khoá của Button đã chặn lượt bấm thật,
// nên chỉ gọi thẳng onPress/onRetry mới chứng minh được khoá và guard trong ContentKitSheet.
const ctl = vi.hoisted(() => ({ buttons: new Map<string, ButtonProps>(), retry: null as null | (() => void) }));
vi.mock('./ui/button', async (importOriginal) => {
  const orig = await importOriginal<{ Button: ComponentType<ButtonProps> }>();
  return {
    ...orig,
    Button: (p: ButtonProps) => {
      ctl.buttons.set(String(p.children), p);
      return <orig.Button {...p} />;
    },
  };
});
vi.mock('./ui/empty-state', async (importOriginal) => {
  const orig = await importOriginal<{ ErrorState: ComponentType<{ message: string; onRetry: () => void }> }>();
  return {
    ...orig,
    ErrorState: (p: { message: string; onRetry: () => void }) => {
      ctl.retry = p.onRetry;
      return <orig.ErrorState {...p} />;
    },
  };
});
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? <div data-testid="sheet">{children}</div> : null,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/zmp-bridge', () => ({ shareLink: mocks.shareLink }));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../services/affiliate-api', () => ({ fetchContentKit: mocks.fetchContentKit }));

import { ContentKitSheet } from './content-kit-sheet';
import { miniAppLink } from '../utils/miniapp-link';

const MINI_PRODUCT_LINK = miniAppLink('/product/tra-xanh?ref=ABC123');

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

  it('bài mẫu soạn tay không có {link}: chép kèm liên kết giới thiệu của Mini App, không mất mã ref', async () => {
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
      `Trà xanh ngon lắm, mua đi ${MINI_PRODUCT_LINK}`,
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
    expect(mocks.copyText).toHaveBeenCalledWith(MINI_PRODUCT_LINK);
  });

  it('nút Sao chép liên kết cũng chép liên kết tuyệt đối khi API trả đường dẫn tương đối', async () => {
    mocks.fetchContentKit.mockResolvedValue({
      productName: 'Trà xanh', images: [], usps: [], faqs: [], videoUrls: [], captions: [],
      shareLink: '/product/tra-xanh?ref=ABC123',
    });
    renderKit();
    fireEvent.click(await screen.findByRole('button', { name: /Sao chép/ }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
    // Đường dẫn tương đối (app.miniapp_base_url trống) thành link Mini App (zalo.me/s/<id>/product/<slug>), không phải link web.
    expect(mocks.copyText).toHaveBeenCalledWith(MINI_PRODUCT_LINK);
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

  it('{link} trong bài mẫu do API chèn là đường dẫn tương đối: bài mẫu hiện và chép với link Mini App, giữ mã ref', async () => {
    mocks.fetchContentKit.mockResolvedValue({
      productName: 'Trà xanh', images: [], usps: [], faqs: [], videoUrls: [],
      captions: ['Mua ngay /product/tra-xanh?ref=ABC123 nhé', 'Bài không có link'],
      shareLink: '/product/tra-xanh?ref=ABC123',
    });
    renderKit();
    const caption = await screen.findByRole('button', { name: /Mua ngay/ });
    expect(caption).toHaveTextContent(`Mua ngay ${MINI_PRODUCT_LINK} nhé`);
    fireEvent.click(caption);
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
    expect(mocks.copyText).toHaveBeenCalledWith(`Mua ngay ${MINI_PRODUCT_LINK} nhé`);
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

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const KIT = {
  productName: 'Trà xanh',
  images: [],
  usps: ['Lá trà sạch'],
  faqs: [{ q: 'Dùng thế nào?', a: 'Pha nước 80 độ.' }],
  videoUrls: ['https://video.example/v1'],
  captions: ['Trà xanh ngon lắm https://app.tubutree.com/product/tra-xanh?ref=ABC123', 'Bài hai'],
  shareLink: '/product/tra-xanh?ref=ABC123',
};

function mountKit(props: { visible?: boolean; productSlug?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <ContentKitSheet visible={props.visible ?? true} onClose={() => {}} productSlug={props.productSlug ?? 'tra-xanh'} />
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

const shareBtn = () => screen.getByRole('button', { name: /Chia sẻ Zalo/ });
const linkBtn = () => screen.getByRole('button', { name: /Sao chép link/ });
const rowBtns = () => [
  screen.getByRole('button', { name: /Trà xanh ngon lắm/ }),
  screen.getByRole('button', { name: 'Bài hai' }),
  screen.getByRole('button', { name: 'https://video.example/v1' }),
];

describe('ContentKitSheet — vùng có tên, trạng thái chờ và điều kiện tải', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctl.buttons.clear();
    ctl.retry = null;
    mocks.copyText.mockResolvedValue(true);
    mocks.fetchContentKit.mockResolvedValue(KIT);
  });

  it('mỗi mục là vùng role="region" tên đúng tiêu đề, chứa nội dung của mục đó', async () => {
    mountKit();
    await screen.findByRole('button', { name: /Chia sẻ Zalo/ });
    const captions = screen.getByRole('region', { name: 'Bài mẫu (chạm để sao chép)' });
    expect(within(captions).getByRole('button', { name: 'Bài hai' })).toBeInTheDocument();
    const usps = screen.getByRole('region', { name: 'Điểm bán hàng' });
    expect(within(usps).getByText('Lá trà sạch')).toBeInTheDocument();
    const faq = screen.getByRole('region', { name: 'Câu hỏi thường gặp' });
    expect(within(faq).getByText('Dùng thế nào?')).toBeInTheDocument();
    const video = screen.getByRole('region', { name: 'Video tham khảo' });
    expect(within(video).getByRole('button', { name: 'https://video.example/v1' })).toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(4);
  });

  it('đang tải: khối chờ là vùng role="status" aria-busy="true"; tải xong thì biến mất', async () => {
    const kit = deferred<typeof KIT>();
    mocks.fetchContentKit.mockReturnValue(kit.promise);
    mountKit();
    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    await act(async () => kit.resolve(KIT));
    await screen.findByRole('button', { name: /Chia sẻ Zalo/ });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('slug rỗng hoặc sheet đóng: không gọi API', async () => {
    mountKit({ productSlug: '' });
    mountKit({ visible: false });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(mocks.fetchContentKit).not.toHaveBeenCalled();
  });

  it('đã có dữ liệu mà tải lại lỗi: Thử lại chỉ tải một lần khi đang tải, bấm thêm hay gọi thẳng onRetry cũng vậy', async () => {
    const { qc } = mountKit();
    await screen.findByRole('button', { name: /Chia sẻ Zalo/ });
    mocks.fetchContentKit.mockRejectedValueOnce(new Error('mạng lỗi'));
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['content-kit'] });
    });
    const retry = await screen.findByRole('button', { name: /Thử lại/ });
    expect(mocks.fetchContentKit).toHaveBeenCalledTimes(2);

    const slow = deferred<typeof KIT>();
    mocks.fetchContentKit.mockReturnValue(slow.promise);
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.fetchContentKit).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole('button', { name: /Thử lại/ }));
    act(() => ctl.retry!());
    expect(mocks.fetchContentKit).toHaveBeenCalledTimes(3);

    await act(async () => slow.resolve(KIT));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Thử lại/ })).toBeNull());
  });
});

describe('ContentKitSheet — khoá khi đang chia sẻ hoặc sao chép', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctl.buttons.clear();
    ctl.retry = null;
    mocks.copyText.mockResolvedValue(true);
    mocks.fetchContentKit.mockResolvedValue(KIT);
  });

  it('đang chia sẻ: nút Chia sẻ báo bận, các nút và hàng chép khác báo khoá; bấm thêm không chia sẻ hay chép; xong thì mở lại', async () => {
    const send = deferred<void>();
    mocks.shareLink.mockReturnValue(send.promise);
    mountKit();
    await screen.findByRole('button', { name: /Chia sẻ Zalo/ });
    expect(shareBtn()).not.toHaveAttribute('aria-busy');
    expect(shareBtn()).not.toHaveAttribute('aria-disabled');
    expect(linkBtn()).not.toHaveAttribute('aria-disabled');
    rowBtns().forEach((b) => expect(b).not.toHaveAttribute('aria-disabled'));

    fireEvent.click(shareBtn());
    await waitFor(() => expect(shareBtn()).toHaveAttribute('aria-busy', 'true'));
    expect(shareBtn()).toHaveAttribute('aria-disabled', 'true');
    expect(linkBtn()).toHaveAttribute('aria-disabled', 'true');
    expect(linkBtn()).not.toHaveAttribute('aria-busy');
    rowBtns().forEach((b) => expect(b).toHaveAttribute('aria-disabled', 'true'));

    fireEvent.click(shareBtn());
    fireEvent.click(linkBtn());
    rowBtns().forEach((b) => fireEvent.click(b));
    await act(async () => {
      ctl.buttons.get('Chia sẻ Zalo')!.onPress?.();
      ctl.buttons.get('Sao chép link')!.onPress?.();
    });
    expect(mocks.shareLink).toHaveBeenCalledTimes(1);
    expect(mocks.copyText).not.toHaveBeenCalled();

    await act(async () => send.resolve());
    await waitFor(() => expect(shareBtn()).not.toHaveAttribute('aria-busy'));
    expect(shareBtn()).not.toHaveAttribute('aria-disabled');
    expect(linkBtn()).not.toHaveAttribute('aria-disabled');
    rowBtns().forEach((b) => expect(b).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(linkBtn());
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
  });

  it('hai lần bấm Chia sẻ sát nhau trước khi vẽ lại: chỉ một lần chia sẻ (khoá bằng ref)', async () => {
    const send = deferred<void>();
    mocks.shareLink.mockReturnValue(send.promise);
    mountKit();
    await screen.findByRole('button', { name: /Chia sẻ Zalo/ });
    await act(async () => {
      const press = ctl.buttons.get('Chia sẻ Zalo')!.onPress!;
      press();
      press();
    });
    expect(mocks.shareLink).toHaveBeenCalledTimes(1);
    await act(async () => send.resolve());
  });

  it('hai hàng chép chạm sát nhau trước khi vẽ lại: chỉ chép hàng đầu', async () => {
    const pending = deferred<boolean>();
    mocks.copyText.mockReturnValue(pending.promise);
    mountKit();
    await screen.findByRole('button', { name: /Chia sẻ Zalo/ });
    const [first, second] = rowBtns();
    act(() => {
      fireEvent.click(first!);
      fireEvent.click(second!);
    });
    expect(mocks.copyText).toHaveBeenCalledTimes(1);
    expect(mocks.copyText).toHaveBeenCalledWith(first!.textContent);
    await act(async () => pending.resolve(true));
  });

  it('đang sao chép: Chia sẻ chỉ báo khoá chứ không báo bận, bấm chia sẻ bị bỏ qua; xong thì báo đã sao chép và mở lại', async () => {
    const pending = deferred<boolean>();
    mocks.copyText.mockReturnValue(pending.promise);
    mountKit();
    await screen.findByRole('button', { name: /Chia sẻ Zalo/ });
    fireEvent.click(linkBtn());
    await waitFor(() => expect(shareBtn()).toHaveAttribute('aria-disabled', 'true'));
    expect(shareBtn()).not.toHaveAttribute('aria-busy');

    fireEvent.click(shareBtn());
    await act(async () => {
      ctl.buttons.get('Chia sẻ Zalo')!.onPress?.();
    });
    expect(mocks.shareLink).not.toHaveBeenCalled();

    await act(async () => pending.resolve(true));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã sao chép', type: 'success' }));
    await waitFor(() => expect(shareBtn()).not.toHaveAttribute('aria-disabled'));
  });

  it('chia sẻ lỗi: khoá được nhả, bấm Sao chép link ngay sau đó vẫn chạy', async () => {
    mocks.shareLink.mockRejectedValue(new Error('zalo từ chối'));
    mountKit();
    await screen.findByRole('button', { name: /Chia sẻ Zalo/ });
    fireEvent.click(shareBtn());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(linkBtn()).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(linkBtn());
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(2));
  });
});

describe('ContentKitSheet — nội dung gửi đi và phản hồi rung', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctl.buttons.clear();
    ctl.retry = null;
    mocks.copyText.mockResolvedValue(true);
    mocks.shareLink.mockResolvedValue(undefined);
    mocks.fetchContentKit.mockResolvedValue({ ...KIT, images: ['https://cdn/a.jpg', 'https://cdn/b.jpg'] });
  });

  it('Chia sẻ Zalo gửi đủ tên, bài mẫu đầu đã có link Mini App, ảnh đầu và đường dẫn trong Mini App; rung nhẹ một lần', async () => {
    mountKit();
    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ Zalo/ }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(1));
    expect(mocks.shareLink.mock.calls[0]![0]).toEqual({
      title: 'Trà xanh',
      description: 'Trà xanh ngon lắm https://app.tubutree.com/product/tra-xanh?ref=ABC123',
      thumbnail: 'https://cdn/a.jpg',
      path: '/product/tra-xanh?ref=ABC123',
    });
    expect(mocks.haptic).toHaveBeenCalledTimes(1);
    expect(mocks.haptic).toHaveBeenCalledWith('light');
  });

  it('không có bài mẫu: mô tả chia sẻ là tên sản phẩm', async () => {
    mocks.fetchContentKit.mockResolvedValue({ ...KIT, captions: [] });
    mountKit();
    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ Zalo/ }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(1));
    expect(mocks.shareLink.mock.calls[0]![0]).toMatchObject({ title: 'Trà xanh', description: 'Trà xanh' });
  });

  it('chép thành công thì rung nhẹ; chép thất bại thì không rung mà báo lỗi', async () => {
    mountKit();
    fireEvent.click(await screen.findByRole('button', { name: /Sao chép link/ }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    expect(mocks.haptic).toHaveBeenCalledTimes(1);
    expect(mocks.haptic).toHaveBeenCalledWith('light');

    mocks.haptic.mockClear();
    mocks.copyText.mockResolvedValue(false);
    fireEvent.click(linkBtn());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(2));
    expect(mocks.openSnackbar.mock.calls[1]![0]).toMatchObject({ type: 'error' });
    expect(mocks.haptic).not.toHaveBeenCalled();
  });
});

describe('ContentKitSheet — dấu hiệu nhìn thấy khi khoá', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctl.buttons.clear();
    ctl.retry = null;
    mocks.copyText.mockResolvedValue(true);
    mocks.fetchContentKit.mockResolvedValue(KIT);
  });

  it('đang khoá: các hàng chép mờ đi (opacity 0,6); mở khoá thì trả về như cũ', async () => {
    const send = deferred<void>();
    mocks.shareLink.mockReturnValue(send.promise);
    mountKit();
    await screen.findByRole('button', { name: /Chia sẻ Zalo/ });
    rowBtns().forEach((b) => expect(b.style.opacity).toBe(''));
    fireEvent.click(shareBtn());
    await waitFor(() => expect(shareBtn()).toHaveAttribute('aria-busy', 'true'));
    rowBtns().forEach((b) => expect(b.style.opacity).toBe('0.6'));
    await act(async () => send.resolve());
    await waitFor(() => expect(shareBtn()).not.toHaveAttribute('aria-busy'));
    rowBtns().forEach((b) => expect(b.style.opacity).toBe(''));
  });
});
