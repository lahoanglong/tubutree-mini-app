// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WasteRequestDetailDTO } from '@tubutree/shared-types';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { makeRequestDetail, makeWarehouseContact, makeWasteMe, makeWastePoint } from './recycle-fixtures';

// Chép ý recycle-request.spec.tsx (Mini App, §4.5, §4.5b, §4.6, §15): mã QR, sửa/huỷ, gửi về kho + mã vận đơn, thu kèm đơn,
// trạng thái đóng, 404. Khác Mini App: thông báo thành công là dòng chữ trong trang, lỗi huỷ nằm trong sheet.

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  request: null as unknown,
  requestError: null as unknown,
  me: null as unknown,
  points: [] as unknown[],
  config: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } } as Record<string, unknown>,
  support: { hotline: '0984606774', email: 'tubutree@gmail.com', zaloOaName: null } as unknown,
  calls: [] as { method: string; path: string; body?: unknown }[],
  cancel: null as unknown as () => unknown,
  tracking: null as unknown as (b: unknown) => unknown,
  copied: [] as string[],
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => state.config }));
vi.mock('@/components/ui/qr-code', () => ({ QrCode: ({ value }: { value: string }) => <div data-testid="qr">{value}</div> }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push({ method: 'GET', path });
      if (path === '/waste/requests/req-1') {
        if (state.requestError) throw state.requestError;
        return state.request;
      }
      if (path === '/waste/me') return state.me;
      if (path.startsWith('/waste/points')) return state.points;
      if (path === '/config/public') return { support: state.support };
      throw new Error(`chưa mock ${path}`);
    },
    post: async (path: string, body?: unknown) => {
      state.calls.push({ method: 'POST', path, body });
      if (path === '/waste/requests/req-1/cancel') return state.cancel();
      throw new Error(`chưa mock ${path}`);
    },
    put: async (path: string, body?: unknown) => {
      state.calls.push({ method: 'PUT', path, body });
      if (path === '/waste/requests/req-1/tracking') return state.tracking(body);
      throw new Error(`chưa mock ${path}`);
    },
  },
}));

import { RecycleRequestDetail } from './recycle-request';

const MAIL = (over: Partial<WasteRequestDetailDTO> = {}) =>
  makeRequestDetail({ method: 'MAIL_IN', pointName: 'Kho Tubu TP.HCM', point: makeWarehouseContact(), ...over });
const PICKUP = (over: Partial<WasteRequestDetailDTO> = {}) =>
  makeRequestDetail({ method: 'PICKUP', pointName: 'Kho Tubu TP.HCM', point: makeWarehouseContact(), ...over });
const PAUSED = 'Chương trình đang tạm dừng';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<RecycleRequestDetail id="req-1" />);
  mounted.push(r);
  await flush(10);
  return r.container;
};
const button = (c: ParentNode, name: string) => byText(c, 'button', name) as HTMLButtonElement | null;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const field = (c: ParentNode, label: string) => (byText(c, 'label', label) as HTMLLabelElement).control;
const calls = (method: string) => state.calls.filter((x) => x.method === method);

beforeEach(() => {
  state.phase = 'authenticated';
  state.request = makeRequestDetail();
  state.requestError = null;
  state.me = makeWasteMe();
  state.points = [makeWastePoint()];
  state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } };
  state.calls = [];
  state.copied = [];
  state.cancel = () => makeRequestDetail({ status: 'CANCELLED', cancellable: false, editable: false });
  state.tracking = () => MAIL({ status: 'IN_TRANSIT', carrier: 'GHN', trackingCode: 'GHN123' });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (t: string) => void state.copied.push(t) },
  });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('/doi-rac/yeu-cau/[id]: Mang tới điểm nhận (§4.5, §4.6)', () => {
  it('timeline luôn hiện ở bước "Mang tới điểm"; bảng đã khai/đã đếm', async () => {
    const c = await mount();
    const tl = c.querySelector('ol[aria-label="Tiến độ yêu cầu"]')!;
    expect(tl.querySelector('[data-step="Mang tới điểm"]')?.getAttribute('aria-current')).toBe('step');
    const row = byText(c.querySelector('table[aria-label="Đã khai và đã đếm"]')!, 'tr', 'Thùng carton')!;
    expect(row.textContent).toContain('5 thùng');
    expect(row.textContent).toContain('—');
  });

  it('không có liên kết "Xem kết quả mẫu" của mockup (§19)', async () => {
    const c = await mount();
    expect(c.querySelector('h1')).not.toBeNull();
    expect(c.textContent).not.toContain('Xem kết quả mẫu');
  });

  it('"Xem mã QR": mã, QR, điểm nhận, hạn giữ chỗ (giờ VN), chuẩn bị, dòng luật cộng điểm', async () => {
    const c = await mount();
    click(button(c, 'Xem mã QR'));
    await flush(2);
    const d = dialog()!;
    expect(d.querySelector('[data-testid="qr"]')?.textContent).toBe('TR-8K2M9');
    expect(d.textContent).toContain('Đại lý Cô Ba');
    expect(d.textContent).toContain('12 Lê Lợi, Phường Bến Thành, TP.HCM');
    expect(d.textContent).toContain('Giữ chỗ tới 25/10/2026');
    expect(d.textContent).toContain('Gấp phẳng, bỏ băng keo');
    expect(d.textContent).toContain('Điểm chỉ cộng sau khi điểm nhận đếm xong theo số thực nhận, không vượt số đã khai');
    click(button(d, 'Theo dõi yêu cầu'));
    await flush(2);
    expect(dialog()).toBeNull();
  });

  it('"Sửa món" chỉ khi editable, "Huỷ yêu cầu" chỉ khi cancellable', async () => {
    state.request = makeRequestDetail({ editable: false, cancellable: false });
    const c = await mount();
    expect(button(c, 'Sửa món')).toBeNull();
    expect(button(c, 'Huỷ yêu cầu')).toBeNull();
  });

  it('Sửa món là liên kết tới /doi-rac/yeu-cau/:id/sua', async () => {
    const c = await mount();
    expect(byText(c, 'a', 'Sửa món')?.getAttribute('href')).toBe('/doi-rac/yeu-cau/req-1/sua');
  });

  it('điểm nhận tạm ngừng: câu ghim + "Đổi điểm nhận" sang trang sửa', async () => {
    state.request = makeRequestDetail({ pointAvailable: false });
    const c = await mount();
    expect(c.textContent).toContain('Điểm nhận đang tạm ngừng, hãy chọn điểm khác');
    expect(byText(c, 'a', 'Đổi điểm nhận')?.getAttribute('href')).toBe('/doi-rac/yeu-cau/req-1/sua');
  });

  it('điểm nhận tạm ngừng: khung mã QR cũng nhắc và có "Đổi điểm nhận" (§15.2)', async () => {
    state.request = makeRequestDetail({ pointAvailable: false });
    const c = await mount();
    click(button(c, 'Xem mã QR'));
    await flush(2);
    const d = dialog()!;
    expect(d.textContent).toContain('Điểm nhận đang tạm ngừng, hãy chọn điểm khác');
    expect(byText(d, 'a', 'Đổi điểm nhận')).not.toBeNull();
  });

  it('chương trình tạm dừng: không còn "Xem mã QR", có câu tạm dừng và vẫn huỷ được', async () => {
    state.config = { isLoaded: true, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } };
    const c = await mount();
    expect(c.textContent).toContain(PAUSED);
    expect(button(c, 'Xem mã QR')).toBeNull();
    expect(button(c, 'Huỷ yêu cầu')?.disabled).toBe(false);
    expect(c.textContent).toContain('Đang tạm dừng');
    expect(c.textContent).not.toContain('Chờ bạn mang tới');
  });

  it('khách bị khoá: cùng câu trung tính, không lộ việc bị khoá, vẫn huỷ được', async () => {
    state.me = makeWasteMe({ blocked: true });
    const c = await mount();
    expect(c.textContent).toContain(PAUSED);
    expect(button(c, 'Xem mã QR')).toBeNull();
    expect(button(c, 'Huỷ yêu cầu')?.disabled).toBe(false);
    expect(c.textContent).not.toMatch(/khoá/i);
    expect(c.textContent).toContain('Đang tạm dừng');
  });

  it('bình thường: có "Xem mã QR" và không có câu tạm dừng', async () => {
    const c = await mount();
    expect(button(c, 'Xem mã QR')).not.toBeNull();
    expect(c.textContent).not.toContain(PAUSED);
  });

  it('cấu hình công khai chưa tải: không coi là tạm dừng, vẫn có "Xem mã QR"', async () => {
    state.config = { isLoaded: false, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } };
    const c = await mount();
    expect(button(c, 'Xem mã QR')).not.toBeNull();
    expect(c.textContent).not.toContain(PAUSED);
  });

  it('điểm của yêu cầu đã hết hạn mức tháng: nhắc đổi điểm khác + "Đổi điểm nhận" (§11.4)', async () => {
    const r = makeRequestDetail();
    state.request = r;
    state.points = [makeWastePoint({ id: r.point!.id, quotaFull: true })];
    const c = await mount();
    expect(c.textContent).toContain('Điểm này tạm hết hạn mức tháng này, hãy chọn điểm khác');
    expect(byText(c, 'a', 'Đổi điểm nhận')?.getAttribute('href')).toBe('/doi-rac/yeu-cau/req-1/sua');
  });

  it('huỷ: hỏi lại, gọi cancel, làm mới khoá; lỗi hiện câu máy chủ trong sheet', async () => {
    let first = true;
    state.cancel = () => {
      if (first) {
        first = false;
        throw new Error('Yêu cầu đã đóng');
      }
      return makeRequestDetail({ status: 'CANCELLED', cancellable: false, editable: false });
    };
    const c = await mount();
    click(button(c, 'Huỷ yêu cầu'));
    await flush(2);
    expect(dialog()!.querySelector('h2')?.textContent).toBe('Huỷ yêu cầu này?');
    click(button(dialog()!, 'Xác nhận huỷ'));
    await flush(4);
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('Yêu cầu đã đóng');
    click(button(dialog()!, 'Xác nhận huỷ'));
    await flush(6);
    expect(calls('POST').filter((x) => x.path === '/waste/requests/req-1/cancel')).toHaveLength(2);
    expect(dialog()).toBeNull();
    expect(c.textContent).toContain('Đã huỷ yêu cầu');
    expect(state.calls.filter((x) => x.path === '/waste/requests/req-1').length).toBeGreaterThan(1);
  });
});

describe('/doi-rac/yeu-cau/[id]: Gửi về kho (§4.5b)', () => {
  it('khối 4.5b nằm TRÊN timeline: mã lớn, dòng ghi mã, người nhận + Sao chép, quy tắc gói, cước, hạn nhập', async () => {
    state.request = MAIL();
    const c = await mount();
    const note = byText(c, 'p', 'Ghi mã này lên kiện, mỗi kiện một yêu cầu')!;
    const tl = c.querySelector('ol[aria-label="Tiến độ yêu cầu"]')!;
    expect(note.compareDocumentPosition(tl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const recipient = c.querySelector('[data-recipient]')!;
    expect(recipient.textContent).toContain('Kho Tubu TP.HCM');
    click(button(c, 'Sao chép'));
    await flush(2);
    expect(state.copied).toEqual(['Kho Tubu TP.HCM\n0281234567\n99 Nguyễn Văn Linh, Phường Tân Phong, TP.HCM']);
    expect(c.textContent).toContain('Đã sao chép');
    expect(c.textContent).toContain('Đóng gói không lẫn pin, hoá chất, vật nhọn, đồ ướt hoặc bẩn');
    expect(c.textContent).toContain('Kho từ chối kiện còn cước phải trả khi nhận');
    expect(c.textContent).toContain('Nhập trước 25/10');
  });

  it.each([null, ''])('kho không có số điện thoại (%j): khối người nhận không có dòng trống, Sao chép bỏ dòng số', async (phone) => {
    state.request = MAIL({ point: makeWarehouseContact({ phone }) });
    const c = await mount();
    const block = c.querySelector('[data-recipient]') as HTMLElement;
    expect(block.querySelectorAll('p')).toHaveLength(2);
    expect(block.textContent).not.toContain('null');
    click(button(c, 'Sao chép'));
    await flush(2);
    expect(state.copied).toEqual(['Kho Tubu TP.HCM\n99 Nguyễn Văn Linh, Phường Tân Phong, TP.HCM']);
  });

  it('"Đã gửi" khoá tới khi có Hãng và Mã vận đơn; gửi PUT tracking rồi làm mới khoá', async () => {
    state.request = MAIL();
    const c = await mount();
    const sent = button(c, 'Đã gửi')!;
    expect(sent.disabled).toBe(true);
    typeInto(field(c, 'Hãng'), ' GHN ');
    typeInto(field(c, 'Mã vận đơn'), 'GHN123');
    expect(sent.disabled).toBe(false);
    click(sent);
    await flush(6);
    expect(calls('PUT')).toEqual([{ method: 'PUT', path: '/waste/requests/req-1/tracking', body: { carrier: 'GHN', trackingCode: 'GHN123' } }]);
    expect(c.textContent).toContain('Đã lưu mã vận đơn');
  });

  it('lưu mã vận đơn lỗi: hiện câu máy chủ ngay dưới biểu mẫu', async () => {
    state.request = MAIL();
    state.tracking = () => {
      throw new Error('Mã vận đơn đã dùng');
    };
    const c = await mount();
    typeInto(field(c, 'Hãng'), 'GHN');
    typeInto(field(c, 'Mã vận đơn'), 'GHN123');
    click(button(c, 'Đã gửi'));
    await flush(6);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Mã vận đơn đã dùng');
  });

  it('đã nhập mã vận đơn: thẻ Vận chuyển hiện hãng + mã và nút "Sửa"', async () => {
    state.request = MAIL({ status: 'IN_TRANSIT', carrier: 'GHN', trackingCode: 'GHN123', editable: false });
    const c = await mount();
    const card = byText(c, 'h2', 'Vận chuyển')!.closest('section')!;
    expect(card.textContent).toContain('GHN · GHN123');
    click(button(card, 'Sửa'));
    await flush(2);
    expect((field(c, 'Mã vận đơn') as HTMLInputElement).value).toBe('GHN123');
  });

  it('chương trình tắt vẫn nhập được mã vận đơn và huỷ (§15.1)', async () => {
    state.config = { isLoaded: true, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } };
    state.me = makeWasteMe({ programmeEnabled: false });
    state.request = MAIL();
    const c = await mount();
    expect(button(c, 'Đã gửi')).not.toBeNull();
    expect(button(c, 'Huỷ yêu cầu')).not.toBeNull();
    expect(byText(c, 'a', 'Sửa món')).toBeNull();
  });

  it('khách bị khoá vẫn nhập được mã vận đơn và huỷ (§15.1)', async () => {
    state.me = makeWasteMe({ blocked: true });
    state.request = MAIL();
    const c = await mount();
    expect(button(c, 'Đã gửi')).not.toBeNull();
    expect(byText(c, 'label', 'Mã vận đơn')).not.toBeNull();
    expect(button(c, 'Huỷ yêu cầu')?.disabled).toBe(false);
    expect(byText(c, 'a', 'Sửa món')).toBeNull();
  });

  it('Gửi về kho còn sửa được: có "Sửa món" (§7.4, mọi cách giao)', async () => {
    state.request = MAIL();
    const c = await mount();
    expect(byText(c, 'a', 'Sửa món')?.getAttribute('href')).toBe('/doi-rac/yeu-cau/req-1/sua');
  });
});

describe('/doi-rac/yeu-cau/[id]: Thu kèm đơn mua (§4.5b, §15.6)', () => {
  it('chưa gắn đơn: "Ghi mã này lên túi", dòng gắn đơn, liên kết đi mua hàng', async () => {
    state.request = PICKUP();
    const c = await mount();
    expect(c.textContent).toContain('Ghi mã này lên túi');
    expect(c.textContent).toContain('Gắn yêu cầu này vào đơn mua kế tiếp ở bước thanh toán');
    expect(byText(c, 'a', 'Đi mua hàng')?.getAttribute('href')).toBe('/');
    expect(c.textContent).toContain('Chờ gắn vào đơn');
  });

  it.each([
    ['khoá đường kho', () => { state.me = makeWasteMe({ shipLockedAt: '2026-10-01T00:00:00.000Z' }); }],
    ['bị khoá chương trình', () => { state.me = makeWasteMe({ blocked: true }); }],
    ['cờ pickup tắt', () => { state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: false } }; }],
    ['chương trình tắt khi cấu hình công khai cũ vẫn bật pickup', () => { state.me = makeWasteMe({ programmeEnabled: false }); }],
  ])('%s: câu tạm dừng trung tính + "Huỷ yêu cầu", không có lối đi mua hàng', async (_n, arrange) => {
    arrange();
    state.request = PICKUP();
    const c = await mount();
    expect(c.textContent).toContain('Thu kèm rác đang tạm dừng, yêu cầu này chưa gắn được vào đơn và sẽ tự hết hạn ngày 25/10');
    expect(c.textContent).not.toContain('Gắn yêu cầu này vào đơn mua kế tiếp ở bước thanh toán');
    expect(byText(c, 'a', 'Đi mua hàng')).toBeNull();
    expect(button(c, 'Huỷ yêu cầu')).not.toBeNull();
    expect(c.textContent).toContain('Đang tạm dừng');
    expect(c.textContent).not.toContain('Chờ gắn vào đơn');
  });

  it('đã gắn đơn: "Đã gắn vào đơn TUBU123", timeline ở "Chờ kho nhận"', async () => {
    state.request = PICKUP({ orderCode: 'TUBU123', orderId: 'ord-1', editable: false });
    const c = await mount();
    expect(c.textContent).toContain('Đã gắn vào đơn TUBU123');
    expect(c.querySelector('[data-step="Chờ kho nhận"]')?.getAttribute('aria-current')).toBe('step');
  });
});

describe('/doi-rac/yeu-cau/[id]: trạng thái đóng và kết quả (§4.6)', () => {
  it('REJECTED: nhãn + lý do thay timeline, có khối hỗ trợ', async () => {
    state.request = makeRequestDetail({ status: 'REJECTED', rejectionReason: 'WET', rejectionNote: 'thùng ướt', editable: false, cancellable: false });
    const c = await mount();
    expect(c.textContent).toContain('Bị từ chối');
    expect(c.textContent).toContain('Ướt: thùng ướt');
    expect(c.querySelector('ol[aria-label="Tiến độ yêu cầu"]')).toBeNull();
    expect(c.textContent).toContain('Cần hỗ trợ? Nhắn Tubu Tree');
    expect(c.querySelector('a[href^="tel:"]')?.getAttribute('href')).toBe('tel:0984606774');
    expect(c.querySelector('a[href="mailto:tubutree@gmail.com"]')).not.toBeNull();
  });

  it('khối hỗ trợ ẩn kênh còn trống', async () => {
    state.support = { hotline: null, email: null, zaloOaName: null };
    state.request = makeRequestDetail({ status: 'REJECTED', rejectionReason: 'WET', editable: false, cancellable: false });
    const c = await mount();
    expect(c.querySelector('a[href^="tel:"]')).toBeNull();
    expect(c.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it('COMPLETED: bảng có số đếm và lý do nhận thiếu; liên kết tới /doi-rac/xong/:id', async () => {
    state.request = makeRequestDetail({
      status: 'COMPLETED',
      pointsAwarded: 3000,
      editable: false,
      cancellable: false,
      lines: [{ ...makeRequestDetail().lines[0]!, receivedQty: 3, shortfallReason: 'WET', pointsAwarded: 3000 }],
    });
    const c = await mount();
    const row = byText(c.querySelector('table[aria-label="Đã khai và đã đếm"]')!, 'tr', 'Thùng carton')!;
    expect(row.textContent).toContain('3 thùng');
    expect(row.textContent).toContain('Ướt');
    expect(byText(c, 'a', 'Xem kết quả cộng điểm')?.getAttribute('href')).toBe('/doi-rac/xong/req-1');
  });

  it('404: trạng thái rỗng, dẫn về Yêu cầu của tôi', async () => {
    state.requestError = Object.assign(new Error('nf'), { status: 404 });
    const c = await mount();
    expect(c.textContent).toContain('Không tìm thấy yêu cầu');
    expect(byText(c, 'a', 'Xem yêu cầu của tôi')?.getAttribute('href')).toBe('/doi-rac/yeu-cau');
  });

  it('lỗi khác 404: câu lỗi + "Thử lại" tải lại được', async () => {
    state.requestError = new Error('Máy chủ bận');
    const c = await mount();
    expect(c.textContent).toContain('Máy chủ bận');
    state.requestError = null;
    click(button(c, 'Thử lại'));
    await flush(6);
    expect(c.textContent).toContain('Xem mã QR');
  });

  it('khách chưa đăng nhập: mời đăng nhập quay lại đúng trang, không gọi API', async () => {
    state.phase = 'guest';
    const c = await mount();
    expect(c.querySelector('a[href^="/dang-nhap"]')?.getAttribute('href')).toBe(`/dang-nhap?returnTo=${encodeURIComponent('/doi-rac/yeu-cau/req-1')}`);
    expect(state.calls.filter((x) => x.path.startsWith('/waste'))).toEqual([]);
  });

  it('phiên không khôi phục được: không gọi API đổi rác', async () => {
    state.phase = 'unavailable';
    await mount();
    expect(state.calls.filter((x) => x.path.startsWith('/waste'))).toEqual([]);
  });

  it('một h1, thứ tự heading đúng, điều khiển có tên, vùng chạm đủ 44px', async () => {
    state.request = MAIL();
    const c = await mount();
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});

describe('/doi-rac/yeu-cau/[id]: trạng thái, ước tính, tiêu đề', () => {
  const step2 = (c: HTMLElement) => c.querySelector('[data-step="Mang tới điểm"]') as HTMLElement;
  it('Mang tới + OPEN: nhãn trạng thái, bước 2 ghi điểm nhận, địa chỉ và hạn; dòng "Ước tính"', async () => {
    const c = await mount();
    expect(step2(c).textContent).toContain('Mang tới Đại lý Cô Ba trước 25/10');
    expect(step2(c).textContent).toContain('12 Lê Lợi');
    expect(c.textContent).toContain('Chờ bạn mang tới');
    expect(c.textContent).toContain('Ước tính 5.000 điểm');
  });
  it('điểm nhận tạm ngừng: bước 2 không dặn mang tới điểm đó', async () => {
    state.request = makeRequestDetail({ pointAvailable: false });
    const c = await mount();
    expect(step2(c).textContent).not.toContain('Mang tới Đại lý Cô Ba');
  });
  it('điểm hết hạn mức tháng: bước 2 không dặn mang tới điểm đó', async () => {
    const r = makeRequestDetail();
    state.request = r;
    state.points = [makeWastePoint({ id: r.point!.id, quotaFull: true })];
    const c = await mount();
    expect(c.textContent).toContain('Điểm này tạm hết hạn mức tháng này, hãy chọn điểm khác');
    expect(step2(c).textContent).not.toContain('Mang tới Đại lý Cô Ba');
  });
  it('chương trình tạm dừng: bước 2 không dặn mang tới điểm', async () => {
    state.config = { isLoaded: true, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } };
    const c = await mount();
    expect(step2(c).textContent).not.toContain('Mang tới Đại lý Cô Ba');
  });
  it('REJECTED và COMPLETED: không còn dòng "Ước tính"', async () => {
    state.request = makeRequestDetail({ status: 'REJECTED', rejectionReason: 'WET', editable: false, cancellable: false });
    let c = await mount();
    expect(c.textContent).not.toContain('Ước tính');
    mounted.pop()!.unmount();
    state.request = makeRequestDetail({ status: 'COMPLETED', pointsAwarded: 2000, editable: false, cancellable: false });
    c = await mount();
    expect(c.textContent).not.toContain('Ước tính');
  });
  it('Gửi về kho + OPEN: có dòng "Ước tính", số điện thoại người nhận nhóm 4-3-3, tiêu đề trang không lặp mã', async () => {
    state.request = MAIL({ point: makeWarehouseContact({ phone: '0984606774' }) });
    const c = await mount();
    expect(c.textContent).toContain('Ước tính 5.000 điểm');
    expect(c.textContent).toContain('0984 606 774');
    expect(c.querySelector('h1')?.textContent).toContain('Yêu cầu đổi rác');
    expect(c.textContent?.match(/TR-8K2M9/g)).toHaveLength(1);
  });
  it('Thu kèm đơn + OPEN: tiêu đề trang không lặp mã; Mang tới giữ mã ở tiêu đề', async () => {
    state.request = PICKUP();
    let c = await mount();
    expect(c.querySelector('h1')?.textContent).toContain('Yêu cầu đổi rác');
    mounted.pop()!.unmount();
    state.request = makeRequestDetail();
    c = await mount();
    expect(c.querySelector('h1')?.textContent).toContain('TR-8K2M9');
  });
});
