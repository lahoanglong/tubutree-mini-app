import { Text } from 'zmp-ui';
import { vi } from '../../i18n/vi';

// Emoji + tên hạng theo authorLevel (1..4) trả về từ BE (FeedItem/FeedComment/LeaderboardEntry).
const LEVEL_EMOJI: Record<number, string> = { 1: '🌱', 2: '🌿', 3: '🌳', 4: '🏆' };

/** Emoji hạng thành viên theo level — dùng ở badge và trang bảng xếp hạng. */
export function levelEmoji(level: number): string {
  return LEVEL_EMOJI[level] ?? '🌱';
}

/** Tên hạng thành viên theo level — dùng cả khi BE không kèm sẵn levelName (post/comment). */
export function levelName(level: number): string {
  switch (level) {
    case 2:
      return vi.community.level2;
    case 3:
      return vi.community.level3;
    case 4:
      return vi.community.level4;
    default:
      return vi.community.level1;
  }
}

/**
 * Badge hạng nhỏ cạnh tên tác giả. Level 1 (Mầm) ẩn để đỡ rối — ai cũng ở hạng này lúc mới tham gia.
 */
export function RankBadge({ level }: { level: number }) {
  if (level <= 1) return null;
  return (
    <Text size="xSmall" bold style={{ color: 'var(--leaf-700)' }}>
      {levelEmoji(level)} {levelName(level)}
    </Text>
  );
}
