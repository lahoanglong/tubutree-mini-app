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

const REPORTS = [
  { id: 'r1', reporterId: 'u9', targetType: 'POST', targetId: 'a2', reason: 'Quảng cáo', status: 'OPEN', createdAt: '2026-10-27T03:00:00.000Z', target: { kind: 'POST', author: 'Quân', title: null, excerpt: 'Mua hàng giá rẻ tại link này.', alreadyHandled: false, postId: 'a2' } },
  { id: 'r2', reporterId: 'u8', targetType: 'COMMENT', targetId: 'c7', reason: 'Lời lẽ khó nghe', status: 'OPEN', createdAt: '2026-10-27T04:00:00.000Z', target: { kind: 'COMMENT', author: 'Hà', title: null, excerpt: 'Bình luận xấu.', alreadyHandled: false, postId: 'a1' } },
  { id: 'r3', reporterId: 'u7', targetType: 'POST', targetId: 'gone', reason: 'Spam', status: 'OPEN', createdAt: '2026-10-27T05:00:00.000Z', target: null },
];

function setup(routes: Parameters<typeof mockFetch>[0] = {}, props: { initialView?: 'pending' | 'reports' | 'published' | 'unanswered' | 'events'; isAdmin?: boolean } = {}) {
  const api = mockFetch({
    '/feed/admin/pending': { body: PENDING },
    '/feed/admin/published': { body: PUBLISHED },
    '/feed/admin/unanswered': { body: UNANSWERED },
    '/feed/admin/reports': { body: REPORTS },
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

  it('ảnh chờ duyệt do API phục vụ (đường dẫn kèm mã v) hiện qua gốc API, không nhúng base64', async () => {
    const ref = `/feed/posts/p1/images/0?v=${'d'.repeat(32)}`;
    const { r } = setup({ '/feed/admin/pending': { body: [{ ...PENDING[0], images: [ref, 'javascript:alert(1)'] }] } });
    await flush();
    expect([...r.container.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([`http://localhost:3001/api${ref}`]);
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

  it('từ chối bài vừa được người khác duyệt (409) → làm mới danh sách, bài biến khỏi hàng chờ, thông điệp 409 hiện ở đầu tab', async () => {
    let listCalls = 0;
    const { api, r } = setup({
      '/feed/admin/pending': () => ({ body: ++listCalls === 1 ? PENDING : [PENDING[1]] }),
      '/feed/admin/p1/reject': { status: 409, body: { message: 'Bài này đã được đăng nên không thể từ chối. Hãy dùng "Ẩn" để gỡ bài đã đăng.' } },
    });
    await flush();

    click(byText(r.container.querySelector('[data-post="p1"]')!, 'button', 'Từ chối'));
    await flush();
    answerConfirm(true);
    await flush();

    expect(api.calls.filter((c) => c.url.includes('/feed/admin/pending')).length).toBeGreaterThanOrEqual(2);
    expect(r.container.querySelector('[data-post="p1"]')).toBeNull();
    expect(r.container.querySelector('[data-post="p2"]')).not.toBeNull();
    expect(r.container.querySelector('[role="alert"]')!.textContent).toContain('dùng "Ẩn"');
  });

  it('duyệt bài đã bị người khác từ chối (409/404) cũng làm mới danh sách và báo rõ; lỗi chung (500) thì KHÔNG làm mới', async () => {
    let listCalls = 0;
    const stale = setup({
      '/feed/admin/pending': () => ({ body: ++listCalls === 1 ? PENDING : [PENDING[1]] }),
      '/feed/admin/p1/approve': { status: 404, body: { message: 'Bài viết không tồn tại.' } },
    });
    await flush();
    click(byText(stale.r.container.querySelector('[data-post="p1"]')!, 'button', 'Duyệt'));
    await flush();
    expect(stale.r.container.querySelector('[data-post="p1"]')).toBeNull();
    expect(stale.r.container.querySelector('[role="alert"]')!.textContent).toContain('Bài viết không tồn tại');
    stale.r.unmount();
    mounted = [];

    const broken = setup({ '/feed/admin/p1/approve': { status: 500, body: { message: 'Máy chủ bận' } } });
    await flush();
    click(byText(broken.r.container.querySelector('[data-post="p1"]')!, 'button', 'Duyệt'));
    await flush();
    expect(broken.api.calls.filter((c) => c.url.includes('/feed/admin/pending'))).toHaveLength(1);
  });

  it('thông điệp 409 ở đầu tab mất đi khi chuyển sang mục khác', async () => {
    const { r } = setup({ '/feed/admin/p1/reject': { status: 409, body: { message: 'Bài này đã được đăng nên không thể từ chối.' } } });
    await flush();
    click(byText(r.container.querySelector('[data-post="p1"]')!, 'button', 'Từ chối'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(r.container.textContent).toContain('đã được đăng nên không thể từ chối');

    click(byText(r.container, 'button[aria-pressed]', 'Đã đăng'));
    await flush();

    expect(r.container.textContent).not.toContain('đã được đăng nên không thể từ chối');
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
  const openPublished = async (routes: Parameters<typeof mockFetch>[0] = {}, isAdmin = true) => {
    const s = setup(routes, { isAdmin });
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

  it('nhân viên không phải ADMIN (CSKH, MARKETING): không có nút Ghim/Bỏ ghim (API chỉ cho ADMIN ghim), vẫn thấy nhãn "Đang ghim" và nút Ẩn', async () => {
    const { r } = await openPublished({}, false);

    const pinned = r.container.querySelector('[data-post="a1"]')!;
    const plain = r.container.querySelector('[data-post="a2"]')!;
    expect(pinned.textContent).toContain('Đang ghim');
    for (const row of [pinned, plain]) {
      expect(byText(row, 'button', 'Ghim')).toBeNull();
      expect(byText(row, 'button', 'Bỏ ghim')).toBeNull();
      expect(byText(row, 'button', 'Ẩn')).not.toBeNull();
    }
  });

  it('không truyền isAdmin thì coi như không phải ADMIN (mặc định ẩn nút ghim)', async () => {
    const s = setup();
    await flush();
    click(byText(s.r.container, 'button', 'Đã đăng'));
    await flush();
    expect(byText(s.r.container.querySelector('[data-post="a2"]')!, 'button', 'Ghim')).toBeNull();
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
  it('mở thẳng bằng initialView (từ thẻ "Việc cần xử lý"): hiện số giờ đã chờ, ô trả lời ngay trong dòng và link mở bài trên web', async () => {
    const { r } = setup({}, { initialView: 'unanswered' });
    await flush();

    const row = r.container.querySelector('[data-post="q1"]')!;
    expect(row.textContent).toContain('Cây khô lá');
    expect(row.textContent).toContain('Bình');
    expect(row.textContent).toContain('52 giờ');
    expect(r.container.textContent).toContain('Trả lời ngay tại đây hoặc mở bài trên web.');
    expect(r.container.textContent).not.toContain('Trả lời trong ứng dụng');
    expect(row.querySelector('textarea')).not.toBeNull();
    const link = byText(row, 'a', 'Mở bài') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/cong-dong/q1');
    // Mở ở tab mới: chữ trả lời đang gõ dở không mất và admin không bị đưa ra khỏi /admin.
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    // Người dùng trình đọc màn hình phải được báo trước là link mở sang tab khác.
    expect(link.querySelector('.sr-only')?.textContent).toContain('mở tab mới');
  });

  it('gửi trả lời gọi API bình luận đúng bài, làm mới danh sách và số trên "Việc cần xử lý": dòng biến mất', async () => {
    let listCalls = 0;
    const { api, r } = setup(
      {
        '/feed/admin/unanswered': () => ({ body: ++listCalls === 1 ? UNANSWERED : [] }),
        '/feed/q1/comments': { body: { id: 'c1' } },
        '/admin/ops/inbox': { body: { generatedAt: '2026-10-28T03:00:00.000Z', items: [{ key: 'communityUnanswered', count: 1 }] } },
      },
      { initialView: 'unanswered' },
    );
    await flush();
    const inboxBefore = api.calls.filter((c) => c.url.includes('/admin/ops/inbox')).length;

    typeInto(r.container.querySelector('[data-post="q1"] textarea'), '  Dạ bạn tưới ít lại, để chỗ mát nhé.  ');
    click(byText(r.container.querySelector('[data-post="q1"]')!, 'button', 'Gửi trả lời'));
    await flush();

    expect(JSON.parse(String(posted(api, '/feed/q1/comments')!.init?.body))).toEqual({ body: 'Dạ bạn tưới ít lại, để chỗ mát nhé.' });
    expect(api.calls.filter((c) => c.url.includes('/feed/admin/unanswered')).length).toBeGreaterThanOrEqual(2);
    expect(api.calls.filter((c) => c.url.includes('/admin/ops/inbox')).length).toBeGreaterThan(inboxBefore);
    expect(r.container.querySelector('[data-post="q1"]')).toBeNull();
    expect(r.container.textContent).toContain('Không có câu hỏi nào đang chờ trả lời');
  });

  it('ô trả lời trống hoặc chỉ có khoảng trắng thì nút gửi khoá, không gọi API', async () => {
    const { api, r } = setup({ '/feed/q1/comments': { body: { id: 'c1' } } }, { initialView: 'unanswered' });
    await flush();
    const send = byText(r.container.querySelector('[data-post="q1"]')!, 'button', 'Gửi trả lời') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    typeInto(r.container.querySelector('[data-post="q1"] textarea'), '   ');
    expect(send.disabled).toBe(true);
    click(send);
    await flush();
    expect(posted(api, '/feed/q1/comments')).toBeUndefined();
  });

  it('gửi lỗi (500): báo ngay trên dòng, giữ nguyên nội dung đã gõ và không làm mới danh sách', async () => {
    const { api, r } = setup({ '/feed/q1/comments': { status: 500, body: { message: 'Máy chủ bận' } } }, { initialView: 'unanswered' });
    await flush();
    typeInto(r.container.querySelector('[data-post="q1"] textarea'), 'Dạ để em xem');
    click(byText(r.container.querySelector('[data-post="q1"]')!, 'button', 'Gửi trả lời'));
    await flush();
    expect(r.container.querySelector('[data-post="q1"] [role="alert"]')!.textContent).toContain('Máy chủ bận');
    expect((r.container.querySelector('[data-post="q1"] textarea') as HTMLTextAreaElement).value).toBe('Dạ để em xem');
    expect(api.calls.filter((c) => c.url.includes('/feed/admin/unanswered'))).toHaveLength(1);
  });

  it('bài đã bị gỡ trong lúc gõ (404): báo ở đầu tab và làm mới danh sách', async () => {
    let listCalls = 0;
    const { r } = setup(
      { '/feed/admin/unanswered': () => ({ body: ++listCalls === 1 ? UNANSWERED : [] }), '/feed/q1/comments': { status: 404, body: { message: 'Bài viết không tồn tại.' } } },
      { initialView: 'unanswered' },
    );
    await flush();
    typeInto(r.container.querySelector('[data-post="q1"] textarea'), 'Dạ để em xem');
    click(byText(r.container.querySelector('[data-post="q1"]')!, 'button', 'Gửi trả lời'));
    await flush();
    expect(r.container.querySelector('[data-post="q1"]')).toBeNull();
    expect(r.container.querySelector('[role="alert"]')!.textContent).toContain('Bài viết không tồn tại');
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
  it('năm mục chuyển đổi được cho ADMIN, mục đang xem có aria-pressed; có h2 làm tiêu đề', async () => {
    const { r } = setup({}, { isAdmin: true });
    await flush();

    expect(r.container.querySelector('h2')!.textContent).toBe('Cộng đồng');
    const chips = ['Chờ duyệt', 'Báo cáo vi phạm', 'Đã đăng', 'Chưa trả lời', 'Sự kiện'].map((t) => byText(r.container, 'button[aria-pressed]', t)!);
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    click(chips[3]!);
    await flush();
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'true', 'false']);
  });

  it('nhân viên CSKH không có mục Sự kiện (API sự kiện chỉ cho ADMIN)', async () => {
    const { r } = setup({}, { isAdmin: false });
    await flush();
    expect(byText(r.container, 'button[aria-pressed]', 'Sự kiện')).toBeNull();
    expect(byText(r.container, 'button[aria-pressed]', 'Chưa trả lời')).not.toBeNull();
  });
});

describe('CommunityModerationTab: báo cáo vi phạm (R-75)', () => {
  it('chip lấy số thật từ hộp việc khi danh sách bị cắt ở 50 (hộp việc ghi 73)', async () => {
    const { r } = setup({ '/admin/ops/inbox': { body: { generatedAt: '2026-10-28T03:00:00.000Z', items: [{ key: 'communityReports', count: 73 }] } } }, { initialView: 'reports', isAdmin: true });
    await flush();
    expect(byText(r.container, 'button[aria-pressed]', 'Báo cáo vi phạm (73)')).not.toBeNull();
  });

  it('chip ghi số báo cáo đang mở; danh sách hiện loại, người đăng, trích nội dung và lý do báo cáo; nội dung đã xoá hẳn vẫn đóng được', async () => {
    const { r } = setup({}, { initialView: 'reports', isAdmin: true });
    await flush();

    expect(byText(r.container, 'button[aria-pressed]', 'Báo cáo vi phạm (3)')).not.toBeNull();
    expect(r.container.textContent).toContain('3 báo cáo đang mở');
    const bai = r.container.querySelector('[data-report="r1"]')!;
    expect(bai.textContent).toContain('Bài viết');
    expect(bai.textContent).toContain('Quân');
    expect(bai.textContent).toContain('Mua hàng giá rẻ tại link này.');
    expect(bai.textContent).toContain('Lý do báo cáo: Quảng cáo');
    expect(r.container.querySelector('[data-report="r3"]')!.textContent).toContain('Nội dung đã bị xoá hẳn.');
    expect(byText(r.container.querySelector('[data-report="r3"]')!, 'button', 'Ẩn bài')).toBeNull();
    expect(byText(r.container.querySelector('[data-report="r3"]')!, 'button', 'Bỏ qua, đóng báo cáo')).not.toBeNull();
  });

  it('Ẩn bài: ẩn bài kèm lý do rồi đóng báo cáo', async () => {
    const { api, r } = setup({ '/feed/admin/a2/hide': { body: { ok: true } }, '/feed/admin/reports/r1/resolve': { body: { ok: true } } }, { initialView: 'reports', isAdmin: true });
    await flush();

    click(byText(r.container.querySelector('[data-report="r1"]')!, 'button', 'Ẩn bài'));
    await flush();
    typeInto(confirmDialog()!.querySelector('input, textarea'), 'Quảng cáo');
    answerConfirm(true);
    await flush();

    expect(JSON.parse(String(posted(api, '/feed/admin/a2/hide')!.init!.body))).toEqual({ reason: 'Quảng cáo' });
    expect(posted(api, '/feed/admin/reports/r1/resolve')).toBeDefined();
  });

  it('bình luận bị báo cáo: ADMIN gỡ được; nhân viên chỉ đóng báo cáo vì API chỉ cho chủ bình luận hoặc ADMIN gỡ', async () => {
    const admin = setup({ '/feed/comments/c7': { body: { ok: true } }, '/feed/admin/reports/r2/resolve': { body: { ok: true } } }, { initialView: 'reports', isAdmin: true });
    await flush();
    click(byText(admin.r.container.querySelector('[data-report="r2"]')!, 'button', 'Gỡ bình luận'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(admin.api.calls.some((c) => c.url.includes('/feed/comments/c7') && c.init?.method === 'DELETE')).toBe(true);
    expect(posted(admin.api, '/feed/admin/reports/r2/resolve')).toBeDefined();
    admin.r.unmount();
    mounted = [];

    const staff = setup({}, { initialView: 'reports', isAdmin: false });
    await flush();
    expect(byText(staff.r.container.querySelector('[data-report="r2"]')!, 'button', 'Gỡ bình luận')).toBeNull();
    expect(byText(staff.r.container.querySelector('[data-report="r2"]')!, 'button', 'Bỏ qua, đóng báo cáo')).not.toBeNull();
  });

  it('Bỏ qua, đóng báo cáo chỉ gọi resolve, không đụng tới bài', async () => {
    const { api, r } = setup({ '/feed/admin/reports/r1/resolve': { body: { ok: true } } }, { initialView: 'reports', isAdmin: true });
    await flush();
    click(byText(r.container.querySelector('[data-report="r1"]')!, 'button', 'Bỏ qua, đóng báo cáo'));
    await flush();
    expect(posted(api, '/feed/admin/reports/r1/resolve')).toBeDefined();
    expect(api.calls.some((c) => c.url.includes('/hide'))).toBe(false);
  });

  it('rỗng: nói chưa có báo cáo nào đang mở', async () => {
    const { r } = setup({ '/feed/admin/reports': { body: [] } }, { initialView: 'reports' });
    await flush();
    expect(r.container.textContent).toContain('Chưa có báo cáo vi phạm nào đang mở');
  });
});

describe('CommunityModerationTab: sự kiện cộng đồng', () => {
  const EVENT = { id: 'e1', title: 'Thi ảnh ban công xanh', description: 'Khoe ban công đẹp nhất.', coverUrl: null, startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-11-30T16:59:00.000Z', rewardPoints: 20_000, status: 'OPEN', winnerUserId: null, createdAt: '2026-10-01T00:00:00.000Z', winner: null };
  const CLOSED = { ...EVENT, id: 'e0', title: 'Thi tỉa lá', status: 'CLOSED', winnerUserId: 'u7', winner: { id: 'u7', name: 'Hà', avatar: null } };
  const PARTICIPANTS = [
    { userId: 'u1', name: 'Lan', avatar: null, postId: 'p1', postTitle: 'Ban công tầng 5', postedAt: '2026-10-20T03:00:00.000Z', postCount: 2 },
    { userId: 'u2', name: 'Minh', avatar: null, postId: 'p2', postTitle: 'Giàn mướp', postedAt: '2026-10-21T03:00:00.000Z', postCount: 1 },
  ];
  // Khoá cụ thể đứng trước khoá chung: mockFetch lấy khoá đầu tiên có trong URL.
  const eventRoutes = (over: Parameters<typeof mockFetch>[0] = {}): Parameters<typeof mockFetch>[0] => ({
    '/feed/admin/events/e1/participants': { body: PARTICIPANTS },
    '/feed/events/e1/close': { body: { ok: true } },
    '/feed/events/e1/winner': { body: { ok: true } },
    '/feed/admin/events?status=CLOSED': { body: [CLOSED] },
    '/feed/admin/events?status=OPEN': { body: [EVENT] },
    '/feed/events': { body: { id: 'e9' } },
    ...over,
  });
  const openEvents = async (over: Parameters<typeof mockFetch>[0] = {}) => {
    const s = setup(eventRoutes(over), { initialView: 'events', isAdmin: true });
    await flush();
    return s;
  };
  const input = (r: Rendered, name: string) => r.container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
  const fillCreate = (r: Rendered, v: { title?: string; start?: string; end?: string; reward?: string; desc?: string }) => {
    if (v.title !== undefined) typeInto(input(r, 'eventTitle'), v.title);
    if (v.desc !== undefined) typeInto(input(r, 'eventDescription'), v.desc);
    if (v.start !== undefined) typeInto(input(r, 'eventStart'), v.start);
    if (v.end !== undefined) typeInto(input(r, 'eventEnd'), v.end);
    if (v.reward !== undefined) typeInto(input(r, 'eventReward'), v.reward);
  };
  const createBtn = (r: Rendered) => byText(r.container.querySelector('form')!, 'button', 'Tạo sự kiện') as HTMLButtonElement;

  it('liệt kê sự kiện đang mở với hạn, điểm thưởng; chuyển sang "Đã đóng" thấy người thắng', async () => {
    const { r } = await openEvents();
    const row = r.container.querySelector('[data-event="e1"]')!;
    expect(row.textContent).toContain('Thi ảnh ban công xanh');
    expect(row.textContent).toContain('Khoe ban công đẹp nhất.');
    expect(row.textContent).toContain('23:59 30/11/2026');
    expect(row.textContent).toContain('20.000');
    expect(byText(row, 'button', 'Chọn người thắng')).not.toBeNull();
    expect(byText(row, 'button', 'Đóng sự kiện')).not.toBeNull();

    click(byText(r.container, 'button[aria-pressed]', 'Đã đóng'));
    await flush();
    const closed = r.container.querySelector('[data-event="e0"]')!;
    expect(closed.textContent).toContain('Người thắng');
    expect(closed.textContent).toContain('Hà');
    expect(byText(closed, 'button', 'Đóng sự kiện')).toBeNull();
  });

  it('rỗng và lỗi tải', async () => {
    const empty = await openEvents({ '/feed/admin/events?status=OPEN': { body: [] } });
    expect(empty.r.container.textContent).toContain('Chưa có sự kiện nào đang mở');
    empty.r.unmount();
    mounted = [];
    const failed = await openEvents({ '/feed/admin/events?status=OPEN': { status: 500, body: { message: 'x' } } });
    expect(failed.r.container.querySelector('[role="alert"]')!.textContent).toContain('Không tải được');
    expect(byText(failed.r.container, 'button', 'Thử lại')).not.toBeNull();
  });

  it('Đóng sự kiện: hộp xác nhận; huỷ thì không gọi, đồng ý thì POST close rồi làm mới danh sách', async () => {
    const { api, r } = await openEvents();
    click(byText(r.container.querySelector('[data-event="e1"]')!, 'button', 'Đóng sự kiện'));
    await flush();
    expect(confirmDialog()!.textContent).toContain('Thi ảnh ban công xanh');
    answerConfirm(false);
    await flush();
    expect(posted(api, '/feed/events/e1/close')).toBeUndefined();

    click(byText(r.container.querySelector('[data-event="e1"]')!, 'button', 'Đóng sự kiện'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(posted(api, '/feed/events/e1/close')).toBeDefined();
    expect(api.calls.filter((c) => c.url.includes('/feed/admin/events?status=OPEN')).length).toBeGreaterThanOrEqual(2);
    expect(r.container.textContent).toContain('Đã đóng sự kiện');
  });

  it('Chọn người thắng: liệt kê người dự thi, chọn một người rồi xác nhận mới gửi userId; huỷ thì không gọi', async () => {
    const { api, r } = await openEvents();
    const row = () => r.container.querySelector('[data-event="e1"]')!;
    click(byText(row(), 'button', 'Chọn người thắng'));
    await flush();
    expect(row().textContent).toContain('Ban công tầng 5');
    expect(row().textContent).toContain('2 bài dự thi');
    expect((byText(row(), 'button', 'Chọn một người ở trên') as HTMLButtonElement).disabled).toBe(true);

    click(row().querySelector('[role="radio"]'));
    const confirmBtn = byText(row(), 'button', 'Chốt Lan là người thắng') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
    click(confirmBtn);
    await flush();
    expect(confirmDialog()!.textContent).toContain('Lan');
    expect(confirmDialog()!.textContent).toContain('20.000');
    answerConfirm(false);
    await flush();
    expect(posted(api, '/feed/events/e1/winner')).toBeUndefined();

    click(confirmBtn);
    await flush();
    answerConfirm(true);
    await flush();
    expect(JSON.parse(String(posted(api, '/feed/events/e1/winner')!.init?.body))).toEqual({ userId: 'u1' });
  });

  it.each([
    ['API đã trả rewarded=true', { ok: true, rewarded: true }, 'cộng 20.000 Điểm Xanh', 'status'],
    ['API báo rewarded=false', { ok: true, rewarded: false }, 'CHƯA cộng được Điểm Xanh', 'alert'],
    ['API cũ chưa trả rewarded', { ok: true }, 'Đã chốt Lan là người thắng', 'status'],
  ])('kết quả chọn người thắng khi %s', async (_name, body, expected, role) => {
    const { r } = await openEvents({ '/feed/events/e1/winner': { body } });
    click(byText(r.container.querySelector('[data-event="e1"]')!, 'button', 'Chọn người thắng'));
    await flush();
    click(r.container.querySelector('[data-event="e1"] [role="radio"]'));
    click(byText(r.container.querySelector('[data-event="e1"]')!, 'button', 'Chốt Lan là người thắng'));
    await flush();
    answerConfirm(true);
    await flush();
    const notice = r.container.querySelector(`[role="${role}"]`)!;
    expect(notice.textContent).toContain(expected);
  });

  it('chọn người thắng lỗi (sự kiện đã đóng) hiện lời máy chủ, không báo thành công', async () => {
    const { r } = await openEvents({ '/feed/events/e1/winner': { status: 400, body: { message: 'Sự kiện đã đóng hoặc đã chọn người thắng.' } } });
    click(byText(r.container.querySelector('[data-event="e1"]')!, 'button', 'Chọn người thắng'));
    await flush();
    click(r.container.querySelector('[data-event="e1"] [role="radio"]'));
    click(byText(r.container.querySelector('[data-event="e1"]')!, 'button', 'Chốt Lan là người thắng'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(r.container.querySelector('[role="alert"]')!.textContent).toContain('đã đóng hoặc đã chọn người thắng');
    expect(r.container.textContent).not.toContain('Đã chốt Lan');
  });

  it('chưa có bài dự thi thì nói rõ và không cho chốt', async () => {
    const { r } = await openEvents({ '/feed/admin/events/e1/participants': { body: [] } });
    click(byText(r.container.querySelector('[data-event="e1"]')!, 'button', 'Chọn người thắng'));
    await flush();
    expect(r.container.querySelector('[data-event="e1"]')!.textContent).toContain('Chưa có bài dự thi nào được đăng');
    expect(r.container.querySelector('[data-event="e1"] [role="radio"]')).toBeNull();
  });

  it('tạo sự kiện: gửi đúng thân, giờ nhập là giờ Việt Nam, bỏ trống mô tả và ảnh bìa thì không gửi; xong thì làm mới danh sách', async () => {
    const { api, r } = await openEvents();
    expect(createBtn(r).disabled).toBe(true);
    fillCreate(r, { title: '  Thi ảnh rau mầm  ', start: '2026-11-01T08:00', end: '2026-11-30T23:59', reward: '30000' });
    expect(createBtn(r).disabled).toBe(false);
    click(createBtn(r));
    await flush();

    const create = api.calls.find((c) => c.init?.method === 'POST' && /\/feed\/events$/.test(c.url))!;
    expect(JSON.parse(String(create.init?.body))).toEqual({
      title: 'Thi ảnh rau mầm',
      startAt: '2026-11-01T01:00:00.000Z',
      endAt: '2026-11-30T16:59:00.000Z',
      rewardPoints: 30_000,
    });
    expect(r.container.textContent).toContain('Đã tạo sự kiện');
    expect(api.calls.filter((c) => c.url.includes('/feed/admin/events?status=OPEN')).length).toBeGreaterThanOrEqual(2);
    expect((input(r, 'eventTitle') as HTMLInputElement).value).toBe('');
  });

  it('có mô tả và điểm thưởng để trống: gửi mô tả, thưởng 0', async () => {
    const { api, r } = await openEvents();
    fillCreate(r, { title: 'Sự kiện vui', desc: 'Ai cũng tham gia được', start: '2026-11-01T08:00', end: '2026-11-02T08:00' });
    click(createBtn(r));
    await flush();
    const create = api.calls.find((c) => c.init?.method === 'POST' && /\/feed\/events$/.test(c.url))!;
    expect(JSON.parse(String(create.init?.body))).toMatchObject({ description: 'Ai cũng tham gia được', rewardPoints: 0 });
  });

  it('thiếu tên, thiếu giờ, giờ kết thúc không sau giờ bắt đầu hoặc điểm thưởng không phải số nguyên thì khoá nút tạo', async () => {
    const { api, r } = await openEvents();
    fillCreate(r, { title: 'A', start: '2026-11-01T08:00' });
    expect(createBtn(r).disabled).toBe(true);
    fillCreate(r, { end: '2026-11-01T08:00' });
    expect(createBtn(r).disabled).toBe(true);
    expect(r.container.textContent).toContain('Giờ kết thúc phải sau giờ bắt đầu');
    fillCreate(r, { end: '2026-11-02T08:00', reward: '-5' });
    expect(createBtn(r).disabled).toBe(true);
    fillCreate(r, { reward: '1.5' });
    expect(createBtn(r).disabled).toBe(true);
    fillCreate(r, { reward: '0' });
    expect(createBtn(r).disabled).toBe(false);
    fillCreate(r, { title: '   ' });
    expect(createBtn(r).disabled).toBe(true);
    expect(api.calls.some((c) => c.init?.method === 'POST')).toBe(false);
  });

  it('tạo lỗi (điểm thưởng ngoài khoảng): hiện lời máy chủ, giữ nguyên nội dung đã nhập', async () => {
    const { r } = await openEvents({ '/feed/events': { status: 400, body: { message: 'Quà sự kiện phải từ 20.000 đến 50.000 Điểm Xanh, hoặc để 0 nếu sự kiện không có quà.' } } });
    fillCreate(r, { title: 'Sự kiện', start: '2026-11-01T08:00', end: '2026-11-02T08:00', reward: '100' });
    click(createBtn(r));
    await flush();
    expect(r.container.querySelector('form [role="alert"]')!.textContent).toContain('Quà sự kiện phải từ 20.000');
    expect((input(r, 'eventTitle') as HTMLInputElement).value).toBe('Sự kiện');
  });
});
