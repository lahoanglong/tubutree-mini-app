// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { VoucherView } from '@tubutree/app-core/commerce/voucher';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { VoucherTicket } from './voucher-ticket';

const view = (patch: Partial<VoucherView> = {}): VoucherView => ({
  id: 'FUWA3E', code: 'FUWA3E', title: 'Giảm 15% (tối đa 45.000đ)', kind: 'discount', condition: 'Đơn từ 250k', expiry: 'Còn 2 ngày', state: 'collectable', ...patch,
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

  it('không điều kiện/hạn: không dòng trống, meta chỉ có mã; đủ thì "điều kiện · mã"', () => {
    const a = mount(<VoucherTicket voucher={view({ condition: '', expiry: '' })} variant="ticket" />);
    expect(q('voucher-expiry')).toBeNull();
    expect(q('voucher-meta')!.textContent).toBe('FUWA3E');
    a.unmount();
    mount(<VoucherTicket voucher={view()} variant="ticket" expiring />);
    expect(q('voucher-meta')!.textContent).toBe('Đơn từ 250k · FUWA3E');
    expect(q('voucher-expiry')!.style.color).toBe('var(--color-status-warning-fg)');
  });

  it('mã luôn là một ô không co, không cắt; điều kiện mới là phần bị cắt khi hàng hẹp', () => {
    mount(<VoucherTicket voucher={view({ condition: 'Đơn từ 500.000đ cho mọi sản phẩm', code: 'CHUADU' })} variant="ticket" primary={{ label: 'Dùng ngay', onClick: vi.fn() }} />);
    const code = q('voucher-code') as HTMLElement;
    expect(code.textContent).toBe(' · CHUADU');
    expect(code.style.flex).toBe('0 0 auto');
    expect(code.style.textOverflow).toBe('');
    expect(code.style.whiteSpace).toBe('pre');
    const cond = q('voucher-condition') as HTMLElement;
    expect(cond.style.minWidth).toBe('0px');
    expect(cond.style.textOverflow).toBe('ellipsis');
    expect(cond.style.overflow).toBe('hidden');
  });

  it('chip chỉ có tiêu đề và điều kiện: không mã; ticket và row vẫn có mã', () => {
    const a = mount(<VoucherTicket voucher={view()} variant="chip" />);
    expect(q('voucher-meta')!.textContent).toBe('Đơn từ 250k');
    expect(q('voucher-code')).toBeNull();
    a.unmount();
    const b = mount(<VoucherTicket voucher={view({ condition: '' })} variant="chip" />);
    expect(q('voucher-meta')).toBeNull();
    b.unmount();
    mount(<VoucherTicket voucher={view()} variant="row" />);
    expect(q('voucher-meta')!.textContent).toBe('Đơn từ 250k · FUWA3E');
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
