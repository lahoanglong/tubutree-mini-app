import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div data-testid="sheet">{children}</div> : null),
}));

import { NewSectionSheet } from './new-section-sheet';

afterEach(cleanup);

describe('NewSectionSheet', () => {
  it('đóng thì không dựng gì; mở lại là một biểu mẫu mới, tên gợi ý của kiểu Lưới', () => {
    const view = render(<NewSectionSheet open={false} onClose={() => {}} pending={false} onCreate={() => {}} />);
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    view.rerender(<NewSectionSheet open onClose={() => {}} pending={false} onCreate={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Tên khối' })).toHaveValue('Gợi ý của mình');
    expect(within(screen.getByRole('radiogroup', { name: 'Kiểu hiển thị' })).getAllByRole('radio')).toHaveLength(4);
  });

  it('bấm "Tạo và thêm món" đưa body đúng kiểu cho API (Danh sách: kind NORMAL, layout STACK)', () => {
    const onCreate = vi.fn();
    render(<NewSectionSheet open onClose={() => {}} pending={false} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('radio', { name: /Danh sách/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tạo và thêm món' }));
    expect(onCreate).toHaveBeenCalledWith({ title: 'Ba món mình chọn', kind: 'NORMAL', layout: 'STACK' });
  });

  it('đang tạo: nút bận và bấm thêm không gọi lần hai', () => {
    const onCreate = vi.fn();
    render(<NewSectionSheet open onClose={() => {}} pending onCreate={onCreate} />);
    const btn = screen.getByRole('button', { name: 'Tạo và thêm món' });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(btn);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
