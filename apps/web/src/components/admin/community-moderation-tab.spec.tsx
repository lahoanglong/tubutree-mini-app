// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import { CommunityModerationTab } from './community-moderation-tab';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const PENDING = [
  { id: 'p1', kind: 'SHOWCASE', title: 'Ban công mới trồng', body: 'Khoe vườn ban công sau ba tuần.', images: ['https://cdn.example.com/a.jpg'], author: 'Lan', category: 'Khoe vườn', createdAt: '2026-10-17T03:00:00.000Z' },
  { id: 'p2', kind: 'QUESTION', title: null, body: 'Lá vàng phải làm sao?', images: [], author: 'Minh', category: null, createdAt: '2026-10-17T04:00:00.000Z' },
];
const PUBLISHED = {
  items: [
    { id: 'a1', kind: 'TIP', title: 'Mẹo tưới', excerpt: 'Tưới buổi sáng.', author: 'Hà', category: 'Chăm sóc', createdAt: '2026-10-16T03:00:00.000Z', isPinned: true, likeCount: 4, commentCount: 2 },
    { id: 'a2', kind: 'MANUAL', title: null, excerpt: 'Chia sẻ nhỏ.', author: 'Quân', category: null, createdAt: '2026-10-16T04:00:00.000Z', isPinned: false, likeCount: 0, commentCount: 0 },
  ],
  nextCursor: null as string | null,
};
const UNANSWERED = [
  { id: 'q1', title: 'Cây khô lá', excerpt: 'Cây để ngoài nắng bị khô.', createdAt: '2026-10-15T03:00:00.000Z', author: 'Bình', category: 'Hỏi đáp', waitingHours: 52 },
];

function setup(routes: Parameters<typeof mockFetch>[0] = {}, props: { initialView?: 'pending' | 'published' | 'unanswered' } = {}) {
  const api = mockFetch({
    '/feed/admin/pending': { body: PENDING },
    '/feed/admin/published': { body: PUBLISHED },
    '/feed/admin/unanswered': { body: UNANSWERED },
    ...routes,
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const r = render(<CommunityModerationTab {...props} />);
  mounted.push(r);
  return { api, r };
}
const posted = (api: ReturnType<typeof mockFetch>, part: string) => api.calls.find((c) => c.url.includes(part) && c.init?.method === 'POST');

describe('CommunityModerationTab — bài chờ duyệt', () => {
  it('mặc định mở danh sách chờ duyệt: tác giả, loại bài, nội dung, ảnh', async () => {
    const { r } = setup();
    await flush();

    expect(r.container.textContent).toContain('Ban công mới trồng');
    expect(r.container.textContent).toContain('Lan');
    expect(r.container.textContent).toContain('Trải nghiệm');
    expect(r.container.textContent).toContain('Khoe vườn ban công sau ba tuần.');
    expect(r.container.textContent).toContain('Lá vàng phải làm sao?');
    expect(r.container.querySelector('img[src="https://cdn.example.com/a.jpg"]')).not.toBeNull();
  });

  it('Duyệt gọi approve đúng bài rồi làm mới danh sách', async () => {
    const { api, r } = setup({ '/feed/admin/p1/approve': { body: { ok: true } } });
    await flush();

    click(byText(r.container.querySelector('[data-post="p1"]')!, 'button', 'Duyệt'));
    await flush();

    expect(posted(api, '/feed/admin/p1/approve')).toBeDefined();
    expect(api.calls.filter((c) => c.url.includes('/feed/admin/pending')).length).toBeGreaterThanOrEqual(2);
  });

  it('Từ chối hỏi lý do (tối đa 200 ký tự như API) rồi gửi kèm lý do; huỷ hộp thoại thì không gọi API', async () => {
    const { api, r } = setup({ '/feed/admin/p1/reject': { body: { ok: true } } });
    await flush();

    click(byText(r.container.querySelector('[data-post="p1"]')!, 'button', 'Từ chối'));
    await flush();
    const reason = confirmDialog()!.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea, input')!;
    expect(reason.maxLength).toBe(200);
    answerConfirm(false);
    await flush();
    expect(posted(api, '/feed/admin/p1/reject')).toBeUndefined();

    click(byText(r.container.querySelector('[data-post="p1"]')!, 'button', 'Từ chối'));
    await flush();
    typeInto(confirmDialog()!.querySelector('textarea, input'), 'Có link bán hàng ngoài');
    answerConfirm(true);
    await flush();
    expect(JSON.parse(String(posted(api, '/feed/admin/p1/reject')!.init?.body))).toEqual({ reason: 'Có link bán hàng ngoài' });
  });

  it('Từ chối để trống lý do vẫn được (API dùng lý do mặc định về nội quy)', async () => {
    const { api, r } = setup({ '/feed/admin/p2/reject': { body: { ok: true } } });
    await flush();

    click(byText(r.container.querySelector('[data-post="p2"]')!, 'button', 'Từ chối'));
    await flush();
    answerConfirm(true);
    await flush();

    expect(JSON.parse(String(posted(api, '/feed/admin/p2/reject')!.init?.body))).toEqual({});
  });

  it('duyệt lỗi → hiện lỗi ngay trên bài, các bài khác vẫn thao tác được', async () => {
    const { r } = setup({ '/feed/admin/p1/approve': { status: 500, body: { message: 'Máy chủ bận' } } });
    await flush();

    click(byText(r.container.querySelector('[data-post="p1"]')!, 'button', 'Duyệt'));
    await flush();

    expect(r.container.querySelector('[data-post="p1"] [role="alert"]')!.textContent).toContain('Máy chủ bận');
    expect(r.container.querySelector('[data-post="p2"] [role="alert"]')).toBeNull();
  });

  it('trạng thái tải, rỗng và lỗi tải', async () => {
    const loading = setup();
    expect(loading.r.container.textContent).toContain('Đang tải');
    await flush();
    loading.r.unmount();
    mounted = [];

    const empty = setup({ '/feed/admin/pending': { body: [] } });
    await flush();
    expect(empty.r.container.textContent).toContain('Không có bài nào đang chờ duyệt');
    empty.r.unmount();
    mounted = [];

    const failed = setup({ '/feed/admin/pending': { status: 500, body: { message: 'x' } } });
    await flush();
    expect(failed.r.container.querySelector('[role="alert"]')!.textContent).toContain('Không tải được');
    expect(byText(failed.r.container, 'button', 'Thử lại')).not.toBeNull();
  });
});

describe('CommunityModerationTab — bài đã đăng', () => {
  const openPublished = async (routes: Parameters<typeof mockFetch>[0] = {}) => {
    const s = setup(routes);
    await flush();
    click(byText(s.r.container, 'button', 'Đã đăng'));
    await flush();
    return s;
  };

  it('liệt kê bài đã đăng, bài đang ghim có nhãn và nút "Bỏ ghim"', async () => {
    const { r } = await openPublished();

    const pinned = r.container.querySelector('[data-post="a1"]')!;
    expect(pinned.textContent).toContain('Mẹo tưới');
    expect(pinned.textContent).toContain('Đang ghim');
    expect(byText(pinned, 'button', 'Bỏ ghim')).not.toBeNull();
    expect(byText(r.container.querySelector('[data-post="a2"]')!, 'button', 'Ghim')).not.toBeNull();
  });

  it('Ghim gửi pinned=true; Bỏ ghim gửi pinned=false', async () => {
    const { api, r } = await openPublished({ '/feed/admin/a2/pin': { body: { ok: true } }, '/feed/admin/a1/pin': { body: { ok: true } } });

    click(byText(r.container.querySelector('[data-post="a2"]')!, 'button', 'Ghim'));
    await flush();
    expect(JSON.parse(String(posted(api, '/feed/admin/a2/pin')!.init?.body))).toEqual({ pinned: true });

    click(byText(r.container.querySelector('[data-post="a1"]')!, 'button', 'Bỏ ghim'));
    await flush();
    expect(JSON.parse(String(posted(api, '/feed/admin/a1/pin')!.init?.body))).toEqual({ pinned: false });
  });

  it('Ẩn hỏi lý do (tác giả sẽ được báo) rồi gọi hide kèm lý do', async () => {
    const { api, r } = await openPublished({ '/feed/admin/a2/hide': { body: { ok: true } } });

    click(byText(r.container.querySelector('[data-post="a2"]')!, 'button', 'Ẩn'));
    await flush();
    expect(confirmDialog()!.textContent).toContain('tác giả');
    typeInto(confirmDialog()!.querySelector('textarea, input'), 'Quảng cáo');
    answerConfirm(true);
    await flush();

    expect(JSON.parse(String(posted(api, '/feed/admin/a2/hide')!.init?.body))).toEqual({ reason: 'Quảng cáo' });
  });

  it('còn trang sau → "Tải thêm" gửi cursor', async () => {
    const calls: string[] = [];
    const { r } = await openPublished({
      '/feed/admin/published': () => {
        return { body: calls.push('x') === 1 ? { ...PUBLISHED, nextCursor: 'a2' } : { items: [], nextCursor: null } };
      },
    });
    const more = byText(r.container, 'button', 'Tải thêm')!;
    expect(more).not.toBeNull();
    click(more);
    await flush();
    expect(calls).toHaveLength(2);
  });

  it('rỗng và lỗi tải', async () => {
    const empty = await openPublished({ '/feed/admin/published': { body: { items: [], nextCursor: null } } });
    expect(empty.r.container.textContent).toContain('Chưa có bài nào được đăng');
    empty.r.unmount();
    mounted = [];

    const failed = await openPublished({ '/feed/admin/published': { status: 500, body: { message: 'x' } } });
    expect(failed.r.container.querySelector('[role="alert"]')!.textContent).toContain('Không tải được');
  });
});

describe('CommunityModerationTab — câu hỏi chưa ai trả lời', () => {
  it('mở thẳng bằng initialView (từ thẻ "Việc cần xử lý"): hiện số giờ đã chờ và hướng dẫn trả lời', async () => {
    const { r } = setup({}, { initialView: 'unanswered' });
    await flush();

    const row = r.container.querySelector('[data-post="q1"]')!;
    expect(row.textContent).toContain('Cây khô lá');
    expect(row.textContent).toContain('Bình');
    expect(row.textContent).toContain('52 giờ');
    expect(r.container.textContent).toContain('Trả lời trong ứng dụng');
    expect(r.container.querySelector('[data-post="q1"] button')).toBeNull();
  });

  it('rỗng: nói không có câu hỏi nào đang chờ; lỗi tải có Thử lại', async () => {
    const empty = setup({ '/feed/admin/unanswered': { body: [] } }, { initialView: 'unanswered' });
    await flush();
    expect(empty.r.container.textContent).toContain('Không có câu hỏi nào đang chờ trả lời');
    empty.r.unmount();
    mounted = [];

    const failed = setup({ '/feed/admin/unanswered': { status: 500, body: { message: 'x' } } }, { initialView: 'unanswered' });
    await flush();
    expect(failed.r.container.querySelector('[role="alert"]')!.textContent).toContain('Không tải được');
    expect(byText(failed.r.container, 'button', 'Thử lại')).not.toBeNull();
  });
});

describe('CommunityModerationTab — khung', () => {
  it('ba mục chuyển đổi được, mục đang xem có aria-pressed; có h2 làm tiêu đề', async () => {
    const { r } = setup();
    await flush();

    expect(r.container.querySelector('h2')!.textContent).toBe('Cộng đồng');
    const chips = ['Chờ duyệt', 'Đã đăng', 'Chưa trả lời'].map((t) => byText(r.container, 'button[aria-pressed]', t)!);
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    click(chips[2]!);
    await flush();
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
  });
});
