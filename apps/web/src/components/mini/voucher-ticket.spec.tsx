// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { VoucherView } from '@tubutree/app-core/commerce/voucher';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { VoucherTicket } from './voucher-ticket';

const view = (patch: Partial<VoucherView> = {}): VoucherView => ({
  id: 'FUWA3E', code: 'FUWA3E', title: 'Giảm 15% (tối đa 45.000đ)', kind: 'discount', condition: 'Đơn từ 250k', expiry: 'Còn 2 ngày', name: null, quota: null, state: 'collectable', ...patch,
});
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'));

describe('VoucherTicket (web)', () => {
  it.each(['collectable', 'saved'] as const)('%s: đúng một nút chính, bấm gọi onClick một lần', (state) => {
    const onClick = vi.fn();
    mount(<VoucherTicket voucher={view({ state })} variant="ticket" primary={{ label: 'Dùng ngay', onClick }} />);
    expect(buttons()).toHaveLength(1);
    click(buttons()[0]!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['used', 'Đã dùng'],
    ['expired', 'Đã hết hạn'],
    ['soldout', 'Đã hết lượt'],
  ] as const)('%s: không nút dù truyền primary, có dấu "%s"', (state, stamp) => {
    mount(<VoucherTicket voucher={view({ state })} variant="ticket" primary={{ label: 'Dùng ngay', onClick: vi.fn() }} />);
    expect(buttons()).toHaveLength(0);
    expect(q('voucher-stamp')!.textContent).toBe(stamp);
    expect(document.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe(`Giảm 15% (tối đa 45.000đ), ${stamp}`);
  });

  it('ineligible: aria-disabled, mô tả bằng reason, bấm không gọi; busy: aria-busy và không gọi', () => {
    const onClick = vi.fn();
    const a = mount(<VoucherTicket voucher={view({ state: 'ineligible' })} variant="ticket" reason="Mua thêm 50k để dùng" primary={{ label: 'Dùng ngay', onClick }} />);
    const btn = buttons()[0]!;
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(btn.getAttribute('aria-describedby')!)!.textContent).toBe('Mua thêm 50k để dùng');
    click(btn);
    a.unmount();
    mount(<VoucherTicket voucher={view()} variant="ticket" primary={{ label: 'Lưu mã', onClick, busy: true }} />);
    const busy = buttons()[0]!;
    expect(busy.getAttribute('aria-busy')).toBe('true');
    click(busy);
    click(busy);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ineligible không có reason: điều kiện chỉ hiện một lần, không dòng lý do lặp, nút mô tả bằng dòng điều kiện', () => {
    for (const variant of ['ticket', 'row'] as const) {
      const a = mount(<VoucherTicket voucher={view({ state: 'ineligible' })} variant={variant} primary={{ label: 'Dùng ngay', onClick: vi.fn() }} />);
      expect(q('voucher-reason')).toBeNull();
      expect(document.body.textContent!.split('Đơn từ 250k')).toHaveLength(2);
      const btn = buttons()[0]!;
      expect(document.getElementById(btn.getAttribute('aria-describedby')!)!.textContent).toContain('Đơn từ 250k');
      a.unmount();
    }
  });

  it('không điều kiện/hạn: không dòng trống, meta chỉ có mã; đủ thì "điều kiện · mã"', () => {
    const a = mount(<VoucherTicket voucher={view({ condition: '', expiry: '' })} variant="ticket" />);
    expect(q('voucher-expiry')).toBeNull();
    expect(q('voucher-meta')!.textContent).toBe('FUWA3E');
    a.unmount();
    mount(<VoucherTicket voucher={view()} variant="ticket" expiring />);
    expect(q('voucher-meta')!.textContent).toBe('Đơn từ 250k · FUWA3E');
    expect(q('voucher-expiry')!.style.color).toBe('var(--color-status-warning-fg)');
  });

  it('ticket và row: mã là một khối không ngắt giữa chừng, meta không nowrap/ellipsis (hẹp thì xuống dòng, không cắt điều kiện hay mã)', () => {
    mount(<VoucherTicket voucher={view({ condition: 'Đơn từ 500k', code: 'CHUADU' })} variant="ticket" primary={{ label: 'Dùng ngay', onClick: vi.fn() }} />);
    const code = q('voucher-code') as HTMLElement;
    expect(code.textContent).toBe('CHUADU');
    expect(code.style.whiteSpace).toBe('nowrap');
    const meta = q('voucher-meta') as HTMLElement;
    expect(meta.textContent).toBe('Đơn từ 500k · CHUADU');
    expect(meta.style.whiteSpace).toBe('');
    expect(meta.style.textOverflow).toBe('');
  });

  it('chip chỉ có tiêu đề và điều kiện: không mã; ticket và row vẫn có mã', () => {
    const a = mount(<VoucherTicket voucher={view()} variant="chip" />);
    expect(q('voucher-meta')!.textContent).toBe('Đơn từ 250k');
    expect(q('voucher-meta')!.style.whiteSpace).toBe('nowrap');
    expect(q('voucher-meta')!.style.textOverflow).toBe('ellipsis');
    expect(q('voucher-code')).toBeNull();
    a.unmount();
    const b = mount(<VoucherTicket voucher={view({ condition: '' })} variant="chip" />);
    expect(q('voucher-meta')).toBeNull();
    b.unmount();
    mount(<VoucherTicket voucher={view()} variant="row" />);
    expect(q('voucher-meta')!.textContent).toBe('Đơn từ 250k · FUWA3E');
  });

  it('tên admin đặt đứng đầu dòng meta, trước điều kiện và mã; chỉ có tên và mã thì không dấu "·" thừa; chip không vẽ tên', () => {
    const a = mount(<VoucherTicket voucher={view({ name: 'Chào bạn mới' })} variant="ticket" />);
    expect(q('voucher-meta')!.textContent).toBe('Chào bạn mới · Đơn từ 250k · FUWA3E');
    a.unmount();
    const b = mount(<VoucherTicket voucher={view({ name: 'Chào bạn mới', condition: '' })} variant="row" />);
    expect(q('voucher-meta')!.textContent).toBe('Chào bạn mới · FUWA3E');
    b.unmount();
    mount(<VoucherTicket voucher={view({ name: 'Chào bạn mới' })} variant="chip" />);
    expect(q('voucher-meta')!.textContent).toBe('Đơn từ 250k');
  });

  it('quota "Còn 3 lượt" nằm sau dòng hạn, tông cảnh báo; không vẽ ở chip hay mã không còn nhận được', () => {
    const a = mount(<VoucherTicket voucher={view({ quota: 'Còn 3 lượt' })} variant="ticket" />);
    const quota = q('voucher-quota')!;
    expect(quota.textContent).toBe('Còn 3 lượt');
    expect(q('voucher-expiry')!.compareDocumentPosition(quota) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(quota.style.color).toBe('var(--color-status-warning-fg)');
    a.unmount();
    const b = mount(<VoucherTicket voucher={view({ quota: 'Còn 3 lượt' })} variant="chip" />);
    expect(q('voucher-quota')).toBeNull();
    b.unmount();
    mount(<VoucherTicket voucher={view({ quota: 'Còn 3 lượt', state: 'soldout' })} variant="ticket" />);
    expect(q('voucher-quota')).toBeNull();
  });

  it('onDetail: thân là nút anh em của nút chính, không lồng, bấm thân không gọi primary', () => {
    const onDetail = vi.fn();
    const onClick = vi.fn();
    const m = mount(<VoucherTicket voucher={view()} variant="ticket" onDetail={onDetail} primary={{ label: 'Lưu mã', onClick }} />);
    expect(m.container.querySelector('button button')).toBeNull();
    expect(buttons()).toHaveLength(2);
    click(q('voucher-body'));
    expect(onDetail).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('cuống ba loại đúng biến màu, đã dùng cuống xám, icon aria-hidden', () => {
    const want: Record<string, string> = { discount: 'var(--color-voucher-stub-bg)', freeship: 'var(--color-voucher-ship-bg)', shop: 'var(--color-voucher-shop-stub-bg)' };
    for (const kind of ['discount', 'freeship', 'shop'] as const) {
      const m = mount(<VoucherTicket voucher={view({ kind })} variant="ticket" />);
      expect(q('voucher-stub')!.style.background).toBe(want[kind]);
      expect(q('voucher-stub')!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
      m.unmount();
    }
    mount(<VoucherTicket voucher={view({ state: 'used' })} variant="ticket" />);
    expect(q('voucher-stub')!.style.background).toBe('var(--color-bg-chip)');
  });

  it('chiều cao ba biến thể và vùng chạm 44px của mọi nút', () => {
    const mins: Record<string, string> = { ticket: '88px', chip: '44px', row: '56px' };
    for (const variant of ['ticket', 'chip', 'row'] as const) {
      const m = mount(<VoucherTicket voucher={view()} variant={variant} onDetail={() => {}} primary={{ label: 'Lưu', onClick: vi.fn() }} />);
      expect((m.container.firstElementChild as HTMLElement).style.minHeight).toBe(mins[variant]);
      for (const b of buttons()) expect(b.className.includes('tubu-hit-44') || b.style.minHeight === '44px').toBe(true);
      m.unmount();
    }
  });
});
