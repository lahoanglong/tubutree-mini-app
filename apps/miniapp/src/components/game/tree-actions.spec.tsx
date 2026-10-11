import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div role="dialog">{children}</div> : null),
}));

import { TreeActions } from './tree-actions';

function setup(props: Partial<Parameters<typeof TreeActions>[0]> = {}) {
  const onBuy = vi.fn();
  render(<TreeActions treePointsPrice={50} waterPending={false} onWater={vi.fn()} buyPending={false} onBuy={onBuy} {...props} />);
  return { onBuy };
}

describe('TreeActions — xác nhận góp quỹ trồng cây', () => {
  it('bấm nút chỉ mở hộp xác nhận, chưa gọi API; hộp nêu số điểm và thứ tự lô bị trừ', () => {
    const { onBuy } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Góp quỹ trồng cây/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('50 điểm');
    expect(dialog).toHaveTextContent(/điểm thường trừ trước, rồi điểm quy đổi không hết hạn/i);
    expect(onBuy).not.toHaveBeenCalled();
  });

  it('xác nhận gọi đúng 1 lần dù bấm đúp', () => {
    const { onBuy } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Góp quỹ trồng cây/ }));
    const ok = screen.getByRole('button', { name: 'Xác nhận' });
    fireEvent.click(ok);
    fireEvent.click(ok);
    expect(onBuy).toHaveBeenCalledTimes(1);
  });

  it('huỷ thì không gọi API và đóng hộp', () => {
    const { onBuy } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Góp quỹ trồng cây/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(onBuy).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('đang gửi thì nút xác nhận bị khoá', () => {
    const { onBuy } = setup({ buyPending: true });
    expect(screen.getByRole('button', { name: /Góp quỹ trồng cây/ })).toBeDisabled();
    expect(onBuy).not.toHaveBeenCalled();
  });
});
