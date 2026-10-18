import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(__dirname, '../../../..');
const SCRIPT = join(REPO, 'ops/check-edge.sh');
const EXPECT_IP = '14.225.207.177';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Cùng định dạng `openssl x509 -enddate`: ngày một chữ số đệm khoảng trắng. */
function opensslDate(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${d.getUTCFullYear()} GMT`;
}

interface Page {
  code?: number;
  headers?: string[];
  body?: string;
  /** curl thoát mã này thay vì trả phản hồi (6 = DNS, 7 = từ chối kết nối). */
  rc?: number;
}

interface World {
  pages: Record<string, Page>;
  dig?: string;
  notAfterDays?: number;
  dfPct?: number;
  dockerPs?: string;
  backupAgeMinutes?: number | null;
}

const key = (url: string) => url.replace(/[^A-Za-z0-9]/g, '_');
const GOOD_API_HEADERS = ['content-type: application/json', 'content-encoding: gzip', 'cache-control: public, max-age=5, s-maxage=10'];

function goodWorld(overrides: Partial<World> = {}): World {
  return {
    pages: {
      'https://api.test.vn/api/home': { code: 200, headers: GOOD_API_HEADERS, body: '{"ok":true}' },
      'https://api.test.vn/api/health': { code: 200, body: '{"status":"ok","db":"up","redis":"up"}' },
      'https://app.test.vn/': { code: 200, headers: ['content-encoding: gzip', 'cache-control: private, no-cache, no-store'], body: '<html>' },
      'http://127.0.0.1:14001/api/health': { code: 200, body: '{"status":"ok"}' },
      'http://127.0.0.1:14000/': { code: 200, body: '<html>' },
    },
    dig: EXPECT_IP,
    notAfterDays: 60,
    ...overrides,
  };
}

/** Chạy check-edge.sh với curl/dig/openssl/df/docker giả trên PATH: không đụng mạng hay máy thật. */
function run(world: World, args: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'tubu-edge-'));
  const bin = join(dir, 'bin');
  const fix = join(dir, 'fix');
  mkdirSync(bin);
  mkdirSync(fix);
  const stub = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  for (const [url, p] of Object.entries(world.pages)) {
    const k = join(fix, key(url));
    if (p.rc !== undefined) {
      writeFileSync(`${k}.rc`, String(p.rc));
      continue;
    }
    writeFileSync(`${k}.code`, String(p.code ?? 200));
    writeFileSync(`${k}.h`, `HTTP/2 ${p.code ?? 200}\r\n${(p.headers ?? []).join('\r\n')}\r\n\r\n`);
    writeFileSync(`${k}.body`, p.body ?? '');
  }
  stub(
    'curl',
    `url=""; body=/dev/null; hdr=/dev/null
while [ $# -gt 0 ]; do
  case "$1" in -o) body="$2"; shift 2;; -D) hdr="$2"; shift 2;; -w|-H|--max-time) shift 2;; -*) shift;; *) url="$1"; shift;; esac
done
k="${fix}/$(printf '%s' "$url" | sed 's/[^A-Za-z0-9]/_/g')"
[ -f "$k.rc" ] && { echo "curl: (fake) $url" >&2; printf 000; exit "$(cat "$k.rc")"; }
[ -f "$k.code" ] || { echo "curl: (6) fake no fixture for $url" >&2; printf 000; exit 6; }
cp "$k.h" "$hdr"; cp "$k.body" "$body"; printf '%s' "$(cat "$k.code")"`,
  );
  stub('dig', `printf '%b\\n' "${world.dig ?? ''}"`);
  stub('openssl', `case "$1" in s_client) echo fake;; x509) echo "notAfter=${opensslDate(world.notAfterDays ?? 60)}";; esac`);
  if (world.dfPct !== undefined) {
    stub('df', `echo "Filesystem 1024-blocks Used Available Capacity Mounted on"; echo "/dev/vda1 100 ${world.dfPct} ${100 - world.dfPct} ${world.dfPct}% /"`);
  }
  if (world.dockerPs !== undefined) stub('docker', `printf '%b\\n' ${JSON.stringify(world.dockerPs)}`);
  const backupDir = join(dir, 'backups');
  mkdirSync(backupDir);
  if (world.backupAgeMinutes !== undefined && world.backupAgeMinutes !== null) {
    const f = join(backupDir, 'tubutree_20261018_020000.sql.gz');
    writeFileSync(f, 'x');
    const t = new Date(Date.now() - world.backupAgeMinutes * 60_000);
    spawnSync('touch', ['-t', `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}`, f]);
  }
  const res = spawnSync('bash', [SCRIPT, '--api-host', 'api.test.vn', '--app-host', 'app.test.vn', '--expect-ip', EXPECT_IP, '--backup-dir', backupDir, ...args], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, TMPDIR: dir },
  });
  rmSync(dir, { recursive: true, force: true });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

const lines = (out: string, level: 'OK' | 'WARN' | 'FAIL' | 'INFO') => out.split('\n').filter((l) => l.startsWith(level === 'OK' ? '[ OK ]' : `[${level}]`));

describe('ops/check-edge.sh', () => {
  it('--help in trợ giúp và thoát 0; tham số lạ thoát 2', () => {
    const help = spawnSync('bash', [SCRIPT, '--help'], { encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('--local');
    expect(help.stdout).toContain('Mã thoát');
    const bad = spawnSync('bash', [SCRIPT, '--khong-co'], { encoding: 'utf8' });
    expect(bad.status).toBe(2);
  });

  it('mọi thứ ổn: không FAIL, không WARN, thoát 0', () => {
    const { status, out } = run(goodWorld());
    expect(lines(out, 'FAIL')).toEqual([]);
    expect(lines(out, 'WARN')).toEqual([]);
    expect(status).toBe(0);
    expect(out).toContain('api.test.vn DNS: 14.225.207.177 (đúng IP VPS)');
    expect(out).toMatch(/api\.test\.vn chứng chỉ: còn (59|60) ngày/);
    expect(out).toContain('api nén: content-encoding=gzip');
    expect(out).toContain('api cache: Cache-Control=public, max-age=5, s-maxage=10');
    expect(out).toContain('api health: https://api.test.vn/api/health → 200');
  });

  it('phản hồi không nén → WARN (không FAIL)', () => {
    const w = goodWorld();
    w.pages['https://api.test.vn/api/home'] = { code: 200, headers: ['cache-control: public, s-maxage=10'], body: '{}' };
    const { status, out } = run(w);
    expect(lines(out, 'WARN').join('\n')).toContain('api nén: không có content-encoding');
    expect(lines(out, 'FAIL')).toEqual([]);
    expect(status).toBe(0);
  });

  it('API route công khai thiếu s-maxage → WARN', () => {
    const w = goodWorld();
    w.pages['https://api.test.vn/api/home'] = { code: 200, headers: ['content-encoding: gzip', 'cache-control: no-store'], body: '{}' };
    expect(lines(run(w).out, 'WARN').join('\n')).toContain('api cache');
  });

  it('chứng chỉ: còn 10 ngày → WARN, còn 3 ngày → FAIL thoát 1, đã hết hạn → FAIL', () => {
    const warn = run(goodWorld({ notAfterDays: 10 }));
    expect(lines(warn.out, 'WARN').join('\n')).toMatch(/chứng chỉ: còn (9|10) ngày/);
    expect(warn.status).toBe(0);
    const fail = run(goodWorld({ notAfterDays: 3 }));
    expect(lines(fail.out, 'FAIL').join('\n')).toMatch(/chứng chỉ: còn (2|3) ngày/);
    expect(fail.status).toBe(1);
    const expired = run(goodWorld({ notAfterDays: -2 }));
    expect(lines(expired.out, 'FAIL').join('\n')).toContain('ĐÃ HẾT HẠN');
    expect(expired.status).toBe(1);
  });

  it('/api/health trả 503 → FAIL thoát 1, in thân phản hồi', () => {
    const w = goodWorld();
    w.pages['https://api.test.vn/api/health'] = { code: 503, body: '{"status":"error","db":"up","redis":"down"}' };
    const { status, out } = run(w);
    expect(lines(out, 'FAIL').join('\n')).toContain('→ 503 {"status":"error","db":"up","redis":"down"}');
    expect(status).toBe(1);
  });

  it('không kết nối được → FAIL nêu lý do, không treo', () => {
    const w = goodWorld();
    w.pages['https://app.test.vn/'] = { rc: 7 };
    const { status, out } = run(w);
    expect(lines(out, 'FAIL').join('\n')).toContain('không kết nối được');
    expect(status).toBe(1);
  });

  it('DNS khác IP VPS: WARN khi trỏ thẳng, INFO khi đang qua Cloudflare (cf-ray)', () => {
    const direct = run(goodWorld({ dig: '1.2.3.4' }));
    expect(lines(direct.out, 'WARN').join('\n')).toContain('mong đợi 14.225.207.177');
    const w = goodWorld({ dig: '104.21.1.1\\n172.67.2.2' });
    w.pages['https://api.test.vn/api/home'] = { code: 200, headers: [...GOOD_API_HEADERS, 'cf-ray: abc-SIN', 'cf-cache-status: HIT'], body: '{}' };
    w.pages['https://app.test.vn/'] = { code: 200, headers: ['content-encoding: br', 'cf-ray: abc-SIN', 'cf-cache-status: DYNAMIC'], body: '<html>' };
    const cf = run(w);
    expect(lines(cf.out, 'WARN')).toEqual([]);
    expect(lines(cf.out, 'INFO').join('\n')).toContain('IP biên Cloudflare');
    expect(cf.out).toContain('cf-cache-status HIT → HIT');
  });

  it('--local: đĩa đầy 95% và container unhealthy → FAIL; backup mới → OK', () => {
    const { status, out } = run(
      goodWorld({ dfPct: 95, dockerPs: 'tubutree-api-1 Up 3 hours (unhealthy)\ntubutree-web-1 Up 3 hours (healthy)', backupAgeMinutes: 30 }),
      ['--local'],
    );
    const fails = lines(out, 'FAIL').join('\n');
    expect(fails).toContain('đĩa / (/): đầy 95%');
    expect(fails).toContain('tubutree-api-1');
    expect(lines(out, 'OK').join('\n')).toContain('backup: bản mới nhất trong 8 giờ qua');
    expect(status).toBe(1);
  });

  it('--local: đĩa 85% → WARN; backup cũ 10 giờ → WARN; chưa có backup → FAIL', () => {
    const stale = run(goodWorld({ dfPct: 85, dockerPs: 'tubutree-api-1 Up 3 hours (healthy)', backupAgeMinutes: 600 }), ['--local']);
    expect(lines(stale.out, 'WARN').join('\n')).toContain('đĩa / (/): đầy 85%');
    expect(lines(stale.out, 'WARN').join('\n')).toContain('cũ hơn 8 giờ');
    expect(lines(stale.out, 'OK').join('\n')).toContain('docker: không có container unhealthy');
    const none = run(goodWorld({ dfPct: 10, dockerPs: 'x Up (healthy)', backupAgeMinutes: null }), ['--local']);
    expect(lines(none.out, 'FAIL').join('\n')).toContain('chưa có file tubutree_*.sql.gz');
  });

  it('không có --local thì không đụng df/docker/backup', () => {
    const { out } = run(goodWorld({ dfPct: 99 }));
    expect(out).not.toContain('đĩa');
    expect(out).not.toContain('docker:');
    expect(out).not.toContain('backup:');
  });
});
