// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { SITE_URL } from '@/lib/site';

// Cùng ý nghĩa share-sheet.spec.tsx / content-kit-sheet.spec.tsx của Mini App: chia sẻ và sao chép không chạy chồng,
// lỗi là role="alert", thông báo cũ không sống sót qua đóng/mở hay đổi đối tượng, mục có tên, khối chờ báo bận.

const mocks = vi.hoisted(() => ({ http: { get: vi.fn() }, share: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: mocks.http }));
vi.mock('@/lib/platform-bridge', () => ({ platformBridge: { share: mocks.share } }));
vi.mock('@/components/ui/qr-code', () => ({ QrCode: ({ value }: { value: string }) => <div data-testid="qr">{value}</div> }));

import { ContentKitSheet, StorefrontShareSheet, useActionLock } from './storefront-share';

const COPY_FAILED = 'Không sao chép được — hãy chọn và chép thủ công.';
const SHARE_FAILED = 'Chưa chia sẻ được — hãy chọn rồi chép liên kết thủ công.';
const KIT = {
  productName: 'Dầu gội bồ kết',
  images: ['https://cdn/a.jpg'],
  captions: ['Mua ngay /product/dau-goi?ref=CTV1', 'Bài hai'],
  usps: ['Không sulfate'],
  faqs: [{ q: 'Dùng bao lâu?', a: 'Hai tháng.' }],
  videoUrls: ['https://youtu.be/abc'],
  shareLink: '/product/dau-goi?ref=CTV1',
};
const KIT_LINK = `${SITE_URL}/san-pham/dau-goi?ref=CTV1`;
const STORE_URL = `${SITE_URL}/s/an-lanh?ref=CTV1`;

let mounted: Rendered[] = [];
const writeText = vi.fn();

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type StoreProps = { open: boolean; slug?: string; home?: boolean; heading?: string; captions?: string[] };
function storeSheet(p: StoreProps) {
  return <StorefrontShareSheet open={p.open} onClose={vi.fn()} slug={p.slug ?? 'an-lanh'} title="An Lành" referralCode="CTV1" home={p.home} heading={p.heading} captions={p.captions} />;
}
function mountStore(initial: StoreProps = { open: true }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const r = render(storeSheet(initial), qc);
  mounted.push(r);
  const update = (next: StoreProps) => act(() => r.root.render(<QueryClientProvider client={qc}>{storeSheet(next)}</QueryClientProvider>));
  return { qc, update };
}

type KitProps = { open: boolean; productSlug: string };
function kitSheet(p: KitProps) {
  return <ContentKitSheet open={p.open} onClose={vi.fn()} productSlug={p.productSlug} />;
}
function mountKit(initial: KitProps = { open: true, productSlug: 'dau-goi' }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const r = render(kitSheet(initial), qc);
  mounted.push(r);
  const update = (next: KitProps) => act(() => r.root.render(<QueryClientProvider client={qc}>{kitSheet(next)}</QueryClientProvider>));
  return { qc, update };
}

const btn = (text: string | RegExp) => byText(document.body, 'button', text) as HTMLButtonElement;
const shareBtn = () => btn('Chia sẻ');
const linkBtn = () => btn('Sao chép link');
const storeRows = () => [btn(/Mình tuyển vài món/), btn(/Gian hàng sống xanh/), btn(/Đồ thiên nhiên/)];
const kitRows = () => [btn(/Mua ngay/), btn('Bài hai'), btn('https://youtu.be/abc')];
const kitCalls = () => mocks.http.get.mock.calls.filter(([p]) => String(p).includes('/affiliate/content-kit/'));
const notes = () => ({
  status: document.querySelector('[role="status"]:not([aria-busy])')?.textContent ?? '',
  alert: document.querySelector('[role="alert"]')?.textContent ?? null,
});
const region = (name: string) => document.querySelector<HTMLElement>(`section[aria-label="${name}"]`);
const allLocked = (buttons: HTMLElement[]) => buttons.every((b) => b.getAttribute('aria-disabled') === 'true');
const noneLocked = (buttons: HTMLElement[]) => buttons.every((b) => !b.hasAttribute('aria-disabled'));

beforeEach(() => {
  mocks.http.get.mockReset().mockResolvedValue(KIT);
  mocks.share.mockReset().mockResolvedValue('shared');
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('StorefrontShareSheet: nội dung và chia sẻ', () => {
  it('mã QR và nút Sao chép link dùng link gian hàng kèm mã giới thiệu; tiêu đề mặc định hoặc tuỳ biến', async () => {
    const first = mountStore({ open: true });
    await flush();
    expect(document.querySelector('[data-testid="qr"]')!.textContent).toBe(STORE_URL);
    expect(document.querySelector('h2')!.textContent).toBe('Chia sẻ gian hàng');
    click(linkBtn());
    await flush();
    expect(writeText).toHaveBeenCalledWith(STORE_URL);
    first.update({ open: true, heading: 'Chia sẻ mã của tôi' });
    await flush();
    expect(document.querySelector('h2')!.textContent).toBe('Chia sẻ mã của tôi');
  });

  it('chia sẻ trang chủ kèm mã: đường dẫn /?ref=...; chia sẻ gian hàng: /s/<slug>?ref=...', async () => {
    mountStore({ open: true, home: true });
    await flush();
    expect(document.querySelector('[data-testid="qr"]')!.textContent).toBe(`${SITE_URL}/?ref=CTV1`);
    click(shareBtn());
    await flush();
    expect(mocks.share).toHaveBeenCalledWith(expect.objectContaining({ title: 'An Lành', path: '/?ref=CTV1' }));
  });

  it('nút Chia sẻ gọi hộp chia sẻ với caption đầu và đường dẫn gian hàng', async () => {
    mountStore();
    await flush();
    click(shareBtn());
    await flush();
    expect(mocks.share).toHaveBeenCalledWith({ title: 'An Lành', text: expect.stringContaining(STORE_URL), path: '/s/an-lanh?ref=CTV1' });
  });

  it('caption tuỳ biến được nối link nếu chưa có; caption đã có link giữ nguyên; chạm vào là chép đúng nội dung', async () => {
    mountStore({ open: true, captions: ['Ghé gian hàng nhé', `Đã có link ${STORE_URL}`] });
    await flush();
    click(btn('Ghé gian hàng nhé'));
    await flush();
    expect(writeText).toHaveBeenLastCalledWith(`Ghé gian hàng nhé ${STORE_URL}`);
    click(btn('Đã có link'));
    await flush();
    expect(writeText).toHaveBeenLastCalledWith(`Đã có link ${STORE_URL}`);
  });

  it('không truyền caption: ba lời đăng mặc định, đều kèm link', async () => {
    mountStore();
    await flush();
    const rows = storeRows();
    expect(rows).toHaveLength(3);
    rows.forEach((b) => expect(b.textContent).toContain(STORE_URL));
  });

  it('lời đăng gợi ý nằm trong vùng có tên, hai nút chính nằm ngoài vùng đó', async () => {
    mountStore();
    await flush();
    const r = region('Lời đăng gợi ý (chạm để sao chép)')!;
    expect(r.textContent).toContain('Lời đăng gợi ý (chạm để sao chép)');
    expect(r.querySelectorAll('button')).toHaveLength(3);
    expect(r.contains(shareBtn())).toBe(false);
    expect(r.contains(linkBtn())).toBe(false);
  });
});

describe('StorefrontShareSheet: thông báo', () => {
  it('vùng status luôn có sẵn (rỗng); thành công là chữ trong status, lỗi là role="alert" riêng', async () => {
    mountStore();
    await flush();
    expect(document.querySelector('[role="status"]')!.textContent).toBe('');
    expect(notes().alert).toBeNull();
    click(linkBtn());
    await flush();
    expect(notes()).toEqual({ status: 'Đã sao chép', alert: null });
    writeText.mockRejectedValue(new Error('denied'));
    click(linkBtn());
    await flush();
    expect(notes()).toEqual({ status: '', alert: COPY_FAILED });
    writeText.mockResolvedValue(undefined);
    click(linkBtn());
    await flush();
    expect(notes()).toEqual({ status: 'Đã sao chép', alert: null });
  });

  it('kết quả hộp chia sẻ: copied → đã sao chép, failed → lỗi, shared hoặc cancelled → không thông báo', async () => {
    mountStore();
    await flush();
    mocks.share.mockResolvedValue('copied');
    click(shareBtn());
    await flush();
    expect(notes()).toEqual({ status: 'Đã sao chép', alert: null });
    mocks.share.mockResolvedValue('failed');
    click(shareBtn());
    await flush();
    expect(notes()).toEqual({ status: '', alert: SHARE_FAILED });
    mocks.share.mockResolvedValue('cancelled');
    click(shareBtn());
    await flush();
    expect(notes()).toEqual({ status: '', alert: null });
    mocks.share.mockResolvedValue('failed');
    click(shareBtn());
    await flush();
    mocks.share.mockResolvedValue('shared');
    click(shareBtn());
    await flush();
    expect(notes()).toEqual({ status: '', alert: null });
  });

  it('đóng sheet rồi mở lại: thông báo cũ (thành công hay lỗi) không còn', async () => {
    const { update } = mountStore();
    await flush();
    click(linkBtn());
    await flush();
    expect(notes().status).toBe('Đã sao chép');
    await update({ open: false });
    await flush();
    await update({ open: true });
    await flush();
    expect(notes()).toEqual({ status: '', alert: null });

    mocks.share.mockResolvedValue('failed');
    click(shareBtn());
    await flush();
    expect(notes().alert).toBe(SHARE_FAILED);
    await update({ open: false });
    await flush();
    await update({ open: true });
    await flush();
    expect(notes()).toEqual({ status: '', alert: null });
  });

  it('đổi sang gian hàng khác khi sheet vẫn mở: thông báo cũ không còn', async () => {
    const { update } = mountStore();
    await flush();
    click(linkBtn());
    await flush();
    expect(notes().status).toBe('Đã sao chép');
    await update({ open: true, slug: 'khac' });
    await flush();
    expect(notes()).toEqual({ status: '', alert: null });
  });
});

describe('StorefrontShareSheet: khoá khi đang chia sẻ hoặc sao chép', () => {
  it('đang chia sẻ: nút Chia sẻ báo bận, các nút khác báo khoá; bấm thêm không chia sẻ hay chép; xong thì mở lại', async () => {
    const send = deferred<string>();
    mocks.share.mockReturnValue(send.promise);
    mountStore();
    await flush();
    expect(shareBtn().hasAttribute('aria-busy')).toBe(false);
    expect(noneLocked([shareBtn(), linkBtn(), ...storeRows()])).toBe(true);

    click(shareBtn());
    await flush(2);
    expect(shareBtn().getAttribute('aria-busy')).toBe('true');
    expect(shareBtn().disabled).toBe(false);
    expect(linkBtn().hasAttribute('aria-busy')).toBe(false);
    expect(allLocked([shareBtn(), linkBtn(), ...storeRows()])).toBe(true);

    click(shareBtn());
    click(linkBtn());
    storeRows().forEach((b) => click(b));
    await flush(2);
    expect(mocks.share).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();

    await act(async () => send.resolve('shared'));
    await flush(3);
    expect(shareBtn().hasAttribute('aria-busy')).toBe(false);
    expect(noneLocked([shareBtn(), linkBtn(), ...storeRows()])).toBe(true);
    click(linkBtn());
    await flush(2);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('hai lần bấm Chia sẻ sát nhau trước khi vẽ lại: chỉ một lần chia sẻ (khoá bằng ref)', async () => {
    const send = deferred<string>();
    mocks.share.mockReturnValue(send.promise);
    mountStore();
    await flush();
    act(() => {
      click(shareBtn());
      click(shareBtn());
    });
    await flush(2);
    expect(mocks.share).toHaveBeenCalledTimes(1);
    await act(async () => send.resolve('shared'));
  });

  it('hai lời đăng chạm sát nhau trước khi vẽ lại: chỉ chép lời đầu', async () => {
    const pending = deferred<void>();
    writeText.mockReturnValue(pending.promise);
    mountStore();
    await flush();
    const [first, second] = storeRows();
    act(() => {
      click(first!);
      click(second!);
    });
    await flush(2);
    expect(writeText).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
  });

  it('đang sao chép: Chia sẻ chỉ báo khoá chứ không báo bận, bấm chia sẻ bị bỏ qua; xong thì mở lại', async () => {
    const pending = deferred<void>();
    writeText.mockReturnValue(pending.promise);
    mountStore();
    await flush();
    click(linkBtn());
    await flush(2);
    expect(shareBtn().getAttribute('aria-disabled')).toBe('true');
    expect(shareBtn().hasAttribute('aria-busy')).toBe(false);
    click(shareBtn());
    await flush(2);
    expect(mocks.share).not.toHaveBeenCalled();
    await act(async () => pending.resolve());
    await flush(3);
    expect(noneLocked([shareBtn(), linkBtn()])).toBe(true);
  });

  it('chia sẻ lỗi: khoá được nhả, bấm Sao chép link ngay sau đó vẫn chạy', async () => {
    mocks.share.mockResolvedValue('failed');
    mountStore();
    await flush();
    click(shareBtn());
    await flush(3);
    expect(notes().alert).toBe(SHARE_FAILED);
    click(linkBtn());
    await flush(2);
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});

describe('ContentKitSheet (affiliate): vùng có tên, trạng thái chờ và điều kiện tải', () => {
  it('mỗi mục là vùng tên đúng tiêu đề, chứa nội dung của mục đó', async () => {
    mountKit();
    await flush();
    expect(region('Bài mẫu (chạm để sao chép)')!.textContent).toContain('Bài hai');
    expect(region('Điểm bán hàng')!.textContent).toContain('Không sulfate');
    expect(region('Câu hỏi thường gặp')!.textContent).toContain('Dùng bao lâu?');
    expect(region('Video tham khảo')!.textContent).toContain('https://youtu.be/abc');
    expect(document.querySelectorAll('section[aria-label]')).toHaveLength(4);
  });

  it('đang tải: khối chờ là vùng role="status" aria-busy="true"; tải xong thì biến mất', async () => {
    const kit = deferred<typeof KIT>();
    mocks.http.get.mockReturnValue(kit.promise);
    mountKit();
    await flush(2);
    expect(document.querySelectorAll('[role="status"][aria-busy="true"]')).toHaveLength(1);
    await act(async () => kit.resolve(KIT));
    await flush(3);
    expect(document.querySelector('[role="status"][aria-busy]')).toBeNull();
  });

  it('slug rỗng hoặc sheet đóng: không gọi API', async () => {
    mountKit({ open: true, productSlug: '' });
    mountKit({ open: false, productSlug: 'dau-goi' });
    await flush(3);
    expect(kitCalls()).toHaveLength(0);
  });

  it('bài mẫu có link tương đối được đổi sang link web tuyệt đối khi chép; chưa có nội dung thì báo rỗng', async () => {
    mountKit();
    await flush();
    click(btn(/Mua ngay/));
    await flush();
    expect(writeText).toHaveBeenLastCalledWith(`Mua ngay ${KIT_LINK}`);
    click(linkBtn());
    await flush();
    expect(writeText).toHaveBeenLastCalledWith(KIT_LINK);
    mounted.pop()!.unmount();
    mocks.http.get.mockResolvedValue({ ...KIT, captions: [], usps: [], faqs: [], videoUrls: [] });
    mountKit();
    await flush();
    expect(document.body.textContent).toContain('Sản phẩm này chưa có nội dung mẫu.');
  });

  it('đã có dữ liệu mà tải lại lỗi: Thử lại chỉ tải một lần khi đang tải, bấm thêm không tải lần hai', async () => {
    const { qc } = mountKit();
    await flush();
    mocks.http.get.mockRejectedValueOnce(new Error('Máy chủ bận'));
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['content-kit'] });
    });
    await flush(3);
    expect(notes().alert).toContain('Máy chủ bận');
    expect(kitCalls()).toHaveLength(2);

    const slow = deferred<typeof KIT>();
    mocks.http.get.mockReturnValue(slow.promise);
    click(btn('Thử lại'));
    await flush(2);
    expect(kitCalls()).toHaveLength(3);
    click(btn('Thử lại'));
    click(btn('Thử lại'));
    await flush(2);
    expect(kitCalls()).toHaveLength(3);
    await act(async () => slow.resolve(KIT));
    await flush(3);
  });
});

describe('ContentKitSheet (affiliate): chia sẻ và thông báo', () => {
  it('chia sẻ link của web: gọi hộp chia sẻ với đường dẫn /san-pham/..., bài mẫu đầu đã đổi sang link tuyệt đối', async () => {
    mountKit();
    await flush();
    click(shareBtn());
    await flush();
    expect(mocks.share).toHaveBeenCalledWith({ title: 'Dầu gội bồ kết', text: `Mua ngay ${KIT_LINK}`, path: '/san-pham/dau-goi?ref=CTV1' });
    expect(notes()).toEqual({ status: '', alert: null });
  });

  it('kết quả hộp chia sẻ: copied → đã sao chép; failed → chép bài mẫu đầu thay thế; cancelled → không thông báo', async () => {
    mountKit();
    await flush();
    mocks.share.mockResolvedValue('copied');
    click(shareBtn());
    await flush();
    expect(notes().status).toBe('Đã sao chép');
    expect(writeText).not.toHaveBeenCalled();
    mocks.share.mockResolvedValue('cancelled');
    click(shareBtn());
    await flush();
    expect(notes()).toEqual({ status: '', alert: null });
    mocks.share.mockResolvedValue('failed');
    click(shareBtn());
    await flush(3);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(`Mua ngay ${KIT_LINK}`);
    expect(notes().status).toBe('Đã sao chép');
    expect(noneLocked([shareBtn(), linkBtn()])).toBe(true);
  });

  it('link của nơi khác (Mini App): không gọi hộp chia sẻ của web, chép sẵn bài mẫu đầu kèm link để dán', async () => {
    mocks.http.get.mockResolvedValue({ ...KIT, captions: ['Bài soạn tay'], shareLink: 'https://zalo.me/s/1/product/dau-goi?ref=CTV1' });
    mountKit();
    await flush();
    click(shareBtn());
    await flush(3);
    expect(mocks.share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith('Bài soạn tay https://zalo.me/s/1/product/dau-goi?ref=CTV1');
    expect(notes().status).toBe('Đã sao chép');
  });

  it('thành công là role="status", thất bại là role="alert", không cái nào hiện cả hai', async () => {
    mountKit();
    await flush();
    click(linkBtn());
    await flush();
    expect(notes()).toEqual({ status: 'Đã sao chép', alert: null });
    writeText.mockRejectedValue(new Error('denied'));
    click(linkBtn());
    await flush();
    expect(notes()).toEqual({ status: '', alert: COPY_FAILED });
    writeText.mockResolvedValue(undefined);
    click(linkBtn());
    await flush();
    expect(notes()).toEqual({ status: 'Đã sao chép', alert: null });
  });

  it('đóng sheet rồi mở lại: thông báo cũ (thành công hay lỗi) không còn', async () => {
    const { update } = mountKit();
    await flush();
    click(linkBtn());
    await flush();
    expect(notes().status).toBe('Đã sao chép');
    await update({ open: false, productSlug: 'dau-goi' });
    await flush();
    await update({ open: true, productSlug: 'dau-goi' });
    await flush();
    expect(linkBtn()).not.toBeNull();
    expect(notes()).toEqual({ status: '', alert: null });

    writeText.mockRejectedValue(new Error('denied'));
    click(linkBtn());
    await flush();
    expect(notes().alert).toBe(COPY_FAILED);
    await update({ open: false, productSlug: 'dau-goi' });
    await flush();
    await update({ open: true, productSlug: 'dau-goi' });
    await flush();
    expect(notes()).toEqual({ status: '', alert: null });
  });

  it('đổi sang sản phẩm khác khi sheet vẫn mở: thông báo cũ không còn', async () => {
    const { update } = mountKit();
    await flush();
    click(linkBtn());
    await flush();
    expect(notes().status).toBe('Đã sao chép');
    await update({ open: true, productSlug: 'dau-xa' });
    await flush(4);
    expect(linkBtn()).not.toBeNull();
    expect(notes()).toEqual({ status: '', alert: null });
  });
});

describe('ContentKitSheet (affiliate): khoá khi đang chia sẻ hoặc sao chép', () => {
  it('đang chia sẻ: nút Chia sẻ báo bận, các nút và hàng chép khác báo khoá; bấm thêm không chia sẻ hay chép; xong thì mở lại', async () => {
    const send = deferred<string>();
    mocks.share.mockReturnValue(send.promise);
    mountKit();
    await flush();
    expect(shareBtn().hasAttribute('aria-busy')).toBe(false);
    expect(noneLocked([shareBtn(), linkBtn(), ...kitRows()])).toBe(true);

    click(shareBtn());
    await flush(2);
    expect(shareBtn().getAttribute('aria-busy')).toBe('true');
    expect(shareBtn().disabled).toBe(false);
    expect(linkBtn().hasAttribute('aria-busy')).toBe(false);
    expect(allLocked([shareBtn(), linkBtn(), ...kitRows()])).toBe(true);

    click(shareBtn());
    click(linkBtn());
    kitRows().forEach((b) => click(b));
    await flush(2);
    expect(mocks.share).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();

    await act(async () => send.resolve('shared'));
    await flush(3);
    expect(shareBtn().hasAttribute('aria-busy')).toBe(false);
    expect(noneLocked([shareBtn(), linkBtn(), ...kitRows()])).toBe(true);
    click(linkBtn());
    await flush(2);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('hai lần bấm Chia sẻ sát nhau trước khi vẽ lại: chỉ một lần chia sẻ (khoá bằng ref)', async () => {
    const send = deferred<string>();
    mocks.share.mockReturnValue(send.promise);
    mountKit();
    await flush();
    act(() => {
      click(shareBtn());
      click(shareBtn());
    });
    await flush(2);
    expect(mocks.share).toHaveBeenCalledTimes(1);
    await act(async () => send.resolve('shared'));
  });

  it('hai hàng chép chạm sát nhau trước khi vẽ lại: chỉ chép hàng đầu', async () => {
    const pending = deferred<void>();
    writeText.mockReturnValue(pending.promise);
    mountKit();
    await flush();
    const [first, second] = kitRows();
    act(() => {
      click(first!);
      click(second!);
    });
    await flush(2);
    expect(writeText).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
  });

  it('đang sao chép: Chia sẻ chỉ báo khoá chứ không báo bận, bấm chia sẻ bị bỏ qua; xong thì mở lại', async () => {
    const pending = deferred<void>();
    writeText.mockReturnValue(pending.promise);
    mountKit();
    await flush();
    click(linkBtn());
    await flush(2);
    expect(shareBtn().getAttribute('aria-disabled')).toBe('true');
    expect(shareBtn().hasAttribute('aria-busy')).toBe(false);
    click(shareBtn());
    await flush(2);
    expect(mocks.share).not.toHaveBeenCalled();
    await act(async () => pending.resolve());
    await flush(3);
    expect(noneLocked([shareBtn(), linkBtn(), ...kitRows()])).toBe(true);
  });
});

describe('ContentKitSheet (affiliate): nội dung mỗi hàng chép', () => {
  it('chạm hàng video chép đúng địa chỉ video, chạm bài mẫu chép đúng bài mẫu đó (đã đổi sang link tuyệt đối)', async () => {
    mountKit();
    await flush();
    click(btn('https://youtu.be/abc'));
    await flush();
    expect(writeText).toHaveBeenLastCalledWith('https://youtu.be/abc');
    click(btn('Bài hai'));
    await flush();
    expect(writeText).toHaveBeenLastCalledWith('Bài hai');
    click(btn(/Mua ngay/));
    await flush();
    expect(writeText).toHaveBeenLastCalledWith(`Mua ngay ${KIT_LINK}`);
  });
});

describe('useActionLock', () => {
  it('tác vụ ném lỗi: lỗi được trả lên, khoá và trạng thái bận vẫn được nhả để việc sau chạy được', async () => {
    const probe: { current: ReturnType<typeof useActionLock> | null } = { current: null };
    function Probe() {
      probe.current = useActionLock();
      return null;
    }
    mounted.push(render(<Probe />));
    await act(async () => {
      await expect(
        probe.current!.run('share', async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
    });
    expect(probe.current!.busy).toBe(false);
    expect(probe.current!.active).toBeNull();
    const next = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      await probe.current!.run('copy', next);
    });
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('dấu hiệu nhìn thấy khi khoá', () => {
  it('hàng chép của gian hàng và của bộ nội dung có kiểu mờ khi aria-disabled', async () => {
    mountStore();
    await flush();
    storeRows().forEach((b) => expect(b.className).toContain('aria-disabled:opacity-60'));
    mountKit();
    await flush();
    kitRows().forEach((b) => expect(b.className).toContain('aria-disabled:opacity-60'));
  });
});
