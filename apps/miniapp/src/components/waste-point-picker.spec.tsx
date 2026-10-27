import { render, screen, fireEvent, within } from '@testing-library/react';
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
