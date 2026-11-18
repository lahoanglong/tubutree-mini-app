import type { MiniKitchenCorner } from '@tubutree/shared-types';
import { fillTemplate } from '../copy-template';

/**
 * Chữ của bàn chơi và màn kết quả Căn Bếp Xanh. Tách khỏi `GAME_MINI_COPY` vì game chỉ phát ở web: Mini App chỉ mang tên, mô tả và luật chơi
 * (`game.kitchen_swap.*` trong `GAME_MINI_COPY`). `kitchen.spec.ts` chạy `FORBIDDEN_TERMS`, bộ chặn tuyên bố và ngân sách độ dài trên từng khoá.
 */
export const KITCHEN_COPY = {
  'corner.table': 'Bàn ăn',
  'corner.kitchen': 'Gian bếp',
  'corner.bathroom': 'Phòng tắm',
  'corner.bag': 'Túi đi làm',
  'corner.step': 'Góc {n}/{m}',
  cornersAria: 'Các góc nhà của ván này',
  cornerDoneAria: '{corner}: đã đổi',
  cornerTodoAria: '{corner}: chưa đổi',
  hidden: 'Đang giấu',
  pick: 'Chạm sản phẩm làm đúng việc này để đổi',
  optionsAria: 'Ba sản phẩm để đổi cho món {item}',
  swapped: 'Đã đổi sang {name}',
  label: 'Về sản phẩm này',
  next: 'Góc tiếp',
  finish: 'Nộp bài',
  set: 'Sản phẩm bạn vừa khám phá',
  pending: 'Sản phẩm ở ván trước của bạn',
  add: 'Thêm vào giỏ dùng thử',
  reviewTitle: '{corner}: {item}',
} as const;

export type KitchenCopyKey = keyof typeof KITCHEN_COPY;

/** Số ký tự tối đa sau khi điền biến với giá trị thường gặp: nhãn góc, nút, tiêu đề khối phải nằm gọn một dòng ở 360px. */
export const KITCHEN_COPY_MAX: Partial<Record<KitchenCopyKey, number>> = {
  'corner.table': 12,
  'corner.kitchen': 12,
  'corner.bathroom': 12,
  'corner.bag': 12,
  'corner.step': 10,
  hidden: 12,
  label: 16,
  next: 12,
  finish: 12,
  set: 32,
  pending: 32,
  add: 24,
};

export function kitchenCopy(key: KitchenCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(KITCHEN_COPY[key], vars, key);
}

export const kitchenCornerName = (corner: MiniKitchenCorner): string => kitchenCopy(`corner.${corner}`);
