import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const REPO = join(__dirname, '../../../..');

describe('tools/backup/test-backup-perms.sh', () => {
  it('quyền file của backup-db.sh (dump 600, thư mục tạo mới 700, dump cũ được siết) đạt', () => {
    const out = execFileSync('bash', [join(REPO, 'tools/backup/test-backup-perms.sh')], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '', LANG: process.env.LANG ?? 'C' },
    });
    expect(out).not.toContain('FAIL');
  });
});
