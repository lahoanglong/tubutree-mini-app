// Mốc tuần theo giờ VN (UTC+7). Tuần bắt đầu Thứ 2. Dùng chung cho trang ca làm.
const VN = 7 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' theo giờ VN. */
export function vnDateKey(d: Date): string {
  return new Date(d.getTime() + VN).toISOString().slice(0, 10);
}

/** Date-key (YYYY-MM-DD) của Thứ 2 tuần chứa d (giờ VN). */
export function mondayKeyOf(d: Date): string {
  const vn = new Date(d.getTime() + VN);
  const dow = vn.getUTCDay(); // 0=CN..6=T7
  const back = (dow + 6) % 7; // T2→0
  const mon = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - back * 86400000);
  return mon.toISOString().slice(0, 10);
}

/** Cộng n ngày vào một date-key, trả date-key mới. */
export function addDaysKey(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  return new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
}

/** 7 date-key của tuần bắt đầu từ mondayKey. */
export function weekDayKeys(mondayKey: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysKey(mondayKey, i));
}

/** Date-key → ISO 00:00:00Z (mốc gửi backend cho weekStart/copy-week). */
export function keyToUtcMidnightISO(key: string): string {
  return `${key}T00:00:00.000Z`;
}

/** Dựng ISO instant từ ngày (VN) + giờ 'HH:mm' (giờ VN). */
export function vnDateTimeISO(dayKey: string, hhmm: string): string {
  return new Date(`${dayKey}T${hhmm}:00+07:00`).toISOString();
}

/** Phút trong ngày (0..1440) → 'HH:mm'. */
export function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** ISO instant → 'HH:mm' theo giờ VN. */
export function isoToVnHHMM(iso: string): string {
  return new Date(new Date(iso).getTime() + VN).toISOString().slice(11, 16);
}

/** 'HH:mm' → phút trong ngày. */
export function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Nhãn ngắn 'dd/mm' từ date-key. */
export function shortDayLabel(key: string): string {
  const [, m, d] = key.split('-');
  return `${d}/${m}`;
}

const DOW_VN = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
/** Thứ (T2..CN) của date-key. */
export function dowLabel(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  return DOW_VN[(d.getUTCDay() + 6) % 7] ?? '';
}
