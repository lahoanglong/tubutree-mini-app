import { createHash } from 'node:crypto';
import { RANK_KEY_HASH_PREFIX, RANK_KEY_RAW_MAX_CHARS, rankCacheKey } from './rank-cache-key';

describe('rankCacheKey (w25-01)', () => {
  const where = (n: number) => JSON.stringify({ where: { AND: [{ id: { in: Array.from({ length: n }, (_, i) => `cmproduct${String(i).padStart(16, '0')}`) } }] } });

  it('khoá tới 2.000 ký tự giữ nguyên chuỗi JSON', () => {
    const raw = 'x'.repeat(RANK_KEY_RAW_MAX_CHARS);
    expect(rankCacheKey(raw)).toBe(raw);
    expect(rankCacheKey('{"where":{}}')).toBe('{"where":{}}');
  });

  it('khoá dài hơn (bộ lọc 200+ id) thành "sha256:v1:" + 64 ký tự hex của chính chuỗi gốc', () => {
    const raw = where(250);
    expect(raw.length).toBeGreaterThan(RANK_KEY_RAW_MAX_CHARS);
    const key = rankCacheKey(raw);
    expect(key).toBe(`${RANK_KEY_HASH_PREFIX}${createHash('sha256').update(raw).digest('hex')}`);
    expect(key).toMatch(/^sha256:v1:[0-9a-f]{64}$/);
    expect(rankCacheKey('x'.repeat(RANK_KEY_RAW_MAX_CHARS + 1))).toMatch(/^sha256:v1:/);
  });

  it('cùng bộ lọc thì cùng khoá; bộ lọc khác một id thì khác khoá', () => {
    expect(rankCacheKey(where(250))).toBe(rankCacheKey(where(250)));
    expect(rankCacheKey(where(250))).not.toBe(rankCacheKey(where(251)));
    expect(rankCacheKey(where(250))).not.toBe(rankCacheKey(where(250).replace('cmproduct0000000000000007', 'cmproduct0000000000000999')));
  });
});
