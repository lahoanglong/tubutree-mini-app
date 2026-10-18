// Emoji + tên hạng theo authorLevel (1..4) API trả về cho bài, bình luận và bảng xếp hạng.
const LEVEL_EMOJI: Record<number, string> = { 1: '🌱', 2: '🌿', 3: '🌳', 4: '🏆' };
const LEVEL_NAME: Record<number, string> = { 1: 'Mầm', 2: 'Cây non', 3: 'Cây trưởng thành', 4: 'Cổ thụ' };

export const levelEmoji = (level: number): string => LEVEL_EMOJI[level] ?? '🌱';

/** Dùng cả khi API không kèm sẵn levelName (bài, bình luận). */
export const levelName = (level: number): string => LEVEL_NAME[level] ?? 'Mầm';

/** Hạng 1 (Mầm) ẩn: ai cũng ở hạng này lúc mới vào, hiện ra chỉ thêm rối cạnh tên tác giả. */
export function RankBadge({ level }: { level: number }) {
  if (level <= 1) return null;
  return (
    <span className="text-xs font-semibold text-forest-700">
      {levelEmoji(level)} {levelName(level)}
    </span>
  );
}
