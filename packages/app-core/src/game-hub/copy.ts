import { fillTemplate } from '../copy-template';

/**
 * Chữ của Sảnh Game, thẻ đầu Vườn Xanh và nút âm thanh. Tách khỏi `SHOP_COPY` (bảng đó đã quá lớn) và khỏi `game-mini/copy.ts` (của gói game mini):
 * chỉ đi theo chunk lười của trang Vườn Xanh. `copy.spec.ts` chạy `FORBIDDEN_TERMS` và ngân sách độ dài `GAME_HUB_COPY_MAX` trên từng khoá.
 * Huy hiệu duy nhất là "Mới": "Hot" nằm trong FORBIDDEN_TERMS (chữ giục mua), và không có huy hiệu khung giờ thưởng.
 */
export const GAME_HUB_COPY = {
  'tab.care': 'Chăm vườn',
  'tab.games': 'Sảnh Game',
  'tab.garden': 'Khu vườn',
  'reward.water': '+💧 Giọt nước',
  'reward.waterPoints': '+💧 và Điểm Xanh',
  'reward.wheel': 'Trúng quà, mã giảm giá',
  'reward.matcher': 'Gợi ý bộ đồ xanh',
  'badge.new': 'Mới',
  'cta.play': 'Chơi',
  'cta.try': 'Chơi thử',
  'cta.wheel': 'Quay',
  'cta.open': 'Mở',
  'wheel.title': 'Vòng Quay May Mắn',
  'wheel.cost': '{n} Điểm Xanh mỗi lượt',
  best: 'Kỷ lục {n}',
  'sound.label': 'Âm thanh trò chơi',
  'hero.streakAria': 'Chuỗi điểm danh {n} ngày',
  'hero.streak': '{n} ngày',
  'hero.treeAria': 'Cây của bạn: {stage}',
  'stage.sprout': 'mầm non',
  'stage.sapling': 'cây con',
  'stage.tree': 'cây lớn',
  'stage.bloom': 'đã ra quả',
  'stage.wilted': 'đang héo',
} as const;

export type GameHubCopyKey = keyof typeof GAME_HUB_COPY;

/** Ngân sách độ dài sau khi điền mẫu bằng số 4 chữ số. Thẻ sảnh rộng ~165px ở 375px: tiêu đề và dòng thưởng phải nằm gọn trong hai dòng. */
export const GAME_HUB_COPY_MAX: Record<GameHubCopyKey, number> = {
  'tab.care': 10,
  'tab.games': 10,
  'tab.garden': 10,
  'reward.water': 16,
  'reward.waterPoints': 18,
  'reward.wheel': 24,
  'reward.matcher': 20,
  'badge.new': 6,
  'cta.play': 8,
  'cta.try': 10,
  'cta.wheel': 8,
  'cta.open': 8,
  'wheel.title': 20,
  'wheel.cost': 28,
  best: 16,
  'sound.label': 24,
  'hero.streakAria': 32,
  'hero.streak': 12,
  'hero.treeAria': 32,
  'stage.sprout': 12,
  'stage.sapling': 12,
  'stage.tree': 12,
  'stage.bloom': 12,
  'stage.wilted': 12,
};

export function hubCopy(key: GameHubCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(GAME_HUB_COPY[key], vars, key);
}
