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
    out[m[1] ?? ''] = block.slice(m.index, heads[i + 1]?.index ?? block.length);
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
    const command = /\n {4}command: (.*)\n/.exec(svc.redis ?? '')?.[1] ?? '';
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

describe('docker-compose.vietnix.yml — VPS dùng chung với ChoDeli', () => {
  const compose = repoFile('docker-compose.vietnix.yml');
  const svc = services(compose);

  it('mọi service tự khởi động lại sau khi máy chủ reboot hoặc process thoát', () => {
    for (const [name, block] of Object.entries(svc)) {
      expect({ name, restart: /\n {4}restart: unless-stopped\n/.test(block) }).toEqual({ name, restart: true });
    }
  });

  it('api và web có healthcheck (deploy.sh và depends_on chờ trạng thái healthy)', () => {
    for (const name of ['api', 'web']) {
      expect({ name, healthcheck: /\n {4}healthcheck:\n/.test(svc[name] ?? '') }).toEqual({ name, healthcheck: true });
    }
  });

  it('mọi service có trần RAM; api và web có thêm trần CPU, mặc định không vượt 1 lõi (Docker từ chối khởi động khi cpus lớn hơn số vCPU của máy)', () => {
    for (const [name, block] of Object.entries(svc)) {
      expect({ name, mem: /\n {4}mem_limit: \d+m\n/.test(block) }).toEqual({ name, mem: true });
    }
    for (const name of ['api', 'web']) {
      const cpus = /\n {4}cpus: (?:\$\{[A-Z_]+:-([\d.]+)\}|([\d.]+))\n/.exec(svc[name] ?? '');
      expect({ name, hasCpus: cpus !== null }).toEqual({ name, hasCpus: true });
      expect(Number(cpus?.[1] ?? cpus?.[2])).toBeGreaterThan(0);
      expect(Number(cpus?.[1] ?? cpus?.[2])).toBeLessThanOrEqual(1);
    }
  });

  it('chỉnh CPU qua .env (API_CPUS, WEB_CPUS) không cần sửa file compose: sửa file trên VPS làm git status bẩn và dừng bước 1 của runbook', () => {
    for (const v of ['API_CPUS', 'WEB_CPUS']) expect(compose).toContain('${' + v + ':-');
  });

  // deploy.sh bước 4 chạy `up -d --no-build api` KHÔNG có --no-deps: compose v2 hội tụ luôn các service api phụ thuộc, nên mọi
  // thay đổi cấu hình của postgres hoặc redis làm deploy tự động tạo lại chúng giữa chừng (5xx vài chục giây, BullMQ mất kết nối).
  // Muốn đổi thì làm chủ động ngoài giờ cao điểm: `up -d --no-deps postgres redis` trước deploy (runbook mục 1.5).
  it.each(['postgres', 'redis'])('%s KHÔNG có cấu hình tài nguyên mới (cpus, shm_size): deploy.sh sẽ tạo lại nó giữa lúc deploy', (name) => {
    expect(svc[name]).not.toMatch(/\n {4}(cpus|shm_size):/);
  });

  it('Next đóng kết nối rảnh sau 55 s: lớn hơn ttl=30 của Apache, nhỏ hơn headersTimeout mặc định 60 s của Node', () => {
    const ms = Number(/\n {6}KEEP_ALIVE_TIMEOUT: '?(\d+)'?\n/.exec(svc.web ?? '')?.[1]);
    expect(ms).toBeGreaterThan(30_000);
    expect(ms).toBeLessThan(60_000);
  });
});

describe('ops/vietnix-vhost-*.phase2 — Apache phía trước container', () => {
  it.each(['api', 'app'])('%s: ProxyPass có ttl=30 (bỏ kết nối rảnh trước khi Node đóng nó) và bật mod_deflate', (host) => {
    const vhost = repoFile(`ops/vietnix-vhost-${host}.conf.phase2`);
    const code = vhost.split('\n').filter((l) => !l.trim().startsWith('#'));
    expect(code.filter((l) => /^\s*ProxyPass \/ http:\/\/127\.0\.0\.1:\d+\/ ttl=30$/.test(l))).toHaveLength(1);
    expect(code.join('\n')).toMatch(/<IfModule mod_deflate\.c>[\s\S]*AddOutputFilterByType DEFLATE[^\n]*application\/json[\s\S]*<\/IfModule>/);
  });

  it.each(['api', 'app'])('%s: AddOutputFilterByType nằm trong <IfModule mod_filter.c> (Apache dùng chung với ChoDeli/WordPress: thiếu module là lỗi configtest, không phải bỏ qua)', (host) => {
    const code = repoFile(`ops/vietnix-vhost-${host}.conf.phase2`)
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    expect(code).toMatch(/<IfModule mod_filter\.c>[\s\S]*AddOutputFilterByType DEFLATE[\s\S]*<\/IfModule>/);
    const lines = code.split('\n');
    const depthAt = (i: number) => lines.slice(0, i).reduce((d, l) => d + (/<IfModule /.test(l) ? 1 : 0) - (/<\/IfModule>/.test(l) ? 1 : 0), 0);
    lines.forEach((l, i) => {
      if (/AddOutputFilterByType/.test(l)) expect(depthAt(i)).toBe(2);
    });
  });

  it('runbook 1.5: khối cập nhật vhost chép file .bak về lại ngay khi configtest lỗi (Apache chung với ChoDeli)', () => {
    const runbook = repoFile('docs/launch/deploy-rollback-runbook.md');
    const block = /### 1\.5[\s\S]*?```bash\n([\s\S]*?)```/.exec(runbook)?.[1] ?? '';
    expect(block).toMatch(/if sudo \S+ configtest; then[\s\S]*-k graceful[\s\S]*\belse\b[\s\S]*\.bak\.\$TS[\s\S]*configtest[\s\S]*\bfi\b/);
  });
});

describe('apps/web/Dockerfile', () => {
  const dockerfile = repoFile('apps/web/Dockerfile');
  const runner = dockerfile.slice(dockerfile.lastIndexOf('AS runner'));

  it('container web chạy bằng user node, và user đó ghi được .next/cache (Data Cache của fetch)', () => {
    expect(runner).toMatch(/\nUSER node\n/);
    expect(runner).toMatch(/mkdir -p apps\/web\/\.next\/cache && chown -R node:node apps\/web\/\.next/);
    expect(runner.indexOf('chown -R node:node')).toBeLessThan(runner.indexOf('USER node'));
    expect(runner.indexOf('USER node')).toBeLessThan(runner.indexOf('CMD ['));
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
