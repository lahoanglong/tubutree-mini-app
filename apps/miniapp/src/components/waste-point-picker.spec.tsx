import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeWastePoint } from '../services/waste-test-fixtures';
import { describeNested, findNestedInteractive } from './ui/nested-interactive';

const mocks = vi.hoisted(() => ({ callPhone: vi.fn(), openExternal: vi.fn(), copyText: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ callPhone: mocks.callPhone, openExternal: mocks.openExternal }));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
import { WastePointPicker, sortWastePoints } from './waste-point-picker';

const ITEMS = [{ id: 'item-carton', name: 'Thùng carton' }, { id: 'item-milk', name: 'Vỏ hộp sữa' }];
const NEAR = makeWastePoint({ id: 'pt-near', name: 'Đại lý Gần', distanceKm: 1.24 });
const FAR = makeWastePoint({ id: 'pt-far', name: 'Kho Tubu TP.HCM', kind: 'WAREHOUSE', distanceKm: 7.5, phone: null });
const FULL = makeWastePoint({ id: 'pt-full', name: 'Đại lý Hết', quotaFull: true, distanceKm: 0.5 });
const PARTIAL = makeWastePoint({ id: 'pt-part', name: 'Đại lý Thiếu', acceptedItemIds: ['item-carton'], distanceKm: 0.3, perkText: 'Giảm 10% hoá đơn đầu' });
const MONDAY_9AM = new Date('2026-10-19T02:00:00.000Z');
const onChange = vi.fn();
const renderPicker = (over: Partial<Parameters<typeof WastePointPicker>[0]> = {}) =>
  render(<WastePointPicker points={[FAR, FULL, PARTIAL, NEAR]} value={null} onChange={onChange} items={ITEMS} selectedItemIds={['item-carton', 'item-milk']} showDistance now={MONDAY_9AM} {...over} />);

beforeEach(() => vi.clearAllMocks());

describe('WastePointPicker (§4.4, §16.1)', () => {
  it('nhóm radio có tên; nút gọi và chỉ đường nằm ngoài radio', () => {
    const { container } = renderPicker();
    const group = screen.getByRole('radiogroup', { name: 'Chọn điểm nhận' });
    expect(within(group).getAllByRole('radio')).toHaveLength(4);
    expect(findNestedInteractive(container).map(describeNested)).toEqual([]);
  });
  it('điểm nhận đủ món xếp trước, rồi theo khoảng cách; điểm thiếu món xếp sau', () => {
    expect(sortWastePoints([FAR, FULL, PARTIAL, NEAR], ['item-carton', 'item-milk']).map((p) => p.id)).toEqual(['pt-full', 'pt-near', 'pt-far', 'pt-part']);
  });
  it('chọn điểm được → onChange(id)', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('radio', { name: /Đại lý Gần/ }));
    expect(onChange).toHaveBeenCalledWith('pt-near');
  });
  it('điểm hết hạn mức: mờ, ghi "Tạm hết hạn mức tháng này", không chọn được', () => {
    renderPicker();
    const r = screen.getByRole('radio', { name: /Đại lý Hết/ });
    expect(r).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Tạm hết hạn mức tháng này')).toBeInTheDocument();
    fireEvent.click(r);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('điểm không nhận đủ món đã chọn: "Điểm này không nhận: <tên món>", không chọn được; món không nhận gạch ngang', () => {
    renderPicker();
    const r = screen.getByRole('radio', { name: /Đại lý Thiếu/ });
    expect(r).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Điểm này không nhận: Vỏ hộp sữa')).toBeInTheDocument();
    const struck = within(r).getByText('Vỏ hộp sữa');
    expect(struck.closest('s, del')).not.toBeNull();
    expect(within(r).getByText('Không nhận')).toBeInTheDocument();
    fireEvent.click(r);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('lý do khoá dài (nhiều món) được xuống dòng, không bị cắt', () => {
    const none = makeWastePoint({ id: 'pt-none', name: 'Đại lý Không', acceptedItemIds: [], distanceKm: 0.4 });
    renderPicker({ points: [none] });
    const reason = screen.getByText('Điểm này không nhận: Thùng carton, Vỏ hộp sữa');
    expect(reason.style.whiteSpace).not.toBe('nowrap');
  });
  it('thẻ khoá: chỉ radio và phần chữ bị làm mờ; lý do, Chỉ đường và Gọi giữ nguyên độ đậm', () => {
    renderPicker();
    const r = screen.getByRole('radio', { name: /Đại lý Hết/ });
    const card = r.parentElement as HTMLElement;
    expect(card.style.opacity).toBe('');
    expect((r.querySelector('[data-point-body]') as HTMLElement).style.opacity).toBe('0.55');
    for (const el of [screen.getByText('Tạm hết hạn mức tháng này'), ...within(card).getAllByRole('button').filter((b) => b !== r)]) {
      expect(el.closest('[style*="opacity"]')).toBeNull();
    }
    const open = screen.getByRole('radio', { name: /Đại lý Gần/ });
    expect((open.querySelector('[data-point-body]') as HTMLElement).style.opacity).toBe('1');
  });
  it('món nhận hiện thành chip riêng, món không nhận vẫn gạch ngang kèm "Không nhận"', () => {
    renderPicker();
    const r = screen.getByRole('radio', { name: /Đại lý Thiếu/ });
    const accepted = within(r).getByText('Thùng carton');
    expect(accepted.style.borderRadius).toBe('var(--radius-pill)');
    expect(accepted.closest('s, del')).toBeNull();
    expect(within(r).getByText('Vỏ hộp sữa').closest('s')).not.toBeNull();
  });
  it('có vị trí: "Gần nhất" ở điểm chọn được gần nhất + khoảng cách', () => {
    renderPicker();
    expect(within(screen.getByRole('radio', { name: /Đại lý Gần/ })).getByText('Gần nhất')).toBeInTheDocument();
    expect(screen.getAllByText('Gần nhất')).toHaveLength(1);
    expect(screen.getByText(/1,2 km/)).toBeInTheDocument();
  });
  it('không có vị trí: không "Gần nhất", không khoảng cách, không lỗi', () => {
    renderPicker({ showDistance: false });
    expect(screen.queryByText('Gần nhất')).toBeNull();
    expect(screen.queryByText(/ km/)).toBeNull();
  });
  it('loại điểm, địa chỉ hai cấp, đang mở', () => {
    renderPicker();
    expect(screen.getAllByText('Đại lý').length).toBeGreaterThan(0);
    expect(screen.getByText('Kho Tubu')).toBeInTheDocument();
    expect(screen.getAllByText('12 Lê Lợi, Phường Bến Thành, TP.HCM').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Đang mở, đến 18:00').length).toBe(4);
  });
  it('Chép địa chỉ chép địa chỉ điểm, không mở Google Maps; Gọi gọi số của điểm', async () => {
    mocks.copyText.mockResolvedValue(true);
    renderPicker({ points: [NEAR] });
    expect(screen.queryByRole('button', { name: 'Chỉ đường' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chép địa chỉ' }));
    expect(mocks.copyText).toHaveBeenCalledWith('12 Lê Lợi, Phường Bến Thành, TP.HCM');
    expect(await screen.findByRole('button', { name: 'Đã chép địa chỉ' })).toBeInTheDocument();
    expect(mocks.openExternal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Gọi/ }));
    expect(mocks.callPhone).toHaveBeenCalledWith('0901234567');
  });
  it('ưu đãi riêng hiện tách riêng, nói rõ không dùng Điểm Xanh (§5.6)', () => {
    renderPicker();
    const perk = screen.getByText('Ưu đãi của cửa hàng (không dùng Điểm Xanh): Giảm 10% hoá đơn đầu');
    expect(perk).toBeInTheDocument();
    expect(within(screen.getByRole('radio', { name: /Đại lý Thiếu/ })).queryByText(/Ưu đãi riêng/)).toBeNull();
  });
});

describe('WastePointPicker — món chỉ kho nhận và giờ mở cửa (B-36, B-83)', () => {
  const MILK = [{ id: 'item-carton', name: 'Thùng carton' }, { id: 'item-milk', name: 'Vỏ hộp sữa', warehouseOnly: true }];
  it('điểm đại lý bị khoá vì món chỉ kho nhận thì nói lý do rõ', () => {
    renderPicker({ items: MILK });
    const part = screen.getByRole('radio', { name: /Đại lý Thiếu/ }).closest('div')!.parentElement as HTMLElement;
    expect(within(part).getByText('Đại lý không nhận Vỏ hộp sữa, món này chỉ kho TP.HCM nhận')).toBeInTheDocument();
  });
  it('điểm đủ món (kho) không bị khoá và xếp trước', () => {
    renderPicker({ items: MILK, points: [PARTIAL, makeWastePoint({ id: 'wh', name: 'Kho X', kind: 'WAREHOUSE', acceptedItemIds: ['item-carton', 'item-milk'] })] });
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toHaveAccessibleName(/Kho X/);
    expect(radios[0]).toHaveAttribute('aria-disabled', 'false');
  });
  it('giờ mở cửa lấy từ openingHours: đang đóng ghi giờ mở lại', () => {
    const closedNow = new Date('2026-10-19T14:00:00.000Z');
    renderPicker({ now: closedNow, points: [makeWastePoint({ id: 'a', name: 'Điểm A' })] });
    expect(screen.getByText('Đang đóng, mở lại 8:00 Thứ hai')).toBeInTheDocument();
    expect(screen.queryByText(/Đang mở/)).toBeNull();
  });
  it('điểm chưa có giờ mở cửa thì không khẳng định đang đóng', () => {
    renderPicker({ points: [makeWastePoint({ id: 'a', name: 'Điểm A', openingHours: {} })] });
    expect(screen.getByText('Chưa cập nhật giờ mở cửa')).toBeInTheDocument();
    expect(screen.queryByText(/Đang đóng/)).toBeNull();
  });
});

describe('WastePointPicker — lý do khoá, bàn phím, bận, số đều (W63A)', () => {
  const radios = () => screen.getAllByRole('radio');
  const radioOf = (name: RegExp) => screen.getByRole('radio', { name });
  const stops = () => radios().filter((r) => r.getAttribute('tabindex') === '0');
  const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement as HTMLElement, { key, ...init });
  // Thứ tự hiển thị: Hết (khoá), Gần, Kho Tubu, Thiếu (khoá).

  it('ô khoá trỏ aria-describedby vào lý do khoá; ô mở thì không có', () => {
    renderPicker();
    const full = radioOf(/Đại lý Hết/);
    expect(full).toHaveAttribute('aria-describedby', 'waste-point-reason-pt-full');
    expect(full).toHaveAccessibleDescription('Tạm hết hạn mức tháng này');
    expect(document.getElementById('waste-point-reason-pt-full')).toHaveTextContent('Tạm hết hạn mức tháng này');
    const part = radioOf(/Đại lý Thiếu/);
    expect(part).toHaveAttribute('aria-describedby', 'waste-point-reason-pt-part');
    expect(part).toHaveAccessibleDescription('Điểm này không nhận: Vỏ hộp sữa');
    expect(radioOf(/Đại lý Gần/)).not.toHaveAttribute('aria-describedby');
    expect(document.getElementById('waste-point-reason-pt-near')).toBeNull();
  });

  it('roving tabindex: một điểm dừng Tab, ưu tiên ô đang chọn còn dùng được, rồi ô dùng được đầu tiên', () => {
    const { unmount } = renderPicker();
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toHaveAccessibleName(/Đại lý Gần/);
    expect(radios().filter((r) => r.getAttribute('tabindex') === '-1')).toHaveLength(3);
    unmount();
    renderPicker({ value: 'pt-far' });
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toHaveAccessibleName(/Kho Tubu TP\.HCM/);
  });

  it('ô đang chọn nhưng bị khoá không giữ điểm dừng Tab khi còn ô dùng được', () => {
    renderPicker({ value: 'pt-full' });
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toHaveAccessibleName(/Đại lý Gần/);
  });

  it('mọi ô đều khoá: vẫn có một điểm dừng Tab (ô đang chọn, không có thì ô đầu) để đọc lý do khoá', () => {
    const { unmount } = renderPicker({ points: [PARTIAL, FULL] });
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toHaveAccessibleName(/Đại lý Hết/);
    unmount();
    renderPicker({ points: [PARTIAL, FULL], value: 'pt-part' });
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toHaveAccessibleName(/Đại lý Thiếu/);
  });

  it('mũi tên xuống/phải: sang ô dùng được kế tiếp, bỏ qua ô khoá, đi vòng, và chọn ô đó', () => {
    renderPicker();
    const near = radioOf(/Đại lý Gần/);
    near.focus();
    press('ArrowDown');
    expect(radioOf(/Kho Tubu TP\.HCM/)).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('pt-far');
    press('ArrowRight');
    expect(near).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('pt-near');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('mũi tên lên/trái: lùi một ô dùng được, đi vòng từ đầu về cuối', () => {
    renderPicker();
    radioOf(/Đại lý Gần/).focus();
    press('ArrowUp');
    expect(radioOf(/Kho Tubu TP\.HCM/)).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('pt-far');
    press('ArrowLeft');
    expect(radioOf(/Đại lý Gần/)).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('pt-near');
  });

  it('ba ô dùng được: xuống đi tới ô kế, lên đi lùi ô trước, đi vòng ở hai đầu', () => {
    const mid = makeWastePoint({ id: 'pt-mid', name: 'Đại lý Giữa', distanceKm: 3 });
    renderPicker({ points: [FAR, FULL, NEAR, mid] });
    // Thứ tự: Hết (khoá), Gần, Giữa, Kho Tubu.
    radioOf(/Đại lý Gần/).focus();
    press('ArrowDown');
    expect(radioOf(/Đại lý Giữa/)).toHaveFocus();
    press('ArrowDown');
    expect(radioOf(/Kho Tubu TP\.HCM/)).toHaveFocus();
    press('ArrowDown');
    expect(radioOf(/Đại lý Gần/)).toHaveFocus();
    press('ArrowUp');
    expect(radioOf(/Kho Tubu TP\.HCM/)).toHaveFocus();
    press('ArrowUp');
    expect(radioOf(/Đại lý Giữa/)).toHaveFocus();
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['pt-mid', 'pt-far', 'pt-near', 'pt-far', 'pt-mid']);
  });

  it('Home về ô dùng được đầu, End tới ô dùng được cuối (không dừng ở ô khoá)', () => {
    renderPicker();
    radioOf(/Kho Tubu TP\.HCM/).focus();
    press('Home');
    expect(radioOf(/Đại lý Gần/)).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('pt-near');
    press('End');
    expect(radioOf(/Kho Tubu TP\.HCM/)).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('pt-far');
  });

  it('tới ô đang chọn thì chỉ chuyển tiêu điểm, không gọi onChange lần nữa', () => {
    renderPicker({ value: 'pt-far' });
    radioOf(/Đại lý Gần/).focus();
    press('End');
    expect(radioOf(/Kho Tubu TP\.HCM/)).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('phím đã xử lý thì chặn mặc định (không cuộn trang); phím khác và phím kèm Ctrl/Alt/Meta bị bỏ qua', () => {
    renderPicker();
    const near = radioOf(/Đại lý Gần/);
    near.focus();
    expect(press('ArrowDown')).toBe(false);
    near.focus();
    onChange.mockClear();
    for (const init of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect(press('ArrowDown', init)).toBe(true);
      expect(near).toHaveFocus();
    }
    expect(press('a')).toBe(true);
    expect(press('Tab')).toBe(true);
    expect(near).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('phím mũi tên ở nút Chép địa chỉ hay ở ô khoá thì không làm gì', () => {
    renderPicker();
    const copy = screen.getAllByRole('button', { name: 'Chép địa chỉ' })[0]!;
    copy.focus();
    expect(press('ArrowDown')).toBe(true);
    expect(copy).toHaveFocus();
    const full = radioOf(/Đại lý Hết/);
    full.focus();
    expect(press('ArrowDown')).toBe(true);
    expect(full).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disabled: mọi ô aria-disabled, bấm không gọi onChange, con trỏ not-allowed; điểm dừng Tab là ô đang chọn', () => {
    renderPicker({ disabled: true, value: 'pt-far' });
    for (const r of radios()) expect(r).toHaveAttribute('aria-disabled', 'true');
    const near = radioOf(/Đại lý Gần/);
    expect(near.style.cursor).toBe('not-allowed');
    fireEvent.click(near);
    expect(onChange).not.toHaveBeenCalled();
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toHaveAccessibleName(/Kho Tubu TP\.HCM/);
  });

  it('disabled: không có ô dùng được nên mũi tên không chuyển tiêu điểm và không chọn', () => {
    renderPicker({ disabled: true });
    const near = radioOf(/Đại lý Gần/);
    near.focus();
    expect(press('ArrowDown')).toBe(true);
    expect(press('End')).toBe(true);
    expect(near).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disabled: điểm dừng Tab rơi về ô đầu khi chưa chọn gì', () => {
    renderPicker({ disabled: true });
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toHaveAccessibleName(/Đại lý Hết/);
  });

  it('disabled=false hay bỏ trống: ô mở aria-disabled="false", con trỏ pointer, chọn được', () => {
    for (const over of [{}, { disabled: false }]) {
      const { unmount } = renderPicker(over);
      const near = radioOf(/Đại lý Gần/);
      expect(near).toHaveAttribute('aria-disabled', 'false');
      expect(near.style.cursor).toBe('pointer');
      fireEvent.click(near);
      expect(onChange).toHaveBeenLastCalledWith('pt-near');
      onChange.mockClear();
      unmount();
    }
  });

  it('disabled chỉ khoá việc chọn: Chép địa chỉ và Gọi vẫn dùng được', async () => {
    mocks.copyText.mockResolvedValue(true);
    renderPicker({ disabled: true, points: [NEAR] });
    fireEvent.click(screen.getByRole('button', { name: 'Chép địa chỉ' }));
    expect(mocks.copyText).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Đã chép địa chỉ' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Gọi/ }));
    expect(mocks.callPhone).toHaveBeenCalledWith('0901234567');
  });

  it('Gọi: chạm đúp trong cùng một nhịp chỉ mở cuộc gọi một lần; gọi xong thì gọi lại được', async () => {
    let finish: () => void = () => undefined;
    mocks.callPhone.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderPicker({ points: [NEAR] });
    const call = screen.getByRole('button', { name: /Gọi/ });
    act(() => {
      fireEvent.click(call);
      fireEvent.click(call);
    });
    expect(mocks.callPhone).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    fireEvent.click(call);
    expect(mocks.callPhone).toHaveBeenCalledTimes(2);
    expect(mocks.callPhone).toHaveBeenLastCalledWith('0901234567');
  });

  it('giờ mở cửa, khoảng cách và số điện thoại dùng số đều; nút Chép địa chỉ thì không', () => {
    renderPicker({ points: [NEAR] });
    expect(screen.getByText('Đang mở, đến 18:00').style.fontVariantNumeric).toBe('tabular-nums');
    expect(screen.getByText(/1,2 km/).style.fontVariantNumeric).toBe('tabular-nums');
    expect(screen.getByRole('button', { name: /Gọi/ }).style.fontVariantNumeric).toBe('tabular-nums');
    expect(screen.getByRole('button', { name: 'Chép địa chỉ' }).style.fontVariantNumeric).toBe('');
  });
});
