// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { BottomSheet, Dialog } from './bottom-sheet';

const key = (k: string, init: KeyboardEventInit = {}) => act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init })); });
const panel = () => document.querySelector<HTMLElement>('[role="dialog"]');

describe('BottomSheet', () => {
  it('đóng thì không dựng gì', () => {
    mount(<BottomSheet open={false} onClose={() => {}}>nội dung</BottomSheet>);
    expect(panel()).toBeNull();
  });

  it('mở: hộp thoại aria-modal có tên theo tiêu đề, mô tả, thân, chân; safe-area đáy chỉ ở khung ngoài', () => {
    mount(<BottomSheet open onClose={() => {}} title="Chọn mã" description="Mã còn hạn" footer={<button>Áp dụng</button>}>thân</BottomSheet>);
    const p = panel()!;
    expect(p.getAttribute('aria-modal')).toBe('true');
    expect(p.getAttribute('aria-labelledby')).toBe(p.querySelector('h2')!.id);
    expect(p.querySelector('h2')!.textContent).toBe('Chọn mã');
    expect(p.textContent).toContain('Mã còn hạn');
    expect(p.querySelector('[data-testid="bottom-sheet-body"]')!.textContent).toBe('thân');
    expect(p.textContent).toContain('Áp dụng');
    expect(p.innerHTML).not.toContain('safe-bottom');
    expect(p.parentElement!.parentElement).toBe(document.body);
  });

  it('size: auto ôm nội dung, half 50vh, full 92vh', () => {
    const m = mount(<BottomSheet open onClose={() => {}} size="half">a</BottomSheet>);
    expect(panel()!.style.height).toBe('50vh');
    m.unmount();
    mount(<BottomSheet open onClose={() => {}} size="full">a</BottomSheet>).unmount();
    mount(<BottomSheet open onClose={() => {}}>a</BottomSheet>);
    expect(panel()!.hasAttribute('data-hug')).toBe(true);
    expect(panel()!.style.height).toBe('');
  });

  it('nút Đóng, bấm nền và Esc đều gọi onClose', () => {
    const onClose = vi.fn();
    mount(<BottomSheet open onClose={onClose} title="T">a</BottomSheet>);
    click(document.querySelector('[aria-label="Đóng"]'));
    click(document.querySelector('[data-sheet-backdrop]'));
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('dismissible=false chặn nút X, nền và Esc', () => {
    const onClose = vi.fn();
    mount(<BottomSheet open onClose={onClose} dismissible={false}>a</BottomSheet>);
    expect(document.querySelector('[aria-label="Đóng"]')).toBeNull();
    click(document.querySelector('[data-sheet-backdrop]'));
    key('Escape');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('khoá cuộn trang khi mở và trả lại khi đóng; trả focus cho nút đã mở', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const m = mount(<BottomSheet open onClose={() => {}}>a</BottomSheet>);
    expect(document.body.style.overflow).toBe('hidden');
    m.unmount();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('Tab quay vòng trong sheet', () => {
    mount(<BottomSheet open onClose={() => {}} title="T" footer={<button data-last>Xong</button>}>a</BottomSheet>);
    const close = document.querySelector<HTMLElement>('[aria-label="Đóng"]')!;
    const last = document.querySelector<HTMLElement>('[data-last]')!;
    expect(document.activeElement).toBe(close);
    last.focus();
    key('Tab');
    expect(document.activeElement).toBe(close);
    close.focus();
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('hai sheet chồng nhau: Esc chỉ đóng sheet trên cùng', () => {
    const a = vi.fn();
    const b = vi.fn();
    mount(<BottomSheet open onClose={a}>a</BottomSheet>);
    mount(<BottomSheet open onClose={b}>b</BottomSheet>);
    key('Escape');
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it('tiêu đề là tiêu đề khối Inter 16/700, không phải Fraunces 18 (final-critique P2 #2)', () => {
    mount(<BottomSheet open onClose={() => {}} title="Chọn mã">a</BottomSheet>);
    const h2 = document.querySelector<HTMLElement>('[role="dialog"] h2')!;
    expect(h2.style.fontFamily).toBe('var(--font-ui)');
    expect(h2.style.fontSize).toBe('var(--type-title-sm-size)');
    expect(h2.style.fontWeight).toBe('700');
    expect(h2.style.letterSpacing).toBe('-0.01em');
  });

  it('numericTitle: tiêu đề có số đều (tabular-nums)', () => {
    mount(<BottomSheet open onClose={() => {}} title="Tiết kiệm 12%" numericTitle>a</BottomSheet>);
    expect(document.querySelector<HTMLElement>('[role="dialog"] h2')!.style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('không có numericTitle thì tiêu đề không ép số đều', () => {
    mount(<BottomSheet open onClose={() => {}} title="Tiết kiệm 12%">a</BottomSheet>);
    expect(document.querySelector<HTMLElement>('[role="dialog"] h2')!.style.fontVariantNumeric).toBe('');
  });

  it('Dialog là bí danh của BottomSheet', () => {
    expect(Dialog).toBe(BottomSheet);
  });
});
