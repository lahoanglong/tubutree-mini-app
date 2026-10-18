import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseCronBackup } from './go-live/backup-checks';

const REPO = join(__dirname, '../../../..');

/**
 * Chạy script ops với một `docker` giả trên PATH: ghi lại từng lệnh, lệnh khớp FAIL_ON thì exit 1,
 * `inspect` trả "healthy", `ps -q` trả một id giả. Không đụng Docker thật.
 */
function runWithFakeDocker(
  script: string,
  args: string[],
  opts: {
    failOn?: string;
    stdin?: string;
    env?: Record<string, string>;
    /** Lệnh giả khác (rclone, curl...): ghi lại từng lần gọi vào calls.log, thoát 0 (thoát 1 khi khớp failOn như docker). */
    stubs?: string[];
    /** File có sẵn trong BACKUP_DIR trước khi chạy. */
    seed?: string[];
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'tubu-ops-'));
  const log = join(dir, 'calls.log');
  writeFileSync(
    join(dir, 'docker'),
    `#!/usr/bin/env bash
echo "docker $*" >> "${log}"
if [ -n "$FAIL_ON" ] && [[ "$*" == *"$FAIL_ON"* ]]; then exit 1; fi
case "$*" in
  *"State.Running"*) echo "\${FAKE_API_RUNNING:-false}";;
  *inspect*) echo healthy;;
  *" ps -q "*) echo fakeid;;
  *"psql"*) q="$(cat)"; if [ -n "$FAKE_PSQL_FAIL" ]; then exit 1; fi; case "$q" in *points_1d*) echo "\${FAKE_POINTS_1D_APPLIED:-0}";; *) echo 1;; esac;;
esac
exit 0
`,
  );
  chmodSync(join(dir, 'docker'), 0o755);
  for (const name of opts.stubs ?? []) {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\necho "${name} $*" >> "${log}"\nif [ -n "$FAIL_ON" ] && [[ "$*" == *"$FAIL_ON"* ]]; then exit 1; fi\nexit 0\n`);
    chmodSync(join(dir, name), 0o755);
  }
  mkdirSync(join(dir, 'backups'));
  for (const name of opts.seed ?? []) writeFileSync(join(dir, 'backups', name), 'x');
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
      ...opts.env,
    },
  });
  let files: string[] = [];
  try {
    files = readdirSync(join(dir, 'backups')).sort();
  } catch {
    /* script chưa tạo thư mục */
  }
  let calls: string[] = [];
  try {
    calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    /* script không gọi docker lần nào */
  }
  rmSync(dir, { recursive: true, force: true });
  return { status: res.status, out: `${res.stdout}${res.stderr}`, calls, files };
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

describe('tools/deploy/deploy.sh: migration points_1d (đổi đơn vị điểm, không chạy khi API cũ còn phục vụ)', () => {
  const run = (env: Record<string, string>, extra: { failOn?: string } = {}) => runWithFakeDocker('tools/deploy/deploy.sh', [], { env, ...extra });

  it('API cũ đang chạy và points_1d chưa áp → build trước, rồi dừng API, migrate, seed-reference, bật API', () => {
    const { status, calls, out } = run({ FAKE_API_RUNNING: 'true', FAKE_POINTS_1D_APPLIED: '0' });
    expect({ status, out }).toMatchObject({ status: 0 });
    const build = idx(calls, ' build api web');
    const stop = idx(calls, ' stop api');
    const migrate = idx(calls, 'migrate deploy');
    const seed = idx(calls, 'prisma:seed:reference');
    const upApi = idx(calls, 'up -d --no-build api');
    expect(build).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(build);
    expect(migrate).toBeGreaterThan(stop);
    expect(seed).toBeGreaterThan(migrate);
    expect(upApi).toBeGreaterThan(seed);
    expect(out).toMatch(/backup/);
  });

  it('API cũ đang chạy, points_1d chưa áp, build lỗi → dừng, API cũ KHÔNG bị dừng, chưa migrate', () => {
    const { status, calls } = run({ FAKE_API_RUNNING: 'true', FAKE_POINTS_1D_APPLIED: '0' }, { failOn: ' build api web' });
    expect(status).not.toBe(0);
    expect(idx(calls, ' stop ')).toBe(-1);
    expect(idx(calls, 'migrate deploy')).toBe(-1);
    expect(idx(calls, ' up ')).toBe(-1);
  });

  it('API cũ đang chạy, points_1d chưa áp, migrate lỗi → API đã dừng, KHÔNG tự bật lại, không seed', () => {
    const { status, calls, out } = run({ FAKE_API_RUNNING: 'true', FAKE_POINTS_1D_APPLIED: '0' }, { failOn: 'migrate deploy' });
    expect(status).toBe(2);
    expect(idx(calls, ' stop api')).toBeGreaterThan(-1);
    expect(idx(calls, 'prisma:seed:reference')).toBe(-1);
    expect(idx(calls, ' up ')).toBe(-1);
    expect(out).toMatch(/API đã bị dừng/);
  });

  it('API cũ đang chạy, points_1d chưa áp, seed-reference lỗi → không bật API', () => {
    const { status, calls } = run({ FAKE_API_RUNNING: 'true', FAKE_POINTS_1D_APPLIED: '0' }, { failOn: 'prisma:seed:reference' });
    expect(status).toBe(2);
    expect(idx(calls, ' up ')).toBe(-1);
  });

  it('API đang dừng và points_1d chưa áp → deploy chạy bình thường (build, migrate, thay container)', () => {
    const { status, calls } = run({ FAKE_API_RUNNING: 'false', FAKE_POINTS_1D_APPLIED: '0' });
    expect(status).toBe(0);
    expect(idx(calls, 'migrate deploy')).toBeGreaterThan(idx(calls, ' build api web'));
    expect(idx(calls, ' stop ')).toBe(-1);
    expect(idx(calls, 'prisma:seed:reference')).toBe(-1);
  });

  it('points_1d đã áp xong thì API đang chạy không còn bị chặn bởi nó', () => {
    const { status, calls } = run({ FAKE_API_RUNNING: 'true', FAKE_POINTS_1D_APPLIED: '1' });
    expect(status).toBe(0);
    expect(idx(calls, ' stop ')).toBe(-1);
  });

  it('api mới không healthy sau khi points_1d đã áp → KHÔNG gợi ý quay image cũ, nói khôi phục backup', () => {
    const { status, out } = run({ FAKE_POINTS_1D_APPLIED: '1' }, { failOn: '.State.Health' });
    expect(status).not.toBe(0);
    expect(out).not.toMatch(/docker tag \S+ \S+/);
    expect(out).toMatch(/khôi phục backup/);
  });

  it('không đọc được DB (psql lỗi) khi api mới không healthy → cảnh báo kiểm points_1d, KHÔNG in lệnh quay image cũ', () => {
    const { status, out } = run({ FAKE_PSQL_FAIL: '1' }, { failOn: '.State.Health' });
    expect(status).not.toBe(0);
    expect(out).toMatch(/không đọc được DB/);
    expect(out).toMatch(/points_1d/);
    expect(out).not.toMatch(/docker tag \S+ \S+/);
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

  it('không đặt nhãn: tên file giữ nguyên tubutree_<giờ>.sql.gz (go-live:check, runbook và restore-db.sh tìm theo mẫu này)', () => {
    const { status, files } = runWithFakeDocker('tools/backup/backup-db.sh', [], {});
    expect(status).toBe(0);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^tubutree_\d{8}_\d{6}\.sql\.gz$/);
  });

  it('BACKUP_LABEL gắn nhãn vào tên file, vẫn khớp mẫu tubutree_*.sql.gz', () => {
    const { status, files } = runWithFakeDocker('tools/backup/backup-db.sh', [], { env: { BACKUP_LABEL: 'predeploy' } });
    expect(status).toBe(0);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^tubutree_\d{8}_\d{6}_predeploy\.sql\.gz$/);
  });

  it('nhãn hoặc số bản giữ sai dạng: dừng ngay, chưa gọi docker', () => {
    const bad: Record<string, string>[] = [{ BACKUP_LABEL: '../x' }, { BACKUP_LABEL: 'a b' }, { BACKUP_KEEP_COUNT: 'abc' }, { BACKUP_KEEP_COUNT: '-1' }];
    for (const env of bad) {
      const { status, calls, files } = runWithFakeDocker('tools/backup/backup-db.sh', [], { env });
      expect({ env, status }).toEqual({ env, status: 1 });
      expect(calls).toEqual([]);
      expect(files).toEqual([]);
    }
  });

  it('BACKUP_KEEP_COUNT giữ N bản MỚI NHẤT của cùng nhãn, không đụng nhãn khác hay bản không nhãn', () => {
    const cron = [1, 2, 3, 4, 5].map((h) => `tubutree_20260101_0${h}0000_cron.sql.gz`);
    const pre = ['tubutree_20250101_000000_predeploy.sql.gz', 'tubutree_20250102_000000_predeploy.sql.gz'];
    const legacy = ['tubutree_20240101_020000.sql.gz'];
    const { status, files } = runWithFakeDocker('tools/backup/backup-db.sh', [], {
      env: { BACKUP_LABEL: 'cron', BACKUP_KEEP_COUNT: '3' },
      seed: [...cron, ...pre, ...legacy],
    });
    expect(status).toBe(0);
    const cronLeft = files.filter((f) => f.endsWith('_cron.sql.gz'));
    expect(cronLeft).toHaveLength(3);
    expect(cronLeft).toEqual(expect.arrayContaining(['tubutree_20260101_040000_cron.sql.gz', 'tubutree_20260101_050000_cron.sql.gz']));
    expect(files).toEqual(expect.arrayContaining([...pre, ...legacy]));
  });

  it('không đặt BACKUP_KEEP_COUNT: không xoá theo số bản (chỉ quy tắc theo ngày như trước)', () => {
    const seed = [1, 2, 3, 4].map((h) => `tubutree_20260101_0${h}0000_cron.sql.gz`);
    const { files } = runWithFakeDocker('tools/backup/backup-db.sh', [], { env: { BACKUP_LABEL: 'cron' }, seed });
    expect(files.filter((f) => f.endsWith('_cron.sql.gz'))).toHaveLength(5);
  });

  it('chưa có RCLONE_REMOTE và HEALTHCHECK_URL: vẫn lưu local, thoát 0, in cảnh báo cả hai', () => {
    const { status, out, files } = runWithFakeDocker('tools/backup/backup-db.sh', [], {});
    expect(status).toBe(0);
    expect(files).toHaveLength(1);
    expect(out).toMatch(/WARN: RCLONE_REMOTE chưa đặt.*cùng đĩa/);
    expect(out).toMatch(/WARN: HEALTHCHECK_URL chưa đặt/);
  });

  it('có RCLONE_REMOTE và HEALTHCHECK_URL: đẩy đúng file ra ngoài máy, ping khi xong, không cảnh báo', () => {
    const { status, out, calls, files } = runWithFakeDocker('tools/backup/backup-db.sh', [], {
      env: { BACKUP_LABEL: 'cron', RCLONE_REMOTE: 'r2:bk/db', HEALTHCHECK_URL: 'https://hc.test/abc' },
      stubs: ['rclone', 'curl'],
    });
    expect(status).toBe(0);
    expect(out).not.toMatch(/WARN: (RCLONE_REMOTE|HEALTHCHECK_URL)/);
    expect(calls.find((c) => c.startsWith('rclone copy'))).toMatch(/rclone copy \S+tubutree_\d{8}_\d{6}_cron\.sql\.gz r2:bk\/db$/);
    expect(files).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith('curl')).pop()).toMatch(/https:\/\/hc\.test\/abc$/);
  });

  it('đẩy ra ngoài máy lỗi: thoát 3, ping /fail, bản local vẫn giữ và vẫn dọn theo số bản (đĩa không đầy khi remote hỏng nhiều ngày)', () => {
    const seed = [1, 2, 3].map((h) => `tubutree_20260101_0${h}0000_cron.sql.gz`);
    const { status, calls, files } = runWithFakeDocker('tools/backup/backup-db.sh', [], {
      env: { BACKUP_LABEL: 'cron', BACKUP_KEEP_COUNT: '2', RCLONE_REMOTE: 'r2:bk/db', HEALTHCHECK_URL: 'https://hc.test/abc' },
      stubs: ['curl'],
      seed,
      failOn: 'r2:bk/db',
    });
    expect(status).toBe(3);
    expect(calls.filter((c) => c.startsWith('curl')).pop()).toMatch(/https:\/\/hc\.test\/abc\/fail$/);
    expect(files.filter((f) => f.endsWith('_cron.sql.gz'))).toHaveLength(2);
  });
});

describe('ops/backup-predeploy.sh', () => {
  it('gắn nhãn predeploy, giữ 10 bản, và KHÔNG ping HEALTHCHECK_URL của cron (ping bất thường che việc cron ngừng chạy)', () => {
    const seed = Array.from({ length: 12 }, (_, i) => `tubutree_20260101_${String(i).padStart(2, '0')}0000_predeploy.sql.gz`);
    const { status, files, calls, out } = runWithFakeDocker('ops/backup-predeploy.sh', [], {
      env: { HEALTHCHECK_URL: 'https://hc.test/cron-only' },
      stubs: ['curl'],
      seed,
    });
    expect(status).toBe(0);
    expect(files.filter((f) => f.endsWith('_predeploy.sql.gz'))).toHaveLength(10);
    expect(calls.filter((c) => c.startsWith('curl'))).toEqual([]);
    expect(out).not.toMatch(/WARN: HEALTHCHECK_URL/);
  });

  it('PREDEPLOY_HEALTHCHECK_URL (nếu đặt) được ping khi xong', () => {
    const { calls } = runWithFakeDocker('ops/backup-predeploy.sh', [], { env: { PREDEPLOY_HEALTHCHECK_URL: 'https://hc.test/pre' }, stubs: ['curl'] });
    expect(calls.filter((c) => c.startsWith('curl')).pop()).toMatch(/https:\/\/hc\.test\/pre$/);
  });
});

describe('ops/crontab.backup.example', () => {
  const sample = readFileSync(join(REPO, 'ops/crontab.backup.example'), 'utf8');

  it('dòng cron 6 giờ/lần được go-live:check nhận ra: có backup-db.sh, remote rclone và healthcheck', () => {
    expect(parseCronBackup(sample)).toEqual({ hasBackupLine: true, remoteName: 'gdrive', hasHealthcheck: true });
    const active = sample.split('\n').filter((l) => /backup-db\.sh/.test(l) && !l.trim().startsWith('#'));
    expect(active).toHaveLength(1);
    expect(active[0]).toMatch(/^17 \*\/6 \* \* \* /);
    expect(active[0]).toContain('BACKUP_LABEL=cron');
    expect(active[0]).toContain('BACKUP_KEEP_COUNT=120');
  });

  it('giữ 120 bản cron (30 ngày x 4) trong mọi nơi cài cron, để không lùi so với 30 ngày của cron 02:00 cũ', () => {
    const ops = readFileSync(join(REPO, '.github/workflows/ops.yml'), 'utf8');
    expect(ops.match(/BACKUP_KEEP_COUNT=(\d+)/g)).toEqual(['BACKUP_KEEP_COUNT=120', 'BACKUP_KEEP_COUNT=120']);
    expect(sample).toMatch(/chỉ hạ[^\n]*RCLONE_REMOTE/i);
  });
});
