// Test bước dựng thư mục tạm + zmp deploy của publish-zmp-release.sh (không gọi mạng, không cần zmp CLI thật).
//   node --test scripts/ops/publish-zmp-release.test.mjs
// Nạp script bằng `source` với PUBLISH_ZMP_LIB_ONLY=1 rồi gọi deploy_staged trên một apps/miniapp giả; zmp giả ghi lại thư mục chạy, tham số,
// app-config.json nó thấy và việc có nhận được ZMP_TOKEN hay không (chỉ ghi khớp/không khớp, không ghi giá trị).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./publish-zmp-release.sh', import.meta.url));
const FILE_TOKEN = 'tok-from-file-9f3c1a';
const ENV_TOKEN = 'tok-from-env-77b2e0';
const SOURCE_CONFIG = JSON.stringify({ app: { title: 'Tubu Tree', appId: '1' }, listSyncCSS: [], listCSS: [], listSyncJS: [], listJS: [] }, null, 2);
const BUILT_CONFIG = JSON.stringify({ app: { title: 'Tubu Tree', appId: '1' }, listCSS: ['assets/index.css'], listSyncJS: ['assets/index.module.js'], listAsyncJS: [] });
const ENV_FILE = `APP_ID=1\nZMP_TOKEN="${FILE_TOKEN}"\n`;

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** apps/miniapp giả: app-config.json nguồn (listSyncJS rỗng), www/ đã build, .env có token; cùng một zmp giả ghi nhật ký vào `log/`. */
function fixture({ built = BUILT_CONFIG, envFile = ENV_FILE } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'zmp-release-test-'));
  const mini = join(root, 'apps/miniapp');
  mkdirSync(join(mini, 'www/assets'), { recursive: true });
  writeFileSync(join(mini, 'app-config.json'), SOURCE_CONFIG);
  writeFileSync(join(mini, 'package.json'), '{"name":"miniapp"}');
  writeFileSync(join(mini, 'zmp-cli.json'), '{"name":"tubutree"}');
  writeFileSync(join(mini, '.env'), envFile);
  writeFileSync(join(mini, 'www/index.html'), '<!doctype html>');
  writeFileSync(join(mini, 'www/assets/index.module.js'), 'console.log(1)');
  writeFileSync(join(mini, 'www/app-config.json'), built);
  const log = join(root, 'log');
  mkdirSync(log);
  const fake = join(root, 'fake-zmp');
  // zmp thật tạo .env rỗng ở thư mục chạy nếu chưa có: giả lập để chứng minh nó rơi vào thư mục tạm, không vào apps/miniapp.
  writeFileSync(
    fake,
    `#!/usr/bin/env bash
pwd -P > "$ZMP_TEST_LOG/cwd"
printf '%s\\n' "$@" > "$ZMP_TEST_LOG/args"
cp app-config.json "$ZMP_TEST_LOG/app-config.json"
ls www > "$ZMP_TEST_LOG/www"
[ -f package.json ] && [ -f zmp-cli.json ] && echo yes > "$ZMP_TEST_LOG/project-files"
if [ "\${ZMP_TOKEN:-}" = "$ZMP_TEST_EXPECT" ]; then echo match > "$ZMP_TEST_LOG/token"; else echo nomatch > "$ZMP_TEST_LOG/token"; fi
echo "\${APP_ID:-}" > "$ZMP_TEST_LOG/app-id"
[ -e .env ] || : > .env
exit "\${ZMP_TEST_EXIT:-0}"
`,
  );
  chmodSync(fake, 0o755);
  return { root, mini, log, fake };
}

function runDeploy(fx, { env = {}, expectToken = FILE_TOKEN } = {}) {
  // `source` không kèm tham số sẽ chuyển $@ của shell cho script (script coi là tham số lạ): giữ đường dẫn vào biến rồi xoá $@ trước khi nạp.
  const cmd = `set -u; s="$1" m="$2" z="$3"; set --; PUBLISH_ZMP_LIB_ONLY=1 source "$s"; ZMP_ENV_FILE="$m/.env"; ZMP_CMD=("$z"); deploy_staged "$m" "W45 thử"; echo "STAGE=$STAGE"`;
  const baseEnv = { ...process.env };
  delete baseEnv.ZMP_TOKEN;
  delete baseEnv.APP_ID;
  return spawnSync('bash', ['-c', cmd, 'test', SCRIPT, fx.mini, fx.fake], {
    encoding: 'utf8',
    env: { ...baseEnv, TMPDIR: fx.root, ZMP_TEST_LOG: fx.log, ZMP_TEST_EXPECT: expectToken, ...env },
  });
}

const read = (fx, name) => readFileSync(join(fx.log, name), 'utf8').trim();
const stagesLeft = (fx) => spawnSync('bash', ['-c', `ls -d "$1"/zmp-stage.* 2>/dev/null | wc -l`, 'x', fx.root], { encoding: 'utf8' }).stdout.trim();

test('deploy chạy ở thư mục tạm có app-config.json của www (listSyncJS đủ), apps/miniapp giữ nguyên, thư mục tạm bị xoá', (t) => {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const before = sha(join(fx.mini, 'app-config.json'));
  const r = runDeploy(fx);
  assert.equal(r.status, 0, r.stderr);
  const stage = /STAGE=(.+)/.exec(r.stdout)?.[1] ?? '';
  assert.match(stage, /zmp-stage\./);
  assert.equal(read(fx, 'cwd'), join(realpathSync(fx.root), stage.split('/').pop()), 'zmp chạy trong thư mục tạm, không ở apps/miniapp');
  assert.deepEqual(read(fx, 'args').split('\n'), ['deploy', '-t', '-e', '-p', '-m', 'W45 thử']);
  assert.deepEqual(JSON.parse(read(fx, 'app-config.json')).listSyncJS, ['assets/index.module.js']);
  assert.deepEqual(read(fx, 'www').split('\n').sort(), ['app-config.json', 'assets', 'index.html']);
  assert.equal(read(fx, 'project-files'), 'yes');
  assert.equal(sha(join(fx.mini, 'app-config.json')), before, 'apps/miniapp/app-config.json không đổi');
  assert.equal(readFileSync(join(fx.mini, '.env'), 'utf8'), ENV_FILE, 'apps/miniapp/.env không đổi');
  assert.equal(existsSync(stage), false, 'thư mục tạm đã xoá khi thoát');
  assert.equal(stagesLeft(fx), '0');
});

test('ZMP_TOKEN đọc từ apps/miniapp/.env (bỏ nháy) và APP_ID đi kèm; không bao giờ in token', (t) => {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const r = runDeploy(fx);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(fx, 'token'), 'match');
  assert.equal(read(fx, 'app-id'), '1');
  assert.equal(`${r.stdout}${r.stderr}`.includes(FILE_TOKEN), false);
});

test('.env có tiền tố export, khoảng trắng quanh dấu =, chú thích cuối dòng và dòng sau thắng: vẫn ra đúng token', (t) => {
  const envFile = `# zmp login\nexport ZMP_TOKEN=old-token\nexport APP_ID = 1 # app Tubu\nexport ZMP_TOKEN = ${FILE_TOKEN}   # ghi bởi zmp login\r\n`;
  const fx = fixture({ envFile });
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const r = runDeploy(fx);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(fx, 'token'), 'match');
  assert.equal(read(fx, 'app-id'), '1');
  assert.equal(`${r.stdout}${r.stderr}`.includes(FILE_TOKEN), false);
});

test("token trong nháy đơn: bỏ nháy và chú thích sau nháy", (t) => {
  const fx = fixture({ envFile: `APP_ID='1'\nZMP_TOKEN='${FILE_TOKEN}' # cmt\n` });
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const r = runDeploy(fx);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(fx, 'token'), 'match');
  assert.equal(read(fx, 'app-id'), '1');
});

test('ZMP_TOKEN trong môi trường thắng .env; không in token nào', (t) => {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const r = runDeploy(fx, { env: { ZMP_TOKEN: ENV_TOKEN }, expectToken: ENV_TOKEN });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(fx, 'token'), 'match');
  assert.equal(`${r.stdout}${r.stderr}`.includes(ENV_TOKEN), false);
  assert.equal(`${r.stdout}${r.stderr}`.includes(FILE_TOKEN), false);
});

test('www/app-config.json có listSyncJS rỗng (build hỏng): dừng trước zmp, không deploy, thư mục tạm vẫn bị xoá', (t) => {
  const fx = fixture({ built: SOURCE_CONFIG });
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const r = runDeploy(fx);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /listSyncJS/);
  assert.equal(existsSync(join(fx.log, 'args')), false, 'zmp không được gọi');
  assert.equal(stagesLeft(fx), '0');
});

test('chưa build (thiếu www/app-config.json): dừng với lời nhắc, không gọi zmp', (t) => {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  rmSync(join(fx.mini, 'www/app-config.json'));
  const r = runDeploy(fx);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /chưa build Mini App/);
  assert.equal(existsSync(join(fx.log, 'args')), false);
});

test('zmp deploy lỗi: script thoát 1 và báo mã lỗi, không in token, thư mục tạm bị xoá', (t) => {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const r = runDeploy(fx, { env: { ZMP_TEST_EXIT: '7' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /zmp deploy lỗi \(mã 7\)/);
  assert.equal(`${r.stdout}${r.stderr}`.includes(FILE_TOKEN), false);
  assert.equal(stagesLeft(fx), '0');
});
