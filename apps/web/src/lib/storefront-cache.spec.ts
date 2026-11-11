import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { setStorefrontData } from './storefront-cache';

const KEY = ['my-storefront'] as const;

async function seeded() {
  const qc = new QueryClient();
  const queryFn = vi.fn(async () => ({ title: 'máy chủ' }));
  await qc.fetchQuery({ queryKey: KEY, queryFn });
  queryFn.mockClear();
  return { qc, queryFn };
}
const flagged = (qc: QueryClient) => qc.getQueryState(KEY)?.isInvalidated;

describe('setStorefrontData', () => {
  it('canary: setQueryData thường xoá cờ đã cũ, đây là lý do mọi chỗ ghi tay đi qua hàm này', async () => {
    const { qc } = await seeded();
    await qc.invalidateQueries({ queryKey: KEY, refetchType: 'none' });
    expect(flagged(qc)).toBe(true);
    qc.setQueryData(KEY, { title: 'dựng tại chỗ' });
    expect(flagged(qc)).toBe(false);
  });

  it('cờ đang bật: ghi dữ liệu mới nhưng cờ vẫn bật và không tải lại', async () => {
    const { qc, queryFn } = await seeded();
    await qc.invalidateQueries({ queryKey: KEY, refetchType: 'none' });
    setStorefrontData<{ title: string }>(qc, KEY, (old) => (old ? { ...old, title: 'dựng tại chỗ' } : old));
    expect(qc.getQueryData(KEY)).toEqual({ title: 'dựng tại chỗ' });
    expect(flagged(qc)).toBe(true);
    expect(queryFn).not.toHaveBeenCalled();
    expect(qc.getQueryState(KEY)?.fetchStatus).toBe('idle');
  });

  it('cờ đang tắt: ghi xong cờ vẫn tắt', async () => {
    const { qc } = await seeded();
    setStorefrontData<{ title: string }>(qc, KEY, { title: 'dựng tại chỗ' });
    expect(flagged(qc)).toBe(false);
    expect(qc.getQueryData(KEY)).toEqual({ title: 'dựng tại chỗ' });
  });

  it('lần đọc thành công kế tiếp vẫn xoá cờ', async () => {
    const { qc, queryFn } = await seeded();
    await qc.invalidateQueries({ queryKey: KEY, refetchType: 'none' });
    setStorefrontData<{ title: string }>(qc, KEY, { title: 'dựng tại chỗ' });
    await qc.refetchQueries({ queryKey: KEY, exact: true });
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(flagged(qc)).toBe(false);
    expect(qc.getQueryData(KEY)).toEqual({ title: 'máy chủ' });
  });

  it('chưa có dữ liệu: không ghi gì và không dựng cờ', () => {
    const qc = new QueryClient();
    expect(setStorefrontData<{ title: string }>(qc, KEY, (old) => (old ? { ...old, title: 'x' } : old))).toBeUndefined();
    expect(qc.getQueryState(KEY)).toBeUndefined();
  });

  it('không chạm khoá khác, kể cả khoá con cùng tiền tố', async () => {
    const { qc } = await seeded();
    qc.setQueryData(['other'], 1);
    qc.setQueryData([...KEY, 'child'], 1);
    await qc.invalidateQueries({ queryKey: KEY, exact: true, refetchType: 'none' });
    setStorefrontData<{ title: string }>(qc, KEY, { title: 'a' });
    expect(qc.getQueryState(['other'])?.isInvalidated).toBe(false);
    expect(qc.getQueryState([...KEY, 'child'])?.isInvalidated).toBe(false);
    expect(flagged(qc)).toBe(true);
  });
});
