import { EXPECTED_QUEUES, evaluateRedis } from './redis-checks';
import type { RedisSnapshot } from './redis-checks';
import { GOOD_REDIS, byId } from './go-live.fixtures';

const status = (s: RedisSnapshot, id: string) => byId(evaluateRedis(s), id).status;
const patch = (p: Partial<RedisSnapshot>): RedisSnapshot => ({ ...GOOD_REDIS, ...p });

describe('evaluateRedis', () => {
  it('khớp đúng 6 hàng đợi của ops', () => {
    expect([...EXPECTED_QUEUES].sort()).toEqual(['gomdon-events', 'gomdon-push', 'notifications', 'pancake-events', 'pancake-push', 'zalo-oa-events']);
  });

  it('Redis tốt: mọi dòng PASS', () => {
    expect(evaluateRedis(GOOD_REDIS).filter((r) => r.status !== 'PASS')).toEqual([]);
  });

  it('mọi WARN/FAIL đều có cách sửa', () => {
    const worst = [patch({ reachable: false, error: 'ECONNREFUSED' }), patch({ maxmemoryPolicy: 'allkeys-lru', maxmemoryBytes: 0, appendonly: 'no', dbIndex: 3 })];
    for (const s of worst) for (const r of evaluateRedis(s)) if (r.status !== 'PASS') expect(r.hint.length).toBeGreaterThan(10);
  });

  it('không kết nối được: FAIL cả Redis lẫn hàng đợi, nêu lỗi đã được làm sạch', () => {
    const results = evaluateRedis(patch({ reachable: false, error: 'ECONNREFUSED' }));
    expect(results.map((r) => r.status)).toEqual(['FAIL', 'FAIL']);
    expect(byId(results, 'redis.reachable').detail).toBe('ECONNREFUSED');
  });

  it('không kết nối được mà thiếu thông báo lỗi thì vẫn có chữ', () => {
    expect(byId(evaluateRedis(patch({ reachable: false })), 'redis.reachable').detail).toContain('không kết nối');
  });

  describe('maxmemory-policy', () => {
    it('noeviction thì PASS', () => expect(status(GOOD_REDIS, 'redis.policy')).toBe('PASS'));
    it.each(['allkeys-lru', 'volatile-lru', 'allkeys-random'])('%s thì FAIL', (p) => {
      expect(status(patch({ maxmemoryPolicy: p }), 'redis.policy')).toBe('FAIL');
    });
    it('không đọc được thì WARN', () => expect(status(patch({ maxmemoryPolicy: null }), 'redis.policy')).toBe('WARN'));

    describe('theo giai đoạn', () => {
      const phased = (p: string | null, phase: 'pre-deploy' | 'post-deploy') => byId(evaluateRedis(patch({ maxmemoryPolicy: p }), phase), 'redis.policy');
      it('trước deploy: allkeys-lru của compose cũ chỉ là WARN, hint nêu cách đổi', () => {
        const r = phased('allkeys-lru', 'pre-deploy');
        expect(r.status).toBe('WARN');
        expect(r.hint).toContain('config set maxmemory-policy noeviction');
      });
      it('sau deploy: allkeys-lru vẫn là FAIL', () => expect(phased('allkeys-lru', 'post-deploy').status).toBe('FAIL'));
      it('không truyền giai đoạn thì coi như sau deploy', () => expect(status(patch({ maxmemoryPolicy: 'allkeys-lru' }), 'redis.policy')).toBe('FAIL'));
      it('noeviction PASS ở cả hai giai đoạn', () => {
        expect(phased('noeviction', 'pre-deploy').status).toBe('PASS');
        expect(phased('noeviction', 'post-deploy').status).toBe('PASS');
      });
      it('không đọc được vẫn WARN ở cả hai giai đoạn', () => {
        expect(phased(null, 'pre-deploy').status).toBe('WARN');
        expect(phased(null, 'post-deploy').status).toBe('WARN');
      });
    });
  });

  describe('trần bộ nhớ', () => {
    it('có trần thì PASS và hiện MB', () => expect(byId(evaluateRedis(GOOD_REDIS), 'redis.maxmemory').detail).toBe('150MB'));
    it('không giới hạn thì WARN', () => expect(status(patch({ maxmemoryBytes: 0 }), 'redis.maxmemory')).toBe('WARN'));
    it('không đọc được thì WARN', () => expect(status(patch({ maxmemoryBytes: null }), 'redis.maxmemory')).toBe('WARN'));
  });

  describe('appendonly', () => {
    it('yes thì PASS', () => expect(status(GOOD_REDIS, 'redis.persistence')).toBe('PASS'));
    it('no thì WARN', () => expect(status(patch({ appendonly: 'no' }), 'redis.persistence')).toBe('WARN'));
    it('không đọc được thì WARN', () => expect(status(patch({ appendonly: null }), 'redis.persistence')).toBe('WARN'));
  });

  describe('chỉ số DB', () => {
    it('0 thì PASS', () => expect(status(GOOD_REDIS, 'redis.db_index')).toBe('PASS'));
    it('khác 0 thì WARN', () => expect(status(patch({ dbIndex: 2 }), 'redis.db_index')).toBe('WARN'));
  });

  describe('hàng đợi', () => {
    const queues = GOOD_REDIS.queues;
    it('thiếu hàng đợi thì FAIL', () => {
      const s = patch({ queues: queues.filter((q) => q.name !== 'gomdon-push') });
      const r = byId(evaluateRedis(s), 'queues.reachable');
      expect(r.status).toBe('FAIL');
      expect(r.detail).toContain('gomdon-push');
    });
    it('một hàng đợi đọc lỗi thì FAIL', () => {
      const s = patch({ queues: queues.map((q) => (q.name === 'notifications' ? { name: q.name, ok: false, error: 'TimeoutError' } : q)) });
      expect(status(s, 'queues.reachable')).toBe('FAIL');
    });
    it('có job failed thì WARN và nêu hàng đợi', () => {
      const s = patch({ queues: queues.map((q) => (q.name === 'pancake-push' ? { ...q, counts: { waiting: 0, active: 0, delayed: 0, failed: 3 } } : q)) });
      const r = byId(evaluateRedis(s), 'queues.backlog');
      expect(r.status).toBe('WARN');
      expect(r.detail).toContain('pancake-push: failed 3');
    });
    it('waiting nhiều hơn 50 thì WARN', () => {
      const s = patch({ queues: queues.map((q) => (q.name === 'gomdon-events' ? { ...q, counts: { waiting: 51, active: 0, delayed: 0, failed: 0 } } : q)) });
      expect(status(s, 'queues.backlog')).toBe('WARN');
    });
    it('đúng 50 waiting thì vẫn PASS', () => {
      const s = patch({ queues: queues.map((q) => (q.name === 'gomdon-events' ? { ...q, counts: { waiting: 50, active: 9, delayed: 4, failed: 0 } } : q)) });
      expect(status(s, 'queues.backlog')).toBe('PASS');
    });
  });
});
