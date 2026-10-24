import { evaluateBackup, parseCronBackup } from './backup-checks';
import type { BackupSnapshot } from './backup-checks';
import { GOOD_BACKUP, GOOD_ENV, byId, envWith } from './go-live.fixtures';

const snap = (p: Partial<BackupSnapshot>): BackupSnapshot => ({ ...GOOD_BACKUP, ...p });
const status = (s: BackupSnapshot, id: string, env = GOOD_ENV) => byId(evaluateBackup(s, env), id).status;

const BLIND: BackupSnapshot = {
  script: 'unknown',
  cron: { visible: false, hasBackupLine: false, remoteName: null, hasHealthcheck: false },
  rclone: { available: false, remotes: [] },
  dir: { path: '/var/backups/tubutree', visible: false, fileCount: 0, newest: null },
};

describe('parseCronBackup', () => {
  const line = '0 2 * * * COMPOSE_FILE=/opt/tubutree/docker-compose.vietnix.yml RCLONE_REMOTE=r2:tubutree-backups/db HEALTHCHECK_URL=https://hc-ping.com/abc-123 /opt/tubutree/tools/backup/backup-db.sh >> /var/log/tubutree-backup.log 2>&1';

  it('đọc tên remote và cờ healthcheck, không trả URL', () => {
    const info = parseCronBackup(`MAILTO=""\n${line}\n`);
    expect(info).toEqual({ hasBackupLine: true, remoteName: 'r2', hasHealthcheck: true });
    expect(JSON.stringify(info)).not.toContain('hc-ping');
  });

  it('dòng bị comment không tính', () => {
    expect(parseCronBackup(`# ${line}`).hasBackupLine).toBe(false);
  });

  it('không có dòng backup', () => {
    expect(parseCronBackup('0 3 * * * certbot renew --quiet')).toEqual({ hasBackupLine: false, remoteName: null, hasHealthcheck: false });
    expect(parseCronBackup('')).toEqual({ hasBackupLine: false, remoteName: null, hasHealthcheck: false });
  });

  it('dòng backup không đặt remote hay healthcheck', () => {
    expect(parseCronBackup('0 2 * * * /opt/tubutree/tools/backup/backup-db.sh')).toEqual({ hasBackupLine: true, remoteName: null, hasHealthcheck: false });
  });

  it('chấp nhận giá trị đặt trong dấu nháy', () => {
    const info = parseCronBackup(`0 2 * * * RCLONE_REMOTE="gdrive:tubu" HEALTHCHECK_URL='https://x.io/p' /opt/tubutree/tools/backup/backup-db.sh`);
    expect(info).toEqual({ hasBackupLine: true, remoteName: 'gdrive', hasHealthcheck: true });
  });

  it('nhiều dòng backup: lấy remote ở dòng đầu tiên có đặt', () => {
    const text = '0 1 * * * /opt/tubutree/tools/backup/backup-db.sh\n0 2 * * * RCLONE_REMOTE=r2:x /opt/tubutree/tools/backup/backup-db.sh\n0 3 * * * RCLONE_REMOTE=s3:y /opt/tubutree/tools/backup/backup-db.sh';
    expect(parseCronBackup(text).remoteName).toBe('r2');
  });

  it('RCLONE_REMOTE rỗng thì không tính là có remote', () => {
    expect(parseCronBackup('0 2 * * * RCLONE_REMOTE= /opt/tubutree/tools/backup/backup-db.sh').remoteName).toBeNull();
  });
});

describe('parseCronBackup allowPlainRemote', () => {
  it('nhận BACKUP_ALLOW_PLAIN_REMOTE=1, không nhận =0', () => {
    expect(parseCronBackup('0 2 * * * BACKUP_ALLOW_PLAIN_REMOTE=1 RCLONE_REMOTE=g:x /opt/tubutree/tools/backup/backup-db.sh').allowPlainRemote).toBe(true);
    expect(parseCronBackup('0 2 * * * BACKUP_ALLOW_PLAIN_REMOTE=0 RCLONE_REMOTE=g:x /opt/tubutree/tools/backup/backup-db.sh').allowPlainRemote).toBeUndefined();
  });
});

describe('evaluateBackup', () => {
  it('đủ hết thì mọi dòng PASS', () => {
    expect(evaluateBackup(GOOD_BACKUP, GOOD_ENV).filter((r) => r.status !== 'PASS')).toEqual([]);
  });

  it('không nhìn thấy gì: mọi dòng WARN "không kiểm được", không dòng nào PASS hay FAIL', () => {
    const results = evaluateBackup(BLIND, GOOD_ENV);
    expect(results.map((r) => r.status)).toEqual(['WARN', 'WARN', 'WARN', 'WARN', 'WARN']);
    for (const r of results) expect(r.detail).toContain('không kiểm được');
  });

  it('mọi WARN/FAIL đều có cách sửa', () => {
    for (const s of [BLIND, snap({ script: 'missing', cron: { visible: true, hasBackupLine: false, remoteName: null, hasHealthcheck: false } })]) {
      for (const r of evaluateBackup(s, GOOD_ENV)) if (r.status !== 'PASS') expect(r.hint.length).toBeGreaterThan(10);
    }
  });

  describe('script', () => {
    it('thiếu hẳn thì FAIL', () => expect(status(snap({ script: 'missing' }), 'backup.script')).toBe('FAIL'));
    it('không biết thì WARN', () => expect(status(snap({ script: 'unknown' }), 'backup.script')).toBe('WARN'));
  });

  describe('cron', () => {
    it('đọc được mà không có dòng backup thì FAIL', () => {
      expect(status(snap({ cron: { visible: true, hasBackupLine: false, remoteName: null, hasHealthcheck: false } }), 'backup.cron')).toBe('FAIL');
    });
    it('không đọc được thì WARN', () => expect(status(BLIND, 'backup.cron')).toBe('WARN'));
  });

  describe('bản ngoài máy', () => {
    it('cron không đặt RCLONE_REMOTE thì FAIL', () => {
      const s = snap({ cron: { visible: true, hasBackupLine: true, remoteName: null, hasHealthcheck: true } });
      expect(status(s, 'backup.offsite')).toBe('FAIL');
    });
    it('remote có trong rclone thì PASS', () => expect(status(GOOD_BACKUP, 'backup.offsite')).toBe('PASS'));
    it('remote loại drive (không crypt) thì FAIL: script không đẩy gì ra ngoài máy', () => expect(status(snap({ rclone: { available: true, remotes: ['r2'], types: { r2: 'drive' } } }), 'backup.offsite')).toBe('FAIL'));
    it('remote drive nhưng cron đặt BACKUP_ALLOW_PLAIN_REMOTE=1 thì WARN', () => expect(status(snap({ cron: { ...GOOD_BACKUP.cron, allowPlainRemote: true }, rclone: { available: true, remotes: ['r2'], types: { r2: 'drive' } } }), 'backup.offsite')).toBe('WARN'));
    it('remote loại crypt thì PASS', () => expect(status(snap({ rclone: { available: true, remotes: ['r2'], types: { r2: 'crypt' } } }), 'backup.offsite')).toBe('PASS'));
    it('remote không có trong rclone thì FAIL', () => expect(status(snap({ rclone: { available: true, remotes: ['khac'] } }), 'backup.offsite')).toBe('FAIL'));
    it('có tên remote nhưng không có rclone thì WARN', () => expect(status(snap({ rclone: { available: false, remotes: [] } }), 'backup.offsite')).toBe('WARN'));
    it('không biết remote nào thì WARN', () => expect(status(BLIND, 'backup.offsite')).toBe('WARN'));
    it('không đọc được cron nhưng env có RCLONE_REMOTE thì dùng nó', () => {
      const s = snap({ cron: BLIND.cron, rclone: { available: true, remotes: ['r2'] } });
      expect(status(s, 'backup.offsite', envWith({ RCLONE_REMOTE: 'r2:tubutree-backups/db' }))).toBe('PASS');
      expect(status(s, 'backup.offsite', envWith({ BACKUP_RCLONE_REMOTE: 'r2:tubutree-backups/db' }))).toBe('PASS');
    });
  });

  describe('healthcheck', () => {
    it('có thì PASS', () => expect(status(GOOD_BACKUP, 'backup.healthcheck')).toBe('PASS'));
    it('cron có dòng backup mà thiếu HEALTHCHECK_URL thì WARN', () => {
      expect(status(snap({ cron: { visible: true, hasBackupLine: true, remoteName: 'r2', hasHealthcheck: false } }), 'backup.healthcheck')).toBe('WARN');
    });
    it('chưa có cron backup thì WARN', () => {
      expect(status(snap({ cron: { visible: true, hasBackupLine: false, remoteName: null, hasHealthcheck: false } }), 'backup.healthcheck')).toBe('WARN');
    });
    it('không đọc được cron thì WARN', () => expect(status(BLIND, 'backup.healthcheck')).toBe('WARN'));
  });

  describe('bản backup gần nhất', () => {
    const dir = (ageHours: number | null) => snap({ dir: { path: '/var/backups/tubutree', visible: true, fileCount: ageHours === null ? 0 : 3, newest: ageHours === null ? null : { ageHours, sizeBytes: 2_000_000 } } });
    it.each([
      [1, 'PASS'],
      [26, 'PASS'],
      [27, 'WARN'],
      [72, 'WARN'],
      [73, 'FAIL'],
      [null, 'FAIL'],
    ])('cách %s giờ thì %s', (age, expected) => {
      expect(status(dir(age), 'backup.recent')).toBe(expected);
    });
    it('không thấy thư mục thì WARN và gợi ý gắn volume', () => {
      const r = byId(evaluateBackup(BLIND, GOOD_ENV), 'backup.recent');
      expect(r.status).toBe('WARN');
      expect(r.hint).toContain(':ro');
    });
    it('nêu tuổi, số file và dung lượng', () => {
      expect(byId(evaluateBackup(GOOD_BACKUP, GOOD_ENV), 'backup.recent').detail).toBe('mới nhất cách 7.0 giờ, 12 file, 5.0MB');
    });
  });

  it('không in dòng cron hay URL healthcheck', () => {
    const dump = JSON.stringify(evaluateBackup(GOOD_BACKUP, GOOD_ENV));
    expect(dump).not.toContain('hc-ping');
    expect(dump).not.toContain('HEALTHCHECK_URL=');
  });
});
