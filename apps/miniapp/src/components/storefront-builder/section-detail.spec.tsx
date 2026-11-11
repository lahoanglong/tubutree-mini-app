import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StorefrontCollectionEdit } from '../../services/storefront-api';
import { SectionDetail, type SectionDetailProps } from './section-detail';

const combo = (pct: number | null): StorefrontCollectionEdit => ({
  id: 'c3', title: 'Bộ ba', kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: pct, sortOrder: 0, items: [],
});

function detail(pct: number | null, onComboPct: SectionDetailProps['onComboPct']) {
  return (
    <SectionDetail
      col={combo(pct)}
      productMap={new Map()}
      sortMode={false}
      headingRef={null}
      pickedStyle={null}
      onMenu={vi.fn()}
      onStyle={vi.fn()}
      onComboPct={onComboPct}
      onAddItem={vi.fn()}
      onToggleSort={vi.fn()}
      onMoveItem={vi.fn()}
      onMoveBlocked={vi.fn()}
      onItemMenu={vi.fn()}
      onNote={vi.fn()}
    />
  );
}

const pctInput = () => screen.getByRole('textbox', { name: 'Giảm khi mua cả bộ' }) as HTMLInputElement;
const saveBtn = () => screen.getByRole('button', { name: 'Lưu mức giảm' });
const type = (value: string) => fireEvent.change(pctInput(), { target: { value } });
const deferredSave = () => {
  let finish!: (saved: number | null) => void;
  const onSave = vi.fn(() => new Promise<number | null>((resolve) => { finish = resolve; }));
  return { onSave, finish: (saved: number | null) => finish(saved) };
};

describe('ô mức giảm của khối Combo bám số máy chủ, số khách đang gõ giữ nguyên (W118A)', () => {
  it('khách đang gõ 25 mà số máy chủ đổi từ 10 sang 40: ô giữ 25, nút Lưu gửi 25', async () => {
    const onSave = vi.fn().mockResolvedValue(25);
    const view = render(detail(10, onSave));
    expect(pctInput().value).toBe('10');
    type('25');
    view.rerender(detail(40, onSave));
    expect(pctInput().value).toBe('25');
    expect(saveBtn()).not.toBeDisabled();
    fireEvent.click(saveBtn());
    await act(async () => undefined);
    expect(onSave).toHaveBeenCalledWith(25);
  });

  it('khách chưa gõ: số máy chủ đổi thì ô đổi theo, kể cả từ chưa có sang có số', () => {
    const onSave = vi.fn();
    const view = render(detail(null, onSave));
    expect(pctInput().value).toBe('');
    view.rerender(detail(10, onSave));
    expect(pctInput().value).toBe('10');
    view.rerender(detail(40, onSave));
    expect(pctInput().value).toBe('40');
  });

  it('lưu xong máy chủ hạ xuống trần 30: ô hiện 30 và dòng gợi ý nói đúng số ấy', async () => {
    const onSave = vi.fn().mockResolvedValue(30);
    const view = render(detail(10, onSave));
    type('50');
    fireEvent.click(saveBtn());
    await act(async () => undefined);
    expect(onSave).toHaveBeenCalledWith(50);
    expect(pctInput().value).toBe('30');
    expect(screen.getByTestId('combo-pct-hint')).toHaveTextContent('Mức giảm tối đa hiện là 30%.');
    view.rerender(detail(30, onSave));
    expect(pctInput().value).toBe('30');
  });

  it('khách gõ tiếp 25 trong lúc lệnh lưu 15 còn bay: lưu xong ô giữ 25, không bị xoá về 15', async () => {
    const { onSave, finish } = deferredSave();
    const view = render(detail(10, onSave));
    type('15');
    fireEvent.click(saveBtn());
    await act(async () => undefined);
    expect(saveBtn()).toHaveAttribute('aria-busy', 'true');
    type('25');
    await act(async () => finish(15));
    view.rerender(detail(15, onSave));
    expect(pctInput().value).toBe('25');
    expect(saveBtn()).not.toHaveAttribute('aria-busy', 'true');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('lưu thất bại (trả null): ô giữ số khách đã gõ, nhả nút Lưu để thử lại', async () => {
    const { onSave, finish } = deferredSave();
    render(detail(10, onSave));
    type('15');
    fireEvent.click(saveBtn());
    await act(async () => undefined);
    await act(async () => finish(null));
    expect(pctInput().value).toBe('15');
    expect(saveBtn()).not.toHaveAttribute('aria-busy', 'true');
    expect(saveBtn()).not.toBeDisabled();
  });

  it('gõ 15 và lưu xong, máy khác đổi mức giảm thành 20: ô đổi theo 20 và nút Lưu tắt, không còn giữ 15 để ghi đè 20', async () => {
    const onSave = vi.fn().mockResolvedValue(15);
    const view = render(detail(10, onSave));
    type('15');
    fireEvent.click(saveBtn());
    await act(async () => undefined);
    view.rerender(detail(15, onSave));
    expect(pctInput().value).toBe('15');
    view.rerender(detail(20, onSave));
    expect(pctInput().value).toBe('20');
    expect(saveBtn()).toBeDisabled();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('lưu xong mà số máy chủ về đúng số khác ngay (chưa qua số vừa lưu): ô cũng đổi theo', async () => {
    const onSave = vi.fn().mockResolvedValue(15);
    const view = render(detail(10, onSave));
    type('15');
    fireEvent.click(saveBtn());
    await act(async () => undefined);
    view.rerender(detail(20, onSave));
    expect(pctInput().value).toBe('20');
  });

  it('lưu xong rồi khách gõ số mới: số mới được giữ khi máy chủ đổi tiếp, nhưng không phải số đã lưu từ trước', async () => {
    const onSave = vi.fn().mockResolvedValue(15);
    const view = render(detail(10, onSave));
    type('15');
    fireEvent.click(saveBtn());
    await act(async () => undefined);
    view.rerender(detail(15, onSave));
    type('30');
    view.rerender(detail(20, onSave));
    expect(pctInput().value).toBe('30');
    expect(saveBtn()).not.toBeDisabled();
  });

  it('gõ tiếp 25 trong lúc lệnh lưu 15 còn bay: sau khi lưu xong số máy chủ đổi tiếp vẫn không đè 25', async () => {
    const { onSave, finish } = deferredSave();
    const view = render(detail(10, onSave));
    type('15');
    fireEvent.click(saveBtn());
    await act(async () => undefined);
    type('25');
    await act(async () => finish(15));
    view.rerender(detail(15, onSave));
    view.rerender(detail(40, onSave));
    expect(pctInput().value).toBe('25');
    expect(saveBtn()).not.toBeDisabled();
  });
});
