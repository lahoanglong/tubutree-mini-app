import { StrictMode, useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSheetSeq } from './use-sheet-seq';
import { useSyncedDraft } from './use-synced-draft';

interface Form extends Record<string, string> {
  name: string;
  phone: string;
  note: string;
}
const EMPTY: Form = { name: '', phone: '', note: '' };
const A: Form = { name: 'An', phone: '0901', note: 'ghi chú cũ' };

type Props = { source: Form | null | undefined; open: unknown };
const setup = (initial: Props) =>
  renderHook(({ source, open }: Props) => useSyncedDraft(EMPTY, source, open), { initialProps: initial });

describe('useSyncedDraft', () => {
  it('mở tấm: mọi ô nạp từ dữ liệu máy chủ ngay lần vẽ đầu tiên của lần mở, chưa ô nào bị coi là đã chạm', () => {
    const { result, rerender } = setup({ source: A, open: false });
    rerender({ source: A, open: true });
    expect(result.current.values).toEqual(A);
    expect(result.current.dirty).toBe(false);
    expect(result.current.isTouched('name')).toBe(false);
  });

  it('dữ liệu mới về khi tấm đang mở: ô chưa chạm đổi theo, ô khách đã sửa giữ nguyên chữ đang gõ', () => {
    const { result, rerender } = setup({ source: A, open: true });
    act(() => result.current.set('note', 'khách đang gõ'));
    rerender({ source: { name: 'Bình', phone: '0902', note: 'ghi chú mới' }, open: true });
    expect(result.current.values).toEqual({ name: 'Bình', phone: '0902', note: 'khách đang gõ' });
    expect(result.current.isTouched('note')).toBe(true);
    expect(result.current.isTouched('name')).toBe(false);
  });

  it('ô đã chạm giữ chữ qua nhiều lần dữ liệu mới liên tiếp, ô chưa chạm luôn theo bản mới nhất', () => {
    const { result, rerender } = setup({ source: A, open: true });
    act(() => result.current.set('name', 'Chi'));
    rerender({ source: { ...A, name: 'X1', phone: '1' }, open: true });
    rerender({ source: { ...A, name: 'X2', phone: '2' }, open: true });
    expect(result.current.values).toEqual({ name: 'Chi', phone: '2', note: A.note });
  });

  it('khách sửa ô về đúng giá trị ban đầu vẫn là đã chạm: dữ liệu mới không ghi đè chữ khách chủ động đặt', () => {
    const { result, rerender } = setup({ source: A, open: true });
    act(() => result.current.set('phone', '0999'));
    act(() => result.current.set('phone', A.phone));
    rerender({ source: { ...A, phone: '0777' }, open: true });
    expect(result.current.values.phone).toBe(A.phone);
    expect(result.current.isTouched('phone')).toBe(true);
  });

  it('set trùng giá trị đang hiện không tính là chạm (ô vẫn bám dữ liệu máy chủ)', () => {
    const { result, rerender } = setup({ source: A, open: true });
    act(() => result.current.set('phone', A.phone));
    expect(result.current.isTouched('phone')).toBe(false);
    expect(result.current.dirty).toBe(false);
    rerender({ source: { ...A, phone: '0777' }, open: true });
    expect(result.current.values.phone).toBe('0777');
  });

  it('dữ liệu về lại y nguyên (đối tượng mới, giá trị bằng nhau) không đổi gì: values giữ nguyên tham chiếu', () => {
    const { result, rerender } = setup({ source: A, open: true });
    act(() => result.current.set('note', 'đang gõ'));
    const before = result.current.values;
    rerender({ source: { ...A }, open: true });
    expect(result.current.values).toBe(before);
  });

  it('mở khi chưa có dữ liệu: ô rỗng, dữ liệu về sau đó điền vào ô chưa chạm và không đè ô khách đã gõ', () => {
    const { result, rerender } = setup({ source: null, open: true });
    expect(result.current.values).toEqual(EMPTY);
    act(() => result.current.set('note', 'gõ sớm'));
    rerender({ source: A, open: true });
    expect(result.current.values).toEqual({ name: 'An', phone: '0901', note: 'gõ sớm' });
  });

  it('ô máy chủ trả null/undefined thì về giá trị rỗng của ô, kể cả khi đang đổi từ giá trị có sang không có', () => {
    const { result, rerender } = setup({ source: A, open: true });
    rerender({ source: { name: 'An', phone: null as unknown as string, note: undefined as unknown as string }, open: true });
    expect(result.current.values).toEqual({ name: 'An', phone: '', note: '' });
  });

  it('đóng rồi mở lại: nạp lại từ dữ liệu máy chủ hiện tại và bỏ hết dấu đã chạm của lần trước', () => {
    const { result, rerender } = setup({ source: A, open: true });
    act(() => result.current.set('name', 'Chi'));
    rerender({ source: A, open: false });
    rerender({ source: { ...A, name: 'Dũng' }, open: true });
    expect(result.current.values.name).toBe('Dũng');
    expect(result.current.dirty).toBe(false);
  });

  it('tấm theo mã đích: đổi sang đích khác là nạp lại từ đầu, không mang chữ đã sửa của đích trước sang', () => {
    const B: Form = { name: 'Bảo', phone: '0903', note: 'b' };
    const { result, rerender } = setup({ source: A, open: 'a' });
    act(() => result.current.set('name', 'Chi'));
    rerender({ source: B, open: 'b' });
    expect(result.current.values).toEqual(B);
    expect(result.current.dirty).toBe(false);
  });

  it('tấm đang đóng không bám dữ liệu mới (và giữ chữ cũ cho lúc tấm trượt xuống); mở lại thì lấy bản mới nhất', () => {
    const { result, rerender } = setup({ source: A, open: true });
    rerender({ source: A, open: false });
    rerender({ source: { ...A, name: 'Mới' }, open: false });
    expect(result.current.values.name).toBe('An');
    rerender({ source: { ...A, name: 'Mới' }, open: true });
    expect(result.current.values.name).toBe('Mới');
  });

  it('đang mở mà dữ liệu máy chủ về null (bản ghi bị gỡ, lịch đang tải lại): mọi ô giữ nguyên, không xoá về rỗng; có lại dữ liệu thì ô chưa chạm bám theo', () => {
    const { result, rerender } = setup({ source: A, open: true });
    act(() => result.current.set('note', 'khách đang gõ'));
    rerender({ source: null, open: true });
    expect(result.current.values).toEqual({ ...A, note: 'khách đang gõ' });
    expect(result.current.isTouched('note')).toBe(true);
    rerender({ source: undefined, open: true });
    expect(result.current.values).toEqual({ ...A, note: 'khách đang gõ' });
    rerender({ source: { name: 'Mới', phone: A.phone, note: 'ghi chú mới' }, open: true });
    expect(result.current.values).toEqual({ name: 'Mới', phone: A.phone, note: 'khách đang gõ' });
  });

  it('dữ liệu về null rồi về lại y nguyên bản cũ thì không đổi gì (ô chưa chạm giữ giá trị)', () => {
    const { result, rerender } = setup({ source: A, open: true });
    const before = result.current.values;
    rerender({ source: null, open: true });
    rerender({ source: { ...A }, open: true });
    expect(result.current.values).toBe(before);
  });

  it('đổi openKey giữa hai giá trị thật khi dữ liệu máy chủ giữ nguyên tham chiếu vẫn nạp lại từ đầu', () => {
    const { result, rerender } = setup({ source: A, open: 'a' });
    act(() => result.current.set('name', 'Chi'));
    rerender({ source: A, open: 'b' });
    expect(result.current.values).toEqual(A);
    expect(result.current.dirty).toBe(false);
  });

  it('chạy dưới StrictMode (vẽ hai lần) vẫn đúng: nạp lúc mở, bám dữ liệu mới, giữ ô đã chạm', () => {
    const { result, rerender } = renderHook(({ source, open }: Props) => useSyncedDraft(EMPTY, source, open), {
      initialProps: { source: A, open: false } as Props,
      wrapper: StrictMode,
    });
    rerender({ source: A, open: true });
    expect(result.current.values).toEqual(A);
    act(() => result.current.set('note', 'đang gõ'));
    rerender({ source: { ...A, name: 'Mới' }, open: true });
    expect(result.current.values).toEqual({ name: 'Mới', phone: A.phone, note: 'đang gõ' });
    expect(result.current.dirty).toBe(true);
  });

  it('chỉ đồng bộ các khoá của `empty`: trường thừa trong dữ liệu máy chủ không làm đổi form', () => {
    const { result, rerender } = setup({ source: A, open: true });
    const before = result.current.values;
    rerender({ source: { ...A, extra: 'x' } as Form, open: true });
    expect(result.current.values).toBe(before);
  });

  describe('kết hợp với useSheetSeq (cùng openKey)', () => {
    // Tấm giả: state `open` do tấm giữ; phản hồi của lệnh chỉ đóng tấm khi còn là lần mở đã gửi lệnh (đúng cách các tấm thật dùng `isCurrent`).
    const sheet = (initialSource: Form | null) => {
      let source = initialSource;
      const hook = renderHook(() => {
        const [open, setOpen] = useState(true);
        const seq = useSheetSeq(open);
        const draft = useSyncedDraft(EMPTY, source, open);
        return { open, setOpen, seq, draft };
      });
      return {
        ...hook,
        feed: (next: Form | null) => {
          source = next;
          hook.rerender();
        },
      };
    };

    it('phản hồi muộn của lần mở trước (khách đã đóng rồi mở lại, đang gõ dở) không đóng tấm mới và không đụng chữ đang gõ; dữ liệu mới giữa chừng chỉ làm mới ô chưa chạm', () => {
      const { result, feed } = sheet(A);
      act(() => result.current.draft.set('note', 'lần 1'));
      const sent = result.current.seq.mark();
      act(() => result.current.setOpen(false));
      act(() => result.current.setOpen(true));
      act(() => result.current.draft.set('note', 'lần 2 đang gõ'));
      feed({ ...A, name: 'Từ máy chủ' });

      // phản hồi muộn của lần 1: chỉ đóng khi còn là lần mở hiện tại
      act(() => {
        if (result.current.seq.isCurrent(sent)) result.current.setOpen(false);
      });
      expect(result.current.open).toBe(true);
      expect(result.current.draft.values).toEqual({ name: 'Từ máy chủ', phone: A.phone, note: 'lần 2 đang gõ' });
    });

    it('phản hồi của đúng lần mở hiện tại đóng tấm như bình thường, rồi mở lại nạp từ dữ liệu máy chủ mới nhất và bỏ chữ cũ', () => {
      const { result, feed } = sheet(A);
      act(() => result.current.draft.set('note', 'đang gõ'));
      const sent = result.current.seq.mark();
      feed({ ...A, phone: '0555' });
      act(() => {
        if (result.current.seq.isCurrent(sent)) result.current.setOpen(false);
      });
      expect(result.current.open).toBe(false);
      act(() => result.current.setOpen(true));
      expect(result.current.draft.values).toEqual({ ...A, phone: '0555' });
      expect(result.current.draft.dirty).toBe(false);
    });
  });
});
