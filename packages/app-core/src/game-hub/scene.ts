import { hubCopy } from './copy';

/** Pha bầu trời của thẻ đầu Vườn Xanh theo giờ Việt Nam (UTC+7, không đổi giờ theo mùa). */
export type SkyPhase = 'dawn' | 'day' | 'dusk' | 'night';

const VN_OFFSET_HOURS = 7;

/** Giờ VN của một thời điểm, 0–23, không phụ thuộc múi giờ của máy (máy khách ở nước ngoài vẫn thấy trời theo giờ vườn). */
export function vnHour(now: Date): number {
  return (now.getUTCHours() + VN_OFFSET_HOURS) % 24;
}

/** 05–08 bình minh, 09–15 ban ngày, 16–18 chiều tà, 19–04 ban đêm. */
export function skyPhase(now: Date): SkyPhase {
  const h = vnHour(now);
  if (h >= 5 && h < 9) return 'dawn';
  if (h >= 9 && h < 16) return 'day';
  if (h >= 16 && h < 19) return 'dusk';
  return 'night';
}

/** Giai đoạn của cây trong hình vẽ: theo phần trăm tiến độ tới lần thu hoạch; cây quá hạn chưa tưới thì héo nhưng giữ tiến độ. */
export type TreeStage = 'sprout' | 'sapling' | 'tree' | 'bloom' | 'wilted';

export function treeStage(pct: number, wilted: boolean): TreeStage {
  if (wilted) return 'wilted';
  if (pct >= 100) return 'bloom';
  if (pct >= 60) return 'tree';
  if (pct >= 25) return 'sapling';
  return 'sprout';
}

export const treeStageLabel = (stage: TreeStage): string => hubCopy(`stage.${stage}`);
