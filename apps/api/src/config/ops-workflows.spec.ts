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
