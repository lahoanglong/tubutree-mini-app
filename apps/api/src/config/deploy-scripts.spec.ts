import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const REPO = join(__dirname, '../../../..');

/**
 * Chạy script ops với một `docker` giả trên PATH: ghi lại từng lệnh, lệnh khớp FAIL_ON thì exit 1,
 * `inspect` trả "healthy", `ps -q` trả một id giả. Không đụng Docker thật.
 */
function runWithFakeDocker(script: string, args: string[], opts: { failOn?: string; stdin?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tubu-ops-'));
  const log = join(dir, 'calls.log');
  writeFileSync(
    join(dir, 'docker'),
    `#!/usr/bin/env bash
echo "docker $*" >> "${log}"
if [ -n "$FAIL_ON" ] && [[ "$*" == *"$FAIL_ON"* ]]; then exit 1; fi
case "$*" in
  *inspect*) echo healthy;;
  *" ps -q "*) echo fakeid;;
  *"psql"*) cat > /dev/null;;
esac
exit 0
`,
  );
  chmodSync(join(dir, 'docker'), 0o755);
  writeFileSync(join(dir, 'backup.sql.gz'), gzipSync('SELECT 1;\n'));
  const res = spawnSync('bash', [join(REPO, script), ...args.map((a) => a.replace('$TMP', dir))], {
    cwd: REPO,
    input: opts.stdin ?? '',
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      HOME: dir,
      FAIL_ON: opts.failOn ?? '',
      DEPLOY_HEALTH_TIMEOUT: '2',
      BACKUP_DIR: join(dir, 'backups'),
    },
  });
  let calls: string[] = [];
  try {
    calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    /* script không gọi docker lần nào */
  }
  rmSync(dir, { recursive: true, force: true });
  return { status: res.status, out: `${res.stdout}${res.stderr}`, calls };
}

const idx = (calls: string[], needle: string) => calls.findIndex((c) => c.includes(needle));

describe('tools/deploy/deploy.sh', () => {
  it('build image MỚI trước, rồi migrate bằng chính image đó, rồi mới thay container', () => {
    const { status, calls, out } = runWithFakeDocker('tools/deploy/deploy.sh', []);
    expect({ status, out }).toMatchObject({ status: 0 });
    const build = idx(calls, ' build api web');
    const migrate = idx(calls, 'run --rm --no-deps api pnpm exec prisma migrate deploy');
    const upApi = idx(calls, 'up -d --no-build api');
    const upWeb = idx(calls, 'up -d --no-build web');
    expect(build).toBeGreaterThan(-1);
    expect(migrate).toBeGreaterThan(build);
    expect(upApi).toBeGreaterThan(migrate);
    expect(upWeb).toBeGreaterThan(upApi);
    expect(calls.filter((c) => c.startsWith('docker compose')).every((c) => c.includes('docker-compose.vietnix.yml'))).toBe(true);
  });

  it('kiểm cấu hình môi trường bằng image MỚI trước khi migrate/thay container (R2-PLATFORM-4)', () => {
    const { status, calls } = runWithFakeDocker('tools/deploy/deploy.sh', []);
    expect(status).toBe(0);
    const build = idx(calls, ' build api web');
    const check = idx(calls, 'run --rm --no-deps api node dist/config/check-env.js');
    expect(check).toBeGreaterThan(build);
    expect(idx(calls, 'migrate deploy')).toBeGreaterThan(check);
  });

  it('.env sai → dừng trước migrate, KHÔNG thay container đang chạy', () => {
    const { status, calls, out } = runWithFakeDocker('tools/deploy/deploy.sh', [], { failOn: 'check-env' });
    expect(status).toBe(2);
    expect(idx(calls, 'migrate deploy')).toBe(-1);
    expect(idx(calls, ' up ')).toBe(-1);
    expect(out).toContain('.env');
  });

  it('api mới không healthy → dừng, in cách quay lại image trước', () => {
    const { status, out, calls } = runWithFakeDocker('tools/deploy/deploy.sh', [], { failOn: '.State.Health' });
    expect(status).not.toBe(0);
    expect(out).toMatch(/docker tag \S+ \S+/);
    expect(idx(calls, 'up -d --no-build web')).toBe(-1);
  });

  it('migration lỗi → dừng, KHÔNG thay container đang chạy', () => {
    const { status, calls } = runWithFakeDocker('tools/deploy/deploy.sh', [], { failOn: 'migrate deploy' });
    expect(status).not.toBe(0);
    expect(idx(calls, ' up ')).toBe(-1);
  });
});

describe('tools/backup/restore-db.sh', () => {
  it('restore vào DB tạm, chỉ đổi tên sang DB thật khi restore xong; giữ DB cũ để quay lại', () => {
    const { status, calls, out } = runWithFakeDocker('tools/backup/restore-db.sh', ['$TMP/backup.sql.gz'], { stdin: 'YES\n' });
    expect({ status, out }).toMatchObject({ status: 0 });
    const create = idx(calls, 'CREATE DATABASE "tubutree_restore_');
    const load = idx(calls, '-d tubutree_restore_');
    const stop = idx(calls, ' stop api');
    const rename = idx(calls, 'RENAME TO "tubutree_before_restore_');
    const start = idx(calls, ' start api');
    expect(create).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(create);
    expect(stop).toBeGreaterThan(load);
    expect(rename).toBeGreaterThan(stop);
    expect(start).toBeGreaterThan(rename);
    expect(calls.some((c) => / -d tubutree( |$)/.test(c))).toBe(false);
  });

  it('nạp dump lỗi → DB thật không bị đụng, api không bị dừng', () => {
    const { status, calls } = runWithFakeDocker('tools/backup/restore-db.sh', ['$TMP/backup.sql.gz'], {
      stdin: 'YES\n',
      failOn: '-d tubutree_restore_',
    });
    expect(status).not.toBe(0);
    expect(idx(calls, ' stop api')).toBe(-1);
    expect(idx(calls, 'RENAME')).toBe(-1);
  });

  it('không gõ YES → không làm gì', () => {
    const { status, calls } = runWithFakeDocker('tools/backup/restore-db.sh', ['$TMP/backup.sql.gz'], { stdin: 'no\n' });
    expect(status).toBe(0);
    expect(calls.filter((c) => c.includes('psql'))).toEqual([]);
  });
});

describe('tools/backup/backup-db.sh', () => {
  it('mặc định dùng compose của VPS đang chạy thật (vietnix)', () => {
    const { calls } = runWithFakeDocker('tools/backup/backup-db.sh', [], {});
    expect(calls.find((c) => c.includes('pg_dump'))).toContain('docker-compose.vietnix.yml');
  });
});
