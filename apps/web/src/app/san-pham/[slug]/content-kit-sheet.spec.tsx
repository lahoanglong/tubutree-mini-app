// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Cùng ý nghĩa content-kit-sheet.spec.tsx của Mini App: bài mẫu có link giới thiệu tuyệt đối, chép/chia sẻ không nuốt lỗi.

const mocks = vi.hoisted(() => ({ http: { get: vi.fn() } }));
vi.mock('@/lib/core-http', () => ({ coreHttp: mocks.http }));

import { ContentKitSheet } from './content-kit-sheet';

const KIT = {
  productName: 'Dầu gội bồ kết',
  images: ['https://cdn/a.jpg'],
  captions: ['Dầu gội dịu nhẹ {{x}} https://tubutree.com/product/dau-goi?ref=CTV1', 'Bài hai'],
  usps: ['Không sulfate'],
  faqs: [{ q: 'Dùng bao lâu?', a: 'Hai tháng.' }],
  videoUrls: ['https://youtu.be/abc'],
  shareLink: '/product/dau-goi?ref=CTV1',
};

let mounted: Rendered[] = [];
const mount = () => {
  const r = render(<ContentKitSheet visible onClose={vi.fn()} productSlug="dau-goi" />);
  mounted.push(r);
  return r;
};
const writeText = vi.fn();
const share = vi.fn();

beforeEach(() => {
  mocks.http.get.mockReset().mockResolvedValue(KIT);
  writeText.mockReset().mockResolvedValue(undefined);
  share.mockReset();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('ContentKitSheet', () => {
  it('gọi GET /affiliate/content-kit/<slug>; hiện đủ bài mẫu, điểm bán hàng, hỏi đáp, video; tiêu đề là h2', async () => {
    mount();
    await flush();
    expect(mocks.http.get).toHaveBeenCalledWith('/affiliate/content-kit/dau-goi');
    const t = document.body.textContent!;
    expect(document.querySelector('h2')!.textContent).toBe('Nội dung bán hàng');
    for (const s of ['Bài mẫu (chạm để sao chép)', 'Điểm bán hàng', 'Không sulfate', 'Câu hỏi thường gặp', 'Dùng bao lâu?', 'Video tham khảo', 'https://youtu.be/abc']) expect(t).toContain(s);
    expect(unnamedControls(document.body)).toEqual([]);
    expect(smallTouchTargets(document.body)).toEqual([]);
  });

  it('nút Sao chép link chép link tuyệt đối của trang sản phẩm web, giữ mã ref, và báo đã sao chép', async () => {
    mount();
    await flush();
    click(byText(document.body, 'button', 'Sao chép link'));
    await flush();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/san-pham/dau-goi?ref=CTV1`);
    expect(document.querySelector('[role="status"]')!.textContent).toBe('Đã sao chép');
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('chạm bài mẫu chép đúng nội dung (link tương đối trong bài mẫu được đổi sang link web tuyệt đối)', async () => {
    mocks.http.get.mockResolvedValue({ ...KIT, captions: ['Mua tại /product/dau-goi?ref=CTV1 nhé'] });
    mount();
    await flush();
    click(byText(document.body, 'button', /Mua tại/));
    await flush();
    expect(writeText).toHaveBeenCalledWith(`Mua tại ${window.location.origin}/san-pham/dau-goi?ref=CTV1 nhé`);
  });

  it('API trả URL tuyệt đối (Mini App) thì giữ nguyên', async () => {
    mocks.http.get.mockResolvedValue({ ...KIT, shareLink: 'https://zalo.me/s/1/product/dau-goi?ref=CTV1' });
    mount();
    await flush();
    click(byText(document.body, 'button', 'Sao chép link'));
    await flush();
    expect(writeText).toHaveBeenCalledWith('https://zalo.me/s/1/product/dau-goi?ref=CTV1');
  });

  it('chia sẻ dùng hộp chia sẻ của hệ điều hành khi có, kèm link giới thiệu', async () => {
    Object.defineProperty(navigator, 'share', { value: share.mockResolvedValue(undefined), configurable: true });
    mount();
    await flush();
    click(byText(document.body, 'button', 'Chia sẻ'));
    await flush();
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({
      title: 'Dầu gội bồ kết',
      text: 'Dầu gội dịu nhẹ {{x}} https://tubutree.com/product/dau-goi?ref=CTV1',
      url: `${window.location.origin}/san-pham/dau-goi?ref=CTV1`,
    });
  });

  it('không có bài mẫu thì hộp chia sẻ nhận tên sản phẩm làm nội dung', async () => {
    Object.defineProperty(navigator, 'share', { value: share.mockResolvedValue(undefined), configurable: true });
    mocks.http.get.mockResolvedValue({ ...KIT, captions: [] });
    mount();
    await flush();
    click(byText(document.body, 'button', 'Chia sẻ'));
    await flush();
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ text: 'Dầu gội bồ kết' }));
  });

  it('chạm hàng video chép đúng địa chỉ video, chạm bài mẫu chép đúng bài mẫu đó', async () => {
    mount();
    await flush();
    click(byText(document.body, 'button', 'https://youtu.be/abc'));
    await flush();
    expect(writeText).toHaveBeenLastCalledWith('https://youtu.be/abc');
    click(byText(document.body, 'button', 'Bài hai'));
    await flush();
    expect(writeText).toHaveBeenLastCalledWith('Bài hai');
  });

  it('không có hộp chia sẻ thì chép bài mẫu đầu kèm link; bài mẫu thiếu ref thì nối link vào để không mất hoa hồng', async () => {
    mocks.http.get.mockResolvedValue({ ...KIT, captions: ['Bài soạn tay'] });
    mount();
    await flush();
    click(byText(document.body, 'button', 'Chia sẻ'));
    await flush();
    expect(writeText).toHaveBeenCalledWith(`Bài soạn tay ${window.location.origin}/san-pham/dau-goi?ref=CTV1`);
  });

  it('copy thất bại thì hướng dẫn chép tay, không báo đã sao chép', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    mount();
    await flush();
    click(byText(document.body, 'button', 'Sao chép link'));
    await flush();
    const alert = document.querySelector('[role="alert"]')!.textContent!;
    expect(alert).toContain('Không sao chép được');
    expect(alert).not.toContain('Đã sao chép');
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it('chưa có nội dung mẫu thì báo rỗng', async () => {
    mocks.http.get.mockResolvedValue({ ...KIT, captions: [], usps: [], faqs: [], videoUrls: [] });
    mount();
    await flush();
    expect(document.body.textContent).toContain('Sản phẩm này chưa có nội dung mẫu.');
  });

  it('tải lỗi thì báo lỗi và Thử lại gọi lại API', async () => {
    mocks.http.get.mockRejectedValueOnce(new Error('Máy chủ bận'));
    mount();
    await flush();
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('Máy chủ bận');
    click(byText(document.body, 'button', 'Thử lại'));
    await flush();
    expect(mocks.http.get.mock.calls.filter(([p]) => !String(p).includes('/config/'))).toHaveLength(2);
    expect(document.body.textContent).toContain('Không sulfate');
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type KitProps = { visible: boolean; productSlug: string };
function mountWith(initial: KitProps) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const sheet = (p: KitProps) => <ContentKitSheet visible={p.visible} onClose={vi.fn()} productSlug={p.productSlug} />;
  const r = render(sheet(initial), qc);
  mounted.push(r);
  const update = (next: KitProps) => act(() => r.root.render(<QueryClientProvider client={qc}>{sheet(next)}</QueryClientProvider>));
  return { qc, update };
}
const btn = (text: string | RegExp) => byText(document.body, 'button', text) as HTMLButtonElement;
const shareBtn = () => btn('Chia sẻ');
const linkBtn = () => btn('Sao chép link');
const rowBtns = () => [btn(/Dầu gội dịu nhẹ/), btn('Bài hai'), btn('https://youtu.be/abc')];
const kitCalls = () => mocks.http.get.mock.calls.filter(([p]) => String(p).includes('/affiliate/content-kit/'));
const notes = () => ({
  status: document.querySelector('[role="status"]:not([aria-busy])')?.textContent ?? null,
  alert: document.querySelector('[role="alert"]')?.textContent ?? null,
});

describe('ContentKitSheet: vùng có tên, trạng thái chờ và điều kiện tải', () => {
  it('mỗi mục là vùng tên đúng tiêu đề, chứa nội dung của mục đó', async () => {
    mount();
    await flush();
    const region = (name: string) => document.querySelector<HTMLElement>(`section[aria-label="${name}"]`)!;
    expect(region('Bài mẫu (chạm để sao chép)').textContent).toContain('Bài hai');
    expect(region('Điểm bán hàng').textContent).toContain('Không sulfate');
    expect(region('Câu hỏi thường gặp').textContent).toContain('Dùng bao lâu?');
    expect(region('Video tham khảo').textContent).toContain('https://youtu.be/abc');
    expect(document.querySelectorAll('section[aria-label]')).toHaveLength(4);
  });

  it('đang tải: khối chờ là vùng role="status" aria-busy="true"; tải xong thì biến mất', async () => {
    const kit = deferred<typeof KIT>();
    mocks.http.get.mockReturnValue(kit.promise);
    mount();
    await flush(2);
    expect(document.querySelectorAll('[role="status"][aria-busy="true"]')).toHaveLength(1);
    await act(async () => kit.resolve(KIT));
    await flush(3);
    expect(document.querySelector('[role="status"][aria-busy]')).toBeNull();
  });

  it('slug rỗng hoặc sheet đóng: không gọi API', async () => {
    mountWith({ visible: true, productSlug: '' });
    mountWith({ visible: false, productSlug: 'dau-goi' });
    await flush(3);
    expect(kitCalls()).toHaveLength(0);
  });

  it('đã có dữ liệu mà tải lại lỗi: Thử lại chỉ tải một lần khi đang tải, bấm thêm không tải lần hai', async () => {
    const { qc } = mountWith({ visible: true, productSlug: 'dau-goi' });
    await flush();
    mocks.http.get.mockRejectedValueOnce(new Error('Máy chủ bận'));
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['content-kit'] });
    });
    await flush(3);
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('Máy chủ bận');
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

describe('ContentKitSheet: thông báo sao chép', () => {
  it('thành công là role="status", thất bại là role="alert", không cái nào hiện cả hai', async () => {
    mount();
    await flush();
    click(linkBtn());
    await flush();
    expect(notes()).toEqual({ status: 'Đã sao chép', alert: null });
    writeText.mockRejectedValue(new Error('denied'));
    click(linkBtn());
    await flush();
    expect(notes().status).toBeNull();
    expect(notes().alert).toContain('Không sao chép được');
    writeText.mockResolvedValue(undefined);
    click(linkBtn());
    await flush();
    expect(notes()).toEqual({ status: 'Đã sao chép', alert: null });
  });

  it('đóng sheet rồi mở lại: thông báo cũ (thành công hay lỗi) không còn', async () => {
    const { update } = mountWith({ visible: true, productSlug: 'dau-goi' });
    await flush();
    click(linkBtn());
    await flush();
    expect(notes().status).toBe('Đã sao chép');
    await update({ visible: false, productSlug: 'dau-goi' });
    await flush();
    await update({ visible: true, productSlug: 'dau-goi' });
    await flush();
    expect(linkBtn()).not.toBeNull();
    expect(notes()).toEqual({ status: null, alert: null });

    writeText.mockRejectedValue(new Error('denied'));
    click(linkBtn());
    await flush();
    expect(notes().alert).toContain('Không sao chép được');
    await update({ visible: false, productSlug: 'dau-goi' });
    await flush();
    await update({ visible: true, productSlug: 'dau-goi' });
    await flush();
    expect(notes()).toEqual({ status: null, alert: null });
  });

  it('đổi sang sản phẩm khác khi sheet vẫn mở: thông báo cũ không còn', async () => {
    const { update } = mountWith({ visible: true, productSlug: 'dau-goi' });
    await flush();
    click(linkBtn());
    await flush();
    expect(notes().status).toBe('Đã sao chép');
    await update({ visible: true, productSlug: 'dau-xa' });
    await flush(4);
    expect(linkBtn()).not.toBeNull();
    expect(notes()).toEqual({ status: null, alert: null });
  });
});

describe('ContentKitSheet: khoá khi đang chia sẻ hoặc sao chép', () => {
  it('đang chia sẻ: nút Chia sẻ báo bận, các nút và hàng chép khác báo khoá; bấm thêm không chia sẻ hay chép; xong thì mở lại', async () => {
    const send = deferred<void>();
    share.mockReturnValue(send.promise);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    mount();
    await flush();
    expect(shareBtn().hasAttribute('aria-busy')).toBe(false);
    for (const b of [shareBtn(), linkBtn(), ...rowBtns()]) expect(b.hasAttribute('aria-disabled')).toBe(false);

    click(shareBtn());
    await flush(2);
    expect(shareBtn().getAttribute('aria-busy')).toBe('true');
    expect(shareBtn().disabled).toBe(false);
    expect(linkBtn().hasAttribute('aria-busy')).toBe(false);
    for (const b of [shareBtn(), linkBtn(), ...rowBtns()]) expect(b.getAttribute('aria-disabled')).toBe('true');

    click(shareBtn());
    click(linkBtn());
    rowBtns().forEach((b) => click(b));
    await flush(2);
    expect(share).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();

    await act(async () => send.resolve());
    await flush(3);
    expect(shareBtn().hasAttribute('aria-busy')).toBe(false);
    for (const b of [shareBtn(), linkBtn(), ...rowBtns()]) expect(b.hasAttribute('aria-disabled')).toBe(false);
    click(linkBtn());
    await flush(2);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('hai lần bấm Chia sẻ sát nhau trước khi vẽ lại: chỉ một lần chia sẻ (khoá bằng ref)', async () => {
    const send = deferred<void>();
    share.mockReturnValue(send.promise);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    mount();
    await flush();
    act(() => {
      click(shareBtn());
      click(shareBtn());
    });
    await flush(2);
    expect(share).toHaveBeenCalledTimes(1);
    await act(async () => send.resolve());
  });

  it('hai hàng chép chạm sát nhau trước khi vẽ lại: chỉ chép hàng đầu', async () => {
    const pending = deferred<void>();
    writeText.mockReturnValue(pending.promise);
    mount();
    await flush();
    const [first, second] = rowBtns();
    act(() => {
      click(first!);
      click(second!);
    });
    await flush(2);
    expect(writeText).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
  });

  it('đang sao chép: Chia sẻ chỉ báo khoá chứ không báo bận, bấm chia sẻ bị bỏ qua; xong thì báo đã sao chép và mở lại', async () => {
    const pending = deferred<void>();
    writeText.mockReturnValue(pending.promise);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    mount();
    await flush();
    click(linkBtn());
    await flush(2);
    expect(shareBtn().getAttribute('aria-disabled')).toBe('true');
    expect(shareBtn().hasAttribute('aria-busy')).toBe(false);
    click(shareBtn());
    await flush(2);
    expect(share).not.toHaveBeenCalled();

    await act(async () => pending.resolve());
    await flush(3);
    expect(notes().status).toBe('Đã sao chép');
    expect(shareBtn().hasAttribute('aria-disabled')).toBe(false);
  });

  it('chia sẻ lỗi thường (không phải đóng hộp): chép bài mẫu đầu thay thế, thông báo đã chép và khoá được nhả', async () => {
    share.mockRejectedValue(new Error('không hỗ trợ'));
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    mount();
    await flush();
    click(shareBtn());
    await flush(4);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(notes().status).toBe('Đã sao chép');
    expect(shareBtn().hasAttribute('aria-disabled')).toBe(false);
    click(linkBtn());
    await flush(2);
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('khách đóng hộp chia sẻ (AbortError): không chép thay, không thông báo, khoá được nhả', async () => {
    share.mockRejectedValue(new DOMException('đóng', 'AbortError'));
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    mount();
    await flush();
    click(shareBtn());
    await flush(4);
    expect(writeText).not.toHaveBeenCalled();
    expect(notes()).toEqual({ status: null, alert: null });
    expect(shareBtn().hasAttribute('aria-disabled')).toBe(false);
  });
});

describe('ContentKitSheet: dấu hiệu nhìn thấy khi khoá và thẻ thông báo', () => {
  it('hàng chép có kiểu mờ khi aria-disabled', async () => {
    mount();
    await flush();
    for (const t of ['Bài hai', 'https://youtu.be/abc']) {
      expect(byText(document.body, 'button', t)!.className).toContain('aria-disabled:opacity-60');
    }
  });

  it('chép thành công rồi chép hỏng: thẻ thông báo được dựng mới, không chỉ đổi role trên cùng một thẻ', async () => {
    mount();
    await flush();
    click(byText(document.body, 'button', 'Sao chép link'));
    await flush();
    const okNode = document.querySelector('[role="status"]:not([aria-busy])')!;
    expect(okNode.textContent).toBe('Đã sao chép');
    writeText.mockRejectedValue(new Error('denied'));
    click(byText(document.body, 'button', 'Sao chép link'));
    await flush();
    const alertNode = document.querySelector('[role="alert"]')!;
    expect(alertNode).not.toBe(okNode);
    expect(okNode.isConnected).toBe(false);
  });
});
