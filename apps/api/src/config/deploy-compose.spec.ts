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

  it('zalo-bridge không mở cổng ra ngoài, giữ phiên Zalo trong volume riêng và không đọc cả .env', () => {
    const block = svc['zalo-bridge'] ?? '';
    expect(block).not.toMatch(/\n {4}ports:/);
    expect(block).toMatch(/\n {6}- zalo_bridge_data:\/data\n/);
    expect(block).not.toMatch(/\n {4}env_file:/);
    expect(block).toMatch(/\n {6}ZALO_BRIDGE_SECRET: \$\{ZALO_BRIDGE_SECRET:-\}/);
    expect(block).toMatch(/\n {6}ZALO_BRIDGE_CREDENTIALS_KEY: \$\{ZALO_BRIDGE_CREDENTIALS_KEY:-\}/);
    expect(block).not.toMatch(/DATABASE_URL|JWT/);
    expect(block).toMatch(/\n {4}networks: \[tubu\]\n/);
    expect(compose).toMatch(/\nvolumes:\n(?: {2}\w+:\n)* {2}zalo_bridge_data:\n/);
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

  it('container web chạy bằng user node, và user đó ghi được .next/cache (Data Cache) và .next/server/app (ISR)', () => {
    expect(runner).toMatch(/\nUSER node\n/);
    expect(runner).toMatch(/mkdir -p apps\/web\/\.next\/cache && chown node:node apps\/web\/\.next\/cache\n/);
    expect(runner).toMatch(/COPY --from=builder --chown=node:node \S+\/standalone /);
    const instructions = runner.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(instructions).not.toMatch(/chown -R/);
    expect(runner).not.toContain('DUY NHẤT');
    expect(runner.indexOf('chown node:node')).toBeLessThan(runner.indexOf('USER node'));
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

describe('docker-compose.prod.yml và docker-compose.vietnix.yml không lệch nhau ngoài chỗ có chủ ý', () => {
  const prod = repoFile('docker-compose.prod.yml');
  const vietnix = repoFile('docker-compose.vietnix.yml');
  const prodSvc = services(prod);
  const vietnixSvc = services(vietnix);
  const dockerfile = repoFile('apps/web/Dockerfile');

  const buildArgs = (compose: string) => [...compose.matchAll(/^ {8}(NEXT_PUBLIC_[A-Z_]+):/gm)].map((m) => m[1]);
  const envLine = (block: string, key: string) => new RegExp(`\\n {6}${key}: (.*)\\n`).exec(block)?.[1];
  const redisCommand = (block: string) => /\n {4}command: (.*)\n/.exec(block)?.[1];

  it.each(['docker-compose.prod.yml', 'docker-compose.vietnix.yml'])('%s: mọi NEXT_PUBLIC_* trong build.args có ARG trong apps/web/Dockerfile (build-arg không có ARG bị bỏ phí, cảnh báo "not consumed")', (file) => {
    const args = buildArgs(repoFile(file));
    expect(args.length).toBeGreaterThan(0);
    for (const name of args) expect({ name, hasArg: new RegExp(`^ARG ${name}$`, 'm').test(dockerfile) }).toEqual({ name, hasArg: true });
  });

  it('NEXT_PUBLIC_APP_URL không còn ở compose nào: web không đọc biến này', () => {
    expect(prod).not.toContain('NEXT_PUBLIC_APP_URL');
    expect(vietnix).not.toContain('NEXT_PUBLIC_APP_URL');
  });

  it('cùng tập NEXT_PUBLIC_* ở hai compose (canonical, sitemap, gốc gian hàng CTV đúng theo WEB_DOMAIN khi dựng bằng compose prod)', () => {
    expect([...buildArgs(prod)].sort()).toEqual([...buildArgs(vietnix)].sort());
  });

  it('DATABASE_URL của api cùng giới hạn pool ở hai compose', () => {
    expect(envLine(prodSvc.api ?? '', 'DATABASE_URL')).toBe(envLine(vietnixSvc.api ?? '', 'DATABASE_URL'));
    expect(envLine(vietnixSvc.api ?? '', 'DATABASE_URL')).toContain('connection_limit=20&pool_timeout=30');
  });

  it('Redis cùng lệnh khởi động ở hai compose (maxmemory đặt thì go-live:check không WARN redis.maxmemory)', () => {
    expect(redisCommand(prodSvc.redis ?? '')).toBe(redisCommand(vietnixSvc.redis ?? ''));
    expect(redisCommand(prodSvc.redis ?? '')).toMatch(/'--maxmemory',\s*'150mb'/);
  });
});

describe('mật khẩu Postgres đi thẳng vào DATABASE_URL nên mẫu phải sinh chuỗi an toàn cho URL (D10-03)', () => {
  const example = repoFile('.env.production.example');
  const postgresBlock = example.slice(example.indexOf('POSTGRES_USER='), example.indexOf('POSTGRES_DB='));

  it('.env.production.example hướng dẫn openssl rand -hex, không dùng base64 (có / và + làm DATABASE_URL hỏng, Prisma P1013)', () => {
    expect(postgresBlock).toContain('POSTGRES_PASSWORD=');
    expect(postgresBlock).not.toMatch(/openssl rand -base64/);
    expect(postgresBlock).toMatch(/openssl rand -hex \d+/);
  });

  it('.env.production.example nói rõ ký tự cấm trong mật khẩu', () => {
    expect(postgresBlock).toMatch(/KHÔNG dùng[^\n]*[/@:#?%]/);
  });

  it('docs/DEPLOY-GCP.md không còn gợi ý base64 cho mật khẩu Postgres và nói đây là tài liệu cũ', () => {
    const doc = repoFile('docs/DEPLOY-GCP.md');
    expect(doc).not.toMatch(/openssl rand -base64 24/);
    expect(doc).toMatch(/openssl rand -hex 24/);
    expect(doc.slice(0, 700)).toContain('docker-compose.vietnix.yml');
  });
});

describe('tài liệu chủ làm theo dùng đúng file compose của VPS thật (D10-02)', () => {
  it.each(['docs/GO-LIVE-KEYS.md', 'docs/ZALOPAY-SETUP.md'])('%s không bảo chạy docker-compose.prod.yml', (file) => {
    expect(repoFile(file)).not.toContain('docker-compose.prod.yml');
  });

  it('lệnh khởi động lại một service trong hai tài liệu có --no-deps (không tạo lại postgres, redis giữa giờ bán)', () => {
    for (const file of ['docs/GO-LIVE-KEYS.md', 'docs/ZALOPAY-SETUP.md']) {
      const cmds = repoFile(file).match(/docker compose -f docker-compose\.vietnix\.yml up -d[^\n`]*/g) ?? [];
      for (const c of cmds) expect({ file, c, noDeps: /--no-deps/.test(c) }).toEqual({ file, c, noDeps: true });
    }
  });
});

describe('lệnh go-live:check có mount thư mục backup phải chạy bằng user của người vận hành', () => {
  // Thư mục backup mode 700 thuộc người vận hành; image api chạy uid 1000 nên thiếu --user thì backup.recent báo "không đọc được thư mục".
  it.each(['docs/launch/deploy-rollback-runbook.md', 'ops/README-vietnix-deploy.md'])('%s', (file) => {
    const cmds = repoFile(file).split('\n').filter((l) => l.includes('go-live:check') && l.includes('/var/backups/tubutree'));
    expect(cmds.length).toBeGreaterThan(0);
    for (const c of cmds) expect({ c, user: c.includes('--user "$(id -u):$(id -g)"') }).toEqual({ c, user: true });
  });
});

describe('docker-compose.vietnix.yml — trần heap Node theo mem_limit', () => {
  const svc = services(repoFile('docker-compose.vietnix.yml'));
  const heap = (name: string) => /\n {6}NODE_OPTIONS: '--max-old-space-size=(\d+)'/.exec(svc[name] ?? '')?.[1];
  const limit = (name: string) => Number(/\n {4}mem_limit: (\d+)m/.exec(svc[name] ?? '')?.[1]);

  it.each([['api', 512], ['web', 352]])('%s có --max-old-space-size=%i, khoảng 70% mem_limit (heap vượt trần thì Node tự báo lỗi thay vì bị OOM-kill)', (name, mb) => {
    expect(Number(heap(name))).toBe(mb);
    expect(Number(heap(name)) / limit(name)).toBeGreaterThan(0.6);
    expect(Number(heap(name)) / limit(name)).toBeLessThan(0.75);
  });
});
