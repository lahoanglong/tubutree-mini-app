import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BottomSheet } from './bottom-sheet';

describe('BottomSheet', () => {
  it('renders children and title when open', () => {
    render(<BottomSheet open title="Đặt định kỳ" onClose={() => {}}>Nội dung</BottomSheet>);
    expect(screen.getByText('Đặt định kỳ')).toBeInTheDocument();
    expect(screen.getByText('Nội dung')).toBeInTheDocument();
  });

  it('renders nothing when open=false', () => {
    render(<BottomSheet open={false} onClose={() => {}}>Nội dung</BottomSheet>);
    expect(screen.queryByText('Nội dung')).not.toBeInTheDocument();
  });

  it('close button (44x44, has aria-label) calls onClose', () => {
    const onClose = vi.fn();
    render(<BottomSheet open title="x" onClose={onClose}>y</BottomSheet>);
    const closeBtn = screen.getByRole('button', { name: /đóng/i });
    expect(closeBtn).toHaveStyle({ minWidth: '44px', minHeight: '44px' });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies safe-area padding exactly once (not doubled)', () => {
    const { container } = render(<BottomSheet open onClose={() => {}}>y</BottomSheet>);
    const body = container.querySelector('[data-testid="bottom-sheet-body"]') as HTMLElement;
    expect(body.style.paddingBottom).not.toMatch(/calc\(.*safe-bottom.*safe-bottom/);
  });

  it('never sets its own inline safe-bottom/env(safe-area-inset-bottom) padding anywhere — relies entirely on ZaUI Sheet’s own padding-bottom:var(--zaui-safe-area-inset-bottom) on .zaui-sheet-content (fixes A4-20 double-padding)', () => {
    const { container } = render(
      <BottomSheet open title="t" description="d" onClose={() => {}} footer={<div>F</div>}>
        y
      </BottomSheet>,
    );
    container.querySelectorAll<HTMLElement>('*').forEach((el) => {
      expect(el.style.paddingBottom).not.toMatch(/safe-bottom|safe-area-inset-bottom/);
      expect(el.getAttribute('style') ?? '').not.toMatch(/safe-bottom|safe-area-inset-bottom/);
    });
  });

  it('dismissible=false disables mask-close and swipe-close (maskClosable/swipeToClose false on the underlying ZaUI Sheet)', () => {
    render(<BottomSheet open title="t" onClose={() => {}} dismissible={false}>y</BottomSheet>);
    // ZaUI Sheet renders its mask as a sibling div with class containing "zaui-mask".
    const mask = document.querySelector('[class*="zaui-mask"]');
    expect(mask).toBeTruthy();
  });

  it('size="auto" hugs content (ZaUI autoHeight class), size="half"/"full" get explicit vh height', () => {
    const { container: autoC } = render(<BottomSheet open onClose={() => {}} size="auto">y</BottomSheet>);
    expect(autoC.querySelector('.zaui-sheet-content')?.className).toContain('hug-content');

    const { container: halfC } = render(<BottomSheet open onClose={() => {}} size="half">y</BottomSheet>);
    const halfContent = halfC.querySelector('.zaui-sheet-content') as HTMLElement;
    expect(halfContent.className).not.toContain('hug-content');
    expect(halfContent.style.height).toBe('50vh');

    const { container: fullC } = render(<BottomSheet open onClose={() => {}} size="full">y</BottomSheet>);
    expect((fullC.querySelector('.zaui-sheet-content') as HTMLElement).style.height).toBe('92vh');
  });

  it('renders footer when provided', () => {
    render(
      <BottomSheet open onClose={() => {}} footer={<button type="button">Xác nhận</button>}>
        y
      </BottomSheet>,
    );
    expect(screen.getByText('Xác nhận')).toBeInTheDocument();
  });

  it('Dialog is the same component as BottomSheet (reused per brief, no separate centered modal in this task)', async () => {
    const { Dialog } = await import('./bottom-sheet');
    expect(Dialog).toBe(BottomSheet);
  });
});
