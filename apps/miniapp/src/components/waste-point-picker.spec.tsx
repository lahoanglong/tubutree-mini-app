import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeWastePoint } from '../services/waste-test-fixtures';
import { describeNested, findNestedInteractive } from './ui/nested-interactive';

const mocks = vi.hoisted(() => ({ callPhone: vi.fn(), openExternal: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ callPhone: mocks.callPhone, openExternal: mocks.openExternal }));
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
    expect(screen.getAllByText('Đang mở').length).toBe(4);
  });
  it('Chỉ đường mở Google Maps theo địa chỉ; Gọi gọi số của điểm', () => {
    renderPicker({ points: [NEAR] });
    fireEvent.click(screen.getByRole('button', { name: 'Chỉ đường' }));
    expect(mocks.openExternal).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/));
    fireEvent.click(screen.getByRole('button', { name: /Gọi/ }));
    expect(mocks.callPhone).toHaveBeenCalledWith('0901234567');
  });
  it('ưu đãi riêng hiện tách riêng, nói rõ cửa hàng tự chịu và Tubu không đảm bảo (§5.6)', () => {
    renderPicker();
    const perk = screen.getByText('Ưu đãi riêng của cửa hàng (cửa hàng tự chịu, không qua Điểm Xanh, Tubu không đảm bảo): Giảm 10% hoá đơn đầu');
    expect(perk).toBeInTheDocument();
    expect(within(screen.getByRole('radio', { name: /Đại lý Thiếu/ })).queryByText(/Ưu đãi riêng/)).toBeNull();
  });
});
