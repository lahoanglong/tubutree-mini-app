// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';
import { WAREHOUSE_DESK, makeDeskPoint } from './recycle-fixtures';

// Cùng ý nghĩa waste-desk-perk.spec.tsx của Mini App: thẻ ưu đãi là vùng có tên, khoá khi đang gửi duyệt, lỗi hiện ngay trong sheet,
// báo cáo tháng có vùng, số đều, lỗi role="alert" và nút Thử lại khoá khi đang tải lại.

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
// Bọc Sheet để đọc props mới nhất: `dismissible=false` và ô/nút `disabled` đã chặn mọi thao tác thật,
// nên chỉ gọi thẳng onClose mới chứng minh được guard trong WasteDeskPerk.
const sheetSpy = vi.hoisted(() => ({ last: null as null | { open: boolean; dismissible?: boolean; onClose: () => void } }));
vi.mock('@/components/ui/sheet', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui/sheet')>();
  return {
    ...orig,
    Sheet: (p: Parameters<typeof orig.Sheet>[0]) => {
      sheetSpy.last = p;
      return <orig.Sheet {...p} />;
    },
  };
});
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, put: mocks.put, post: vi.fn(), patch: vi.fn() } }));

import { WasteDeskPerk, WasteDeskReport, vnMonthKey } from './recycle-desk-perk';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const REPORT = { pointId: 'pt-1', month: '2026-10', confirmations: 12, pointsAwarded: 120_000, quotaUsed: 120_000, units: [{ itemId: 'item-carton', itemName: 'Thùng carton', unitLabel: 'thùng', qty: 80 }] };
const FAIL = new ApiError('Bạn không phải chủ điểm', 403);

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement, qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) => {
  const r = render(ui, qc);
  mounted.push(r);
  return { ...r, qc };
};
const body = () => document.body;
const btn = (name: string) => byText(body(), 'button', name) as HTMLButtonElement;
const input = () => (byText(body(), 'label', 'Nội dung ưu đãi') as HTMLLabelElement).control as HTMLInputElement;
const sheetOpen = () => body().querySelector('[role="dialog"]') !== null;
const alerts = () => Array.from(body().querySelectorAll<HTMLElement>('[role="alert"]'));
const statuses = () => Array.from(body().querySelectorAll<HTMLElement>('[role="status"]'));
const sectionOf = (name: string) => body().querySelector<HTMLElement>(`section[aria-label="${name}"]`);
// Nút/ô `disabled` đã chặn mọi lượt bấm thật; chỉ gọi thẳng handler trong props React mới chứng minh được guard của component.
const reactProps = (el: Element) => {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'))!;
  return (el as unknown as Record<string, { onClick?: () => void; onChange?: (e: { target: { value: string } }) => void }>)[key]!;
};
const openSheet = async () => {
  click(btn('Chỉnh sửa'));
  await flush(3);
};
const type = (text: string) => typeInto(input(), text);

beforeEach(() => {
  sheetSpy.last = null;
  mocks.get.mockReset();
  mocks.put.mockReset().mockResolvedValue(makeDeskPoint({ perkPendingText: 'Tặng túi vải' }));
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('vnMonthKey (web)', () => {
  it('tháng theo giờ VN, kể cả khi máy ở UTC', () => {
    expect(vnMonthKey(new Date('2026-10-31T17:30:00.000Z'))).toBe('2026-11');
    expect(vnMonthKey(new Date('2026-10-31T16:59:00.000Z'))).toBe('2026-10');
  });
});

describe('WasteDeskPerk (web): vùng có tên và khoá "Chỉnh sửa"', () => {
  it('thẻ là vùng tên "Ưu đãi riêng của cửa hàng" bọc cả nút Chỉnh sửa; kho thì không vẽ gì', () => {
    const first = mount(<WasteDeskPerk point={makeDeskPoint()} />);
    const section = sectionOf('Ưu đãi riêng của cửa hàng')!;
    expect(section.textContent).toContain('Giảm 10% hoá đơn đầu');
    expect(section.contains(btn('Chỉnh sửa'))).toBe(true);
    first.unmount();
    const warehouse = mount(<WasteDeskPerk point={WAREHOUSE_DESK} />);
    expect(warehouse.container.innerHTML).toBe('');
  });
  it('"Chỉnh sửa" chỉ với OWNER', () => {
    mount(<WasteDeskPerk point={makeDeskPoint({ myRole: 'STAFF' })} />);
    expect(byText(body(), 'button', 'Chỉnh sửa')).toBeNull();
  });
  it('nút "Chỉnh sửa" không bị disabled (giữ focus bàn phím); bấm khi sheet đang mở không nạp lại chữ, đóng sheet rồi bấm thì mở lại', async () => {
    mount(<WasteDeskPerk point={makeDeskPoint()} />);
    expect(btn('Chỉnh sửa').disabled).toBe(false);
    await openSheet();
    expect(btn('Chỉnh sửa').disabled).toBe(false);
    type('Quà đang gõ');
    click(btn('Chỉnh sửa'));
    await flush(3);
    expect(sheetOpen()).toBe(true);
    expect(input().value).toBe('Quà đang gõ');
    act(() => sheetSpy.last!.onClose());
    await flush(3);
    expect(sheetOpen()).toBe(false);
    await openSheet();
    expect(input().value).toBe('Giảm 10% hoá đơn đầu');
  });
  it('mở sheet nạp sẵn nội dung đang chờ duyệt, nếu không có thì nội dung hiện tại', async () => {
    const first = mount(<WasteDeskPerk point={makeDeskPoint({ perkPendingText: 'Tặng túi vải' })} />);
    await openSheet();
    expect(input().value).toBe('Tặng túi vải');
    first.unmount();
    mount(<WasteDeskPerk point={makeDeskPoint({ perkText: null })} />);
    await openSheet();
    expect(input().value).toBe('');
  });
  it('đang chờ duyệt thì hiện dòng "Đang chờ Tubu duyệt"; chưa có ưu đãi thì hiện "Chưa có ưu đãi"', () => {
    const first = mount(<WasteDeskPerk point={makeDeskPoint({ perkPendingText: 'Tặng túi vải' })} />);
    expect(body().textContent).toContain('Đang chờ Tubu duyệt: Tặng túi vải');
    first.unmount();
    mount(<WasteDeskPerk point={makeDeskPoint({ perkText: null })} />);
    expect(body().textContent).toContain('Chưa có ưu đãi');
    expect(body().textContent).not.toContain('Đang chờ Tubu duyệt');
  });
  it('ô nhập giới hạn 200 ký tự', async () => {
    mount(<WasteDeskPerk point={makeDeskPoint()} />);
    await openSheet();
    expect(input().maxLength).toBe(200);
  });
});

describe('WasteDeskPerk (web): đang gửi duyệt', () => {
  it('khoá ô nhập, nút Gửi duyệt báo bận, sheet không đóng được; xong thì đóng và báo; "Chỉnh sửa" xoá thông báo cũ', async () => {
    const send = deferred<unknown>();
    mocks.put.mockReturnValue(send.promise);
    const { qc } = mount(<WasteDeskPerk point={makeDeskPoint()} />);
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await openSheet();
    expect(input().disabled).toBe(false);
    expect(sheetSpy.last!.dismissible).toBe(true);
    expect(btn('Gửi duyệt').hasAttribute('aria-busy')).toBe(false);
    expect(btn('Gửi duyệt').hasAttribute('aria-disabled')).toBe(false);
    type('Tặng túi vải');
    click(btn('Gửi duyệt'));
    await flush(3);
    expect(mocks.put).toHaveBeenCalledWith('/waste/desk/points/pt-1/perk', { perkText: 'Tặng túi vải' });
    expect(btn('Gửi duyệt').getAttribute('aria-busy')).toBe('true');
    expect(btn('Gửi duyệt').getAttribute('aria-disabled')).toBe('true');
    expect(btn('Gửi duyệt').disabled).toBe(false);
    expect(input().disabled).toBe(true);
    expect(sheetSpy.last!.dismissible).toBe(false);
    expect(btn('Chỉnh sửa').disabled).toBe(false);

    click(btn('Gửi duyệt'));
    await flush(3);
    expect(mocks.put).toHaveBeenCalledTimes(1);

    await act(async () => send.resolve(makeDeskPoint({ perkPendingText: 'Tặng túi vải' })));
    await flush(4);
    expect(sheetOpen()).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['waste', 'desk'] });
    expect(statuses().map((s) => s.textContent)).toEqual(['Đã gửi, chờ Tubu duyệt']);
    expect(btn('Chỉnh sửa').disabled).toBe(false);
    click(btn('Chỉnh sửa'));
    await flush(3);
    expect(statuses()).toHaveLength(0);
  });
  it('handler gọi thẳng (qua mặt nút khoá) bị bỏ qua: không đóng sheet, không đổi chữ, không gửi lần hai', async () => {
    const send = deferred<unknown>();
    mocks.put.mockReturnValue(send.promise);
    mount(<WasteDeskPerk point={makeDeskPoint()} />);
    await openSheet();
    type('Tặng túi vải');
    click(btn('Gửi duyệt'));
    await flush(3);
    expect(sheetSpy.last!.dismissible).toBe(false);

    await act(async () => {
      sheetSpy.last!.onClose();
      reactProps(input()).onChange?.({ target: { value: 'Chữ khác' } });
      reactProps(btn('Gửi duyệt')).onClick?.();
      reactProps(btn('Gửi duyệt')).onClick?.();
      reactProps(btn('Chỉnh sửa')).onClick?.();
    });
    await flush(3);
    expect(sheetOpen()).toBe(true);
    expect(input().value).toBe('Tặng túi vải');
    expect(sheetSpy.last!.dismissible).toBe(false);
    expect(mocks.put).toHaveBeenCalledTimes(1);

    await act(async () => send.resolve(makeDeskPoint()));
    await flush(4);
    expect(sheetOpen()).toBe(false);
  });
  it('rảnh thì onClose đóng sheet và onChange đổi chữ', async () => {
    mount(<WasteDeskPerk point={makeDeskPoint()} />);
    await openSheet();
    act(() => reactProps(input()).onChange?.({ target: { value: 'Quà mới' } }));
    expect(input().value).toBe('Quà mới');
    act(() => sheetSpy.last!.onClose());
    await flush(3);
    expect(sheetOpen()).toBe(false);
  });
  it('onClick của Gửi duyệt bị bỏ qua khi chữ rỗng hoặc có chữ trả tiền mặt; chữ hợp lệ thì gửi đúng một lần', async () => {
    mount(<WasteDeskPerk point={makeDeskPoint()} />);
    await openSheet();
    type('   ');
    expect(btn('Gửi duyệt').disabled).toBe(true);
    await act(async () => reactProps(btn('Gửi duyệt')).onClick?.());
    type('Tặng 10k cho khách');
    await act(async () => reactProps(btn('Gửi duyệt')).onClick?.());
    expect(mocks.put).not.toHaveBeenCalled();
    type('  Tặng túi vải  ');
    await act(async () => reactProps(btn('Gửi duyệt')).onClick?.());
    await flush(3);
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(mocks.put).toHaveBeenCalledWith('/waste/desk/points/pt-1/perk', { perkText: 'Tặng túi vải' });
  });
  it('chữ trả/thưởng tiền mặt: báo lỗi ngay, khoá nút Gửi duyệt, không gọi API', async () => {
    mount(<WasteDeskPerk point={makeDeskPoint()} />);
    await openSheet();
    type('Tặng 10k cho khách');
    expect(alerts().map((a) => a.textContent).join('')).toContain('Zalo không cho phép');
    expect(btn('Gửi duyệt').disabled).toBe(true);
    click(btn('Gửi duyệt'));
    expect(mocks.put).not.toHaveBeenCalled();
    type('Giảm 10k đơn từ 100k, tặng túi vải');
    expect(alerts()).toHaveLength(0);
    expect(btn('Gửi duyệt').disabled).toBe(false);
  });
});

describe('WasteDeskPerk (web): gửi lỗi', () => {
  it('lỗi hiện bằng role="alert" ngay trong sheet; sheet vẫn mở, hết bận, chữ còn nguyên', async () => {
    mocks.put.mockRejectedValue(FAIL);
    mount(<WasteDeskPerk point={makeDeskPoint()} />);
    await openSheet();
    expect(alerts()).toHaveLength(0);
    type('Tặng túi vải');
    click(btn('Gửi duyệt'));
    await flush(6);
    expect(alerts().map((a) => a.textContent)).toEqual(['Bạn không phải chủ điểm']);
    expect(alerts()[0]!.tagName).toBe('P');
    expect(body().querySelector('[role="dialog"]')!.contains(alerts()[0]!)).toBe(true);
    expect(sheetSpy.last!.dismissible).toBe(true);
    expect(input().disabled).toBe(false);
    expect(input().value).toBe('Tặng túi vải');
    expect(btn('Gửi duyệt').hasAttribute('aria-busy')).toBe(false);
  });
  it('sửa chữ sau lỗi: lời lỗi cũ biến mất', async () => {
    mocks.put.mockRejectedValue(FAIL);
    mount(<WasteDeskPerk point={makeDeskPoint()} />);
    await openSheet();
    type('Tặng túi vải');
    click(btn('Gửi duyệt'));
    await flush(6);
    expect(alerts()).toHaveLength(1);
    type('Tặng túi vải xanh');
    expect(alerts()).toHaveLength(0);
  });
  it('đóng sheet rồi mở lại bằng "Chỉnh sửa": lời lỗi cũ biến mất', async () => {
    mocks.put.mockRejectedValue(FAIL);
    mount(<WasteDeskPerk point={makeDeskPoint()} />);
    await openSheet();
    type('Tặng túi vải');
    click(btn('Gửi duyệt'));
    await flush(6);
    expect(alerts()).toHaveLength(1);
    act(() => sheetSpy.last!.onClose());
    await flush(3);
    expect(sheetOpen()).toBe(false);
    await openSheet();
    expect(alerts()).toHaveLength(0);
  });
  it('gửi lại sau lỗi: lời lỗi cũ biến mất lúc đang gửi', async () => {
    mocks.put.mockRejectedValueOnce(FAIL);
    mount(<WasteDeskPerk point={makeDeskPoint()} />);
    await openSheet();
    type('Tặng túi vải');
    click(btn('Gửi duyệt'));
    await flush(6);
    expect(alerts()).toHaveLength(1);
    const again = deferred<unknown>();
    mocks.put.mockReturnValue(again.promise);
    click(btn('Gửi duyệt'));
    await flush(3);
    expect(alerts()).toHaveLength(0);
    await act(async () => again.resolve(makeDeskPoint()));
    await flush(4);
    expect(sheetOpen()).toBe(false);
  });
});

describe('WasteDeskReport (web): vùng, số đều, lỗi và nút Thử lại', () => {
  it('có số liệu: vùng tên "Báo cáo tháng này"; ba dòng số dùng số đều, nhãn thì không', async () => {
    mocks.get.mockResolvedValue(REPORT);
    mount(<WasteDeskReport pointId="pt-1" />);
    await flush(6);
    const section = sectionOf('Báo cáo tháng này')!;
    expect(section).not.toBeNull();
    expect(byText(section, 'p', '12 lượt xác nhận')!.className).toContain('tabular-nums');
    expect(byText(section, 'p', 'Tubu đã cộng 120.000 điểm cho khách')!.className).toContain('tabular-nums');
    expect(byText(section, 'p', 'Thùng carton: 80 thùng')!.className).toContain('tabular-nums');
    expect(Array.from(section.querySelectorAll('p')).find((p) => p.textContent === 'Báo cáo tháng này')!.className).not.toContain('tabular-nums');
    expect(alerts()).toHaveLength(0);
  });
  it('chưa có số liệu và chưa lỗi: không vẽ gì', async () => {
    mocks.get.mockReturnValue(new Promise(() => undefined));
    const { container } = mount(<WasteDeskReport pointId="pt-1" />);
    await flush(3);
    expect(container.innerHTML).toBe('');
  });
  it('báo cáo lỗi: vùng cùng tên, lời báo là role="alert", nút Thử lại dùng được', async () => {
    mocks.get.mockRejectedValue(new Error('x'));
    mount(<WasteDeskReport pointId="pt-1" />);
    await flush(6);
    expect(alerts().map((a) => a.textContent)).toEqual(['Chưa tải được báo cáo']);
    expect(alerts()[0]!.tagName).toBe('P');
    expect(sectionOf('Báo cáo tháng này')!.contains(alerts()[0]!)).toBe(true);
    expect(btn('Thử lại').hasAttribute('aria-disabled')).toBe(false);
    expect(btn('Thử lại').hasAttribute('aria-busy')).toBe(false);
  });
  it('lỗi lần đầu rồi bấm Thử lại: thẻ lỗi vẫn còn, nút báo bận mà vẫn giữ focus được, bấm thêm hay gọi thẳng onClick không tải lần hai; xong thì ra số liệu', async () => {
    mocks.get.mockRejectedValueOnce(new Error('x'));
    mount(<WasteDeskReport pointId="pt-1" />);
    await flush(6);
    expect(alerts()).toHaveLength(1);
    const slow = deferred<typeof REPORT>();
    mocks.get.mockReturnValue(slow.promise);
    click(btn('Thử lại'));
    await flush(3);
    expect(btn('Thử lại').getAttribute('aria-busy')).toBe('true');
    expect(btn('Thử lại').getAttribute('aria-disabled')).toBe('true');
    expect(btn('Thử lại').disabled).toBe(false);
    expect(alerts()).toHaveLength(1);
    expect(sectionOf('Báo cáo tháng này')).not.toBeNull();
    expect(mocks.get).toHaveBeenCalledTimes(2);

    click(btn('Thử lại'));
    await act(async () => {
      reactProps(btn('Thử lại')).onClick?.();
    });
    expect(mocks.get).toHaveBeenCalledTimes(2);

    await act(async () => slow.resolve({ ...REPORT, confirmations: 3 }));
    await flush(4);
    expect(body().textContent).toContain('3 lượt xác nhận');
    expect(alerts()).toHaveLength(0);
  });
  it('đã có số liệu mà tải lại lỗi: Thử lại khoá và báo bận khi đang tải, gọi thẳng onClick không tải lần hai', async () => {
    mocks.get.mockResolvedValueOnce(REPORT);
    const { qc } = mount(<WasteDeskReport pointId="pt-1" />);
    await flush(6);
    mocks.get.mockRejectedValueOnce(new Error('x'));
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['waste', 'desk'] });
    });
    await flush(3);
    expect(alerts()).toHaveLength(1);
    expect(mocks.get).toHaveBeenCalledTimes(2);

    const slow = deferred<typeof REPORT>();
    mocks.get.mockReturnValue(slow.promise);
    click(btn('Thử lại'));
    await flush(3);
    expect(btn('Thử lại').getAttribute('aria-disabled')).toBe('true');
    expect(btn('Thử lại').disabled).toBe(false);
    expect(btn('Thử lại').getAttribute('aria-busy')).toBe('true');
    expect(alerts()).toHaveLength(1);
    expect(mocks.get).toHaveBeenCalledTimes(3);

    await act(async () => {
      reactProps(btn('Thử lại')).onClick?.();
      reactProps(btn('Thử lại')).onClick?.();
    });
    expect(mocks.get).toHaveBeenCalledTimes(3);

    await act(async () => slow.resolve({ ...REPORT, confirmations: 15 }));
    await flush(4);
    expect(body().textContent).toContain('15 lượt xác nhận');
    expect(alerts()).toHaveLength(0);
  });
});
