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

describe.each(SSH_WORKFLOWS)('%s: khoá bằng VM_WORKFLOWS_ENABLED', (file) => {
  const wf = read(file);

  it('bước đầu tiên của job thất bại trừ khi biến repo VM_WORKFLOWS_ENABLED == true', () => {
    const afterSteps = wf.split('\n    steps:\n')[1] ?? '';
    const lines = afterSteps.split('\n');
    const nextStepAt = lines.findIndex((l, i) => i > 0 && /^ {6}- /.test(l));
    const first = lines.slice(0, nextStepAt).join('\n');
    expect(first).toContain("if: ${{ vars.VM_WORKFLOWS_ENABLED != 'true' }}");
    expect(first).toContain('exit 1');
    expect(first).toContain('VM_WORKFLOWS_ENABLED=true');
    expect(wf.split('\n').filter((l) => /^ {4}steps:/.test(l))).toHaveLength(1);
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

  it('địa chỉ thử lấy mã tỉnh/phường theo địa giới mới từ chính API, không gắn cứng mã cũ (R2-PLATFORM-5)', () => {
    const wf = read('.github/workflows/smoke-purchase.yml');
    expect(wf).not.toMatch(/"provinceCode":"\d+"/);
    expect(wf).toContain('$B/geo/provinces');
    expect(wf).toContain('$B/geo/communes?provinceCode=');
  });

  it('bước nào không trả 2xx thì job đỏ (dọn dẹp xong mới thoát)', () => {
    const wf = read('.github/workflows/smoke-purchase.yml');
    const exit = wf.lastIndexOf('exit 1');
    expect(exit).toBeGreaterThan(wf.lastIndexOf('DELETE "$B/me/addresses/'));
    expect(wf).toMatch(/2\?\?\)/);
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

describe('ops.yml: ZALO_OA_WEBHOOK_SECRET đi từ GitHub Secret vào .env', () => {
  const wf = read('.github/workflows/ops.yml');

  it('secret được khai báo, chuyển qua SSH và set-env ghi được (GO-LIVE-KEYS mục 5 dặn đúng quy trình này)', () => {
    expect(wf).toContain('ZALO_OA_WEBHOOK_SECRET: ${{ secrets.ZALO_OA_WEBHOOK_SECRET }}');
    expect((/envs: ([^\n]*)/.exec(wf)?.[1] ?? '').split(',')).toContain('ZALO_OA_WEBHOOK_SECRET');
    expect(wf).toContain('set_if ZALO_OA_WEBHOOK_SECRET ');
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

describe('tham số discount của mẫu ZNS GROUP_BUY_SUCCESS là phần trăm (groupbuy.service)', () => {
  const keys = read('docs/GO-LIVE-KEYS.md');
  const playbook = read('docs/launch/pilot-order-playbook.md');
  const discountRow = keys.split('\n').find((l) => /\|\s*`discount`\s*\|/.test(l)) ?? '';

  it('mã gửi discount dạng "N%" nên bảng khoá ghi mức giảm theo %, ví dụ có dấu % và không còn mô tả "số tiền mã giảm"', () => {
    expect(read('apps/api/src/modules/groupbuy/groupbuy.service.ts')).toContain('discount: `${terms.pct}%`');
    expect(discountRow).toMatch(/%/);
    expect(discountRow).not.toMatch(/Số tiền mã giảm/);
    expect(discountRow).not.toMatch(/`15\.000`/);
  });

  it('GO-LIVE-KEYS và playbook dặn mẫu có chữ "đ" sau discount phải nộp lại', () => {
    const rule = /chữ "đ" sau[^\n]*discount[^\n]*nộp lại/;
    expect(keys).toMatch(rule);
    expect(playbook).toMatch(rule);
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

describe('Email báo động vận hành qua quy trình chuẩn (R8)', () => {
  const EMAIL_KEYS = ['OPS_ALERT_EMAIL_TO', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
  const wf = read('.github/workflows/ops.yml');
  const setEnv = wf.slice(wf.indexOf('set-env)'), wf.indexOf('grant-admin)', wf.indexOf('set-env)')));
  const audit = wf.slice(wf.indexOf('audit)'), wf.indexOf('backup)'));

  it('ops.yml chuyển đủ bảy secret email qua SSH như OPS_ALERT_WEBHOOK_URL, set-env ghi được, audit in SET/EMPTY', () => {
    const envs = (/envs: ([^\n]*)/.exec(wf)?.[1] ?? '').split(',');
    for (const k of EMAIL_KEYS) {
      expect({ k, passed: wf.includes(`${k}: \${{ secrets.${k} }}`) }).toEqual({ k, passed: true });
      expect({ k, inEnvs: envs.includes(k) }).toEqual({ k, inEnvs: true });
      expect({ k, setIf: setEnv.includes(`set_if ${k} "\${${k}:-}"`) }).toEqual({ k, setIf: true });
      expect({ k, audited: audit.includes(`envstate ${k}`) }).toEqual({ k, audited: true });
    }
  });

  it('set-env từ chối ghi khi cấu hình email còn thiếu, và kiểm TRƯỚC khi ghi bất kỳ khoá nào', () => {
    const check = setEnv.indexOf('E_MISSING');
    expect(check).toBeGreaterThan(-1);
    expect(setEnv).toContain('KHÔNG ghi khoá nào');
    expect(setEnv.indexOf('exit 1', check)).toBeLessThan(setEnv.indexOf('set_if OPS_ALERT_EMAIL_TO'));
  });

  it('OPS_ALERT_ENV_LABEL đi bằng biến repo (vars.*, không phải secret), qua SSH, set-env ghi được, audit in SET/EMPTY', () => {
    expect(wf).toMatch(/^\s+OPS_ALERT_ENV_LABEL: \$\{\{ vars\.OPS_ALERT_ENV_LABEL \|\| '' \}\}$/m);
    expect(wf).not.toContain('secrets.OPS_ALERT_ENV_LABEL');
    expect((/envs: ([^\n]*)/.exec(wf)?.[1] ?? '').split(',')).toContain('OPS_ALERT_ENV_LABEL');
    expect(setEnv).toContain('set_if OPS_ALERT_ENV_LABEL "$OPS_ALERT_ENV_LABEL"');
    expect(audit).toContain('envstate OPS_ALERT_ENV_LABEL');
    expect(setEnv).toContain('envstate OPS_ALERT_ENV_LABEL');
  });

  it('set-env kiểm nhãn môi trường (≤ 24 ký tự, một dòng, không [ ]) TRƯỚC khi ghi bất kỳ khoá email nào — khớp luật boot của API', () => {
    const label = setEnv.indexOf('case "${OPS_ALERT_ENV_LABEL:-}" in');
    expect(label).toBeGreaterThan(-1);
    expect(label).toBeLessThan(setEnv.indexOf('set_if OPS_ALERT_EMAIL_TO'));
    expect(setEnv).toContain('-gt 24');
    const check = setEnv.slice(label, setEnv.indexOf('E_TO=$(effective'));
    expect(check).toContain('*[][]*');
    expect(check).toContain("$'\\n'");
    expect(check).toContain('exit 1');
  });

  it('nhãn môi trường một mình không phải "đã đặt cấu hình email": không tính vào kiểm cấu hình dở dang', () => {
    const emailBlock = setEnv.slice(setEnv.indexOf('E_TO=$(effective'), setEnv.indexOf('=== Trạng thái sau khi set'));
    expect(emailBlock).not.toContain('OPS_ALERT_ENV_LABEL');
  });

  it('không bao giờ in giá trị SMTP_PASS ra log', () => {
    const lines = wf.split('\n').filter((l) => !l.trim().startsWith('#'));
    expect(lines.filter((l) => /\becho\b.*\$\{?SMTP_PASS|\bprintf\b.*\$\{?SMTP_PASS|\bset -x\b/.test(l))).toEqual([]);
  });

  it('.env.example và .env.production.example liệt kê đủ bảy khoá, để trống', () => {
    for (const file of ['apps/api/.env.example', '.env.production.example']) {
      const text = read(file);
      for (const k of [...EMAIL_KEYS, 'OPS_ALERT_ENV_LABEL']) {
        expect({ file, k, line: new RegExp(`^${k}=(""|)$`, 'm').test(text) }).toEqual({ file, k, line: true });
      }
    }
  });

  it('GO-LIVE-KEYS.md mô tả email trong mục báo động vận hành: đủ khoá, gửi thử, nơi xem lỗi', () => {
    const doc = read('docs/GO-LIVE-KEYS.md');
    const section = doc.slice(doc.search(/^## .*[Bb]áo động vận hành/m), doc.indexOf('## Thứ tự khuyến nghị go-live'));
    for (const k of [...EMAIL_KEYS, 'OPS_ALERT_ENV_LABEL']) expect({ k, documented: section.includes(k) }).toEqual({ k, documented: true });
    expect(section).toContain('alert-email/test');
    expect(section).toContain('Sức khoẻ hệ thống');
    expect(section).toContain('Gửi email thử');
  });

  it('GO-LIVE-KEYS.md nói rõ lỗi SMTP vĩnh viễn không tự gửi lại mỗi 5 phút và khi nào mới thử lại', () => {
    const doc = read('docs/GO-LIVE-KEYS.md');
    expect(doc).toContain('Lỗi tạm thời và lỗi vĩnh viễn');
    expect(doc).toContain('EAUTH');
    expect(doc).toMatch(/không\*\* tự gửi lại mỗi 5 phút/);
  });

  // Đặt khoá bằng sửa .env qua SSH (ops.yml chưa SSH được tới VPS); nhãn vẫn không bao giờ là secret.
  it('GO-LIVE-KEYS.md dặn ghi nhãn môi trường vào .env, không phải secret', () => {
    const doc = read('docs/GO-LIVE-KEYS.md');
    expect(doc).toMatch(/^OPS_ALERT_ENV_LABEL=/m);
    expect(doc).not.toContain('gh secret set OPS_ALERT_ENV_LABEL');
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
