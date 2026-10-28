import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConfirmSheet } from './confirm-sheet';

const base = { title: 'Thu hồi quyền?', message: 'Người này sẽ mất quyền.', confirmLabel: 'Thu hồi', onConfirm: () => {}, onCancel: () => {} };

describe('ConfirmSheet', () => {
  it('hiện tiêu đề, lời nhắc và hai nút; đóng thì không hiện gì', () => {
    const { unmount } = render(<ConfirmSheet open {...base} />);
    expect(screen.getByText('Thu hồi quyền?')).toBeInTheDocument();
    expect(screen.getByText('Người này sẽ mất quyền.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thu hồi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeInTheDocument();
    unmount();
    render(<ConfirmSheet open={false} {...base} />);
    expect(screen.queryByText('Người này sẽ mất quyền.')).not.toBeInTheDocument();
  });

  it('bấm nút xác nhận gọi onConfirm, bấm Huỷ hoặc nút Đóng gọi onCancel', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmSheet open {...base} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thu hồi' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('nhãn Huỷ đổi được (vd "Giữ lời mời")', () => {
    render(<ConfirmSheet open {...base} cancelLabel="Giữ lời mời" />);
    expect(screen.getByRole('button', { name: 'Giữ lời mời' })).toBeInTheDocument();
  });

  it('tone danger tô nút xác nhận màu nguy hiểm; mặc định thì không', () => {
    const { rerender } = render(<ConfirmSheet open {...base} tone="danger" />);
    expect(screen.getByRole('button', { name: 'Thu hồi' })).toHaveStyle({ background: 'var(--color-action-danger-bg)' });
    rerender(<ConfirmSheet open {...base} />);
    expect(screen.getByRole('button', { name: 'Thu hồi' })).not.toHaveStyle({ background: 'var(--color-action-danger-bg)' });
  });

  it('đang xử lý (loading): không đóng bằng nút Huỷ, nút xác nhận không nhận thêm cú bấm', () => {
    const onConfirm = vi.fn();
    render(<ConfirmSheet open {...base} loading onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thu hồi' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
