import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div role="dialog">{children}</div> : null),
}));

import { TreeActions } from './tree-actions';

/** Hợp đồng BE của Idempotency-Key: chuỗi 8–128 ký tự [A-Za-z0-9_-]. */
const KEY_CONTRACT = /^[A-Za-z0-9_-]{8,128}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function pending<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setup(props: Partial<Parameters<typeof TreeActions>[0]> = {}) {
  const onBuy = vi.fn<(key: string) => Promise<boolean>>().mockResolvedValue(true);
  render(<TreeActions treePointsPrice={50} waterPending={false} onWater={vi.fn()} buyPending={false} onBuy={onBuy} {...props} />);
  return { onBuy };
}

const openBox = () => fireEvent.click(screen.getByRole('button', { name: /Góp quỹ trồng cây/ }));
const confirmButton = () => screen.getByRole('button', { name: 'Xác nhận' });
const keyOf = (onBuy: ReturnType<typeof setup>['onBuy'], call: number) => onBuy.mock.calls[call]![0];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TreeActions — xác nhận góp quỹ trồng cây', () => {
  it('bấm nút chỉ mở hộp xác nhận, chưa gọi API; hộp nêu số điểm và thứ tự lô bị trừ', () => {
    const { onBuy } = setup();
    openBox();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('50 điểm');
    expect(dialog).toHaveTextContent(/điểm thường trừ trước, rồi điểm quy đổi không hết hạn/i);
    expect(onBuy).not.toHaveBeenCalled();
  });

  it('xác nhận gọi đúng 1 lần dù chạm đúp trong cùng khung hình', async () => {
    const { onBuy } = setup();
    openBox();
    const ok = confirmButton();
    await act(async () => {
      ok.click();
      ok.click();
    });
    expect(onBuy).toHaveBeenCalledTimes(1);
  });

  it('huỷ thì không gọi API và đóng hộp', () => {
    const { onBuy } = setup();
    openBox();
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

describe('TreeActions — Idempotency-Key của hộp xác nhận', () => {
  it('gửi một key theo đúng hợp đồng BE; có crypto.randomUUID thì là UUID v4 nguyên dạng', async () => {
    const { onBuy } = setup();
    openBox();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onBuy).toHaveBeenCalledTimes(1));
    expect(keyOf(onBuy, 0)).toMatch(KEY_CONTRACT);
    expect(keyOf(onBuy, 0)).toMatch(UUID_V4);
  });

  it('WebView không có crypto.randomUUID: vẫn sinh key hợp hợp đồng BE', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const { onBuy } = setup();
    openBox();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onBuy).toHaveBeenCalledTimes(1));
    expect(keyOf(onBuy, 0)).toMatch(KEY_CONTRACT);
  });

  it('đang gửi: hộp vẫn mở, nút xác nhận khoá, không thể đóng; xong thì đóng hộp', async () => {
    const gate = pending<boolean>();
    const { onBuy } = setup();
    onBuy.mockReturnValue(gate.promise);
    openBox();
    fireEvent.click(confirmButton());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();
    fireEvent.click(confirmButton());
    expect(onBuy).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve(true);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('lỗi (mạng/timeout): hộp ở lại, bấm lại thử lại với ĐÚNG key cũ', async () => {
    const { onBuy } = setup();
    onBuy.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    openBox();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onBuy).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onBuy).toHaveBeenCalledTimes(2));
    expect(keyOf(onBuy, 1)).toBe(keyOf(onBuy, 0));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('huỷ rồi mở lại hộp: key mới', async () => {
    const { onBuy } = setup();
    onBuy.mockResolvedValue(false);
    openBox();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onBuy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    openBox();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onBuy).toHaveBeenCalledTimes(2));
    expect(keyOf(onBuy, 1)).not.toBe(keyOf(onBuy, 0));
  });

  it('góp thành công rồi mở lại hộp: key mới', async () => {
    const { onBuy } = setup();
    openBox();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    openBox();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onBuy).toHaveBeenCalledTimes(2));
    expect(keyOf(onBuy, 1)).not.toBe(keyOf(onBuy, 0));
  });
});
