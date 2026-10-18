// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ExternalClaimsTab } from './external-claims-tab';
import { answerConfirm, click, confirmDialog, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const claim = (over: Record<string, unknown> = {}) => ({
  id: 'c1', externalOrderId: 'e1', pancakeOrderId: '910001', channel: 'Shopee', source: 'MARKETPLACE', maskedCode: 'SPX***789',
  userId: 'u1', userName: 'Lan', userPhoneMasked: '091****678', orderPhoneMasked: '091****678', goodsValue: 320000, points: 3200,
  state: 'REVIEW', orderStatus: 'DELIVERED', reviewReason: 'Vượt ngưỡng', voidReason: null, decidedById: null,
  deliveredAt: '2026-10-13T08:30:00.000Z', creditedAt: null, createdAt: '2026-10-13T08:31:00.000Z', ...over,
});
const attempt = (over: Record<string, unknown> = {}) => ({
  id: 'a1', userId: 'u2', userName: 'Mai', userPhoneMasked: '090****111', maskedCode: 'LZ***000', result: 'UNMATCHED',
  externalOrderId: null, note: null, createdAt: '2026-10-10T08:31:00.000Z', ...over,
});

function stub(opts: { claims?: unknown[]; attempts?: unknown[]; events?: unknown[]; post?: (url: string, body: unknown) => { status?: number; body: unknown } } = {}) {
  const claims = opts.claims ?? [claim()];
  const attempts = opts.attempts ?? [];
  const m = mockFetch({
    '/admin/external-claims/attempts?': { body: { data: attempts, meta: { page: 1, limit: 20, total: attempts.length } } },
    '/admin/external-claims/attempts/': (init) => opts.post?.('attempts', JSON.parse(String(init?.body ?? '{}'))) ?? { body: { claimId: 'c9', state: 'PENDING' } },
    '/admin/external-claims/c1/': (init) => opts.post?.('claim', JSON.parse(String(init?.body ?? '{}'))) ?? { body: { id: 'c1' } },
    '/admin/external-claims/c1': { body: { ...(claims[0] as object), events: opts.events ?? [] } },
    '/admin/external-claims?': { body: { data: claims, meta: { page: 1, limit: 20, total: claims.length } } },
  });
  vi.stubGlobal('fetch', vi.fn(m.fn));
  return m;
}

const buttons = (root: ParentNode) => [...root.querySelectorAll('button')].map((b) => b.textContent);
const btn = (root: ParentNode, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text) ?? null;

describe('ExternalClaimsTab', () => {
  it('ADMIN thấy đủ nút với claim REVIEW; KE_TOAN không có nút thao tác nào', async () => {
    stub();
    const admin = mount(<ExternalClaimsTab isAdmin canAct meId="admin1" />);
    await flush();
    expect(admin.container.querySelector('h2')!.textContent).toBe('Tích điểm đơn sàn');
    expect(buttons(admin.container)).toEqual(expect.arrayContaining(['Chi tiết', 'Duyệt', 'Huỷ', 'Huỷ và mở lại mã']));
    expect(buttons(admin.container)).not.toContain('Đảo điểm');
    admin.unmount();
    mounted = [];

    stub();
    const ketoan = mount(<ExternalClaimsTab isAdmin={false} canAct={false} meId="kt1" />);
    await flush();
    expect(buttons(ketoan.container)).toContain('Chi tiết');
    for (const t of ['Duyệt', 'Huỷ', 'Huỷ và mở lại mã', 'Đảo điểm', 'Giữ điểm, gỡ cờ']) expect(buttons(ketoan.container)).not.toContain(t);
  });

  it('claim của chính mình: ẩn mọi nút thao tác (SELF_ACTION biết trước)', async () => {
    stub({ claims: [claim({ userId: 'me' })] });
    const r = mount(<ExternalClaimsTab isAdmin canAct meId="me" />);
    await flush();
    for (const t of ['Duyệt', 'Huỷ', 'Huỷ và mở lại mã', 'Đảo điểm', 'Giữ điểm, gỡ cờ']) expect(buttons(r.container)).not.toContain(t);
    expect(buttons(r.container)).toContain('Chi tiết');
  });

  it('CSKH không có Đảo điểm / Giữ điểm; ADMIN thấy cả hai khi claim đã cộng có cờ', async () => {
    const credited = claim({ state: 'CREDITED', reviewReason: 'Đơn hoàn một phần', orderStatus: 'PARTIAL_RETURN', creditedAt: '2026-10-30T00:00:00.000Z' });
    stub({ claims: [credited] });
    const cskh = mount(<ExternalClaimsTab isAdmin={false} canAct meId="cs1" />);
    await flush();
    expect(btn(cskh.container, 'Đảo điểm')).toBeNull();
    expect(btn(cskh.container, 'Giữ điểm, gỡ cờ')).toBeNull();
    cskh.unmount();
    mounted = [];
    stub({ claims: [credited] });
    const admin = mount(<ExternalClaimsTab isAdmin canAct meId="ad1" />);
    await flush();
    expect(btn(admin.container, 'Đảo điểm')).not.toBeNull();
    expect(btn(admin.container, 'Giữ điểm, gỡ cờ')).not.toBeNull();
  });

  it('đã cộng mà đơn đã đóng: có nhãn cần đảo điểm, không có Giữ điểm (không có cờ)', async () => {
    stub({ claims: [claim({ state: 'CREDITED', reviewReason: null, orderStatus: 'RETURNED' })] });
    const r = mount(<ExternalClaimsTab isAdmin canAct meId="ad1" />);
    await flush();
    expect(r.container.textContent).toContain('Đã cộng, đơn đã đóng: cần đảo điểm');
    expect(btn(r.container, 'Giữ điểm, gỡ cờ')).toBeNull();
    expect(btn(r.container, 'Đảo điểm')).not.toBeNull();
  });

  it('Duyệt cần xác nhận, rồi gọi POST /approve', async () => {
    const m = stub();
    const r = mount(<ExternalClaimsTab isAdmin canAct meId="ad1" />);
    await flush();
    click(btn(r.container, 'Duyệt'));
    await flush();
    expect(confirmDialog()).not.toBeNull();
    expect(m.calls.some((c) => c.url.endsWith('/approve'))).toBe(false);
    answerConfirm(true);
    await flush();
    expect(m.calls.some((c) => c.url.endsWith('/c1/approve') && c.init?.method === 'POST')).toBe(true);
    expect(r.container.textContent).toContain('Đã duyệt');
  });

  it('Huỷ và mở lại mã bắt buộc lý do rồi gọi void-and-reopen với lý do', async () => {
    const m = stub();
    const r = mount(<ExternalClaimsTab isAdmin canAct meId="ad1" />);
    await flush();
    click(btn(r.container, 'Huỷ và mở lại mã'));
    await flush();
    const accept = confirmDialog()!.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!;
    expect(accept.disabled).toBe(true);
    typeInto(confirmDialog()!.querySelector('textarea'), 'Mã nhập nhầm đơn');
    answerConfirm(true);
    await flush();
    const call = m.calls.find((c) => c.url.endsWith('/c1/void-and-reopen'))!;
    expect(JSON.parse(String(call.init!.body))).toEqual({ reason: 'Mã nhập nhầm đơn' });
  });

  it('Đảo điểm: hộp xác nhận, gọi reverse và báo số điểm thực thu hồi có dấu chấm nghìn', async () => {
    const m = stub({
      claims: [claim({ state: 'CREDITED', reviewReason: null })],
      post: () => ({ body: { claimId: 'c1', reversedPoints: 12500 } }),
    });
    const r = mount(<ExternalClaimsTab isAdmin canAct meId="ad1" />);
    await flush();
    click(btn(r.container, 'Đảo điểm'));
    await flush();
    typeInto(confirmDialog()!.querySelector('textarea'), 'Khách hoàn đơn');
    answerConfirm(true);
    await flush();
    expect(m.calls.some((c) => c.url.endsWith('/c1/reverse'))).toBe(true);
    expect(r.container.textContent).toContain('Đã thu hồi 12.500 điểm');
  });

  it('Giữ điểm gỡ cờ gửi note', async () => {
    const m = stub({ claims: [claim({ state: 'CREDITED', reviewReason: 'Đơn hoàn một phần', orderStatus: 'PARTIAL_RETURN' })] });
    const r = mount(<ExternalClaimsTab isAdmin canAct meId="ad1" />);
    await flush();
    click(btn(r.container, 'Giữ điểm, gỡ cờ'));
    await flush();
    typeInto(confirmDialog()!.querySelector('textarea'), 'Hoàn món nhỏ');
    answerConfirm(true);
    await flush();
    const call = m.calls.find((c) => c.url.endsWith('/c1/keep-points'))!;
    expect(JSON.parse(String(call.init!.body))).toEqual({ note: 'Hoàn món nhỏ' });
  });

  it('lỗi có code hiện câu tiếng Việt của web, không in message máy chủ', async () => {
    stub({ post: () => ({ status: 403, body: { statusCode: 403, code: 'SAME_INTRODUCER', message: 'english' } }) });
    const r = mount(<ExternalClaimsTab isAdmin canAct meId="ad1" />);
    await flush();
    click(btn(r.container, 'Duyệt'));
    await flush();
    answerConfirm(true);
    await flush();
    const alert = r.container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('không tự duyệt được');
    expect(alert.textContent).not.toContain('english');
  });

  it('chi tiết hiện lịch sử thao tác; người đã gắn đơn bị vô hiệu nút Duyệt', async () => {
    stub({
      events: [
        { id: 'ev1', action: 'ATTACH', actorId: 'cs1', fromState: null, toState: 'REVIEW', userIdBefore: 'u1', userIdAfter: 'u1', note: 'Mã lệch một ký tự', orderStatus: 'PARTIAL_RETURN', createdAt: '2026-10-14T01:00:00.000Z' },
      ],
    });
    const r = mount(<ExternalClaimsTab isAdmin canAct meId="cs1" />);
    await flush();
    click(btn(r.container, 'Chi tiết'));
    await flush();
    const events = r.container.querySelector('[data-claim-events]')!;
    expect(events.textContent).toContain('Gắn đơn cho lần gửi mã');
    expect(events.textContent).toContain('Mã lệch một ký tự');
    expect(events.textContent).toContain('đơn: Hoàn một phần');
    expect(btn(r.container, 'Duyệt')!.disabled).toBe(true);
  });

  it('lần gửi mã: CSKH gắn đơn khớp (không thấy đơn) được; đã thấy đơn nguồn lạ thì chỉ ADMIN; của chính mình thì ẩn', async () => {
    stub({ claims: [], attempts: [attempt(), attempt({ id: 'a2', externalOrderId: 'e9', maskedCode: 'SH***222' }), attempt({ id: 'a3', userId: 'cs1', maskedCode: 'ME***333' })] });
    const cskh = mount(<ExternalClaimsTab isAdmin={false} canAct meId="cs1" />);
    await flush();
    const rows = [...cskh.container.querySelectorAll('[data-external-attempt]')];
    expect(rows).toHaveLength(3);
    expect(btn(rows[0]!, 'Gắn đơn')).not.toBeNull();
    expect(btn(rows[1]!, 'Gắn đơn')).toBeNull();
    expect(rows[1]!.textContent).toContain('chỉ ADMIN gắn được');
    expect(rows[2]!.querySelectorAll('button')).toHaveLength(0);
    cskh.unmount();
    mounted = [];
    stub({ claims: [], attempts: [attempt({ id: 'a2', externalOrderId: 'e9' })] });
    const admin = mount(<ExternalClaimsTab isAdmin canAct meId="ad1" />);
    await flush();
    expect(btn(admin.container, 'Gắn đơn')).not.toBeNull();
  });

  it('gắn đơn gửi pancakeOrderId và note; kết quả REVIEW báo chờ người khác duyệt', async () => {
    const m = stub({ claims: [], attempts: [attempt({ externalOrderId: 'e9' })], post: () => ({ body: { claimId: 'c9', state: 'REVIEW' } }) });
    const r = mount(<ExternalClaimsTab isAdmin canAct meId="ad1" />);
    await flush();
    click(btn(r.container, 'Gắn đơn'));
    await flush();
    typeInto(confirmDialog()!.querySelector('textarea'), '910001');
    answerConfirm(true);
    await flush();
    typeInto(confirmDialog()!.querySelector('textarea'), 'Khách đọc nhầm một ký tự');
    answerConfirm(true);
    await flush();
    const call = m.calls.find((c) => c.url.endsWith('/attempts/a1/attach'))!;
    expect(JSON.parse(String(call.init!.body))).toEqual({ pancakeOrderId: '910001', note: 'Khách đọc nhầm một ký tự' });
    expect(r.container.textContent).toContain('đang chờ người khác duyệt');
  });

  it('bộ lọc chú ý gửi attention lên API và bỏ lọc trạng thái', async () => {
    const m = stub({ claims: [] });
    const r = mount(<ExternalClaimsTab isAdmin canAct meId="ad1" />);
    await flush();
    const select = r.container.querySelector<HTMLSelectElement>('select[aria-label="Lọc việc cần chú ý"]')!;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Mọi yêu cầu', 'Đã cộng mà đơn đã đóng', 'Kẹt chờ quá lâu']);
    selectValue(select, 'closed_credited');
    await flush();
    const last = m.calls.filter((c) => c.url.includes('/admin/external-claims?')).at(-1)!;
    expect(last.url).toContain('attention=closed_credited');
    expect(last.url).not.toContain('state=');
  });
});
