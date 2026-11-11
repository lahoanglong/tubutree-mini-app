// @vitest-environment jsdom
import { act, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/test-utils/render-hook';
import { click, flush, render, typeInto } from '@/test-utils/dom';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { SHEET_CLOSED_WHEN_SENT, useSheetSeq } from './use-sheet-seq';
import { settleWithin } from './settle-within';

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

  it('đối tượng hàm trả về ổn định qua các lần vẽ (không làm effect phụ thuộc chạy lại)', () => {
    const { result, rerender } = renderHook(({ open }) => useSheetSeq(open), { initialProps: { open: true } });
    const first = result.current;
    rerender({ open: false });
    rerender({ open: true });
    expect(result.current).toBe(first);
  });
});

describe('useSheetSeq cùng useLockedMutation và settleWithin (đúng mẫu các tấm trên web)', () => {
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
      onError: async (_e, _v, sent) => {
        await settleWithin(fresh());
        if (!seq.isCurrent(sent)) return;
        setOpen(false);
        setText('');
      },
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

  const btn = (name: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === name) ?? null;
  const dialog = () => document.querySelector('[role="dialog"]');
  const reason = () => document.querySelector<HTMLInputElement>('[aria-label="lý do"]');
  const setup = (send: () => Promise<void>, fresh: () => Promise<unknown>) => render(<Harness send={send} fresh={fresh} />);

  it('tấm vẫn là lần mở đã gửi lệnh: đóng sau khi dữ liệu mới về và xoá chữ như trước', async () => {
    const refetch = deferred();
    const send = vi.fn().mockRejectedValue(new Error('từ chối'));
    const r = setup(send, () => refetch.promise);
    click(btn('mở'));
    typeInto(reason(), 'hết hàng');
    click(btn('gửi'));
    await flush();
    expect(dialog()).not.toBeNull();
    await act(async () => refetch.resolve());
    await flush();
    expect(dialog()).toBeNull();
    r.unmount();
  });

  it('khách đóng tấm rồi mở lại gõ mới trong lúc chờ: lệnh bị từ chối trễ không đóng tấm mới, không xoá chữ đang gõ', async () => {
    const refetch = deferred();
    const send = vi.fn().mockRejectedValue(new Error('từ chối'));
    const r = setup(send, () => refetch.promise);
    click(btn('mở'));
    typeInto(reason(), 'cũ');
    click(btn('gửi'));
    await flush();
    click(btn('đóng'));
    click(btn('mở'));
    typeInto(reason(), 'đang gõ mới');
    await act(async () => refetch.resolve());
    await flush();
    expect(dialog()).not.toBeNull();
    expect(reason()!.value).toBe('đang gõ mới');
    r.unmount();
  });

  it('chạm "gửi" lần hai ở lần mở mới trong lúc lệnh đầu còn bay bị khoá bỏ qua và không ghi đè số đã bắt của lệnh đầu', async () => {
    const refetch = deferred();
    const send = vi.fn().mockRejectedValue(new Error('từ chối'));
    const r = setup(send, () => refetch.promise);
    click(btn('mở'));
    click(btn('gửi'));
    await flush();
    click(btn('đóng'));
    click(btn('mở'));
    typeInto(reason(), 'mới');
    click(btn('gửi'));
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => refetch.resolve());
    await flush();
    expect(dialog()).not.toBeNull();
    expect(reason()!.value).toBe('mới');
    r.unmount();
  });

  it('khách đóng tấm trong lúc chờ và không mở lại: lần đóng muộn vẫn chạy được, không lỗi, tấm vẫn đóng', async () => {
    const refetch = deferred();
    const send = vi.fn().mockRejectedValue(new Error('từ chối'));
    const r = setup(send, () => refetch.promise);
    click(btn('mở'));
    click(btn('gửi'));
    await flush();
    click(btn('đóng'));
    await act(async () => refetch.resolve());
    await flush();
    expect(dialog()).toBeNull();
    r.unmount();
  });
});
