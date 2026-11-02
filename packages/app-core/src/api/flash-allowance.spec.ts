import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '../http';
import { fetchFlashAllowance, flashAllowancePath } from './flash-allowance';

describe('flashAllowancePath', () => {
  it('nối id bằng dấu phẩy sau ?items=, mã hoá từng id', () => {
    expect(flashAllowancePath(['a', 'b'])).toBe('/flash-sales/me/allowance?items=a,b');
    expect(flashAllowancePath(['a b', 'c/d'])).toBe('/flash-sales/me/allowance?items=a%20b,c%2Fd');
  });
});

describe('fetchFlashAllowance', () => {
  it('gọi đúng đường dẫn, có phiên (không anonymous), trả nguyên phản hồi', async () => {
    const res = { items: { fi1: { perUserLeft: 0, allowance: 0 } } };
    const get = vi.fn().mockResolvedValue(res);
    await expect(fetchFlashAllowance({ get } as unknown as HttpClient, ['fi1'])).resolves.toBe(res);
    expect(get).toHaveBeenCalledWith('/flash-sales/me/allowance?items=fi1');
  });
});
