import { envValue } from './secrets';
import { fail, pass, warn, type CheckResult, type Env } from './types';

const G_BACKUP = 'Backup';

export interface CronBackupInfo {
  hasBackupLine: boolean;
  /** Tên remote rclone đặt trong dòng cron (phần trước dấu hai chấm), null nếu dòng không đặt RCLONE_REMOTE. */
  remoteName: string | null;
  hasHealthcheck: boolean;
}

/**
 * Đọc dòng cron gọi backup-db.sh. Chỉ trả cờ và tên remote: URL healthcheck và mọi giá trị khác trong dòng đó có thể
 * là bí mật nên không đi tiếp ra ngoài hàm này.
 */
export function parseCronBackup(cronText: string): CronBackupInfo {
  const lines = cronText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('backup-db.sh'));
  if (lines.length === 0) return { hasBackupLine: false, remoteName: null, hasHealthcheck: false };
  let remoteName: string | null = null;
  let hasHealthcheck = false;
  for (const line of lines) {
    const remote = /RCLONE_REMOTE=["']?([^\s"']+)/.exec(line);
    if (remote?.[1] && remoteName === null) remoteName = remote[1].split(':')[0] ?? null;
    if (/HEALTHCHECK_URL=["']?[^\s"']+/.test(line)) hasHealthcheck = true;
  }
  return { hasBackupLine: true, remoteName: remoteName || null, hasHealthcheck };
}

export interface BackupSnapshot {
  /** tools/backup/backup-db.sh của repo: unknown khi không thấy thư mục repo (vd chạy trong container, image không chứa tools/). */
  script: 'found' | 'missing' | 'unknown';
  cron: { visible: boolean } & CronBackupInfo;
  rclone: { available: boolean; remotes: string[]; /** Loại từng remote (drive, crypt...) theo `listremotes --long`; thiếu thì không biết. */ types?: Record<string, string> };
  dir: { path: string; visible: boolean; fileCount: number; newest: { ageHours: number; sizeBytes: number } | null };
}

const FRESH_HOURS = 26;
const STALE_HOURS = 72;

const CANNOT_TELL_HOST =
  'Chạy kiểm tra này trực tiếp trên máy chủ, hoặc kiểm tay: `crontab -l | grep backup-db`, `rclone listremotes`, `ls -lh /var/backups/tubutree | tail`.';

/** Phân tích ảnh chụp backup. Không thấy thì nói WARN "không kiểm được", không bao giờ đoán là ổn. */
export function evaluateBackup(s: BackupSnapshot, env: Env): CheckResult[] {
  const out: CheckResult[] = [];

  const scriptTitle = 'Script backup của repo';
  if (s.script === 'found') out.push(pass(G_BACKUP, 'backup.script', scriptTitle, 'tools/backup/backup-db.sh có mặt'));
  else if (s.script === 'missing') out.push(fail(G_BACKUP, 'backup.script', scriptTitle, 'không thấy tools/backup/backup-db.sh trong repo', 'Cập nhật repo trên máy chủ (git pull --ff-only) để có script backup.'));
  else out.push(warn(G_BACKUP, 'backup.script', scriptTitle, 'không kiểm được: không thấy thư mục repo từ nơi đang chạy (container không chứa tools/)', CANNOT_TELL_HOST));

  const cronTitle = 'Cron backup hằng ngày';
  if (!s.cron.visible) {
    out.push(warn(G_BACKUP, 'backup.cron', cronTitle, 'không kiểm được: không đọc được crontab từ nơi đang chạy', CANNOT_TELL_HOST));
  } else if (s.cron.hasBackupLine) {
    out.push(pass(G_BACKUP, 'backup.cron', cronTitle, 'có dòng cron gọi backup-db.sh'));
  } else {
    out.push(fail(G_BACKUP, 'backup.cron', cronTitle, 'đọc được crontab nhưng không có dòng nào gọi backup-db.sh', 'Cài cron theo tools/backup/README.md mục "Cài crontab" hoặc ops.yml, hành động crontab.'));
  }

  const remoteTitle = 'Bản backup ngoài máy (rclone)';
  const remoteName = s.cron.remoteName ?? (envValue(env, 'RCLONE_REMOTE') || envValue(env, 'BACKUP_RCLONE_REMOTE')).split(':')[0] ?? '';
  if (s.cron.visible && s.cron.hasBackupLine && !s.cron.remoteName) {
    out.push(fail(G_BACKUP, 'backup.offsite', remoteTitle, 'dòng cron không đặt RCLONE_REMOTE: backup chỉ nằm cùng đĩa với DB', 'Thêm RCLONE_REMOTE=<remote>:<thư mục> vào dòng cron; đĩa hỏng là mất cả DB lẫn backup.'));
  } else if (!remoteName) {
    out.push(warn(G_BACKUP, 'backup.offsite', remoteTitle, 'không kiểm được: không biết remote nào vì không đọc được cron và không có RCLONE_REMOTE trong môi trường', CANNOT_TELL_HOST));
  } else if (!s.rclone.available) {
    out.push(warn(G_BACKUP, 'backup.offsite', remoteTitle, `remote "${remoteName}" được đặt nhưng không chạy được rclone từ nơi này nên chưa xác nhận`, CANNOT_TELL_HOST));
  } else if (s.rclone.remotes.includes(remoteName) && s.rclone.types && s.rclone.types[remoteName] !== 'crypt') {
    out.push(warn(G_BACKUP, 'backup.offsite', remoteTitle, `remote "${remoteName}" loại "${s.rclone.types[remoteName]}", không phải crypt: backup ngoài máy (SĐT, địa chỉ, tài khoản hoàn tiền) nằm dạng rõ, và backup-db.sh sẽ từ chối đẩy`, 'Tạo remote crypt bọc remote này theo tools/backup/README.md mục "Mã hoá bản ngoài máy", rồi đổi RCLONE_REMOTE sang remote crypt.'));
  } else if (s.rclone.remotes.includes(remoteName)) {
    out.push(pass(G_BACKUP, 'backup.offsite', remoteTitle, `remote "${remoteName}" đã cấu hình trong rclone`));
  } else {
    out.push(fail(G_BACKUP, 'backup.offsite', remoteTitle, `rclone chưa có remote "${remoteName}"`, 'Chạy `rclone config` tạo remote đúng tên, rồi thử `rclone lsd <remote>:`.'));
  }

  const hcTitle = 'Báo động khi backup lỗi hoặc cron không chạy';
  if (!s.cron.visible) {
    out.push(warn(G_BACKUP, 'backup.healthcheck', hcTitle, 'không kiểm được: không đọc được crontab', CANNOT_TELL_HOST));
  } else if (!s.cron.hasBackupLine) {
    out.push(warn(G_BACKUP, 'backup.healthcheck', hcTitle, 'chưa có dòng cron backup nên chưa có gì để báo', 'Cài cron backup trước.'));
  } else if (s.cron.hasHealthcheck) {
    out.push(pass(G_BACKUP, 'backup.healthcheck', hcTitle, 'dòng cron có HEALTHCHECK_URL'));
  } else {
    out.push(warn(G_BACKUP, 'backup.healthcheck', hcTitle, 'dòng cron không có HEALTHCHECK_URL', 'Tạo check ở healthchecks.io và thêm HEALTHCHECK_URL=... vào dòng cron; không có thì cron chết im lặng cũng không ai biết.'));
  }

  const recentTitle = 'Bản backup gần nhất';
  if (!s.dir.visible) {
    out.push(warn(G_BACKUP, 'backup.recent', recentTitle, `không kiểm được: không đọc được thư mục ${s.dir.path} từ nơi đang chạy`, `${CANNOT_TELL_HOST} Trong container có thể gắn thêm \`-v ${s.dir.path}:${s.dir.path}:ro\` khi chạy lệnh.`));
  } else if (!s.dir.newest) {
    out.push(fail(G_BACKUP, 'backup.recent', recentTitle, `${s.dir.path} không có file tubutree_*.sql.gz nào`, 'Chạy backup tay: `COMPOSE_FILE=docker-compose.vietnix.yml ./tools/backup/backup-db.sh`, rồi diễn tập restore.'));
  } else {
    const age = s.dir.newest.ageHours;
    const detail = `mới nhất cách ${age.toFixed(1)} giờ, ${s.dir.fileCount} file, ${(s.dir.newest.sizeBytes / 1024 / 1024).toFixed(1)}MB`;
    if (age <= FRESH_HOURS) out.push(pass(G_BACKUP, 'backup.recent', recentTitle, detail));
    else if (age <= STALE_HOURS) out.push(warn(G_BACKUP, 'backup.recent', recentTitle, `${detail}: cron có thể đã lỡ một đêm`, 'Xem `tail /var/log/tubutree-backup.log`.'));
    else out.push(fail(G_BACKUP, 'backup.recent', recentTitle, `${detail}: quá cũ`, 'Cron đã ngừng chạy; xem /var/log/tubutree-backup.log và chạy backup tay.'));
  }
  return out;
}
