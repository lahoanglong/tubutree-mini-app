import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from './admin-client';

afterEach(() => vi.unstubAllGlobals());

function stub(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })));
}

describe('getConfig', () => {
  it('đổi object {khoá: giá trị} của ?category= thành mảng dòng', async () => {
    stub({ 'waste.enabled': false, 'waste.max_open_requests': 3 });
    const rows = await getConfig('waste');
    expect(rows.find((r) => r.key === 'waste.enabled')?.value).toBe(false);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ category: 'waste', description: null });
  });
  it('giữ nguyên mảng khi không lọc', async () => {
    const all = [{ key: 'a.b', value: 1, description: null, category: 'a' }];
    stub(all);
    expect(await getConfig()).toEqual(all);
  });
});
