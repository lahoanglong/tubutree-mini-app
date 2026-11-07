import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = join(__dirname, '../../../../tools/deploy/tag-prev-images.sh');
const PRUNE = join(__dirname, '../../../../tools/deploy/prune-prev-images.sh');

const API = 'tubutree-api';
const WEB = 'tubutree-web';
const T0 = 1_800_000_000;

/** ID image dạng sha256 đủ dài, 8 ký tự đầu là hex để dùng làm nhãn dự phòng khi không biết SHA. */
const imageId = (n: number) => `sha256:${n.toString(16).padStart(8, '0')}${'0'.repeat(56)}`;
const FULL = (sha8: string) => `${sha8}${'0'.repeat(32)}`;

/**
 * Máy "VPS" giả: `docker` giả giữ danh sách `tên id giờ-build` trong một file (tag ghi đè dòng cùng tên, rmi xoá dòng), và một repo git thật
 * có mỗi SHA8 là một thẻ git với giờ commit riêng. Chạy đúng các script thật trong tools/deploy.
 */
class Vps {
  readonly dir = mkdtempSync(join(tmpdir(), 'tubu-prev-'));
  private readonly repo = join(this.dir, 'repo');
  private readonly imagesFile = join(this.dir, 'images.txt');
  private readonly log = join(this.dir, 'calls.log');

  constructor(commits: Record<string, number>) {
    mkdirSync(this.repo);
    const git = (args: string[], env: Record<string, string> = {}) =>
      spawnSync('git', args, { cwd: this.repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', ...env } });
    git(['init', '-q']);
    for (const [sha8, ts] of Object.entries(commits)) {
      const date = `${ts} +0000`;
      git(['commit', '-q', '--allow-empty', '-m', sha8], { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
      git(['tag', sha8]);
    }
    writeFileSync(this.imagesFile, '');
    writeFileSync(
      join(this.dir, 'docker'),
      `#!/usr/bin/env bash
IMG="${this.imagesFile}"
echo "docker $*" >> "${this.log}"
id_of() { awk -v r="$1" '$1==r {print $2; exit}' "$IMG"; }
drop() { grep -vF "$1 " "$IMG" > "$IMG.new" || true; mv "$IMG.new" "$IMG"; }
case "$1" in
  images) awk '{print $1" "$2}' "$IMG";;
  image) ref="\${@: -1}"; id="$(id_of "$ref")"; [ -n "$id" ] || exit 1
         case "$*" in *Created*) awk -v r="$ref" '$1==r {print $3; exit}' "$IMG";; *) echo "$id";; esac;;
  tag) id="$(id_of "$2")"; [ -n "$id" ] || id="$2"; drop "$3"; echo "$3 $id 2020-01-01T00:00:00Z" >> "$IMG";;
  rmi) drop "$2";;
  system) echo "TYPE TOTAL";;
esac
exit 0
`,
    );
    chmodSync(join(this.dir, 'docker'), 0o755);
  }

  /** Đặt thẳng một thẻ trỏ vào một image (dựng sẵn trạng thái VPS). */
  set(name: string, id: string) {
    const lines = this.read().filter(([n]) => n !== name);
    lines.push([name, id, '2020-01-01T00:00:00Z']);
    writeFileSync(this.imagesFile, `${lines.map((l) => l.join(' ')).join('\n')}\n`);
  }

  private read(): string[][] {
    return readFileSync(this.imagesFile, 'utf8').split('\n').filter(Boolean).map((l) => l.split(' '));
  }

  /** Thẻ → id. */
  tags(): Record<string, string> {
    return Object.fromEntries(this.read().map(([n, id]) => [n, id!]));
  }

  prevTags(repo: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [n, id] of Object.entries(this.tags())) if (n.startsWith(`${repo}:prev-`)) out[n.slice(`${repo}:prev-`.length)] = id;
    return out;
  }

  private run(script: string, args: string[], env: Record<string, string> = {}) {
    const res = spawnSync('bash', [script, ...args], {
      encoding: 'utf8',
      env: { PATH: `${this.dir}:${process.env.PATH}`, HOME: this.dir, REPO_DIR: this.repo, ...env },
    });
    return { status: res.status, out: `${res.stdout}${res.stderr}` };
  }

  /** Gắn thẻ cho image ĐANG CHẠY (bước 2 của dep1). */
  tag(running: { api: string; web: string }, curSha: string, lastImage: string) {
    return this.run(TAG, [running.api, `${API}:latest`, running.web, `${WEB}:latest`, curSha, lastImage]);
  }

  tagRaw(args: string[]) {
    return this.run(TAG, args);
  }

  prune(args: string[] = ['--apply']) {
    return this.run(PRUNE, args);
  }

  dispose() {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

let vps: Vps | null = null;
const make = (commits: Record<string, number>) => (vps = new Vps(commits));
afterEach(() => {
  vps?.dispose();
  vps = null;
});

const COMMITS = { aaaaaaa1: T0 + 100, bbbbbbb2: T0 + 200, ccccccc3: T0 + 300, ddddddd4: T0 + 400, eeeeeee5: T0 + 500, fffffff6: T0 + 600 };

describe('tools/deploy/tag-prev-images.sh: chọn nhãn :prev-* theo image thật, không theo ghi chép', () => {
  it('ghi chép khớp image đang chạy (dep2 ghi đúng id): nhãn là SHA đã ghi, gắn cả :rollback lẫn :prev-<nhãn> cho api và web', () => {
    const v = make(COMMITS);
    const r = v.tag({ api: imageId(1), web: imageId(101) }, FULL('bbbbbbb2'), imageId(1));
    expect(r.status).toBe(0);
    expect(v.tags()).toEqual({
      [`${API}:rollback`]: imageId(1),
      [`${WEB}:rollback`]: imageId(101),
      [`${API}:prev-bbbbbbb2`]: imageId(1),
      [`${WEB}:prev-bbbbbbb2`]: imageId(101),
    });
  });

  it('chưa có ghi chép image (lần đầu sau khi nâng cấp): tin SHA đã ghi như trước', () => {
    const v = make(COMMITS);
    const r = v.tag({ api: imageId(1), web: imageId(101) }, FULL('bbbbbbb2'), '');
    expect(r.status).toBe(0);
    expect(v.prevTags(API)).toEqual({ bbbbbbb2: imageId(1) });
  });

  it('đã quay lại bản cũ (image chạy khác ghi chép) và thẻ của bản đó còn: dùng lại thẻ đó, KHÔNG dán tên SHA đã ghi', () => {
    const v = make(COMMITS);
    // Đang chạy B (quay lại từ C); dep2 lần trước ghi C (SHA + image).
    v.set(`${API}:prev-bbbbbbb2`, imageId(2));
    v.set(`${WEB}:prev-bbbbbbb2`, imageId(102));
    const r = v.tag({ api: imageId(2), web: imageId(102) }, FULL('ccccccc3'), imageId(3));
    expect(r.status).toBe(0);
    expect(v.prevTags(API)).toEqual({ bbbbbbb2: imageId(2) });
    expect(v.prevTags(WEB)).toEqual({ bbbbbbb2: imageId(102) });
    expect(v.tags()[`${API}:rollback`]).toBe(imageId(2));
  });

  it('đã quay lại bản cũ mà thẻ của bản đó đã bị dọn: nhãn lấy từ 8 ký tự đầu của image id, không mượn SHA đã ghi', () => {
    const v = make(COMMITS);
    const r = v.tag({ api: imageId(0xabcdef12), web: imageId(102) }, FULL('ccccccc3'), imageId(3));
    expect(r.status).toBe(0);
    expect(v.prevTags(API)).toEqual({ abcdef12: imageId(0xabcdef12) });
    expect(v.prevTags(API)).not.toHaveProperty('ccccccc3');
  });

  it('nhiều thẻ cũ cùng trỏ vào image đang chạy (di chứng dán nhầm): dùng thẻ của commit CŨ NHẤT, không thêm thẻ mới', () => {
    const v = make(COMMITS);
    for (const sha of ['ccccccc3', 'bbbbbbb2']) {
      v.set(`${API}:prev-${sha}`, imageId(2));
      v.set(`${WEB}:prev-${sha}`, imageId(102));
    }
    const r = v.tag({ api: imageId(2), web: imageId(102) }, FULL('ddddddd4'), imageId(4));
    expect(r.status).toBe(0);
    expect(Object.keys(v.prevTags(API)).sort()).toEqual(['bbbbbbb2', 'ccccccc3']);
    expect(r.out).toContain('prev-bbbbbbb2');
  });

  it('KHÔNG ghi đè thẻ đang trỏ image khác: nhãn đã ghi trùng tên một thẻ cũ thì rơi về nhãn theo image id, thẻ cũ nguyên vẹn', () => {
    const v = make(COMMITS);
    v.set(`${API}:prev-bbbbbbb2`, imageId(7));
    v.set(`${WEB}:prev-bbbbbbb2`, imageId(107));
    const r = v.tag({ api: imageId(0x1234abcd), web: imageId(102) }, FULL('bbbbbbb2'), imageId(0x1234abcd));
    expect(r.status).toBe(0);
    expect(v.tags()[`${API}:prev-bbbbbbb2`]).toBe(imageId(7));
    expect(v.tags()[`${WEB}:prev-bbbbbbb2`]).toBe(imageId(107));
    expect(v.prevTags(API)['1234abcd']).toBe(imageId(0x1234abcd));
  });

  it('thẻ web cùng tên nhưng khác image: cũng không ghi đè (api trùng id vẫn không đủ)', () => {
    const v = make(COMMITS);
    v.set(`${API}:prev-bbbbbbb2`, imageId(1));
    v.set(`${WEB}:prev-bbbbbbb2`, imageId(555));
    const r = v.tag({ api: imageId(1), web: imageId(101) }, FULL('bbbbbbb2'), imageId(1));
    expect(r.status).toBe(0);
    expect(v.tags()[`${WEB}:prev-bbbbbbb2`]).toBe(imageId(555));
    expect(v.prevTags(WEB)['00000001']).toBe(imageId(101));
  });

  it('SHA đã ghi rỗng hoặc sai dạng: nhãn theo image id, vẫn gắn :rollback', () => {
    const v = make(COMMITS);
    for (const bad of ['', 'xyz', 'ZZZZZZZZ']) {
      const r = v.tag({ api: imageId(9), web: imageId(109) }, bad, imageId(9));
      expect(r.status).toBe(0);
    }
    expect(v.prevTags(API)).toEqual({ '00000009': imageId(9) });
    expect(v.tags()[`${API}:rollback`]).toBe(imageId(9));
  });

  it('chạy lại cùng lượt (dep1 chạy lại an toàn): kết quả không đổi', () => {
    const v = make(COMMITS);
    const run = () => v.tag({ api: imageId(1), web: imageId(101) }, FULL('bbbbbbb2'), imageId(1));
    run();
    const first = v.tags();
    expect(run().status).toBe(0);
    expect(v.tags()).toEqual(first);
  });

  it('thiếu tham số → thoát 2, không gắn gì', () => {
    const v = make(COMMITS);
    const r = v.tagRaw([imageId(1), `${API}:latest`]);
    expect(r.status).toBe(2);
    expect(v.tags()).toEqual({});
  });
});

/** Mô phỏng vòng đời PROD: dep1 (gắn thẻ + dọn) → dep2 (ghi SHA + image id vừa chạy) và đường quay lại của runbook 7.2/7.3. */
describe('xoay vòng :prev-*: deploy, quay lại, deploy tiếp', () => {
  type Ids = { api: string; web: string };

  function lifecycle(v: Vps) {
    let running: Ids | null = null;
    let lastSha = '';
    let lastImage = '';
    const truth: Record<string, Ids> = {};
    let n = 0;
    return {
      deploy(sha8: string) {
        if (running) {
          expect(v.tag(running, lastSha, lastImage).status).toBe(0);
          expect(v.prune().status).toBe(0);
        }
        n += 1;
        running = { api: imageId(1000 + n), web: imageId(2000 + n) };
        truth[sha8] = running;
        lastSha = FULL(sha8);
        lastImage = running.api;
      },
      /** Runbook 7.2/7.3: gắn lại ảnh cũ rồi bật; dep2 KHÔNG chạy nên ghi chép (SHA, image) vẫn là của bản vừa bị gỡ. */
      rollbackTo(sha8: string) {
        const api = v.prevTags(API)[sha8];
        const web = v.prevTags(WEB)[sha8];
        if (!api || !web) throw new Error(`không còn thẻ prev-${sha8} để quay lại`);
        running = { api, web };
      },
      truth,
    };
  }

  const distinctApi = (v: Vps) => new Set(Object.values(v.prevTags(API))).size;

  it('mọi thẻ :prev-<sha> luôn trỏ đúng image của bản đó, qua deploy A..F có quay lại giữa chừng', () => {
    const v = make(COMMITS);
    const life = lifecycle(v);
    for (const sha of ['aaaaaaa1', 'bbbbbbb2', 'ccccccc3']) life.deploy(sha);
    life.rollbackTo('bbbbbbb2');
    life.deploy('ddddddd4');
    life.deploy('eeeeeee5');
    life.deploy('fffffff6');
    for (const [sha, id] of Object.entries(v.prevTags(API))) expect(life.truth[sha]?.api).toBe(id);
    for (const [sha, id] of Object.entries(v.prevTags(WEB))) expect(life.truth[sha]?.web).toBe(id);
    expect(v.prevTags(API)).not.toHaveProperty('ccccccc3');
  });

  it('sau khi quay về bản cũ rồi deploy tiếp: "3 bản dự phòng" là 3 image ID khác nhau, không phải 2', () => {
    const v = make(COMMITS);
    const life = lifecycle(v);
    for (const sha of ['aaaaaaa1', 'bbbbbbb2', 'ccccccc3']) life.deploy(sha);
    life.rollbackTo('bbbbbbb2');
    life.deploy('ddddddd4'); // dep1 gắn lại thẻ B (không dán tên C lên image của B)
    expect(distinctApi(v)).toBe(Object.keys(v.prevTags(API)).length);
    life.deploy('eeeeeee5'); // dep1 gắn thẻ D
    expect(Object.keys(v.prevTags(API)).sort()).toEqual(['aaaaaaa1', 'bbbbbbb2', 'ddddddd4']);
    expect(distinctApi(v)).toBe(3);
    life.deploy('fffffff6'); // dep1 gắn thẻ E, dọn xuống đúng 3 image khác nhau
    expect(distinctApi(v)).toBe(3);
    expect(Object.keys(v.prevTags(API)).sort()).toEqual(['bbbbbbb2', 'ddddddd4', 'eeeeeee5']);
  });

  it('quay lại hai lần liên tiếp rồi deploy: vẫn không ghi đè và không nhân đôi', () => {
    const v = make(COMMITS);
    const life = lifecycle(v);
    for (const sha of ['aaaaaaa1', 'bbbbbbb2', 'ccccccc3']) life.deploy(sha);
    life.rollbackTo('bbbbbbb2');
    life.rollbackTo('aaaaaaa1');
    life.deploy('ddddddd4');
    for (const [sha, id] of Object.entries(v.prevTags(API))) expect(life.truth[sha]?.api).toBe(id);
    expect(distinctApi(v)).toBe(Object.keys(v.prevTags(API)).length);
    expect(v.prevTags(API)).not.toHaveProperty('ccccccc3');
  });
});
