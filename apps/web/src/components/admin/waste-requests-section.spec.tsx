// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { expectNoBannedCopy, wasteRequestDetail, wasteRequestRow, wasteUnmatched } from '@/test-utils/fixtures/waste-admin';
import { formatDateTime } from '@/lib/format-date';
import type { WasteSeed } from './waste-tab';
import { WasteRequestsSection } from './waste-requests-section';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

type Route = { status?: number; body: unknown } | ((init?: RequestInit) => { status?: number; body: unknown });

const PAGE_ONE = {
  rows: [
    wasteRequestRow(),
    wasteRequestRow({ id: 'r2', code: 'TR-BBBB22', status: 'OPEN', waitingReason: 'CUSTOMER_BLOCKED', trackingConflict: true }),
  ],
  nextCursor: 'c2',
};

async function mount(
  opts: { isAdmin?: boolean; seed?: WasteSeed | null; initialUserId?: string | null; queue?: Route; lookup?: Route; receive?: Route; receive9?: Route; reject?: Route; reject9?: Route; unmatched?: Route } = {},
) {
  const api = mockFetch({
    '/admin/waste/requests/r1/reject': opts.reject ?? { body: { requestId: 'r1' } },
    '/admin/waste/requests/r9/reject': opts.reject9 ?? { body: { requestId: 'r9' } },
    '/admin/waste/unmatched/un1/resolve': { body: wasteUnmatched({ status: 'RESOLVED' }) },
    '/admin/waste/unmatched/un3/resolve': { body: wasteUnmatched({ id: 'un3', status: 'RESOLVED' }) },
    '/admin/waste/requests/lookup': opts.lookup ?? { body: [] },
    '/admin/waste/requests/r1/receive': opts.receive ?? { body: { outcome: 'RECEIVED', requestId: 'r1', receivedAt: '2026-10-17T02:05:00.000Z' } },
    '/admin/waste/requests/r9/receive': opts.receive9 ?? { body: { outcome: 'RECEIVED', requestId: 'r9', receivedAt: '2026-10-17T02:05:00.000Z' } },
    '/admin/waste/unmatched':
      opts.unmatched ??
      ((init) => ({
        body:
          init?.method === 'POST'
            ? { id: 'un1' }
            : [wasteUnmatched(), wasteUnmatched({ id: 'un3', reason: 'TR_TRACKING_CONFLICT', trackingCode: 'GHN777', relatedRequestId: 'r4' })],
      })),
    '/admin/waste/requests/r1': { body: wasteRequestDetail() },
    '/admin/waste/requests': opts.queue ?? { body: PAGE_ONE },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const r = render(<WasteRequestsSection isAdmin={opts.isAdmin ?? false} seed={opts.seed} initialUserId={opts.initialUserId} />);
  mounted.push(r);
  await flush();
  return { api, c: r.container };
}

const LOOKUP_INPUT = 'input[aria-label="Mã yêu cầu, mã đơn hoặc mã vận đơn"]';
const chipGroup = (c: HTMLElement) => c.querySelector('[role="group"][aria-label="Hàng đợi yêu cầu"]')!;
const chips = (c: HTMLElement) => Array.from(chipGroup(c).querySelectorAll('button'));
const chip = (c: HTMLElement, label: string) => chips(c).find((b) => b.textContent === label)!;
const btn = (root: Element, label: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label) ?? null;
const row = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-request="${id}"]`)!;
const lookupRow = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-lookup-results] [data-request="${id}"]`)!;
const requestUrls = (api: { calls: { url: string }[] }) => api.calls.map((x) => x.url).filter((u) => u.includes('/admin/waste/requests'));
const posts = (api: { calls: { url: string; init?: RequestInit }[] }, part: string) =>
  api.calls.filter((x) => x.url.includes(part) && x.init?.method === 'POST');
const DOOR_REJECT = 'Từ chối tại cửa (chưa trả cước)';
const doorBtn = (c: HTMLElement) => btn(c.querySelector('[data-receive-panel]')!, DOOR_REJECT);
const confirmBtn = (c: HTMLElement) => btn(c.querySelector('[data-receive-panel]')!, 'Xác nhận đã nhận kiện')!;

async function lookup(c: HTMLElement, code = 'GHN123456') {
  typeInto(c.querySelector(LOOKUP_INPUT), code);
  click(byText(c, 'button', 'Tra'));
  await flush();
}

describe('WasteRequestsSection', () => {
  it('mở từ ngăn người dùng: lọc theo khách, chỉ admin', async () => {
    const a = await mount({ isAdmin: true, initialUserId: 'u1' });
    expect(requestUrls(a.api)[0]!.endsWith('/admin/waste/requests?userId=u1')).toBe(true);
    expect(chip(a.c, 'Yêu cầu của khách đang xem').getAttribute('aria-pressed')).toBe('true');
    const s = await mount({ isAdmin: false, initialUserId: 'u1' });
    expect(requestUrls(s.api).some((u) => u.includes('userId='))).toBe(false);
    expect(chips(s.c).some((b) => b.textContent === 'Yêu cầu của khách đang xem')).toBe(false);
  });

  it('mặc định mở hàng đợi Kho cần đếm', async () => {
    const { c, api } = await mount();
    expect(requestUrls(api)[0]!.endsWith('/admin/waste/requests?filter=TO_COUNT')).toBe(true);
    expect(chip(c, 'Kho cần đếm').getAttribute('aria-pressed')).toBe('true');
  });

  it('nhân viên không thấy danh sách chỉ admin và không gọi bộ lọc chỉ admin (15.4)', async () => {
    const { c, api } = await mount({ isAdmin: false });
    expect(chips(c).map((b) => b.textContent)).toEqual(['Kho cần đếm', 'Đang gửi về kho', 'Chờ vì khách bị khoá', 'Chờ vì đơn chưa giao', 'Hết hạn', 'Hàng không rõ chủ']);
    for (const b of chips(c)) click(b);
    await flush();
    const urls = api.calls.map((x) => x.url);
    expect(urls.some((u) => u.includes('TRANSIT_OVERDUE'))).toBe(false);
    expect(urls.some((u) => u.includes('ORDER_MISMATCH'))).toBe(false);
    expect(urls.some((u) => u.includes('userId='))).toBe(false);
  });

  it('admin có Gửi kho quá hạn xem lại và Mâu thuẫn với đơn', async () => {
    const { c, api } = await mount({ isAdmin: true });
    const labels = chips(c).map((b) => b.textContent);
    expect(labels.slice(-2)).toEqual(['Gửi kho quá hạn xem lại', 'Mâu thuẫn với đơn']);
    expect(labels.indexOf('Hàng không rõ chủ')).toBe(labels.length - 3);
    click(chip(c, 'Gửi kho quá hạn xem lại'));
    await flush();
    expect(requestUrls(api).some((u) => u.endsWith('?filter=TRANSIT_OVERDUE'))).toBe(true);
  });

  it('lọc theo cách giao và trạng thái', async () => {
    const { c, api } = await mount();
    selectValue(c.querySelector('select[aria-label="Cách giao"]'), 'MAIL_IN');
    await flush();
    selectValue(c.querySelector('select[aria-label="Trạng thái"]'), 'IN_TRANSIT');
    await flush();
    const urls = requestUrls(api);
    expect(urls[urls.length - 1]!.endsWith('/admin/waste/requests?method=MAIL_IN&status=IN_TRANSIT')).toBe(true);
    expect(chips(c).some((b) => b.getAttribute('aria-pressed') === 'true')).toBe(false);
  });

  it('dòng yêu cầu: nhãn tiếng Việt, số điện thoại đúng như máy chủ trả, lý do chờ, trùng mã vận đơn', async () => {
    const { c } = await mount();
    const r1 = row(c, 'r1').textContent!;
    for (const t of ['TR-7K3M9Q', 'Gửi về kho', 'Đang gửi', 'L** V** An', '091****678', 'GHN · GHN123456', '20.000 điểm ước tính', formatDateTime('2026-10-10T02:00:00.000Z')]) {
      expect(r1).toContain(t);
    }
    const r2 = row(c, 'r2').textContent!;
    expect(r2).toContain('Chờ: khách bị khoá');
    expect(r2).toContain('Trùng mã vận đơn');
  });

  it('Tải thêm theo cursor', async () => {
    let n = 0;
    const { c, api } = await mount({
      queue: () => {
        n += 1;
        return n === 1 ? { body: PAGE_ONE } : { body: { rows: [wasteRequestRow({ id: 'r4', code: 'TR-DDDD44' })], nextCursor: null } };
      },
    });
    click(byText(c, 'button', 'Tải thêm'));
    await flush();
    const urls = requestUrls(api);
    expect(urls[urls.length - 1]!.endsWith('?filter=TO_COUNT&cursor=c2')).toBe(true);
    expect(row(c, 'r1')).not.toBeNull();
    expect(row(c, 'r4')).not.toBeNull();
    expect(byText(c, 'button', 'Tải thêm')).toBeNull();
  });

  it('tra mã nhiều kết quả: liệt kê, không tự chọn dòng nào (15.4)', async () => {
    const { c, api } = await mount({ lookup: { body: [wasteRequestRow(), wasteRequestRow({ id: 'r3', code: 'TR-CCCC33' })] } });
    await lookup(c);
    expect(api.calls.some((x) => x.url.endsWith('/admin/waste/requests/lookup?code=GHN123456'))).toBe(true);
    expect(c.querySelectorAll('[data-lookup-results] [data-request]')).toHaveLength(2);
    expect(c.querySelector('[data-receive-panel]')).toBeNull();
    expect(c.querySelector('[data-request-detail]')).toBeNull();
  });

  it('tra mã không ra kết quả', async () => {
    const { c } = await mount({ lookup: { status: 404, body: { message: 'Không tìm thấy mã' } } });
    await lookup(c, 'XXX');
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Không tìm thấy mã');
    expect(c.querySelectorAll('[data-lookup-results] [data-request]')).toHaveLength(0);
  });

  it('nhận kiện gửi kho theo mã TR- trên kiện, kèm cân nặng tuỳ chọn', async () => {
    const { c, api } = await mount({ lookup: { body: [wasteRequestRow()] } });
    await lookup(c);
    click(btn(lookupRow(c, 'r1'), 'Nhận kiện'));
    const panel = c.querySelector('[data-receive-panel]')!;
    expect(panel).not.toBeNull();
    expect(confirmBtn(c).disabled).toBe(true);
    expect(panel.textContent).toContain('Nhập mã TR- trên kiện hoặc tick đối chiếu số điện thoại');
    typeInto(panel.querySelector('input[name="parcelCode"]'), 'TR-7K3M9Q');
    typeInto(panel.querySelector('input[name="receivedWeightGrams"]'), '1200');
    click(confirmBtn(c));
    await flush();
    const sent = posts(api, '/admin/waste/requests/r1/receive');
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0]!.init!.body))).toEqual({ match: { parcelCode: 'TR-7K3M9Q' }, receivedWeightGrams: 1200 });
    expect(c.textContent).toContain('Đã nhận kiện lúc 09:05. Mở màn đếm để đếm số thực nhận.');
  });

  it('không có mã TR-: tick đối chiếu số điện thoại; cân nặng trống thì không gửi', async () => {
    const { c, api } = await mount({ lookup: { body: [wasteRequestRow()] } });
    await lookup(c);
    click(btn(lookupRow(c, 'r1'), 'Nhận kiện'));
    const panel = c.querySelector('[data-receive-panel]')!;
    expect(panel.textContent).toContain('Không có mã TR-, số điện thoại người gửi trên nhãn khớp số đã che');
    click(panel.querySelector('input[name="phoneMatchConfirmed"]'));
    expect(confirmBtn(c).disabled).toBe(false);
    click(confirmBtn(c));
    await flush();
    const sent = posts(api, '/admin/waste/requests/r1/receive');
    expect(JSON.parse(String(sent[0]!.init!.body))).toEqual({ match: { phoneMatchConfirmed: true } });
  });

  it('mã vận đơn trên kiện: ô tuỳ chọn, chỉ gửi khi có nhập, không tự bật nút', async () => {
    const { c, api } = await mount({
      lookup: {
        body: [
          wasteRequestRow(),
          wasteRequestRow({ id: 'r9', code: 'TR-PICK99', method: 'PICKUP', orderCode: 'TUBU2026101546241', carrier: null, trackingCode: null }),
        ],
      },
    });
    await lookup(c, 'TR-7K3M9Q');
    click(btn(lookupRow(c, 'r9'), 'Nhận kiện'));
    expect(c.querySelector('[data-receive-panel]')).not.toBeNull();
    expect(c.querySelector('input[name="parcelTracking"]')).toBeNull();
    click(btn(lookupRow(c, 'r1'), 'Nhận kiện'));
    const tracking = c.querySelector<HTMLInputElement>('input[name="parcelTracking"]')!;
    expect(tracking.maxLength).toBe(64);
    expect(c.querySelector('[data-receive-panel]')!.textContent).toContain('Mã vận đơn trên kiện (nếu có)');
    typeInto(tracking, '  GHN999  ');
    expect(confirmBtn(c).disabled).toBe(true);
    typeInto(c.querySelector('input[name="parcelCode"]'), 'TR-7K3M9Q');
    click(confirmBtn(c));
    await flush();
    const sent = posts(api, '/admin/waste/requests/r1/receive');
    expect(JSON.parse(String(sent[0]!.init!.body))).toEqual({ match: { parcelCode: 'TR-7K3M9Q', parcelTracking: 'GHN999' } });
  });

  describe('từ chối tại cửa (chưa trả cước)', () => {
    const PICKUP_OPEN = wasteRequestRow({ id: 'r9', code: 'TR-PICK99', method: 'PICKUP', status: 'OPEN', orderCode: 'TUBU2026101546241', carrier: null, trackingCode: null });

    it('chỉ có cho gửi kho đang gửi và lấy hàng đang mở; không có cho mang tới điểm nhận hay đã nhận', async () => {
      const { c } = await mount({
        lookup: {
          body: [
            wasteRequestRow(),
            PICKUP_OPEN,
            wasteRequestRow({ id: 'r5', code: 'TR-RECV55', status: 'RECEIVED', receivedAt: '2026-10-12T02:00:00.000Z' }),
            wasteRequestRow({ id: 'r6', code: 'TR-DROP66', method: 'DROP_OFF', status: 'OPEN', carrier: null, trackingCode: null }),
            wasteRequestRow({ id: 'r7', code: 'TR-EXPD77', status: 'EXPIRED', closeReason: 'HOLD_EXPIRED' }),
            wasteRequestRow({ id: 'r8', code: 'TR-DONE88', status: 'COMPLETED', pointsAwarded: 20_000 }),
          ],
        },
      });
      await lookup(c);
      click(btn(lookupRow(c, 'r1'), 'Nhận kiện'));
      expect(doorBtn(c)).not.toBeNull();
      click(btn(lookupRow(c, 'r9'), 'Nhận kiện'));
      expect(doorBtn(c)).not.toBeNull();
      click(btn(lookupRow(c, 'r5'), 'Nhận kiện'));
      expect(c.querySelector('[data-receive-panel]')).not.toBeNull();
      expect(doorBtn(c)).toBeNull();
      for (const closed of ['r7', 'r8']) {
        click(btn(lookupRow(c, closed), 'Nhận kiện'));
        expect(c.querySelector('[data-receive-panel]')).not.toBeNull();
        expect(doorBtn(c)).toBeNull();
      }
      expect(btn(lookupRow(c, 'r6'), 'Nhận kiện')).toBeNull();
    });

    it('gửi kho: cần căn cứ đối chiếu như khi nhận kiện', async () => {
      const { c } = await mount({ lookup: { body: [wasteRequestRow()] } });
      await lookup(c);
      click(btn(lookupRow(c, 'r1'), 'Nhận kiện'));
      expect(doorBtn(c)!.disabled).toBe(true);
      typeInto(c.querySelector('input[name="parcelCode"]'), 'TR-7K3M9Q');
      expect(doorBtn(c)!.disabled).toBe(false);
    });

    it('xác nhận gửi lý do UNPAID_POSTAGE cùng căn cứ đối chiếu của nhận kiện, không gửi cân nặng', async () => {
      const { c, api } = await mount({ lookup: { body: [wasteRequestRow()] } });
      await lookup(c);
      click(btn(lookupRow(c, 'r1'), 'Nhận kiện'));
      typeInto(c.querySelector('input[name="parcelCode"]'), 'TR-7K3M9Q');
      typeInto(c.querySelector('input[name="parcelTracking"]'), '  GHN999  ');
      typeInto(c.querySelector('input[name="receivedWeightGrams"]'), '1200');
      click(doorBtn(c));
      await flush();
      expect(posts(api, '/reject')).toHaveLength(0);
      const d = confirmDialog()!;
      expect(d.textContent).toContain(DOOR_REJECT);
      typeInto(d.querySelector('textarea'), '  Khách chưa trả cước  ');
      answerConfirm(true);
      await flush();
      const sent = posts(api, '/admin/waste/requests/r1/reject');
      expect(sent).toHaveLength(1);
      expect(JSON.parse(String(sent[0]!.init!.body))).toEqual({
        rejectionReason: 'UNPAID_POSTAGE',
        rejectionNote: 'Khách chưa trả cước',
        match: { parcelCode: 'TR-7K3M9Q', parcelTracking: 'GHN999' },
      });
      expect(posts(api, '/receive')).toHaveLength(0);
      expect(c.textContent).toContain('Đã từ chối kiện tại cửa.');
      expect(confirmBtn(c)).toBeNull();
      expect(doorBtn(c)).toBeNull();
      expect(api.calls.filter((x) => x.url.includes('/admin/waste/requests?')).length).toBeGreaterThan(1);
    });

    it('lấy hàng: không có mã TR- thì không gửi căn cứ, ghi chú để trống thì không gửi ghi chú', async () => {
      const { c, api } = await mount({ lookup: { body: [PICKUP_OPEN] } });
      await lookup(c, 'TR-PICK99');
      click(btn(lookupRow(c, 'r9'), 'Nhận kiện'));
      click(doorBtn(c));
      await flush();
      answerConfirm(true);
      await flush();
      const sent = posts(api, '/admin/waste/requests/r9/reject');
      expect(JSON.parse(String(sent[0]!.init!.body))).toEqual({ rejectionReason: 'UNPAID_POSTAGE' });
    });

    it('huỷ hộp thoại thì không gửi gì và panel vẫn mở', async () => {
      const { c, api } = await mount({ lookup: { body: [wasteRequestRow()] } });
      await lookup(c);
      click(btn(lookupRow(c, 'r1'), 'Nhận kiện'));
      typeInto(c.querySelector('input[name="parcelCode"]'), 'TR-7K3M9Q');
      click(doorBtn(c));
      await flush();
      answerConfirm(false);
      await flush();
      expect(posts(api, '/reject')).toHaveLength(0);
      expect(c.querySelector('[data-receive-panel]')).not.toBeNull();
      expect(doorBtn(c)).not.toBeNull();

      click(doorBtn(c));
      await flush();
      answerConfirm(true);
      await flush();
      expect(posts(api, '/admin/waste/requests/r1/reject')).toHaveLength(1);
    });

    it('lỗi máy chủ: hiện đúng thông báo và giữ panel mở', async () => {
      const { c } = await mount({ lookup: { body: [wasteRequestRow()] }, reject: { status: 409, body: { message: 'Căn cứ đối chiếu không hợp lệ' } } });
      await lookup(c);
      click(btn(lookupRow(c, 'r1'), 'Nhận kiện'));
      typeInto(c.querySelector('input[name="parcelCode"]'), 'TR-7K3M9Q');
      click(doorBtn(c));
      await flush();
      answerConfirm(true);
      await flush();
      const panel = c.querySelector('[data-receive-panel]')!;
      expect(panel.querySelector('[role="alert"]')!.textContent).toContain('Căn cứ đối chiếu không hợp lệ');
      expect(doorBtn(c)).not.toBeNull();
      expect(c.textContent).not.toContain('Đã từ chối kiện tại cửa.');
    });
  });

  it('cân nặng ngoài 1..100000 gram bị chặn', async () => {
    const { c } = await mount({ lookup: { body: [wasteRequestRow()] } });
    await lookup(c);
    click(btn(lookupRow(c, 'r1'), 'Nhận kiện'));
    const panel = c.querySelector('[data-receive-panel]')!;
    typeInto(panel.querySelector('input[name="parcelCode"]'), 'TR-7K3M9Q');
    expect(confirmBtn(c).disabled).toBe(false);
    for (const bad of ['0', '100001']) {
      typeInto(panel.querySelector('input[name="receivedWeightGrams"]'), bad);
      expect(panel.textContent).toContain('Cân nặng là số nguyên từ 1 tới 100000 gram');
      expect(confirmBtn(c).disabled).toBe(true);
    }
  });

  it('kiện đã nhận rồi: báo giờ nhận và cho ghi vào hàng không rõ chủ (15.4)', async () => {
    const { c, api } = await mount({
      lookup: { body: [wasteRequestRow()] },
      receive: { body: { outcome: 'ALREADY_RECEIVED', receivedAt: '2026-10-17T02:05:00.000Z' } },
    });
    await lookup(c);
    click(btn(lookupRow(c, 'r1'), 'Nhận kiện'));
    typeInto(c.querySelector('input[name="parcelCode"]'), 'TR-7K3M9Q');
    click(confirmBtn(c));
    await flush();
    expect(c.textContent).toContain('Kiện này đã được nhận lúc 09:05. Nếu đây là kiện khác, hãy ghi vào hàng không rõ chủ');
    const b = byText(c, 'button', 'Ghi vào hàng không rõ chủ');
    click(b);
    click(b);
    await flush();
    const sent = posts(api, '/admin/waste/unmatched');
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0]!.init!.body))).toEqual({ carrier: 'GHN', trackingCode: 'GHN123456', description: 'Kiện thứ hai mang mã TR-7K3M9Q' });
    expect(c.textContent).toContain('Đã ghi vào hàng không rõ chủ.');
    expect(byText(c, 'button', 'Ghi vào hàng không rõ chủ')).toBeNull();
  });

  it('không khớp: kiện đã chuyển vào hàng không rõ chủ', async () => {
    const { c } = await mount({
      lookup: { body: [wasteRequestRow()] },
      receive: { body: { outcome: 'UNMATCHED', unmatchedId: 'un2', reason: 'EXPIRED_REQUEST' } },
    });
    await lookup(c);
    click(btn(lookupRow(c, 'r1'), 'Nhận kiện'));
    typeInto(c.querySelector('input[name="parcelCode"]'), 'TR-7K3M9Q');
    click(confirmBtn(c));
    await flush();
    expect(c.textContent).toContain('Yêu cầu đã hết hạn: kiện đã chuyển vào hàng không rõ chủ');
  });

  it('kiện của yêu cầu đã hết hạn hay đã xử lý: vẫn Nhận kiện, kiện vào hàng không rõ chủ kèm mã yêu cầu (15.4)', async () => {
    const { c, api } = await mount({
      lookup: {
        body: [
          wasteRequestRow({ status: 'EXPIRED', closeReason: 'HOLD_EXPIRED' }),
          wasteRequestRow({ id: 'r5', code: 'TR-EEEE55', status: 'COMPLETED', pointsAwarded: 20_000 }),
          wasteRequestRow({ id: 'r6', code: 'TR-FFFF66', status: 'CANCELLED' }),
          wasteRequestRow({ id: 'r7', code: 'TR-GGGG77', method: 'DROP_OFF', status: 'OPEN', carrier: null, trackingCode: null }),
        ],
      },
      receive: { body: { outcome: 'UNMATCHED', unmatchedId: 'un3', reason: 'EXPIRED_REQUEST' } },
    });
    await lookup(c, 'TR-7K3M9Q');
    expect(btn(lookupRow(c, 'r1'), 'Nhận kiện')).not.toBeNull();
    expect(btn(lookupRow(c, 'r5'), 'Nhận kiện')).not.toBeNull();
    expect(btn(lookupRow(c, 'r6'), 'Nhận kiện')).toBeNull();
    expect(btn(lookupRow(c, 'r7'), 'Nhận kiện')).toBeNull();
    click(btn(lookupRow(c, 'r1'), 'Nhận kiện'));
    typeInto(c.querySelector('input[name="parcelCode"]'), 'TR-7K3M9Q');
    click(confirmBtn(c));
    await flush();
    const sent = posts(api, '/admin/waste/requests/r1/receive');
    expect(JSON.parse(String(sent[0]!.init!.body))).toEqual({ match: { parcelCode: 'TR-7K3M9Q' } });
    expect(c.textContent).toContain('Yêu cầu đã hết hạn: kiện đã chuyển vào hàng không rõ chủ');
  });

  it('thu kèm đơn nhận theo mã đơn, không cần đối chiếu', async () => {
    const { c, api } = await mount({
      lookup: {
        body: [wasteRequestRow({ id: 'r9', code: 'TR-PICK99', method: 'PICKUP', orderCode: 'TUBU2026101546241', carrier: null, trackingCode: null })],
      },
    });
    await lookup(c, 'TUBU2026101546241');
    click(btn(lookupRow(c, 'r9'), 'Nhận kiện'));
    expect(c.querySelector('input[name="phoneMatchConfirmed"]')).toBeNull();
    expect(confirmBtn(c).disabled).toBe(false);
    click(confirmBtn(c));
    await flush();
    const sent = posts(api, '/admin/waste/requests/r9/receive');
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0]!.init!.body))).toEqual({});
  });

  it('thu kèm đơn: gõ mã TR- trên kiện thì gửi parcelCode để máy chủ đối chiếu', async () => {
    const { c, api } = await mount({
      lookup: {
        body: [wasteRequestRow({ id: 'r9', code: 'TR-PICK99', method: 'PICKUP', orderCode: 'TUBU2026101546241', carrier: null, trackingCode: null })],
      },
    });
    await lookup(c, 'TUBU2026101546241');
    click(btn(lookupRow(c, 'r9'), 'Nhận kiện'));
    expect(c.querySelector('input[name="parcelTracking"]')).toBeNull();
    typeInto(c.querySelector('input[name="parcelCode"]'), 'TR-PICK99');
    click(confirmBtn(c));
    await flush();
    const sent = posts(api, '/admin/waste/requests/r9/receive');
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0]!.init!.body))).toEqual({ match: { parcelCode: 'TR-PICK99' } });
  });

  it('nhận kiện từ hàng đợi: kết quả vẫn hiện sau khi danh sách tải lại', async () => {
    let received = false;
    const { c } = await mount({
      seed: { section: 'requests', preset: 'inTransit', n: 1 },
      receive: () => {
        received = true;
        return { body: { outcome: 'RECEIVED', requestId: 'r1', receivedAt: '2026-10-17T02:05:00.000Z' } };
      },
      queue: () => ({ body: { rows: received ? [] : [wasteRequestRow()], nextCursor: null } }),
    });
    click(btn(row(c, 'r1'), 'Nhận kiện'));
    typeInto(c.querySelector('input[name="parcelCode"]'), 'TR-7K3M9Q');
    click(confirmBtn(c));
    await flush();
    await flush();
    expect(c.querySelector('[data-receive-panel]')).not.toBeNull();
    expect(c.textContent).toContain('Đã nhận kiện lúc 09:05. Mở màn đếm để đếm số thực nhận.');
  });

  it('seed của hộp việc chọn sẵn hàng đợi; nhân viên bỏ qua hàng đợi chỉ admin (D3)', async () => {
    const a = await mount({ isAdmin: true, seed: { section: 'requests', preset: 'customerBlocked', n: 1 } });
    expect(chip(a.c, 'Chờ vì khách bị khoá').getAttribute('aria-pressed')).toBe('true');
    expect(requestUrls(a.api)[0]!.endsWith('/admin/waste/requests?filter=CUSTOMER_BLOCKED')).toBe(true);
    const b = await mount({ isAdmin: true, seed: { section: 'requests', preset: 'orderMismatch', n: 2 } });
    expect(requestUrls(b.api).some((u) => u.endsWith('?filter=ORDER_MISMATCH'))).toBe(true);
    const s = await mount({ isAdmin: false, seed: { section: 'requests', preset: 'transitOverdue', n: 3 } });
    expect(chip(s.c, 'Kho cần đếm').getAttribute('aria-pressed')).toBe('true');
    expect(s.api.calls.some((x) => x.url.includes('TRANSIT_OVERDUE'))).toBe(false);
    const o = await mount({ isAdmin: true, seed: { section: 'gifts', preset: 'orderMismatch', n: 4 } });
    expect(chip(o.c, 'Kho cần đếm').getAttribute('aria-pressed')).toBe('true');
  });

  it('không có chữ cấm', async () => {
    const admin = await mount({ isAdmin: true, lookup: { body: [wasteRequestRow()] } });
    await lookup(admin.c);
    click(btn(lookupRow(admin.c, 'r1'), 'Nhận kiện'));
    expectNoBannedCopy(admin.c.textContent);
    const staff = await mount({ isAdmin: false });
    expectNoBannedCopy(staff.c.textContent);
  });
});

describe('hàng không rõ chủ', () => {
  const unmatchedUrls = (api: { calls: { url: string }[] }) => api.calls.map((x) => x.url).filter((u) => u.includes('/admin/waste/unmatched'));
  const unRow = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-unmatched="${id}"]`)!;
  const form = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-unmatched-form]')!;
  const openView = async (opts: Parameters<typeof mount>[0] = {}) => {
    const m = await mount(opts);
    click(chip(m.c, 'Hàng không rõ chủ'));
    await flush();
    return m;
  };

  it('danh sách kiện đang mở: giờ nhận, mã vận đơn, mô tả, lý do', async () => {
    const { c, api } = await openView();
    expect(unmatchedUrls(api).pop()!.endsWith('/admin/waste/unmatched')).toBe(true);
    const t = unRow(c, 'un1').textContent!;
    for (const x of [formatDateTime('2026-10-16T02:00:00.000Z'), 'GHN · GHN999', 'Thùng carton băng keo xanh', 'Không khớp yêu cầu nào']) {
      expect(t).toContain(x);
    }
    click(c.querySelector('input[name="showResolved"]'));
    await flush();
    expect(unmatchedUrls(api).pop()!.endsWith('/admin/waste/unmatched?status=RESOLVED')).toBe(true);
    expect(byText(c, 'label', 'Xem kiện đã xử lý')).not.toBeNull();
  });

  it('ghi kiện không rõ chủ: chỉ mô tả kiện, không ghi tên hay số điện thoại', async () => {
    const { c, api } = await openView();
    const f = form(c);
    expect(f.textContent).toContain('Chỉ mô tả kiện, không ghi tên hay số điện thoại người gửi.');
    expect(Array.from(f.querySelectorAll('input, textarea')).map((e) => e.getAttribute('name'))).toEqual(['carrier', 'trackingCode', 'description']);
    expect(btn(f, 'Ghi kiện')!.disabled).toBe(true);
    typeInto(f.querySelector('input[name="carrier"]'), 'GHN');
    typeInto(f.querySelector('input[name="trackingCode"]'), 'GHN555');
    typeInto(f.querySelector('input[name="description"]'), 'Bao nilon đen 3 kg');
    const b = btn(f, 'Ghi kiện')!;
    click(b);
    click(b);
    await flush();
    const sent = posts(api, '/admin/waste/unmatched');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url.endsWith('/admin/waste/unmatched')).toBe(true);
    expect(JSON.parse(String(sent[0]!.init!.body))).toEqual({ carrier: 'GHN', trackingCode: 'GHN555', description: 'Bao nilon đen 3 kg' });
    expect((form(c).querySelector('input[name="description"]') as HTMLInputElement).value).toBe('');
  });

  it('mô tả quá 200 ký tự hay để trống thì không ghi được', async () => {
    const { c } = await openView();
    const f = form(c);
    typeInto(f.querySelector('input[name="description"]'), 'a'.repeat(201));
    expect(f.textContent).toContain('Mô tả tối đa 200 ký tự');
    expect(btn(f, 'Ghi kiện')!.disabled).toBe(true);
    typeInto(f.querySelector('input[name="description"]'), 'a'.repeat(200));
    expect(f.textContent).not.toContain('Mô tả tối đa 200 ký tự');
    expect(btn(f, 'Ghi kiện')!.disabled).toBe(false);
    typeInto(f.querySelector('input[name="description"]'), '   ');
    expect(btn(f, 'Ghi kiện')!.disabled).toBe(true);
  });

  it('khớp kiện với yêu cầu: tra mã, chọn dòng (không tự chọn), ghi chú bắt buộc', async () => {
    const { c, api } = await openView({ lookup: { body: [wasteRequestRow()] } });
    click(btn(unRow(c, 'un1'), 'Khớp yêu cầu'));
    const panel = c.querySelector<HTMLElement>('[data-match-panel]')!;
    typeInto(panel.querySelector('input[name="matchCode"]'), 'TR-7K3M9Q');
    click(btn(panel, 'Tra'));
    await flush();
    const radios = panel.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios).toHaveLength(1);
    expect(radios[0]!.checked).toBe(false);
    const ok = () => btn(panel, 'Xác nhận khớp')!;
    expect(ok().disabled).toBe(true);
    click(radios[0]!);
    expect(ok().disabled).toBe(true);
    typeInto(panel.querySelector('textarea[name="resolveNote"]'), 'Mã TR trên kiện khớp');
    expect(ok().disabled).toBe(false);
    click(ok());
    click(ok());
    await flush();
    const sent = posts(api, '/admin/waste/unmatched/un1/resolve');
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0]!.init!.body))).toEqual({ action: 'MATCH', requestId: 'r1', note: 'Mã TR trên kiện khớp' });
    expect(c.querySelector('[data-match-panel]')).toBeNull();
  });

  it('tra mã không thấy: lỗi hiện nguyên văn trong bảng khớp', async () => {
    const { c } = await openView({ lookup: { status: 404, body: { message: 'Không tìm thấy mã' } } });
    click(btn(unRow(c, 'un1'), 'Khớp yêu cầu'));
    const panel = c.querySelector<HTMLElement>('[data-match-panel]')!;
    typeInto(panel.querySelector('input[name="matchCode"]'), 'XXX');
    click(btn(panel, 'Tra'));
    await flush();
    expect(panel.querySelector('[role="alert"]')!.textContent).toContain('Không tìm thấy mã');
    expect(panel.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  });

  it('đóng kiện hỏi ghi chú rồi gửi CLOSE', async () => {
    const { c, api } = await openView();
    click(btn(unRow(c, 'un1'), 'Đóng'));
    await flush();
    const d = confirmDialog()!;
    expect(d.textContent).toContain('Đóng kiện không rõ chủ');
    const ta = d.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(ta).not.toBeNull();
    expect(d.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!.disabled).toBe(true);
    typeInto(ta, 'Đã trả lại hãng');
    answerConfirm(true);
    await flush();
    const sent = posts(api, '/admin/waste/unmatched/un1/resolve');
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0]!.init!.body))).toEqual({ action: 'CLOSE', note: 'Đã trả lại hãng' });
  });

  it('huỷ hộp thoại đóng kiện thì không gửi gì', async () => {
    const { c, api } = await openView();
    click(btn(unRow(c, 'un1'), 'Đóng'));
    await flush();
    answerConfirm(false);
    await flush();
    expect(posts(api, '/resolve')).toHaveLength(0);
  });

  it('kiện mâu thuẫn mã TR- và mã vận đơn: chỉ admin khớp được', async () => {
    const staff = await openView({ isAdmin: false });
    const s3 = unRow(staff.c, 'un3');
    expect(btn(s3, 'Khớp yêu cầu')).toBeNull();
    expect(s3.textContent).toContain('Chỉ admin khớp được kiện này');
    expect(btn(s3, 'Đóng')).not.toBeNull();
    expect(btn(unRow(staff.c, 'un1'), 'Khớp yêu cầu')).not.toBeNull();
    const admin = await openView({ isAdmin: true });
    expect(btn(unRow(admin.c, 'un3'), 'Khớp yêu cầu')).not.toBeNull();
    expect(unRow(admin.c, 'un3').textContent).not.toContain('Chỉ admin khớp được kiện này');
  });

  it('lỗi của máy chủ hiện nguyên văn', async () => {
    const { c } = await openView({ unmatched: (init) => (init?.method === 'POST' ? { status: 400, body: { message: 'Mô tả không hợp lệ' } } : { body: [wasteUnmatched()] }) });
    const f = form(c);
    typeInto(f.querySelector('input[name="description"]'), 'Thùng nhỏ');
    click(btn(f, 'Ghi kiện'));
    await flush();
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Mô tả không hợp lệ');
    expect(btn(form(c), 'Ghi kiện')!.disabled).toBe(false);
  });

  it('seed wasteUnmatched mở thẳng hàng không rõ chủ (D3)', async () => {
    const { c, api } = await mount({ isAdmin: false, seed: { section: 'requests', preset: 'unmatched', n: 1 } });
    expect(chip(c, 'Hàng không rõ chủ').getAttribute('aria-pressed')).toBe('true');
    expect(chip(c, 'Kho cần đếm').getAttribute('aria-pressed')).toBe('false');
    expect(unmatchedUrls(api).some((u) => u.endsWith('/admin/waste/unmatched'))).toBe(true);
    expect(unRow(c, 'un1')).not.toBeNull();
    click(chip(c, 'Kho cần đếm'));
    await flush();
    expect(unRow(c, 'un1')).toBeNull();
    expect(row(c, 'r1')).not.toBeNull();
  });

  it('Mở trên dòng r1 hiện chi tiết yêu cầu', async () => {
    const { c } = await mount();
    click(btn(row(c, 'r1'), 'Mở'));
    await flush();
    expect(c.querySelector('[data-request-detail="r1"]')).not.toBeNull();
  });

  it('không có chữ cấm', async () => {
    const admin = await openView({ isAdmin: true });
    click(btn(unRow(admin.c, 'un1'), 'Khớp yêu cầu'));
    expectNoBannedCopy(admin.c.textContent);
    const staff = await openView({ isAdmin: false });
    expectNoBannedCopy(staff.c.textContent);
  });
});
