import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../../tools/deploy/prune-prev-images.sh');

/**
 * Chạy tools/deploy/prune-prev-images.sh với `docker` giả (danh sách image nằm trong file, `rmi` xoá dòng khỏi file) và một repo git thật
 * trong thư mục tạm, mỗi commit có giờ riêng để thứ tự deploy khác thứ tự chữ cái của SHA.
 */
function run(opts: {
  /** SHA8 nào commit lúc nào (epoch giây): càng lớn càng mới. SHA8 không có ở đây = không còn trong repo. */
  commits: Record<string, number>;
  /** Dòng "repo:tag giờ-build" của `docker images`; giờ build chỉ dùng khi SHA8 không có trong repo. */
  images: string[];
  args?: string[];
  env?: Record<string, string>;
  failRmi?: string;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'tubu-prune-'));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const git = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', ...env } });
  git(['init', '-q']);
  for (const [sha8, ts] of Object.entries(opts.commits)) {
    const date = `${ts} +0000`;
    const env = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
    git(['commit', '-q', '--allow-empty', '-m', sha8], env);
    // Không dựng được commit có SHA bắt đầu bằng sha8 cho trước; script chỉ cần `git show <sha8>^{commit}` ra đúng commit, nên đặt thẻ git tên sha8.
    git(['tag', sha8]);
  }
  const imagesFile = join(dir, 'images.txt');
  writeFileSync(imagesFile, `${opts.images.join('\n')}\n`);
  const log = join(dir, 'calls.log');
  writeFileSync(
    join(dir, 'docker'),
    `#!/usr/bin/env bash
echo "docker $*" >> "${log}"
case "$1" in
  images) awk '{print $1" "(NF>=3 ? $3 : "sha256:"$1)}' "${imagesFile}";;
  image) ref="\${@: -1}"; line="$(grep -F "$ref " "${imagesFile}" | head -n1)"; [ -n "$line" ] || exit 1; case "$*" in *Created*) echo "$line" | awk '{print $2}';; esac;;
  rmi) if [ -n "$FAIL_RMI" ] && [ "$2" = "$FAIL_RMI" ]; then exit 1; fi; grep -vF "$2 " "${imagesFile}" > "${imagesFile}.new" || true; mv "${imagesFile}.new" "${imagesFile}";;
  system) echo "TYPE TOTAL";;
esac
exit 0
`,
  );
  chmodSync(join(dir, 'docker'), 0o755);
  const res = spawnSync('bash', [SCRIPT, ...(opts.args ?? [])], {
    encoding: 'utf8',
    env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir, REPO_DIR: repo, FAIL_RMI: opts.failRmi ?? '', ...opts.env },
  });
  // Script thoát sớm vì tham số sai thì chưa gọi docker lần nào.
  let calls: string[] = [];
  try {
    calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    /* chưa có lần gọi nào */
  }
  const remaining = readFileSync(imagesFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split(' ')[0]!);
  rmSync(dir, { recursive: true, force: true });
  return {
    status: res.status,
    out: `${res.stdout}${res.stderr}`,
    rmi: calls.filter((c) => c.startsWith('docker rmi ')).map((c) => c.slice('docker rmi '.length)),
    remaining,
  };
}

const pair = (sha: string) => [`tubutree-api:prev-${sha} 2020-01-01T00:00:00Z`, `tubutree-web:prev-${sha} 2020-01-01T00:00:00Z`];
const FIXED = ['tubutree-api:latest 2026-11-07T00:00:00Z', 'tubutree-web:latest 2026-11-07T00:00:00Z', 'tubutree-api:rollback 2026-11-06T00:00:00Z', 'tubutree-web:rollback 2026-11-06T00:00:00Z'];
const names = (lines: string[]) => lines.map((l) => l.split(' ')[0]!);

// SHA8 hợp lệ (hex) nhưng thứ tự chữ cái NGƯỢC thứ tự deploy: bản cũ nhất có SHA lớn nhất theo chữ cái.
const T0 = 1_800_000_000;
const COMMITS = { eeeeeee5: T0 + 500, ddddddd4: T0 + 1000, ccccccc3: T0 + 2000, bbbbbbb2: T0 + 3000, aaaaaaa1: T0 + 4000 };
const ALL = [...FIXED, ...Object.keys(COMMITS).flatMap(pair)];

describe('tools/deploy/prune-prev-images.sh', () => {
  it('chạy không cờ: in kế hoạch, giữ 3 bản gần nhất theo thứ tự deploy, KHÔNG xoá gì', () => {
    const r = run({ commits: COMMITS, images: ALL });
    expect(r.status).toBe(0);
    expect(r.rmi).toEqual([]);
    expect(r.out).toContain('Giữ 3 bản gần nhất:');
    expect(r.out).toMatch(/prev-aaaaaaa1\n\s+prev-bbbbbbb2\n\s+prev-ccccccc3/);
    expect(r.out).toContain('tubutree-api:prev-ddddddd4');
    expect(r.out).toContain('tubutree-web:prev-eeeeeee5');
    expect(r.out).not.toContain('tubutree-api:prev-aaaaaaa1');
  });

  it('--apply: gỡ đúng cặp api và web của các bản cũ; KHÔNG đụng :latest, :rollback hay bản được giữ', () => {
    const r = run({ commits: COMMITS, images: ALL, args: ['--apply'] });
    expect(r.status).toBe(0);
    expect(r.rmi.sort()).toEqual(['tubutree-api:prev-ddddddd4', 'tubutree-api:prev-eeeeeee5', 'tubutree-web:prev-ddddddd4', 'tubutree-web:prev-eeeeeee5']);
    expect(r.remaining.sort()).toEqual([...names(FIXED), ...['aaaaaaa1', 'bbbbbbb2', 'ccccccc3'].flatMap((s) => [`tubutree-api:prev-${s}`, `tubutree-web:prev-${s}`])].sort());
    expect(r.out).toContain('Đã gỡ 4 thẻ, lỗi 0.');
  });

  it('chạy lại sau khi đã dọn: không còn gì để xoá', () => {
    const r = run({ commits: COMMITS, images: [...FIXED, ...['aaaaaaa1', 'bbbbbbb2', 'ccccccc3'].flatMap(pair)], args: ['--apply'] });
    expect(r.status).toBe(0);
    expect(r.rmi).toEqual([]);
    expect(r.out).toContain('Không có gì để xoá.');
  });

  it('KEEP_PREV đổi số bản giữ', () => {
    const r = run({ commits: COMMITS, images: ALL, args: ['--apply'], env: { KEEP_PREV: '4' } });
    expect(r.rmi.sort()).toEqual(['tubutree-api:prev-eeeeeee5', 'tubutree-web:prev-eeeeeee5']);
  });

  it.each(['0', 'abc', '-1'])('KEEP_PREV=%j không hợp lệ → thoát 2, không gỡ gì', (v) => {
    const r = run({ commits: COMMITS, images: ALL, args: ['--apply'], env: { KEEP_PREV: v } });
    expect(r.status).toBe(2);
    expect(r.rmi).toEqual([]);
  });

  it('cờ lạ → thoát 2, không gỡ gì', () => {
    const r = run({ commits: COMMITS, images: ALL, args: ['--force'] });
    expect(r.status).toBe(2);
    expect(r.rmi).toEqual([]);
  });

  it('chỉ nhận thẻ đúng dạng prev-<8 hex> của api và web: bỏ qua dạng khác và image khác', () => {
    const others = [
      'tubutree-api:prev-latest 2020-01-01T00:00:00Z',
      'tubutree-api:prev-ABCDEF12 2020-01-01T00:00:00Z',
      'tubutree-api:prev-abc 2020-01-01T00:00:00Z',
      'tubutree-api:prev-aaaaaaaaa 2020-01-01T00:00:00Z',
      'tubutree-zalo-bridge:prev-ddddddd4 2020-01-01T00:00:00Z',
      'postgres:prev-eeeeeee5 2020-01-01T00:00:00Z',
    ];
    const r = run({ commits: COMMITS, images: [...FIXED, ...others, ...Object.keys(COMMITS).flatMap(pair)], args: ['--apply'] });
    expect(r.rmi.sort()).toEqual(['tubutree-api:prev-ddddddd4', 'tubutree-api:prev-eeeeeee5', 'tubutree-web:prev-ddddddd4', 'tubutree-web:prev-eeeeeee5']);
    for (const o of names(others)) expect(r.remaining).toContain(o);
  });

  it('SHA chỉ có ở một image: vẫn xử lý, bỏ qua image còn lại', () => {
    const r = run({ commits: COMMITS, images: [...FIXED, ...['aaaaaaa1', 'bbbbbbb2', 'ccccccc3', 'ddddddd4'].flatMap(pair), 'tubutree-api:prev-eeeeeee5 2020-01-01T00:00:00Z'], args: ['--apply'] });
    expect(r.rmi.sort()).toEqual(['tubutree-api:prev-ddddddd4', 'tubutree-api:prev-eeeeeee5', 'tubutree-web:prev-ddddddd4']);
  });

  it('SHA không còn trong repo: không làm script dừng, xếp là bản cũ nhất theo giờ build', () => {
    const known = { ddddddd4: T0 + 1000, ccccccc3: T0 + 2000, bbbbbbb2: T0 + 3000, aaaaaaa1: T0 + 4000 };
    const r = run({ commits: known, images: ALL, args: ['--apply'] });
    expect(r.status).toBe(0);
    expect(r.rmi).toContain('tubutree-api:prev-eeeeeee5');
    expect(r.remaining).toContain('tubutree-api:prev-aaaaaaa1');
  });

  it('gỡ một thẻ lỗi (container đang dùng) → báo, đếm lỗi, vẫn gỡ các thẻ còn lại và thoát 0', () => {
    const r = run({ commits: COMMITS, images: ALL, args: ['--apply'], failRmi: 'tubutree-api:prev-ddddddd4' });
    expect(r.status).toBe(0);
    expect(r.out).toContain('KHÔNG gỡ được tubutree-api:prev-ddddddd4');
    expect(r.out).toContain('Đã gỡ 3 thẻ, lỗi 1.');
    expect(r.rmi).toContain('tubutree-web:prev-eeeeeee5');
  });

  it('không có thẻ :prev-* nào → thoát 0, không gỡ gì', () => {
    const r = run({ commits: {}, images: FIXED, args: ['--apply'] });
    expect(r.status).toBe(0);
    expect(r.rmi).toEqual([]);
    expect(r.out).toContain('Không có thẻ :prev-* nào.');
  });

  describe('đếm theo image khác nhau, không theo số thẻ', () => {
    /** Cặp thẻ api + web của một SHA, kèm id image (giờ build cố định, chỉ dùng khi SHA không còn trong repo). */
    const withIds = (sha: string, apiId: string, webId: string) => [`tubutree-api:prev-${sha} 2020-01-01T00:00:00Z ${apiId}`, `tubutree-web:prev-${sha} 2020-01-01T00:00:00Z ${webId}`];

    it('hai SHA cùng một cặp image tính là MỘT bản: giữ 3 image khác nhau, thẻ phụ của bản được giữ ở lại, chỉ bản thứ tư bị gỡ', () => {
      // aaaaaaa1 và bbbbbbb2 trỏ cùng image (di chứng dán nhầm sau rollback); còn ccccccc3, ddddddd4, eeeeeee5 mỗi cái một image.
      const images = [
        ...FIXED,
        ...withIds('aaaaaaa1', 'sha256:i1', 'sha256:w1'),
        ...withIds('bbbbbbb2', 'sha256:i1', 'sha256:w1'),
        ...withIds('ccccccc3', 'sha256:i3', 'sha256:w3'),
        ...withIds('ddddddd4', 'sha256:i4', 'sha256:w4'),
        ...withIds('eeeeeee5', 'sha256:i5', 'sha256:w5'),
      ];
      const r = run({ commits: COMMITS, images, args: ['--apply'] });
      expect(r.status).toBe(0);
      // Nếu đếm theo thẻ, chỉ giữ aaaaaaa1/bbbbbbb2/ccccccc3 (2 image); đếm theo image thì giữ cả image của ccccccc3 và ddddddd4 và chỉ gỡ eeeeeee5.
      expect(r.rmi.sort()).toEqual(['tubutree-api:prev-eeeeeee5', 'tubutree-web:prev-eeeeeee5']);
      expect(r.remaining).toEqual(expect.arrayContaining(['tubutree-api:prev-aaaaaaa1', 'tubutree-api:prev-bbbbbbb2', 'tubutree-api:prev-ccccccc3', 'tubutree-api:prev-ddddddd4']));
    });

    it('chỉ api trùng id còn web khác: hai bản riêng, không gom', () => {
      const images = [
        ...FIXED,
        ...withIds('aaaaaaa1', 'sha256:i1', 'sha256:w1'),
        ...withIds('bbbbbbb2', 'sha256:i1', 'sha256:w2'),
        ...withIds('ccccccc3', 'sha256:i3', 'sha256:w3'),
        ...withIds('ddddddd4', 'sha256:i4', 'sha256:w4'),
      ];
      const r = run({ commits: COMMITS, images, args: ['--apply'] });
      // 4 bản khác nhau (aaaaaaa1 mới nhất, ddddddd4 cũ nhất): giữ 3 gần nhất, gỡ ddddddd4.
      expect(r.rmi.sort()).toEqual(['tubutree-api:prev-ddddddd4', 'tubutree-web:prev-ddddddd4']);
    });

    it('chưa có bản nào trùng image: giữ nguyên hành vi cũ (3 thẻ gần nhất)', () => {
      const r = run({ commits: COMMITS, images: ALL, args: ['--apply'] });
      expect(r.rmi.sort()).toEqual(['tubutree-api:prev-ddddddd4', 'tubutree-api:prev-eeeeeee5', 'tubutree-web:prev-ddddddd4', 'tubutree-web:prev-eeeeeee5']);
    });

    it('kế hoạch nêu thẻ nào dùng chung image với thẻ nào', () => {
      const images = [
        ...FIXED,
        ...withIds('aaaaaaa1', 'sha256:i1', 'sha256:w1'),
        ...withIds('bbbbbbb2', 'sha256:i1', 'sha256:w1'),
        ...withIds('ccccccc3', 'sha256:i3', 'sha256:w3'),
      ];
      const r = run({ commits: COMMITS, images });
      expect(r.status).toBe(0);
      expect(r.out).toMatch(/prev-bbbbbbb2.*cùng image.*prev-aaaaaaa1|prev-aaaaaaa1.*cùng image.*prev-bbbbbbb2/);
    });
  });
});
