import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoFile = (rel: string) => readFileSync(join(__dirname, '../../../..', rel), 'utf8');
const COMPOSE_FILES = ['docker-compose.prod.yml', 'docker-compose.vietnix.yml'];

/** Khối YAML của từng service (cấp 2 dưới `services:`), cắt theo thụt lề. */
function services(compose: string): Record<string, string> {
  const body = compose.slice(compose.indexOf('\nservices:\n') + '\nservices:\n'.length);
  const end = body.search(/\n[a-z]/);
  const block = end === -1 ? body : body.slice(0, end);
  const out: Record<string, string> = {};
  const re = /^ {2}([a-z][\w-]*):\s*$/gm;
  const heads = [...block.matchAll(re)];
  heads.forEach((m, i) => {
    out[m[1]] = block.slice(m.index, heads[i + 1]?.index ?? block.length);
  });
  return out;
}

describe.each(COMPOSE_FILES)('%s', (file) => {
  const compose = repoFile(file);
  const svc = services(compose);

  it('đọc được các service chính', () => {
    expect(Object.keys(svc)).toEqual(expect.arrayContaining(['postgres', 'redis', 'api', 'web']));
  });

  it('Redis chạy maxmemory-policy noeviction (BullMQ mất job âm thầm nếu Redis tự xoá key)', () => {
    const command = /\n {4}command: (.*)\n/.exec(svc.redis)?.[1] ?? '';
    expect(command).toMatch(/'--maxmemory-policy',\s*'noeviction'/);
    expect(command).not.toMatch(/allkeys-|volatile-/);
  });

  it('mọi service giới hạn dung lượng log (json-file không xoay vòng làm đầy đĩa VPS dùng chung)', () => {
    expect(compose).toMatch(/x-logging: &default-logging\n\s+driver: json-file\n\s+options:\n\s+max-size: '\d+m'\n\s+max-file: '\d+'/);
    for (const [name, block] of Object.entries(svc)) {
      expect({ name, hasLogging: /\n {4}logging: \*default-logging\n/.test(block) }).toEqual({ name, hasLogging: true });
    }
  });
});

describe('BullMQ giữ job đã xong/thất bại có giới hạn', () => {
  it('removeOnFail không giữ quá 1000 job mỗi queue (stacktrace chiếm bộ nhớ Redis)', () => {
    const src = readFileSync(join(__dirname, '../jobs/queue.module.ts'), 'utf8');
    const m = /removeOnFail:\s*(?:\{[^}]*count:\s*)?(\d+)/.exec(src);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(1000);
  });
});
