// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WasteDeskRequestDTO } from '@tubutree/shared-types';
import { byText, click, flush, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, unnamedControls } from '@/test-utils/a11y';
import { WAREHOUSE_DESK, makeDeskPoint, makeDeskRequest } from './recycle-fixtures';

// Chép ý recycle-desk.spec.tsx (Mini App, §4.10, §8, §15.3, §15.5): vào màn, tra mã, đếm, xác nhận, từ chối, trao quà.
// Khác Mini App: thông báo là dòng chữ trong trang (status/alert) thay cho snackbar; 403 của máy chủ được nói rõ.

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  points: [] as unknown[],
  pointsError: null as unknown,
  lookup: null as unknown,
  lookupError: null as unknown,
  confirm: null as unknown as (body: unknown) => unknown,
  reject: null as unknown as (body: unknown) => unknown,
  fulfil: null as unknown as (body: unknown) => unknown,
  report: null as unknown,
  reportError: null as unknown,
  config: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } } as Record<string, unknown>,
  calls: [] as { method: string; path: string; body?: unknown; headers?: unknown }[],
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => state.config }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push({ method: 'GET', path });
      if (path === '/waste/desk/points') {
        if (state.pointsError) throw state.pointsError;
        return state.points;
      }
      if (/^\/waste\/desk\/points\/[^/]+\/report$/.test(path)) {
        if (state.reportError) throw state.reportError;
        return state.report;
      }
      throw new Error(`chưa mock ${path}`);
    },
    post: async (path: string, body?: unknown, opts?: { headers?: unknown }) => {
      state.calls.push({ method: 'POST', path, body, headers: opts?.headers });
      if (path === '/waste/desk/lookup') {
        if (state.lookupError) throw state.lookupError;
        return state.lookup;
      }
      if (path === '/waste/desk/requests/req-1/confirm') return state.confirm(body);
      if (path === '/waste/desk/requests/req-1/reject') return state.reject(body);
      if (path === '/waste/desk/gifts/fulfil') return state.fulfil(body);
      throw new Error(`chưa mock ${path}`);
    },
    put: async (path: string, body?: unknown) => {
      state.calls.push({ method: 'PUT', path, body });
      if (path === '/waste/desk/points/pt-1/perk') return makeDeskPoint({ perkPendingText: (body as { perkText: string }).perkText });
      throw new Error(`chưa mock ${path}`);
    },
  },
}));

import { RecycleDesk, deskPreviewPoints } from './recycle-desk';

const REQ = makeDeskRequest();
const LINE0 = REQ.lines[0]!;
const CONFIRMED = { requestId: 'req-1', code: 'TR-8K2M9', status: 'COMPLETED', pointsAwarded: 6000, dropsAwarded: 0, quota: { limit: 500_000, used: 126_000, remaining: 374_000 }, staffDailyCapRemaining: 150_000 };
const GIFT = { id: 'red-1', giftName: 'Gói hạt giống Tubu', customerName: 'Ng*** A', status: 'READY', claimExpiresAt: '2026-12-16T17:30:00.000Z' };
const CODE_LABEL = 'Mã yêu cầu hoặc mã nhận quà';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<RecycleDesk />);
  mounted.push(r);
  await flush(10);
  return r.container;
};
const button = (c: ParentNode, name: string) => byText(c, 'button', name) as HTMLButtonElement | null;
const label = (c: ParentNode, text: string) => (byText(c, 'label', text) as HTMLLabelElement | null)?.control ?? null;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const lineOf = (c: ParentNode, name: string) => byText(c, '[data-line]', name) as HTMLElement;
const minus = (c: ParentNode, name: string, n: number) => {
  for (let i = 0; i < n; i++) click(lineOf(c, name).querySelector('[aria-label="Giảm số lượng"]'));
};
const plus = (c: ParentNode, name: string, n: number) => {
  for (let i = 0; i < n; i++) click(lineOf(c, name).querySelector('[aria-label="Tăng số lượng"]'));
};
const lookupReq = (over: Partial<WasteDeskRequestDTO> = {}) => {
  state.lookup = { type: 'REQUEST', request: { ...REQ, ...over } };
};
async function lookUp(c: ParentNode, code = 'tr-8k2m9') {
  typeInto(label(c, CODE_LABEL), code);
  click(button(c, 'Tra mã'));
  await flush(10);
}
const calls = (path: string) => state.calls.filter((x) => x.method === 'POST' && x.path === path);

beforeEach(() => {
  state.phase = 'authenticated';
  state.points = [makeDeskPoint()];
  state.pointsError = null;
  state.lookupError = null;
  state.reportError = null;
  state.report = { pointId: 'pt-1', month: '2026-10', confirmations: 0, pointsAwarded: 0, quotaUsed: 0, units: [] };
  state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } };
  state.calls = [];
  state.confirm = () => CONFIRMED;
  state.reject = () => ({ requestId: 'req-1', code: 'TR-8K2M9', status: 'REJECTED' });
  state.fulfil = () => ({ ...GIFT, status: 'FULFILLED' });
  lookupReq();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/doi-rac/quay: vào màn (§16.1, §4.10)', () => {
  it('khách chưa đăng nhập: mời đăng nhập, không gọi danh sách điểm', async () => {
    state.phase = 'guest';
    const c = await mount();
    expect(c.querySelector('a[href^="/dang-nhap"]')).not.toBeNull();
    expect(state.calls).toEqual([]);
  });
  it('đang khôi phục phiên và phiên không khả dụng: không gọi API, không mời đăng nhập', async () => {
    state.phase = 'loading';
    let c = await mount();
    expect(c.textContent).toContain('Đang tải…');
    state.phase = 'unavailable';
    c = await mount();
    expect(c.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(state.calls).toEqual([]);
  });
  it('không có điểm nào: không có ô nhập mã', async () => {
    state.points = [];
    const c = await mount();
    expect(c.textContent).toContain('Tài khoản của bạn chưa được gắn với điểm nhận nào');
    expect(label(c, CODE_LABEL)).toBeNull();
  });
  it('máy chủ trả 403: nói không có quyền, không hiện nút Thử lại', async () => {
    state.pointsError = Object.assign(new Error('Forbidden'), { status: 403 });
    const c = await mount();
    expect(c.textContent).toContain('Tài khoản này không có quyền nhận hàng tại điểm');
    expect(c.textContent).not.toContain('Forbidden');
    expect(button(c, 'Thử lại')).toBeNull();
  });
  it('danh sách điểm lỗi khác: báo lỗi có Thử lại, bấm thì tải lại và vào được màn', async () => {
    state.pointsError = new Error('Mất kết nối');
    const c = await mount();
    expect(c.textContent).toContain('Mất kết nối');
    state.pointsError = null;
    click(button(c, 'Thử lại'));
    await flush(10);
    expect(label(c, CODE_LABEL)).not.toBeNull();
  });
  it('không có điểm khi chương trình tắt: báo tạm dừng, không báo chưa được gắn', async () => {
    state.points = [];
    state.config = { isLoaded: true, waste: { enabled: false } };
    const c = await mount();
    expect(c.textContent).toContain('Chương trình đang tạm dừng');
    expect(c.textContent).not.toContain('chưa được gắn');
  });
  it('danh sách rỗng khi cấu hình công khai chưa tải: chưa kết luận tạm dừng hay chưa được gắn', async () => {
    state.points = [];
    state.config = { isLoaded: false, waste: { enabled: false } };
    const c = await mount();
    expect(c.textContent).not.toContain('Chương trình đang tạm dừng');
    expect(c.textContent).not.toContain('chưa được gắn');
  });
  it('đại lý: thẻ hạn mức tháng + ghi chú không tự cộng điểm', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Hạn mức điểm tháng này');
    expect(c.textContent).toContain('Đã dùng 120.000 / 500.000 điểm');
    expect(c.textContent).toContain('Còn lại 380.000 điểm');
    expect(c.textContent).toContain('Đại lý không tự cộng điểm. Tubu cộng điểm cho khách theo số bạn xác nhận.');
  });
  it('một điểm: tên điểm hiện dưới tiêu đề; hạn mức có thanh tiến độ theo đã dùng trên giới hạn', async () => {
    const c = await mount();
    expect(byText(c, 'p', 'Đại lý Cô Ba')).not.toBeNull();
    expect(c.querySelector<HTMLElement>('[data-testid="progress-fill"]')?.style.width).toBe('24%');
  });
  it('nhiều điểm: tên điểm chỉ nằm trên các tab, không lặp thành dòng riêng', async () => {
    state.points = [makeDeskPoint(), WAREHOUSE_DESK];
    const c = await mount();
    expect(byText(c, 'p', 'Đại lý Cô Ba')).toBeNull();
    expect(byText(c, '[role="tab"]', 'Đại lý Cô Ba')).not.toBeNull();
  });
  it('thứ tự: hạn mức, ô nhập mã, thẻ yêu cầu, rồi ưu đãi và báo cáo; xác nhận có thanh dính đáy', async () => {
    const c = await mount();
    await lookUp(c);
    const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const quota = byText(c, 'p', 'Hạn mức điểm tháng này')!;
    const input = label(c, CODE_LABEL)!;
    const card = byText(c, 'h2', 'TR-8K2M9')!;
    const perk = byText(c, 'p, h2, h3', 'Ưu đãi riêng của cửa hàng')!;
    const report = c.querySelector('section[aria-label="Báo cáo tháng này"]')!;
    expect(before(quota, input) && before(input, card) && before(card, perk) && before(perk, report)).toBe(true);
    expect(byText(c.querySelector('[data-testid="sticky-bar"]')!, 'button', 'Xác nhận đã nhận')).not.toBeNull();
  });
  it('đại lý không giới hạn hạn mức tháng', async () => {
    state.points = [makeDeskPoint({ quota: null })];
    const c = await mount();
    expect(c.textContent).toContain('Không giới hạn theo tháng');
  });
  it('kho: không có thẻ hạn mức, có dòng trần nhân viên trong ngày', async () => {
    state.points = [WAREHOUSE_DESK];
    const c = await mount();
    expect(c.textContent).toContain('Còn 150.000 điểm được xác nhận hôm nay');
    expect(c.textContent).not.toContain('Hạn mức điểm tháng này');
  });
  it('nhiều điểm: chọn điểm ở đầu màn', async () => {
    state.points = [makeDeskPoint(), WAREHOUSE_DESK];
    const c = await mount();
    click(byText(c, '[role="tab"]', 'Kho Tubu TP.HCM'));
    await flush();
    expect(c.textContent).toContain('Còn 150.000 điểm được xác nhận hôm nay');
  });
  it('một h1, mọi điều khiển có tên', async () => {
    const c = await mount();
    await lookUp(c);
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });
});

describe('/doi-rac/quay: tra mã và đếm (§4.10)', () => {
  it('gửi đúng mã đã cắt khoảng trắng; thẻ yêu cầu che tên và số', async () => {
    const c = await mount();
    await lookUp(c, '  tr-8k2m9 ');
    expect(calls('/waste/desk/lookup')[0]!.body).toEqual({ code: 'tr-8k2m9' });
    expect(c.textContent).toContain('Ng*** A');
    expect(c.textContent).toContain('090****567');
    expect(lineOf(c, 'Thùng carton').textContent).toContain('Khách khai 5 thùng');
  });
  it('nút Tra mã khoá khi ô mã trống', async () => {
    const c = await mount();
    expect(button(c, 'Tra mã')!.disabled).toBe(true);
  });
  it('tra mã trượt: hiện nguyên văn lỗi máy chủ', async () => {
    state.lookupError = new Error('Không tìm thấy mã');
    const c = await mount();
    await lookUp(c, 'TR-XXXXX');
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Không tìm thấy mã');
  });
  it('bộ đếm số thực nhận điền sẵn số khai, hiện "Tối đa N", không vượt số khai và chưa hỏi lý do', async () => {
    const c = await mount();
    await lookUp(c);
    expect(lineOf(c, 'Thùng carton').querySelector('[aria-live]')?.textContent).toBe('5');
    expect(lineOf(c, 'Thùng carton').textContent).toContain('Tối đa 5');
    plus(c, 'Thùng carton', 2);
    expect(lineOf(c, 'Thùng carton').querySelector('[aria-live]')?.textContent).toBe('5');
    expect(lineOf(c, 'Thùng carton').querySelector('[aria-label="Tăng số lượng"]')?.getAttribute('aria-disabled')).toBe('true');
    expect(c.querySelectorAll('select')).toHaveLength(0);
    expect(button(c, 'Xác nhận đã nhận')!.disabled).toBe(false);
    expect(c.textContent).not.toContain('Chọn lý do cho món nhận thiếu để xác nhận');
  });
  it('điểm sẽ cộng tính trực tiếp theo nhóm', async () => {
    const c = await mount();
    await lookUp(c);
    expect(c.textContent).toContain('Điểm Tubu sẽ cộng cho khách: 6.000 điểm');
    minus(c, 'Vỏ hộp sữa', 1);
    expect(c.textContent).toContain('Điểm Tubu sẽ cộng cho khách: 5.000 điểm');
    minus(c, 'Thùng carton', 5);
    minus(c, 'Vỏ hộp sữa', 4);
    expect(c.textContent).toContain('Điểm Tubu sẽ cộng cho khách: 0 điểm');
    expect(deskPreviewPoints([{ unitsPerPoint: 5, pointsPerGroup: 1000, hazardous: true }], { a: 5 }, ['a'])).toBe(0);
  });
  it('dòng thiếu phải có lý do (7 lý do) thì nút xác nhận mới mở', async () => {
    const c = await mount();
    await lookUp(c);
    minus(c, 'Vỏ hộp sữa', 2);
    expect(button(c, 'Xác nhận đã nhận')!.disabled).toBe(true);
    expect(c.textContent).toContain('Chọn lý do cho món nhận thiếu để xác nhận');
    expect(lineOf(c, 'Vỏ hộp sữa').textContent).toContain('Lý do nhận thiếu');
    const reason = lineOf(c, 'Vỏ hộp sữa').querySelector<HTMLSelectElement>('select[aria-label="Lý do nhận thiếu: Vỏ hộp sữa"]')!;
    expect(reason.options[0]!.textContent).toBe('Chọn lý do');
    expect(reason.options[0]!.disabled).toBe(true);
    expect(reason.value).toBe('');
    expect(Array.from(reason.options).slice(1).map((o) => o.textContent)).toEqual(['Ướt', 'Bẩn', 'Lẫn vật lạ', 'Sai loại', 'Hỏng', 'Không nhận', 'Khác']);
    expect(lineOf(c, 'Thùng carton').querySelector('select')).toBeNull();
    selectValue(reason, 'DIRTY');
    expect(button(c, 'Xác nhận đã nhận')!.disabled).toBe(false);
    expect(c.textContent).not.toContain('Chọn lý do cho món nhận thiếu để xác nhận');
  });
  it('món nguy hại: không có bộ đếm, gửi receivedQty 0 và lý do Sai loại', async () => {
    lookupReq({ lines: [{ ...LINE0, itemId: 'item-battery', itemName: 'Pin cũ', unitLabel: 'viên', hazardous: true, declaredQty: 2 }] });
    const c = await mount();
    await lookUp(c);
    expect(lineOf(c, 'Pin cũ').querySelector('[aria-label="Tăng số lượng"]')).toBeNull();
    expect(lineOf(c, 'Pin cũ').textContent).toContain('Không nhận món này');
    expect(button(c, 'Xác nhận đã nhận')!.disabled).toBe(false);
    click(button(c, 'Xác nhận đã nhận'));
    await flush(10);
    expect(calls('/waste/desk/requests/req-1/confirm')[0]!.body).toEqual({
      lines: [{ itemId: 'item-battery', declaredQty: 2, receivedQty: 0, shortfallReason: 'WRONG_TYPE' }],
    });
  });
  it.each([
    ['COMPLETED', 'Đã xác nhận'],
    ['REJECTED', 'Đã từ chối'],
  ] as const)('yêu cầu %s: thẻ chỉ xem, không bộ đếm, không nút', async (status, text) => {
    lookupReq({ status, lines: [{ ...LINE0, receivedQty: 5 }] });
    const c = await mount();
    await lookUp(c);
    expect(c.textContent).toContain(text);
    if (status === 'COMPLETED') expect(lineOf(c, 'Thùng carton').textContent).toContain('Đã nhận 5 thùng');
    expect(c.querySelector('[aria-label="Tăng số lượng"]')).toBeNull();
    expect(button(c, 'Xác nhận đã nhận')).toBeNull();
    expect(button(c, 'Từ chối cả yêu cầu')).toBeNull();
  });
});

describe('/doi-rac/quay: xác nhận và từ chối (§4.10, §15.5)', () => {
  it('xác nhận: body đủ dòng, báo Tubu sẽ cộng, hạn mức mới, xoá thẻ; không gửi match cho điểm đại lý', async () => {
    const c = await mount();
    await lookUp(c);
    state.points = [makeDeskPoint({ quota: { limit: 500_000, used: 126_000, remaining: 374_000 } })];
    click(button(c, 'Xác nhận đã nhận'));
    await flush(10);
    const sent = calls('/waste/desk/requests/req-1/confirm');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({ lines: [{ itemId: 'item-carton', declaredQty: 5, receivedQty: 5 }, { itemId: 'item-milk', declaredQty: 5, receivedQty: 5 }] });
    expect(c.querySelector('[role="status"]')?.textContent).toContain('Đã ghi nhận. Tubu sẽ cộng 6.000 điểm cho khách');
    expect(c.textContent).toContain('Còn lại 374.000 điểm');
    expect(button(c, 'Xác nhận đã nhận')).toBeNull();
    expect(button(c, 'Từ chối cả yêu cầu')).toBeNull();
    expect(c.textContent).toContain('Yêu cầu TR-8K2M9 của Ng*** A đã xong');
    expect(c.textContent).toContain('Hạn mức còn lại: 374.000 điểm');
    expect(label(c, CODE_LABEL)).toHaveProperty('value', '');
  });
  it('thẻ kết quả ở lại màn tới khi bấm "Nhận yêu cầu khác"; số hạn mức lấy từ phản hồi, không bịa khi điểm không giới hạn', async () => {
    state.confirm = () => ({ ...CONFIRMED, quota: null });
    const c = await mount();
    await lookUp(c);
    click(button(c, 'Xác nhận đã nhận'));
    await flush(10);
    expect(c.textContent).toContain('Yêu cầu TR-8K2M9 của Ng*** A đã xong');
    expect(c.textContent).not.toContain('Hạn mức còn lại:');
    click(button(c, 'Nhận yêu cầu khác'));
    await flush();
    expect(c.querySelector('[role="status"]')).toBeNull();
    expect(label(c, CODE_LABEL)).toHaveProperty('value', '');
  });
  it('kho: thẻ kết quả nêu số điểm còn được xác nhận hôm nay lấy từ phản hồi', async () => {
    state.points = [WAREHOUSE_DESK];
    lookupReq({ method: 'MAIL_IN', status: 'RECEIVED', pointId: 'wh-1', lines: [LINE0] });
    state.confirm = () => ({ ...CONFIRMED, quota: null });
    const c = await mount();
    await lookUp(c, 'TR-8K2M9');
    click(button(c, 'Xác nhận đã nhận'));
    await flush(10);
    expect(c.textContent).toContain('Còn được xác nhận hôm nay: 150.000 điểm');
    expect(c.textContent).not.toContain('Hạn mức còn lại:');
  });
  it('dòng thiếu gửi kèm shortfallReason', async () => {
    const c = await mount();
    await lookUp(c);
    minus(c, 'Vỏ hộp sữa', 5);
    selectValue(lineOf(c, 'Vỏ hộp sữa').querySelector('select'), 'WET');
    click(button(c, 'Xác nhận đã nhận'));
    await flush(10);
    const body = calls('/waste/desk/requests/req-1/confirm')[0]!.body as { lines: unknown[] };
    expect(body.lines[1]).toEqual({ itemId: 'item-milk', declaredQty: 5, receivedQty: 0, shortfallReason: 'WET' });
  });
  it('kho + Gửi về kho chưa nhận: xác nhận và từ chối gửi match.parcelCode là mã đã tra', async () => {
    state.points = [WAREHOUSE_DESK];
    lookupReq({ method: 'MAIL_IN', status: 'IN_TRANSIT', pointId: 'wh-1', lines: [LINE0] });
    state.confirm = () => {
      throw new Error('Vui lòng thử lại');
    };
    const c = await mount();
    await lookUp(c, 'TR-8K2M9');
    click(button(c, 'Xác nhận đã nhận'));
    await flush(10);
    expect(calls('/waste/desk/requests/req-1/confirm')[0]!.body).toEqual({
      lines: [{ itemId: 'item-carton', declaredQty: 5, receivedQty: 5 }],
      match: { parcelCode: 'TR-8K2M9' },
    });
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Vui lòng thử lại');
    click(button(c, 'Từ chối cả yêu cầu'));
    await flush();
    click(dialog()!.querySelector('input[type="radio"][aria-label="Ướt"]'));
    click(byText(dialog()!, 'button', 'Từ chối yêu cầu'));
    await flush(10);
    expect(calls('/waste/desk/requests/req-1/reject')[0]!.body).toEqual({ rejectionReason: 'WET', match: { parcelCode: 'TR-8K2M9' } });
  });
  it('bưu kiện về kho tra khi đang ở tab đối tác: vẫn gửi match, hạn mức mới ghi vào điểm của yêu cầu', async () => {
    state.points = [makeDeskPoint(), WAREHOUSE_DESK];
    lookupReq({ method: 'MAIL_IN', status: 'IN_TRANSIT', pointId: 'wh-1', lines: [LINE0] });
    state.confirm = () => ({ ...CONFIRMED, quota: null, staffDailyCapRemaining: 145_000 });
    const c = await mount();
    await lookUp(c, 'TR-8K2M9');
    click(button(c, 'Xác nhận đã nhận'));
    await flush(10);
    expect((calls('/waste/desk/requests/req-1/confirm')[0]!.body as { match: unknown }).match).toEqual({ parcelCode: 'TR-8K2M9' });
    expect(c.textContent).toContain('Còn lại 380.000 điểm');
    expect(c.textContent).not.toContain('Không giới hạn theo tháng');
  });
  it('kho + kiện đã RECEIVED: không gửi match', async () => {
    state.points = [WAREHOUSE_DESK];
    lookupReq({ method: 'MAIL_IN', status: 'RECEIVED', pointId: 'wh-1', lines: [LINE0] });
    const c = await mount();
    await lookUp(c, 'TR-8K2M9');
    click(button(c, 'Xác nhận đã nhận'));
    await flush(10);
    expect(calls('/waste/desk/requests/req-1/confirm')[0]!.body).not.toHaveProperty('match');
  });
  it.each([
    'Điểm đã hết hạn mức tháng, còn 3.000 điểm',
    'Khách đang bị khoá, không cộng điểm được',
    'Bạn đã chạm trần điểm xác nhận hôm nay',
    'Khách vừa sửa yêu cầu, vui lòng tra lại mã',
  ])('lỗi máy chủ "%s" hiện nguyên văn', async (msg) => {
    state.confirm = () => {
      throw new Error(msg);
    };
    const c = await mount();
    await lookUp(c);
    click(button(c, 'Xác nhận đã nhận'));
    await flush(10);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain(msg);
    expect(c.textContent).toContain('Ng*** A');
  });
  it('lỗi 403 khi xác nhận: hiện lời nói rõ không có quyền', async () => {
    state.confirm = () => {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    };
    const c = await mount();
    await lookUp(c);
    click(button(c, 'Xác nhận đã nhận'));
    await flush(10);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Tài khoản này không có quyền nhận hàng tại điểm');
  });
  it('"Từ chối cả yêu cầu": danh sách lý do của điểm rồi gọi reject kèm ghi chú', async () => {
    const c = await mount();
    await lookUp(c);
    click(button(c, 'Từ chối cả yêu cầu'));
    await flush();
    const sheet = dialog()!;
    expect(sheet.querySelector('[role="radiogroup"][aria-label="Lý do từ chối"]')).not.toBeNull();
    expect(Array.from(sheet.querySelectorAll('input[type="radio"]')).map((r) => r.getAttribute('aria-label'))).toEqual([
      'Ướt', 'Bẩn', 'Lẫn vật lạ', 'Sai loại', 'Hỏng', 'Không nhận', 'Quá khổ', 'Có pin hoặc vật nguy hại', 'Khác',
    ]);
    const send = byText(sheet, 'button', 'Từ chối yêu cầu') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(sheet.textContent).toContain('Chọn một lý do');
    click(sheet.querySelector('input[type="radio"][aria-label="Ướt"]'));
    expect(sheet.textContent).not.toContain('Chọn một lý do');
    typeInto(label(sheet, 'Ghi chú (không bắt buộc)'), 'thùng ướt hết');
    click(send);
    await flush(10);
    expect(calls('/waste/desk/requests/req-1/reject')[0]!.body).toEqual({ rejectionReason: 'WET', rejectionNote: 'thùng ướt hết' });
    expect(c.querySelector('[role="status"]')?.textContent).toContain('Đã từ chối yêu cầu TR-8K2M9');
    expect(dialog()).toBeNull();
  });
  it('lý do Khác bắt buộc ghi chú', async () => {
    const c = await mount();
    await lookUp(c);
    click(button(c, 'Từ chối cả yêu cầu'));
    await flush();
    const sheet = dialog()!;
    click(sheet.querySelector('input[type="radio"][aria-label="Khác"]'));
    const send = byText(sheet, 'button', 'Từ chối yêu cầu') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    typeInto(label(sheet, 'Ghi chú (bắt buộc với lý do Khác)'), 'thùng lẫn đồ khác');
    expect(send.disabled).toBe(false);
  });
});

describe('/doi-rac/quay: trao quà ở kho (§8, §15.3)', () => {
  beforeEach(() => {
    state.points = [WAREHOUSE_DESK];
    state.lookup = { type: 'GIFT', redemption: GIFT };
  });
  it('mã QG-: tên quà, khách che, hạn nhận; "Trao quà" gửi code + pointId', async () => {
    const c = await mount();
    await lookUp(c, 'qg-8k2m9p4t');
    expect(c.textContent).toContain('Gói hạt giống Tubu');
    expect(c.textContent).toContain('Hạn nhận 17/12/2026');
    click(button(c, 'Trao quà'));
    await flush(10);
    expect(calls('/waste/desk/gifts/fulfil')[0]!.body).toEqual({ code: 'qg-8k2m9p4t', pointId: 'wh-1' });
    expect(c.querySelector('[role="status"]')?.textContent).toContain('Đã trao Gói hạt giống Tubu');
    expect(button(c, 'Trao quà')).toBeNull();
  });
  it('Trao quà dùng mã đã tra, không dùng chữ đang gõ dở', async () => {
    const c = await mount();
    await lookUp(c, 'QG-AAAAAAAA');
    typeInto(label(c, CODE_LABEL), 'QG-BBBBBBBB');
    click(button(c, 'Trao quà'));
    await flush(10);
    expect(calls('/waste/desk/gifts/fulfil')[0]!.body).toEqual({ code: 'QG-AAAAAAAA', pointId: 'wh-1' });
  });
  it('đang gửi thì nút khoá: bấm hai lần chỉ gọi một lần', async () => {
    state.fulfil = () => new Promise(() => {});
    const c = await mount();
    await lookUp(c, 'QG-8K2M9P4T');
    click(button(c, 'Trao quà'));
    await flush();
    expect(button(c, 'Trao quà')!.disabled).toBe(true);
    click(button(c, 'Trao quà'));
    expect(calls('/waste/desk/gifts/fulfil')).toHaveLength(1);
  });
  it('điểm không bật trao quà: không có nút, có câu giải thích', async () => {
    state.points = [{ ...WAREHOUSE_DESK, giftHandoverEnabled: false }];
    const c = await mount();
    await lookUp(c, 'QG-8K2M9P4T');
    expect(c.textContent).toContain('Điểm này không trao quà');
    expect(button(c, 'Trao quà')).toBeNull();
  });
  it.each([
    ['FULFILLED', 'Quà đã được trao'],
    ['CANCELLED', 'Lượt đổi quà đã huỷ'],
  ] as const)('lượt không còn READY (%s): hiện trạng thái, không có nút', async (status, text) => {
    state.lookup = { type: 'GIFT', redemption: { ...GIFT, status } };
    const c = await mount();
    await lookUp(c, 'QG-8K2M9P4T');
    expect(c.textContent).toContain(text);
    expect(button(c, 'Trao quà')).toBeNull();
  });
  it('lỗi trao quà hiện nguyên văn và giữ thẻ quà', async () => {
    state.fulfil = () => {
      throw new Error('Quà đã được trao trước đó');
    };
    const c = await mount();
    await lookUp(c, 'QG-8K2M9P4T');
    click(button(c, 'Trao quà'));
    await flush(10);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Quà đã được trao trước đó');
    expect(c.textContent).toContain('Gói hạt giống Tubu');
  });
});

describe('/doi-rac/quay: ưu đãi và báo cáo tháng', () => {
  it('đại lý có thẻ ưu đãi và báo cáo; kho thì không có thẻ ưu đãi', async () => {
    state.points = [makeDeskPoint(), WAREHOUSE_DESK];
    state.report = { pointId: 'pt-1', month: '2026-10', confirmations: 12, pointsAwarded: 48_000, quotaUsed: 48_000, units: [{ itemId: 'item-carton', itemName: 'Thùng carton', unitLabel: 'thùng', qty: 30 }] };
    const c = await mount();
    expect(c.textContent).toContain('Ưu đãi riêng của cửa hàng');
    expect(c.textContent).toContain('Giảm 10% hoá đơn đầu');
    expect(c.textContent).toContain('12 lượt xác nhận');
    expect(c.textContent).toContain('Tubu đã cộng 48.000 điểm cho khách');
    expect(c.textContent).toContain('Thùng carton: 30 thùng');
    click(byText(c, '[role="tab"]', 'Kho Tubu TP.HCM'));
    await flush();
    expect(c.textContent).not.toContain('Ưu đãi riêng của cửa hàng');
  });
  it('báo cáo lỗi: có nút Thử lại', async () => {
    state.reportError = new Error('x');
    const c = await mount();
    expect(c.textContent).toContain('Chưa tải được báo cáo');
    state.reportError = null;
    click(button(c, 'Thử lại'));
    await flush(10);
    expect(c.textContent).toContain('Báo cáo tháng này');
  });
  it('chủ điểm sửa ưu đãi: gửi duyệt PUT perk, hiện đang chờ duyệt; nhân viên không có nút Chỉnh sửa', async () => {
    const c = await mount();
    click(button(c, 'Chỉnh sửa'));
    await flush();
    const sheet = dialog()!;
    const send = byText(sheet, 'button', 'Gửi duyệt') as HTMLButtonElement;
    typeInto(label(sheet, 'Nội dung ưu đãi'), '');
    expect(send.disabled).toBe(true);
    typeInto(label(sheet, 'Nội dung ưu đãi'), 'Tặng túi vải');
    click(send);
    await flush(10);
    expect(state.calls.find((x) => x.method === 'PUT')!.body).toEqual({ perkText: 'Tặng túi vải' });
    expect(c.textContent).toContain('Đã gửi, chờ Tubu duyệt');
    expect(dialog()).toBeNull();
  });
  it('chữ trả/thưởng tiền mặt: báo lỗi ngay, khoá nút Gửi duyệt, không gọi API', async () => {
    const c = await mount();
    click(button(c, 'Chỉnh sửa'));
    await flush();
    const sheet = dialog()!;
    typeInto(label(sheet, 'Nội dung ưu đãi'), 'Tặng 10k cho khách mang vỏ chai');
    expect(sheet.querySelector('[role=alert]')?.textContent).toContain('Zalo không cho phép');
    const send = byText(sheet, 'button', 'Gửi duyệt') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    click(send);
    await flush(10);
    expect(state.calls.find((x) => x.method === 'PUT')).toBeUndefined();
    typeInto(label(sheet, 'Nội dung ưu đãi'), 'Giảm 10k đơn từ 100k, tặng túi vải');
    expect(sheet.querySelector('[role=alert]')).toBeNull();
    expect((byText(sheet, 'button', 'Gửi duyệt') as HTMLButtonElement).disabled).toBe(false);
  });
  it('chủ hai điểm: gửi duyệt ở điểm A rồi đổi sang điểm B thì B không hiện "Đã gửi"', async () => {
    state.points = [makeDeskPoint(), makeDeskPoint({ id: 'pt-2', name: 'Đại lý B' })];
    const c = await mount();
    click(button(c, 'Chỉnh sửa'));
    await flush();
    typeInto(label(dialog()!, 'Nội dung ưu đãi'), 'Tặng túi vải');
    click(byText(dialog()!, 'button', 'Gửi duyệt'));
    await flush(10);
    expect(c.textContent).toContain('Đã gửi, chờ Tubu duyệt');
    click(byText(c, '[role="tab"]', 'Đại lý B'));
    await flush();
    expect(c.textContent).not.toContain('Đã gửi, chờ Tubu duyệt');
  });
  it('nhân viên đại lý không có nút Chỉnh sửa', async () => {
    state.points = [makeDeskPoint({ myRole: 'STAFF' })];
    const c = await mount();
    expect(button(c, 'Chỉnh sửa')).toBeNull();
  });
});

describe('/doi-rac/quay — diện mạo Mini App ở điện thoại', () => {
  it('thẻ Hạn mức không viền, đệm 12px, chữ cỡ body-md', async () => {
    const c = await mount();
    const card = c.querySelector<HTMLElement>('section[aria-label="Hạn mức"]')!;
    expect(card.className).toContain('max-md:border-transparent');
    expect(card.className).toContain('max-md:p-3');
    expect(card.querySelector('p:nth-of-type(2)')!.className).toContain('max-md:text-[length:var(--type-body-md-size)]');
  });
});
