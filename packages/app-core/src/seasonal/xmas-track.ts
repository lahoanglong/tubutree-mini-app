import type { OrnamentId, TapEvent } from './xmas-tree';

/**
 * Thao tác Noel Xanh gửi lên analytics (`noel_action`) cho tab "Noel" của Admin. Danh sách trùng `NOEL_ACTIONS` ở
 * apps/api/src/modules/analytics/event-props.ts (spec so hai bên); API bỏ mọi sự kiện có thao tác hoặc khoá ngoài danh sách.
 * Chỉ mang tên thao tác và món (một trong sáu món cố định): không mã khách, mã mời hay nội dung thiệp.
 */
export const NOEL_ACTIONS = ['ornament_unlock', 'ornament_on', 'ornament_off', 'share_tap', 'snow_on', 'snow_off'] as const;
export type NoelAction = (typeof NOEL_ACTIONS)[number];

export type NoelActionProps = {
  action: NoelAction;
  slot?: OrnamentId;
};

const ORNAMENT_ACTION: Record<Exclude<TapEvent, 'locked'>, NoelAction> = {
  unlocked: 'ornament_unlock',
  on: 'ornament_on',
  off: 'ornament_off',
};

/** Món bị khoá chỉ hiện gợi ý, không đổi gì nên không ghi (null). */
export function ornamentActionProps(event: TapEvent, id: OrnamentId): NoelActionProps | null {
  return event === 'locked' ? null : { action: ORNAMENT_ACTION[event], slot: id };
}

/** `snowOn`: trạng thái SAU khi khách bấm. */
export function snowActionProps(snowOn: boolean): NoelActionProps {
  return { action: snowOn ? 'snow_on' : 'snow_off' };
}

export const SHARE_ACTION_PROPS: NoelActionProps = { action: 'share_tap' };
