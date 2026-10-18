// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dầu gội bồ kết', url: `${window.location.origin}/san-pham/dau-goi?ref=CTV1` }));
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
    const status = document.querySelector('[role="status"]')!.textContent!;
    expect(status).toContain('Không sao chép được');
    expect(status).not.toContain('Đã sao chép');
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
    expect(mocks.http.get).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('Không sulfate');
  });
});
