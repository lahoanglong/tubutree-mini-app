// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { expectNoBannedCopy, wasteRequestDetail, wasteUnmatched } from '@/test-utils/fixtures/waste-admin';
import type { WasteRequestAdminDetailDTO } from '@tubutree/shared-types';
import { formatDateTime } from '@/lib/format-date';
import { WasteRequestDetail, wastePointsForLines } from './waste-request-detail';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

type Route = { status?: number; body: unknown } | ((init?: RequestInit) => { status?: number; body: unknown });

const CONFIRMED = { requestId: 'r1', code: 'TR-7K3M9Q', status: 'COMPLETED', pointsAwarded: 17_000, dropsAwarded: 0, quota: null, staffDailyCapRemaining: 983_000 };

async function mount(
  opts: {
    isAdmin?: boolean;
    detail?: WasteRequestAdminDetailDTO;
    detailRoute?: Route;
    confirm?: Route;
    reject?: Route;
    reverse?: Route;
    cost?: Route;
    closeLost?: Route;
    reopen?: Route;
    unmatched?: Route;
  } = {},
) {
  const detail = opts.detail ?? wasteRequestDetail();
  const api = mockFetch({
    '/admin/waste/requests/r1/confirm': opts.confirm ?? { body: CONFIRMED },
    '/admin/waste/requests/r1/reject': opts.reject ?? { body: { requestId: 'r1', code: 'TR-7K3M9Q', status: 'REJECTED' } },
    '/admin/waste/requests/r1/reverse': opts.reverse ?? { body: { requestId: 'r1', status: 'REVERSED', pointsTaken: 12_000, shortfallPoints: 5000 } },
    '/admin/waste/requests/r1/cost': opts.cost ?? { body: detail },
    '/admin/waste/requests/r1/close-lost': opts.closeLost ?? { body: detail },
    '/admin/waste/requests/r1/reopen': opts.reopen ?? { body: detail },
    '/admin/waste/unmatched': opts.unmatched ?? { body: [] },
    '/admin/waste/requests/r1': opts.detailRoute ?? { body: detail },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const onClose = vi.fn();
  const r = render(<WasteRequestDetail id="r1" isAdmin={opts.isAdmin ?? false} onClose={onClose} />);
  mounted.push(r);
  await flush();
  return { api, c: r.container, onClose };
}

const btn = (root: ParentNode, label: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label) ?? null;
const input = (c: ParentNode, name: string) => c.querySelector<HTMLInputElement>(`input[name="${name}"]`);
const select = (c: ParentNode, name: string) => c.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
const area = (c: ParentNode, name: string) => c.querySelector<HTMLTextAreaElement>(`textarea[name="${name}"]`);
const optionLabels = (s: HTMLSelectElement) => Array.from(s.options).filter((o) => o.value !== '').map((o) => o.textContent);
const optionValues = (s: HTMLSelectElement) => Array.from(s.options).map((o) => o.value);
const post = (api: { calls: { url: string; init?: RequestInit }[] }, part: string, method = 'POST') =>
  api.calls.filter((x) => x.url.includes(part) && x.init?.method === method);
const bodyOf = (call: { init?: RequestInit } | undefined) => JSON.parse(String(call!.init!.body));
const alerts = (c: ParentNode) => Array.from(c.querySelectorAll('[role="alert"]')).map((e) => e.textContent ?? '');
const dialogArea = () => confirmDialog()!.querySelector('textarea')!;

describe('wastePointsForLines', () => {
  it('wastePointsForLines: phần nguyên theo từng dòng (5.1)', () => {
    expect(
      wastePointsForLines([
        { receivedQty: 8, unitsPerPoint: 1, pointsPerGroup: 1000 },
        { receivedQty: 47, unitsPerPoint: 5, pointsPerGroup: 1000 },
      ]),
    ).toBe(17_000);
    expect(wastePointsForLines([{ receivedQty: 4, unitsPerPoint: 5, pointsPerGroup: 1000 }])).toBe(0);
    expect(wastePointsForLines([{ receivedQty: 3, unitsPerPoint: 1, pointsPerGroup: 2000 }])).toBe(6000);
  });
});

describe('WasteRequestDetail: màn đếm và từ chối', () => {
  it('màn đếm: mặc định nhận đủ, dòng thiếu phải chọn lý do, xác nhận gửi đúng body', async () => {
    const { c, api } = await mount();
    expect(input(c, 'received-i1')!.value).toBe('10');
    expect(input(c, 'received-i3')!.value).toBe('50');
    expect(c.textContent).toContain('Điểm sẽ cộng: 20.000');

    typeInto(input(c, 'received-i1'), '8');
    expect(select(c, 'shortfall-i1')).not.toBeNull();
    expect(btn(c, 'Xác nhận số đếm')!.disabled).toBe(true);
    expect(c.textContent).toContain('Chọn lý do cho dòng nhận thiếu');
    selectValue(select(c, 'shortfall-i1'), 'WET');
    typeInto(input(c, 'received-i3'), '47');
    selectValue(select(c, 'shortfall-i3'), 'DIRTY');
    typeInto(input(c, 'receivedWeightGrams'), '2500');
    expect(c.textContent).toContain('Điểm sẽ cộng: 17.000');

    click(btn(c, 'Xác nhận số đếm'));
    expect(confirmDialog()!.textContent).toContain('Cộng 17.000 điểm cho khách?');
    answerConfirm(true);
    await flush();
    const calls = post(api, '/admin/waste/requests/r1/confirm');
    expect(calls).toHaveLength(1);
    expect(bodyOf(calls[0])).toEqual({
      lines: [
        { itemId: 'i1', declaredQty: 10, receivedQty: 8, shortfallReason: 'WET' },
        { itemId: 'i3', declaredQty: 50, receivedQty: 47, shortfallReason: 'DIRTY' },
      ],
      receivedWeightGrams: 2500,
    });
    expect(c.textContent).toContain('Đã cộng 17.000 điểm cho khách.');
  });

  it('dòng món nguy hại: khoá ở 0 / Sai loại, gửi WRONG_TYPE, dòng thường vẫn theo số khai', async () => {
    const base = wasteRequestDetail();
    const detail = wasteRequestDetail({ lines: [base.lines[0]!, { ...base.lines[1]!, hazardous: true }] });
    const { c, api } = await mount({ detail });
    expect(input(c, 'received-i1')!.value).toBe('10');
    expect(input(c, 'received-i1')!.disabled).toBe(false);
    expect(input(c, 'received-i3')!.value).toBe('0');
    expect(input(c, 'received-i3')!.disabled).toBe(true);
    expect(select(c, 'shortfall-i3')!.value).toBe('WRONG_TYPE');
    expect(select(c, 'shortfall-i3')!.disabled).toBe(true);
    expect(c.textContent).toContain('Không nhận món này');
    expect(c.textContent).toContain('Điểm sẽ cộng: 10.000');
    expect(btn(c, 'Xác nhận số đếm')!.disabled).toBe(false);

    click(btn(c, 'Xác nhận số đếm'));
    answerConfirm(true);
    await flush();
    expect(bodyOf(post(api, '/admin/waste/requests/r1/confirm')[0])).toEqual({
      lines: [
        { itemId: 'i1', declaredQty: 10, receivedQty: 10 },
        { itemId: 'i3', declaredQty: 50, receivedQty: 0, shortfallReason: 'WRONG_TYPE' },
      ],
    });
  });

  it('thông báo kết quả vẫn hiện khi refetch đã chuyển yêu cầu sang trạng thái khác', async () => {
    let done = false;
    const confirmed = await mount({
      detailRoute: () => ({ body: done ? wasteRequestDetail({ status: 'COMPLETED', pointsAwarded: 17_000 }) : wasteRequestDetail() }),
      confirm: () => {
        done = true;
        return { body: CONFIRMED };
      },
    });
    click(btn(confirmed.c, 'Xác nhận số đếm'));
    answerConfirm(true);
    await flush();
    await flush();
    expect(confirmed.c.querySelector('[data-counting]')).toBeNull();
    expect(confirmed.c.textContent).toContain('Đã cộng 17.000 điểm cho khách.');

    let rejected = false;
    const reject = await mount({
      detailRoute: () => ({ body: rejected ? wasteRequestDetail({ status: 'REJECTED' }) : wasteRequestDetail() }),
      reject: () => {
        rejected = true;
        return { body: { requestId: 'r1', code: 'TR-7K3M9Q', status: 'REJECTED' } };
      },
    });
    click(btn(reject.c, 'Từ chối cả yêu cầu'));
    selectValue(select(reject.c, 'rejectionReason'), 'OVERSIZE');
    click(btn(reject.c, 'Xác nhận từ chối'));
    await flush();
    await flush();
    expect(reject.c.querySelector('[data-reject-panel]')).toBeNull();
    expect(reject.c.textContent).toContain('Đã từ chối yêu cầu.');
  });

  it('nhận đủ: không gửi khoá shortfallReason, không gửi cân nặng trống', async () => {
    const { c, api } = await mount();
    click(btn(c, 'Xác nhận số đếm'));
    answerConfirm(true);
    await flush();
    expect(bodyOf(post(api, '/admin/waste/requests/r1/confirm')[0])).toEqual({
      lines: [
        { itemId: 'i1', declaredQty: 10, receivedQty: 10 },
        { itemId: 'i3', declaredQty: 50, receivedQty: 50 },
      ],
    });
  });

  it('nhận lại đủ sau khi chọn lý do thì không gửi lý do cũ', async () => {
    const { c, api } = await mount();
    typeInto(input(c, 'received-i1'), '8');
    selectValue(select(c, 'shortfall-i1'), 'WET');
    typeInto(input(c, 'received-i1'), '10');
    expect(select(c, 'shortfall-i1')).toBeNull();
    click(btn(c, 'Xác nhận số đếm'));
    answerConfirm(true);
    await flush();
    expect(bodyOf(post(api, '/admin/waste/requests/r1/confirm')[0]).lines[0]).toEqual({ itemId: 'i1', declaredQty: 10, receivedQty: 10 });
  });

  it('số thực nhận ngoài 0..số khai bị chặn', async () => {
    const { c } = await mount();
    for (const bad of ['11', '-1', '', '1.5']) {
      typeInto(input(c, 'received-i1'), bad);
      expect(c.textContent).toContain('Số thực nhận từ 0 tới 10');
      expect(btn(c, 'Xác nhận số đếm')!.disabled).toBe(true);
      expect(c.textContent).not.toContain('NaN');
      expect(c.textContent).toContain('Điểm sẽ cộng: 20.000');
    }
    typeInto(input(c, 'received-i1'), '0');
    selectValue(select(c, 'shortfall-i1'), 'NOT_ACCEPTED');
    expect(c.textContent).toContain('Điểm sẽ cộng: 10.000');
    expect(btn(c, 'Xác nhận số đếm')!.disabled).toBe(false);
  });

  it('cân nặng sai định dạng chặn nút', async () => {
    const { c } = await mount();
    for (const bad of ['0', '100001', '1.5', 'abc']) {
      typeInto(input(c, 'receivedWeightGrams'), bad);
      expect(c.textContent).toContain('Cân nặng là số nguyên từ 1 tới 100000 gram');
      expect(btn(c, 'Xác nhận số đếm')!.disabled).toBe(true);
    }
    typeInto(input(c, 'receivedWeightGrams'), '');
    expect(btn(c, 'Xác nhận số đếm')!.disabled).toBe(false);
  });

  it('lý do thiếu đúng bảy lựa chọn', async () => {
    const { c } = await mount();
    typeInto(input(c, 'received-i1'), '8');
    expect(optionLabels(select(c, 'shortfall-i1')!)).toEqual(['Ướt', 'Bẩn', 'Lẫn vật lạ', 'Sai loại', 'Hỏng', 'Không nhận', 'Khác']);
  });

  it('từ chối cả yêu cầu: Khác bắt buộc ghi chú', async () => {
    const first = await mount();
    click(btn(first.c, 'Từ chối cả yêu cầu'));
    const s = select(first.c, 'rejectionReason')!;
    expect(optionLabels(s)).toHaveLength(10);
    expect(area(first.c, 'rejectionNote')!.maxLength).toBe(500);
    selectValue(s, 'OTHER');
    expect(first.c.textContent).toContain('Ghi chú bắt buộc khi chọn Khác');
    expect(btn(first.c, 'Xác nhận từ chối')!.disabled).toBe(true);
    typeInto(area(first.c, 'rejectionNote'), 'Lẫn đá');
    click(btn(first.c, 'Xác nhận từ chối'));
    await flush();
    expect(bodyOf(post(first.api, '/admin/waste/requests/r1/reject')[0])).toEqual({ rejectionReason: 'OTHER', rejectionNote: 'Lẫn đá' });

    const second = await mount();
    click(btn(second.c, 'Từ chối cả yêu cầu'));
    expect(btn(second.c, 'Xác nhận từ chối')!.disabled).toBe(true);
    selectValue(select(second.c, 'rejectionReason'), 'WET');
    click(btn(second.c, 'Xác nhận từ chối'));
    await flush();
    expect(bodyOf(post(second.api, '/admin/waste/requests/r1/reject')[0])).toEqual({ rejectionReason: 'WET' });
  });

  it('nhân viên đếm được nhưng không có thao tác chỉ admin (16.2)', async () => {
    const counting = await mount({ isAdmin: false });
    expect(btn(counting.c, 'Xác nhận số đếm')).not.toBeNull();

    const done = await mount({ isAdmin: false, detail: wasteRequestDetail({ status: 'COMPLETED', pointsAwarded: 17_000 }) });
    for (const label of ['Thu hồi điểm', 'Đóng vì thất lạc', 'Mở lại yêu cầu', 'Lưu phí ship']) expect(btn(done.c, label)).toBeNull();
    expect(done.c.querySelector('[data-request-events]')).toBeNull();
    expect(done.c.textContent).toContain('091****678');
  });

  it('lỗi API hiện nguyên văn', async () => {
    const { c } = await mount({ confirm: { status: 409, body: { message: 'Yêu cầu không còn ở trạng thái chờ đếm' } } });
    click(btn(c, 'Xác nhận số đếm'));
    answerConfirm(true);
    await flush();
    expect(alerts(c).join('|')).toContain('Yêu cầu không còn ở trạng thái chờ đếm');
    expect(btn(c, 'Xác nhận số đếm')!.disabled).toBe(false);
  });

  it('kho nhận tại điểm mang tới: màn đếm hiện cho DROP_OFF OPEN ở kho, không hiện ở đại lý', async () => {
    const warehouse = await mount({
      detail: wasteRequestDetail({
        method: 'DROP_OFF',
        status: 'OPEN',
        point: { id: 'wh', kind: 'WAREHOUSE', name: 'Kho Tubu HCM', addressLine: '1 A', communeName: 'B', provinceName: 'C', phone: null, openingHours: {} },
      }),
    });
    expect(btn(warehouse.c, 'Xác nhận số đếm')).not.toBeNull();
    expect(btn(warehouse.c, 'Từ chối cả yêu cầu')).not.toBeNull();
    const partner = await mount({ detail: wasteRequestDetail({ method: 'DROP_OFF', status: 'OPEN', point: null }) });
    expect(btn(partner.c, 'Xác nhận số đếm')).toBeNull();
  });
});

describe('WasteRequestDetail: thao tác chỉ admin, nhật ký', () => {
  it('admin thu hồi điểm: hỏi lý do, báo số đã thu và số không thu được', async () => {
    const { c, api } = await mount({ isAdmin: true, detail: wasteRequestDetail({ status: 'COMPLETED', pointsAwarded: 17_000 }) });
    click(btn(c, 'Thu hồi điểm'));
    typeInto(dialogArea(), 'Khai khống');
    answerConfirm(true);
    await flush();
    expect(bodyOf(post(api, '/admin/waste/requests/r1/reverse')[0])).toEqual({ reason: 'Khai khống' });
    expect(c.textContent).toContain('Đã thu hồi 12.000 điểm. Còn 5.000 điểm không thu được vì khách đã tiêu.');

    const full = await mount({
      isAdmin: true,
      detail: wasteRequestDetail({ status: 'COMPLETED', pointsAwarded: 17_000 }),
      reverse: { body: { requestId: 'r1', status: 'REVERSED', pointsTaken: 12_000, shortfallPoints: 0 } },
    });
    click(btn(full.c, 'Thu hồi điểm'));
    typeInto(dialogArea(), 'Khai khống');
    answerConfirm(true);
    await flush();
    const status = full.c.querySelector('[role="status"]')!;
    expect(status.textContent).toBe('Đã thu hồi 12.000 điểm.');
  });

  it('thu hồi từ yêu cầu gửi tận nơi: báo số không thu được dù refetch đã đổi trạng thái', async () => {
    let done = false;
    const { c } = await mount({
      isAdmin: true,
      detailRoute: () => ({
        body: done
          ? wasteRequestDetail({ method: 'DROP_OFF', status: 'REVERSED', pointsAwarded: 17_000, reversedPoints: 12_000, reversalShortfallPoints: 5000 })
          : wasteRequestDetail({ method: 'DROP_OFF', status: 'COMPLETED', pointsAwarded: 17_000 }),
      }),
      reverse: () => {
        done = true;
        return { body: { requestId: 'r1', status: 'REVERSED', pointsTaken: 12_000, shortfallPoints: 5000 } };
      },
    });
    click(btn(c, 'Thu hồi điểm'));
    typeInto(dialogArea(), 'Khai khống');
    answerConfirm(true);
    await flush();
    await flush();
    expect(c.textContent).toContain('Còn 5.000 điểm không thu được vì khách đã tiêu.');
    expect(c.textContent).toContain('12.000 điểm, không thu được 5.000 điểm');
    expect(btn(c, 'Thu hồi điểm')).toBeNull();
  });

  it('huỷ hộp thoại thu hồi thì không gọi API', async () => {
    const { c, api } = await mount({ isAdmin: true, detail: wasteRequestDetail({ status: 'COMPLETED', pointsAwarded: 17_000 }) });
    click(btn(c, 'Thu hồi điểm'));
    answerConfirm(false);
    await flush();
    expect(post(api, '/admin/waste/requests/r1/reverse')).toHaveLength(0);
  });

  it('admin đóng vì thất lạc yêu cầu gửi kho đang trên đường', async () => {
    const { c, api } = await mount({ isAdmin: true, detail: wasteRequestDetail({ method: 'MAIL_IN', status: 'IN_TRANSIT' }) });
    click(btn(c, 'Đóng vì thất lạc'));
    typeInto(dialogArea(), 'Hãng báo thất lạc');
    answerConfirm(true);
    await flush();
    expect(bodyOf(post(api, '/admin/waste/requests/r1/close-lost')[0])).toEqual({ reason: 'Hãng báo thất lạc' });

    const dropOff = await mount({ isAdmin: true, detail: wasteRequestDetail({ method: 'DROP_OFF', status: 'OPEN' }) });
    expect(btn(dropOff.c, 'Đóng vì thất lạc')).toBeNull();
  });

  it('admin mở lại yêu cầu hết hạn, chọn được cả kiện mở không liên quan, kiện liên quan xếp trước', async () => {
    const unmatched = {
      body: [
        wasteUnmatched({ id: 'un7', reason: 'MANUAL_ENTRY', relatedRequestId: null, carrier: null, trackingCode: null, description: 'Thùng không nhãn', receivedAt: '2026-10-17T03:00:00.000Z' }),
        wasteUnmatched({ id: 'un9', reason: 'NO_MATCH', relatedRequestId: 'rX', trackingCode: 'GHN777', description: 'Kiện của yêu cầu RX', receivedAt: '2026-10-17T05:00:00.000Z' }),
        wasteUnmatched({ relatedRequestId: 'r1' }),
        wasteUnmatched({ id: 'un8', status: 'RESOLVED', relatedRequestId: 'r1', description: 'Kiện đã đóng' }),
      ],
    };
    const detail = wasteRequestDetail({ status: 'EXPIRED', closeReason: 'HOLD_EXPIRED' });
    const first = await mount({ isAdmin: true, detail, unmatched });
    click(btn(first.c, 'Mở lại yêu cầu'));
    await flush();
    expect(first.api.calls.some((x) => x.url.includes('/admin/waste/unmatched') && x.url.includes('status=OPEN'))).toBe(true);
    const sel = select(first.c, 'reopenUnmatchedId')!;
    expect(optionValues(sel)).toEqual(['', 'un1', 'un7', 'un9']);
    expect(optionLabels(sel)[0]).toContain('liên quan tới yêu cầu này');
    expect(optionLabels(sel)[0]).toContain('GHN999');
    expect(optionLabels(sel)[0]).toContain('Thùng carton băng keo xanh');
    expect(optionLabels(sel)[0]).toContain(formatDateTime('2026-10-16T02:00:00.000Z'));
    expect(optionLabels(sel)[1]).toContain('Thùng không nhãn');
    expect(optionLabels(sel)[1]).toContain(formatDateTime('2026-10-17T03:00:00.000Z'));
    expect(optionLabels(sel)[1]).not.toContain('liên quan tới yêu cầu này');
    expect(optionLabels(sel)[2]).toContain('GHN777');
    expect(optionLabels(sel)[2]).not.toContain('liên quan tới yêu cầu này');
    expect(btn(first.c, 'Xác nhận mở lại')!.disabled).toBe(true);
    typeInto(area(first.c, 'reopenReason'), 'Kiện về muộn');
    selectValue(select(first.c, 'reopenUnmatchedId'), 'un7');
    click(btn(first.c, 'Xác nhận mở lại'));
    await flush();
    expect(bodyOf(post(first.api, '/admin/waste/requests/r1/reopen')[0])).toEqual({ reason: 'Kiện về muộn', unmatchedId: 'un7' });

    const second = await mount({ isAdmin: true, detail, unmatched });
    click(btn(second.c, 'Mở lại yêu cầu'));
    await flush();
    typeInto(area(second.c, 'reopenReason'), 'Kiện về muộn');
    click(btn(second.c, 'Xác nhận mở lại'));
    await flush();
    expect(bodyOf(post(second.api, '/admin/waste/requests/r1/reopen')[0])).toEqual({ reason: 'Kiện về muộn' });
  });

  it('admin nhập phí ship tay (12.2 bước 5)', async () => {
    const { c, api } = await mount({ isAdmin: true, detail: wasteRequestDetail({ method: 'PICKUP', status: 'COMPLETED' }) });
    typeInto(input(c, 'carrierCostVnd'), '32000');
    click(btn(c, 'Lưu phí ship'));
    await flush();
    const calls = post(api, '/admin/waste/requests/r1/cost', 'PATCH');
    expect(calls).toHaveLength(1);
    expect(bodyOf(calls[0])).toEqual({ carrierCostVnd: 32000 });

    for (const bad of ['-1', '1.5']) {
      typeInto(input(c, 'carrierCostVnd'), bad);
      expect(c.textContent).toContain('Phí ship là số nguyên không âm');
      expect(btn(c, 'Lưu phí ship')!.disabled).toBe(true);
    }
  });

  it('admin xem nhật ký sự kiện', async () => {
    const { c } = await mount({
      isAdmin: true,
      detail: wasteRequestDetail({
        status: 'COMPLETED',
        events: [
          { id: 'e1', createdAt: '2026-10-17T02:05:00.000Z', kind: 'PARCEL_RECEIVED', actorUserId: 's1', actorRole: 'STAFF', requestId: 'r1', pointId: 'wh', giftRedemptionId: null, meta: { matchBasis: 'TR_CODE', after: { lines: [{ itemId: 'i1', receivedQty: 8 }] } } },
          { id: 'e2', createdAt: '2026-10-18T01:00:00.000Z', kind: 'REQUEST_EXPIRED', actorUserId: null, actorRole: 'SYSTEM', requestId: 'r1', pointId: null, giftRedemptionId: null, meta: null },
        ],
      }),
    });
    const events = c.querySelector('[data-request-events]')!;
    for (const part of ['09:05 17/10/2026', 'PARCEL_RECEIVED', 'STAFF', 's1', 'TR_CODE', '"receivedQty": 8', 'Hệ thống']) expect(events.textContent).toContain(part);
    const items = events.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[1]!.textContent).toContain('Hệ thống');
    expect(items[1]!.querySelector('pre')).toBeNull();
  });

  it('không hiện thao tác API sẽ từ chối', async () => {
    const pickupTransit = await mount({ isAdmin: true, detail: wasteRequestDetail({ method: 'PICKUP', status: 'IN_TRANSIT', orderId: 'o1' }) });
    expect(btn(pickupTransit.c, 'Đóng vì thất lạc')).toBeNull();
    const dropExpired = await mount({ isAdmin: true, detail: wasteRequestDetail({ method: 'DROP_OFF', status: 'EXPIRED' }) });
    expect(btn(dropExpired.c, 'Mở lại yêu cầu')).toBeNull();
    const pickupNoOrder = await mount({ isAdmin: true, detail: wasteRequestDetail({ method: 'PICKUP', status: 'EXPIRED', orderId: null }) });
    expect(btn(pickupNoOrder.c, 'Mở lại yêu cầu')).toBeNull();
    const completed = await mount({ isAdmin: true, detail: wasteRequestDetail({ status: 'COMPLETED', pointsAwarded: 17_000 }) });
    expect(btn(completed.c, 'Từ chối cả yêu cầu')).toBeNull();
    const mailTransit = await mount({ isAdmin: true, detail: wasteRequestDetail({ method: 'MAIL_IN', status: 'IN_TRANSIT' }) });
    expect(btn(mailTransit.c, 'Đóng vì thất lạc')).not.toBeNull();
    expect(btn(mailTransit.c, 'Từ chối cả yêu cầu')).toBeNull();
  });

  it('không có chữ cấm', async () => {
    const admin = await mount({ isAdmin: true, detail: wasteRequestDetail({ status: 'COMPLETED', pointsAwarded: 17_000 }) });
    expectNoBannedCopy(admin.c.textContent);
    const counting = await mount({ isAdmin: true });
    expectNoBannedCopy(counting.c.textContent);
    click(btn(counting.c, 'Từ chối cả yêu cầu'));
    expectNoBannedCopy(counting.c.textContent);
  });
});
