import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RUNBOOK = readFileSync(join(__dirname, '../../../../docs/launch/deploy-rollback-runbook.md'), 'utf8');
const R8 = '20261015150000_r8_multi_reviews_unique_per_order';

function section72(): string {
  const start = RUNBOOK.indexOf('### 7.2 ');
  const end = RUNBOOK.indexOf('### 7.2b');
  expect(start).toBeGreaterThan(0);
  return RUNBOOK.slice(start, end);
}

function bashBlocks(md: string): string[] {
  return [...md.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1] as string);
}

describe('runbook 7.2: chỉ mục đánh giá cũ chỉ dựng khi r8 còn chờ áp', () => {
  const blocks = bashBlocks(section72());
  const rollback = blocks.find((b) => b.includes('CREATE UNIQUE INDEX "reviews_userId_productId_key"')) ?? '';
  const lines = rollback.split('\n');

  it('khối quay image tồn tại và cú pháp shell hợp lệ (bash -n)', () => {
    expect(rollback).not.toBe('');
    const r = spawnSync('bash', ['-n'], { input: rollback, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('CREATE UNIQUE INDEX và phần đếm trùng nằm trong if grep -qx r8 .pending-migrations ... fi', () => {
    const ifAt = lines.findIndex((l) => l.includes(`grep -qx ${R8} .pending-migrations`) && /^\s*if\b/.test(l));
    expect(ifAt).toBeGreaterThanOrEqual(0);
    const fiAt = lines.findIndex((l, i) => i > ifAt && /^\s*fi\b/.test(l));
    expect(fiAt).toBeGreaterThan(ifAt);
    for (const needle of ['CREATE UNIQUE INDEX "reviews_userId_productId_key"', 'HAVING count(*) > 1']) {
      const at = lines.findIndex((l) => l.includes(needle));
      expect(at).toBeGreaterThan(ifAt);
      expect(at).toBeLessThan(fiAt);
    }
  });

  it('hai lệnh docker tag và up api, web nằm NGOÀI khối có điều kiện (luôn chạy)', () => {
    const fiAt = lines.findIndex((l) => /^\s*fi\b/.test(l));
    for (const needle of ['docker tag "${API_NAME%%:*}:rollback"', 'docker tag "${WEB_NAME%%:*}:rollback"', 'up -d --no-build --no-deps api']) {
      expect(lines.findIndex((l) => l.includes(needle))).toBeGreaterThan(fiAt);
    }
  });

  it('lệnh DROP INDEX ghi chú cuối 7.2 chỉ áp khi đã dựng chỉ mục cũ', () => {
    const sec = section72();
    const at = sec.indexOf('phải gỡ chỉ mục cũ');
    expect(at).toBeGreaterThan(0);
    const para = sec.slice(sec.lastIndexOf('\n\n', at), at);
    expect(para).toContain(R8);
  });
});

describe('runbook 1.19: DB_SESSION_OPTIONS phải có trong .env trước bước check-env', () => {
  const start = RUNBOOK.indexOf('### 1.19 ');
  const sec = RUNBOOK.slice(start, RUNBOOK.indexOf('### 1.20 '));

  it('dặn thêm trước bước 4 và kiểm giá trị compose đọc ra bằng $DC config', () => {
    expect(sec).toContain('TRƯỚC bước 4');
    expect(sec).toContain('$DC config | grep DB_SESSION_OPTIONS');
  });

  it('checklist không còn mốc "trước bước 9" cho dòng .env', () => {
    const line = sec.split('\n').find((l) => l.startsWith('- [ ] `.env` có dòng `DB_SESSION_OPTIONS`')) ?? '';
    expect(line).not.toBe('');
    expect(line).not.toContain('trước bước 9');
    expect(line).toMatch(/trước bước 4/i);
  });
});

describe('runbook 7.0: điều kiện đánh giá trùng chỉ áp khi r8 còn chờ áp', () => {
  const start = RUNBOOK.indexOf('### 7.0 ');
  const sec = RUNBOOK.slice(start, RUNBOOK.indexOf('### 7.1 ', start));

  it('mọi dòng bảng chọn đường nhắc đánh giá trùng hoặc đánh giá lần hai đều kèm r8 hoặc .pending-migrations', () => {
    expect(start).toBeGreaterThan(0);
    const rows = sec.split('\n').filter((l) => l.startsWith('|') && /đánh giá (trùng|lần hai)/.test(l));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.includes(R8) || row.includes('.pending-migrations')).toBe(true);
  });
});

describe('runbook: điều kiện quay lại dẫn theo danh sách tương thích image, không đếm "sáu"', () => {
  // Dòng 0.2 và 1.0 còn nhắc "sáu" như số liệu lịch sử của đợt UAT; chỉ cấm khi nó là điều kiện chọn 7.2/7.3.
  it('không còn "ngoài sáu cái của đợt", "có sáu migration của đợt", "kể cả sáu migration của đợt"', () => {
    expect(RUNBOOK).not.toMatch(/ngoài sáu cái của đợt|có sáu migration của đợt|kể cả sáu migration của đợt/);
  });
});
