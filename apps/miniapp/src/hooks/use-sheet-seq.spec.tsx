import { useState } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { useLockedMutation } from '../components/game/use-locked-mutation';
import { closeAfterFresh, settleWithin } from '../utils/settle-within';
import { SHEET_CLOSED_WHEN_SENT, useSheetSeq } from './use-sheet-seq';

describe('useSheetSeq', () => {
  it('số lần mở tăng mỗi khi tấm chuyển từ đóng sang mở, đóng lại thì không tăng', () => {
    const { result, rerender } = renderHook(({ open }) => useSheetSeq(open), { initialProps: { open: false } });
    rerender({ open: true });
    const first = result.current.mark();
    rerender({ open: false });
    rerender({ open: true });
    const second = result.current.mark();
    expect(second).toBe(first + 1);
    rerender({ open: false });
    rerender({ open: true });
    expect(result.current.mark()).toBe(second + 1);
  });

  it('gửi lúc tấm đang đóng: mark() trả SHEET_CLOSED_WHEN_SENT và lệnh đó luôn được đóng muộn, dù tấm đã mở lại sau lúc gửi', () => {
    const { result, rerender } = renderHook(({ open }) => useSheetSeq(open), { initialProps: { open: false } });
    const sent = result.current.mark();
    expect(sent).toBe(SHEET_CLOSED_WHEN_SENT);
    expect(result.current.isCurrent(sent)).toBe(true);
    rerender({ open: true });
    expect(result.current.isCurrent(sent)).toBe(true);
    const sentOpen = result.current.mark();
    expect(sentOpen).not.toBe(SHEET_CLOSED_WHEN_SENT);
    rerender({ open: false });
    rerender({ open: true });
    expect(result.current.isCurrent(sentOpen)).toBe(false);
    expect(result.current.isCurrent(sent)).toBe(true);
  });

  it('count() là số đếm thô: không có mã "đóng lúc gửi", nên lệnh gửi lúc tấm đóng vẫn phát hiện được tấm mở lại sau đó', () => {
    const { result, rerender } = renderHook(({ open }) => useSheetSeq(open), { initialProps: { open: false } });
    const sent = result.current.count();
    expect(sent).not.toBe(SHEET_CLOSED_WHEN_SENT);
    expect(result.current.isCurrent(sent)).toBe(true);
    rerender({ open: true });
    expect(result.current.isCurrent(sent)).toBe(false);
    const sentOpen = result.current.count();
    rerender({ open: false });
    expect(result.current.isCurrent(sentOpen)).toBe(true);
  });

  it('isCurrent chỉ đúng với số của lần mở hiện tại; đóng rồi không ai mở lại thì lệnh cũ vẫn là hiện tại', () => {
    const { result, rerender } = renderHook(({ open }) => useSheetSeq(open), { initialProps: { open: true } });
    const sent = result.current.mark();
    expect(result.current.isCurrent(sent)).toBe(true);
    rerender({ open: false });
    expect(result.current.isCurrent(sent)).toBe(true);
    rerender({ open: true });
    expect(result.current.isCurrent(sent)).toBe(false);
    expect(result.current.isCurrent(result.current.mark())).toBe(true);
  });

  it('thiếu số (lệnh không bắt số lúc gửi) không bao giờ coi là hiện tại', () => {
    const { result } = renderHook(() => useSheetSeq(true));
    expect(result.current.isCurrent(undefined)).toBe(false);
  });

  it('tấm theo mã đích: đổi sang đích khác tăng số, đóng thì không, mở lại cùng đích sau khi đóng thì tăng', () => {
    const { result, rerender } = renderHook(({ id }) => useSheetSeq(id), { initialProps: { id: null as string | null } });
    rerender({ id: 'a' });
    const a1 = result.current.mark();
    rerender({ id: 'b' });
    const b1 = result.current.mark();
    expect(b1).toBe(a1 + 1);
    rerender({ id: null });
    expect(result.current.isCurrent(b1)).toBe(true);
    rerender({ id: 'b' });
    expect(result.current.mark()).toBe(b1 + 1);
    expect(result.current.isCurrent(b1)).toBe(false);
  });

  it('đối tượng hàm trả về ổn định qua các lần render (không làm effect phụ thuộc chạy lại)', () => {
    const { result, rerender } = renderHook(({ open }) => useSheetSeq(open), { initialProps: { open: true } });
    const first = result.current;
    rerender({ open: false });
    rerender({ open: true });
    expect(result.current).toBe(first);
  });
});

describe('useSheetSeq cùng useLockedMutation và closeAfterFresh (đúng mẫu các tấm trong Mini)', () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  function Harness({ send, fresh }: { send: () => Promise<void>; fresh: () => Promise<unknown> }) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState('');
    const seq = useSheetSeq(open);
    const m = useLockedMutation<void, Error, void, number>({
      mutationFn: send,
      onMutate: () => seq.mark(),
      onError: (_e, _v, sent) =>
        closeAfterFresh(settleWithin(fresh()), () => {
          if (!seq.isCurrent(sent)) return;
          setOpen(false);
          setText('');
        }),
    });
    return (
      <div>
        <button onClick={() => setOpen(true)}>mở</button>
        <button onClick={() => setOpen(false)}>đóng</button>
        {open && (
          <div role="dialog">
            <input aria-label="lý do" value={text} onChange={(e) => setText(e.target.value)} />
            <button onClick={() => m.mutate()}>gửi</button>
          </div>
        )}
      </div>
    );
  }

  const setup = (send: () => Promise<void>, fresh: () => Promise<unknown>) => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <Harness send={send} fresh={fresh} />
      </QueryClientProvider>,
    );
  };
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

  it('tấm vẫn là lần mở đã gửi lệnh: đóng sau khi dữ liệu mới về và xoá chữ như trước', async () => {
    const refetch = deferred();
    const send = vi.fn().mockRejectedValue(new Error('từ chối'));
    setup(send, () => refetch.promise);
    fireEvent.click(screen.getByText('mở'));
    fireEvent.change(screen.getByLabelText('lý do'), { target: { value: 'hết hàng' } });
    fireEvent.click(screen.getByText('gửi'));
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeNull();
    await act(async () => refetch.resolve());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('khách đóng tấm rồi mở lại gõ mới trong lúc chờ: lệnh bị từ chối trễ không đóng tấm mới, không xoá chữ đang gõ', async () => {
    const refetch = deferred();
    const send = vi.fn().mockRejectedValue(new Error('từ chối'));
    setup(send, () => refetch.promise);
    fireEvent.click(screen.getByText('mở'));
    fireEvent.change(screen.getByLabelText('lý do'), { target: { value: 'cũ' } });
    fireEvent.click(screen.getByText('gửi'));
    await settle();
    fireEvent.click(screen.getByText('đóng'));
    fireEvent.click(screen.getByText('mở'));
    fireEvent.change(screen.getByLabelText('lý do'), { target: { value: 'đang gõ mới' } });
    await act(async () => refetch.resolve());
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(screen.getByLabelText('lý do')).toHaveValue('đang gõ mới');
  });

  it('chạm "gửi" lần hai ở lần mở mới trong lúc lệnh đầu còn bay bị khoá bỏ qua và không ghi đè số đã bắt của lệnh đầu', async () => {
    const refetch = deferred();
    const send = vi.fn().mockRejectedValue(new Error('từ chối'));
    setup(send, () => refetch.promise);
    fireEvent.click(screen.getByText('mở'));
    fireEvent.click(screen.getByText('gửi'));
    await settle();
    fireEvent.click(screen.getByText('đóng'));
    fireEvent.click(screen.getByText('mở'));
    fireEvent.change(screen.getByLabelText('lý do'), { target: { value: 'mới' } });
    fireEvent.click(screen.getByText('gửi'));
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => refetch.resolve());
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(screen.getByLabelText('lý do')).toHaveValue('mới');
  });

  it('khách đóng tấm trong lúc chờ và không mở lại: lần đóng muộn vẫn chạy được, không lỗi, tấm vẫn đóng', async () => {
    const refetch = deferred();
    const send = vi.fn().mockRejectedValue(new Error('từ chối'));
    setup(send, () => refetch.promise);
    fireEvent.click(screen.getByText('mở'));
    fireEvent.click(screen.getByText('gửi'));
    await settle();
    fireEvent.click(screen.getByText('đóng'));
    await act(async () => refetch.resolve());
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
