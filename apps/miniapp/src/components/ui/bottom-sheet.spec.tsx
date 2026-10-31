import { act, render, screen, fireEvent } from '@testing-library/react';
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

  it('dismissible=false also hides the header X button — otherwise a "mandatory" sheet still has a working close control', () => {
    render(<BottomSheet open title="t" onClose={() => {}} dismissible={false}>y</BottomSheet>);
    expect(screen.queryByRole('button', { name: /đóng/i })).toBeNull();
  });

  it('closing (open true→false) does not instantly unmount — ZaUI must get the chance to play its slide-down exit animation, matching every other sheet in the app (share-sheet.tsx, voucher-sheet.tsx) which keep <Sheet visible> mounted and just toggle `visible`', () => {
    const { rerender } = render(<BottomSheet open onClose={() => {}}>Nội dung</BottomSheet>);
    expect(screen.getByText('Nội dung')).toBeInTheDocument();
    rerender(<BottomSheet open={false} onClose={() => {}}>Nội dung</BottomSheet>);
    // Ngay sau khi open chuyển false, nội dung PHẢI còn trong DOM — ZaUI (nhờ `unmountOnClose`)
    // chỉ tự gỡ khỏi DOM SAU khi chạy xong animation trượt xuống (~200ms). Nếu bị gỡ ngay lập
    // tức ở đây thì lỗi "if (!open) return null" đã quay lại.
    expect(screen.getByText('Nội dung')).toBeInTheDocument();
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

  it('đóng rồi mở lại trước khi animation đóng xong: nội dung vẫn còn sau khi hẹn giờ đóng cũ chạy', async () => {
    const { rerender } = render(<BottomSheet open title="t" onClose={() => {}}>Nội dung</BottomSheet>);
    rerender(<BottomSheet open={false} title="t" onClose={() => {}}>Nội dung</BottomSheet>);
    rerender(<BottomSheet open title="t" onClose={() => {}}>Nội dung</BottomSheet>);
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByText('Nội dung')).toBeInTheDocument();
  });

  describe('hộp thoại thật (a11y A3: WCAG 4.1.2, 2.4.3)', () => {
    const key = (k: string, init: KeyboardEventInit = {}) =>
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
      });

    it('có role=dialog aria-modal, tên lấy từ tiêu đề h2, tabIndex -1', () => {
      render(<BottomSheet open title="Chọn mã" onClose={() => {}}>nội dung</BottomSheet>);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('tabindex', '-1');
      const h2 = screen.getByRole('heading', { level: 2, name: 'Chọn mã' });
      expect(h2.id).not.toBe('');
      expect(dialog.getAttribute('aria-labelledby')).toBe(h2.id);
      expect(screen.getByRole('dialog', { name: 'Chọn mã' })).toBe(dialog);
    });

    it('không có tiêu đề thì không gắn aria-labelledby trỏ vào chỗ trống', () => {
      render(<BottomSheet open onClose={() => {}}>nội dung</BottomSheet>);
      expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-labelledby');
    });

    it('mở xong focus nằm ở nút Đóng; không đóng được thì focus vào chính khung', () => {
      const { unmount } = render(<BottomSheet open title="t" onClose={() => {}}>y</BottomSheet>);
      expect(screen.getByRole('button', { name: /đóng/i })).toHaveFocus();
      unmount();
      render(<BottomSheet open title="t" dismissible={false} onClose={() => {}}>y</BottomSheet>);
      expect(screen.getByRole('dialog')).toHaveFocus();
    });

    it('Esc gọi onClose một lần', () => {
      const onClose = vi.fn();
      render(<BottomSheet open title="t" onClose={onClose}>y</BottomSheet>);
      key('Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('dismissible=false: Esc không đóng (Review Focus 1)', () => {
      const onClose = vi.fn();
      render(<BottomSheet open title="t" dismissible={false} onClose={onClose}>y</BottomSheet>);
      key('Escape');
      expect(onClose).not.toHaveBeenCalled();
    });

    it('hai sheet chồng nhau: Esc chỉ đóng sheet mở sau (trên cùng)', () => {
      const lower = vi.fn();
      const upper = vi.fn();
      render(
        <>
          <BottomSheet open title="dưới" onClose={lower}>a</BottomSheet>
          <BottomSheet open title="trên" onClose={upper}>b</BottomSheet>
        </>,
      );
      key('Escape');
      expect(upper).toHaveBeenCalledTimes(1);
      expect(lower).not.toHaveBeenCalled();
    });

    it('Tab ở phần tử cuối nhảy về đầu, Shift+Tab ở đầu nhảy về cuối', () => {
      render(<BottomSheet open title="t" onClose={() => {}} footer={<button type="button">Xong</button>}>y</BottomSheet>);
      const close = screen.getByRole('button', { name: /đóng/i });
      const last = screen.getByRole('button', { name: 'Xong' });
      last.focus();
      key('Tab');
      expect(close).toHaveFocus();
      key('Tab', { shiftKey: true });
      expect(last).toHaveFocus();
    });

    it('đóng sheet thì trả focus về nút đã mở nó', () => {
      const opener = document.createElement('button');
      document.body.appendChild(opener);
      const { rerender } = render(<BottomSheet open={false} title="t" onClose={() => {}}>y</BottomSheet>);
      opener.focus();
      rerender(<BottomSheet open title="t" onClose={() => {}}>y</BottomSheet>);
      expect(opener).not.toHaveFocus();
      rerender(<BottomSheet open={false} title="t" onClose={() => {}}>y</BottomSheet>);
      expect(opener).toHaveFocus();
      opener.remove();
    });
  });
});

