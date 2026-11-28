// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AdminQuickReply } from '@/lib/admin-client';
import { ConversationDetail, insertTemplate } from './conversation-detail';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

const msg = (o: Record<string, unknown>) => ({
  id: 'm1',
  sender: 'CUSTOMER',
  source: 'MINIAPP',
  body: 'đơn của mình sao rồi',
  imageUrl: null,
  context: null,
  staffName: null,
  adminUserId: null,
  recalledAt: null,
  createdAt: '2026-11-28T09:00:00.000Z',
  forward: null,
  ...o,
});
const DETAIL = {
  id: 'c1',
  code: 'K7Q2',
  blocked: false,
  blockedAt: null,
  blockedByUserId: null,
  user: { id: 'u1', fullName: 'Lan', phone: '0901234234' },
  truncated: false,
  messages: [msg({ id: 'm1', context: { orderCode: 'TB123', productSlug: 'binh-giu-nhiet' } })],
};
const reply = (o: Partial<AdminQuickReply>): AdminQuickReply => ({
  id: 'q1',
  category: 'Giao hàng',
  keywords: ['giao'],
  title: 'Đơn đang giao',
  content: 'Dạ đơn của chị đang trên đường giao ạ.',
  isGreeting: false,
  isActive: true,
  sortOrder: 0,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...o,
});
const REPLIES = [
  reply({}),
  reply({ id: 'q2', category: 'Đổi trả', keywords: ['doi tra'], title: 'Hướng dẫn đổi trả', content: 'Chị gửi giúp em ảnh sản phẩm nhé.' }),
  reply({ id: 'q3', title: 'Mẫu đã tắt', content: 'không được hiện', isActive: false }),
];

let calls: string[] = [];
let mounted: Rendered | null = null;

function stub(replies: AdminQuickReply[] = REPLIES) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const body = url.includes('/admin/quick-replies') ? replies : DETAIL;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

async function mountDetail(props: { onOpenUser?: (id: string) => void; onOpenOrder?: (code: string) => void } = {}) {
  mounted = render(<ConversationDetail id="c1" {...props} />);
  await flush();
  return mounted.container;
}

const textarea = (root: HTMLElement) => root.querySelector<HTMLTextAreaElement>('textarea[name="reply"]')!;

describe('insertTemplate — chèn mẫu vào chỗ con trỏ', () => {
  it('ô trống (kể cả chỉ khoảng trắng): thay bằng mẫu', () => {
    expect(insertTemplate('  ', 'Mẫu', 1, 1)).toEqual({ text: 'Mẫu', caret: 3 });
  });
  it('con trỏ cuối chữ: xuống dòng rồi chèn', () => {
    expect(insertTemplate('Chào chị', 'Mẫu', 8, 8)).toEqual({ text: 'Chào chị\nMẫu', caret: 12 });
  });
  it('con trỏ giữa chữ: tách hai bên bằng xuống dòng', () => {
    expect(insertTemplate('AB', 'M', 1, 1)).toEqual({ text: 'A\nM\nB', caret: 3 });
  });
  it('đang chọn một đoạn: thay đoạn đó', () => {
    expect(insertTemplate('A\nxx\nB', 'M', 2, 4)).toEqual({ text: 'A\nM\nB', caret: 3 });
  });
});

describe('ConversationDetail — buồng lái CSKH (w51-01)', () => {
  it('bấm tên hoặc SĐT khách mở hồ sơ khách đúng id', async () => {
    stub();
    const onOpenUser = vi.fn();
    const root = await mountDetail({ onOpenUser });
    click(root.querySelector('[data-open-user]'));
    click(byText(root, 'button', 'Hồ sơ khách'));
    expect(onOpenUser.mock.calls).toEqual([['u1'], ['u1']]);
  });

  it('mã đơn trong ngữ cảnh tin mở đơn; sản phẩm là link trang sản phẩm mở tab mới', async () => {
    stub();
    const onOpenOrder = vi.fn();
    const root = await mountDetail({ onOpenOrder });
    click(root.querySelector('[data-open-order="TB123"]'));
    expect(onOpenOrder).toHaveBeenCalledWith('TB123');
    const a = root.querySelector<HTMLAnchorElement>('[data-msg-context] a')!;
    expect(a.getAttribute('href')).toBe('/san-pham/binh-giu-nhiet');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('không truyền hàm mở: tên và mã đơn là chữ thường, không có nút', async () => {
    stub();
    const root = await mountDetail();
    expect(root.querySelector('[data-open-user]')).toBeNull();
    expect(root.querySelector('[data-open-order]')).toBeNull();
    expect(root.querySelector('[data-msg-context]')!.textContent).toContain('Đơn TB123');
  });

  it('mẫu trả lời chỉ tải khi mở, chỉ hiện mẫu đang bật, lọc không dấu, bấm là chèn và đóng', async () => {
    stub();
    const root = await mountDetail();
    expect(calls.some((u) => u.includes('/admin/quick-replies'))).toBe(false);
    click(byText(root, 'button', 'Mẫu trả lời'));
    await flush();
    expect(calls.some((u) => u.includes('/admin/quick-replies'))).toBe(true);
    expect(root.querySelector('[data-quick-reply="q3"]')).toBeNull();
    expect(root.querySelectorAll('[data-quick-reply]')).toHaveLength(2);
    typeInto(root.querySelector('input[aria-label="Lọc mẫu trả lời"]'), 'doi tra');
    expect([...root.querySelectorAll('[data-quick-reply]')].map((b) => b.getAttribute('data-quick-reply'))).toEqual(['q2']);
    click(root.querySelector('[data-quick-reply="q2"]'));
    expect(textarea(root).value).toBe('Chị gửi giúp em ảnh sản phẩm nhé.');
    expect(root.querySelector('[data-quick-reply]')).toBeNull();
  });

  it('đã gõ sẵn: mẫu nối xuống dòng sau chữ đang có', async () => {
    stub();
    const root = await mountDetail();
    typeInto(textarea(root), 'Dạ chào chị Lan,');
    textarea(root).setSelectionRange(16, 16);
    click(byText(root, 'button', 'Mẫu trả lời'));
    await flush();
    click(root.querySelector('[data-quick-reply="q1"]'));
    expect(textarea(root).value).toBe('Dạ chào chị Lan,\nDạ đơn của chị đang trên đường giao ạ.');
  });

  it('chèn mẫu làm trả lời quá 1000 ký tự: không chèn, báo lỗi, giữ chữ đang gõ', async () => {
    stub();
    const root = await mountDetail();
    const typed = 'x'.repeat(990);
    typeInto(textarea(root), typed);
    click(byText(root, 'button', 'Mẫu trả lời'));
    await flush();
    click(root.querySelector('[data-quick-reply="q1"]'));
    expect(textarea(root).value).toBe(typed);
    expect(root.querySelector('[data-detail-error]')!.textContent).toContain('/1000 ký tự');
  });

  it('chưa có mẫu nào đang bật: chỉ đường sang tab Mẫu trả lời nhanh', async () => {
    stub([reply({ isActive: false })]);
    const root = await mountDetail();
    click(byText(root, 'button', 'Mẫu trả lời'));
    await flush();
    expect(root.querySelector('[data-quick-replies]')!.textContent).toContain('Tạo ở tab Mẫu trả lời nhanh');
  });
});
