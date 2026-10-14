import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '../../../..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

/** Workflow SSH vào máy chủ đang chạy thật. */
const SSH_WORKFLOWS = ['ops.yml', 'logs.yml', 'smoke.yml', 'smoke-purchase.yml', 'deploy.yml'].map(
  (f) => `.github/workflows/${f}`,
);

describe.each(SSH_WORKFLOWS)('%s', (file) => {
  const wf = read(file);

  it('không gắn cứng compose/thư mục của VM GCP đã đóng — đọc từ biến repo', () => {
    const lines = wf.split('\n').filter((l) => !l.trim().startsWith('#'));
    expect(lines.filter((l) => l.includes('docker-compose.prod.yml'))).toEqual([]);
    expect(lines.filter((l) => /cd ~\/tubutree/.test(l))).toEqual([]);
    expect(wf).toContain("vars.COMPOSE_FILE || 'docker-compose.vietnix.yml'");
    expect(wf).toContain("vars.DEPLOY_DIR || '/opt/tubutree'");
  });
});

describe('smoke-purchase.yml', () => {
  it('không đặt đơn thật trên PROD (kho sẽ đóng gói, trừ tồn, lẫn doanh thu)', () => {
    const wf = read('.github/workflows/smoke-purchase.yml');
    const lines = wf.split('\n').filter((l) => !l.trim().startsWith('#'));
    expect(lines.filter((l) => l.includes('place-order'))).toEqual([]);
    expect(wf).toMatch(/DELETE "\$B\/cart\/items\//);
    expect(wf).toMatch(/DELETE "\$B\/me\/addresses\//);
  });
});

describe('ops.yml audit/set-env', () => {
  const wf = read('.github/workflows/ops.yml');
  const integrationKeys = [...read('.env.production.example').matchAll(/^((?:PANCAKE|GOMDON)_[A-Z_]+)=/gm)].map((m) => m[1]);

  it('audit in SET/EMPTY cho mọi khoá Pancake/Gomdon trong .env.production.example', () => {
    expect(integrationKeys.length).toBeGreaterThanOrEqual(7);
    const audit = wf.slice(wf.indexOf('audit)'), wf.indexOf('backup)'));
    for (const k of integrationKeys) expect({ k, audited: audit.includes(`envstate ${k}`) }).toEqual({ k, audited: true });
  });

  it('set-env ghi được khoá bí mật Pancake/Gomdon từ GitHub Secrets', () => {
    for (const k of ['PANCAKE_API_KEY', 'PANCAKE_SHOP_ID', 'PANCAKE_WEBHOOK_SECRET', 'GOMDON_PHONE', 'GOMDON_PASSWORD', 'GOMDON_WEBHOOK_SECRET']) {
      expect({ k, setIf: wf.includes(`set_if ${k} `) }).toEqual({ k, setIf: true });
    }
  });
});

describe('docs/GO-LIVE-KEYS.md', () => {
  it('có mục Pancake và Gomdon', () => {
    const doc = read('docs/GO-LIVE-KEYS.md');
    expect(doc).toMatch(/^## .*Pancake/m);
    expect(doc).toMatch(/^## .*Gomdon/m);
    for (const k of ['PANCAKE_API_KEY', 'PANCAKE_SHOP_ID', 'PANCAKE_WEBHOOK_SECRET', 'GOMDON_PHONE', 'GOMDON_PASSWORD', 'GOMDON_WEBHOOK_SECRET']) {
      expect(doc).toContain(k);
    }
  });
});

describe('OPS_ALERT_WEBHOOK_URL qua quy trình chuẩn (R2-PLATFORM-3)', () => {
  const wf = read('.github/workflows/ops.yml');
  const doc = read('docs/GO-LIVE-KEYS.md');

  it('ops.yml chuyển secret qua SSH, set-env ghi được, audit in SET/EMPTY', () => {
    expect(wf).toContain('OPS_ALERT_WEBHOOK_URL: ${{ secrets.OPS_ALERT_WEBHOOK_URL }}');
    expect(wf).toMatch(/envs: [^\n]*\bOPS_ALERT_WEBHOOK_URL\b/);
    const setEnv = wf.slice(wf.indexOf('set-env)'), wf.indexOf('grant-admin)', wf.indexOf('set-env)')));
    expect(setEnv).toContain('OPS_ALERT_WEBHOOK_URL');
    const audit = wf.slice(wf.indexOf('audit)'), wf.indexOf('backup)'));
    expect(audit).toContain('envstate OPS_ALERT_WEBHOOK_URL');
  });

  it('GO-LIVE-KEYS.md có mục báo động vận hành và không còn nói thiếu khoá Pancake thì app vẫn nhận đơn', () => {
    expect(doc).toContain('OPS_ALERT_WEBHOOK_URL');
    expect(doc).toMatch(/^## .*[Bb]áo động vận hành/m);
    expect(doc).not.toMatch(/thiếu `?PANCAKE_API_KEY`?.{0,80}vẫn nhận đơn/);
  });
});

describe('ops.yml crontab (R2-PLATFORM-6)', () => {
  const wf = read('.github/workflows/ops.yml');
  const crontab = wf.slice(wf.indexOf('crontab)\n'), wf.indexOf('*) echo "Action không hợp lệ'));

  it('tạo thư mục backup + file log và chown cho user SSH TRƯỚC khi cài cron (redirect lỗi thì cron không chạy)', () => {
    const chown = crontab.indexOf('sudo chown "$(id -u):$(id -g)" /var/backups/tubutree /var/log/tubutree-backup.log');
    expect(crontab).toContain('sudo mkdir -p /var/backups/tubutree');
    expect(chown).toBeGreaterThan(-1);
    expect(chown).toBeLessThan(crontab.indexOf('| crontab -'));
  });

  it('chạy thử backup ngay sau khi cài, cảnh báo khi chưa có healthcheck', () => {
    expect(crontab).toMatch(/bash "\$SCRIPT"/);
    expect(crontab).toContain('BACKUP_HEALTHCHECK_URL');
    expect(crontab).toMatch(/CẢNH BÁO: chưa đặt secret BACKUP_HEALTHCHECK_URL/);
  });
});
