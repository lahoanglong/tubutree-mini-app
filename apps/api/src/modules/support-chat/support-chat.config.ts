export const CHAT_ENABLED_KEY = 'chat.enabled';
export const CHAT_GROUP_KEY = 'chat.zalo_group_id';
export const CHAT_HOURS_KEY = 'chat.hours';
export const CHAT_OFF_HOURS_TEXT_KEY = 'chat.off_hours_text';
export const CHAT_RETENTION_KEY = 'retention.support_chat_days';

export const DEFAULT_CHAT_HOURS = { start: '08:00', end: '21:00' } as const;
export const DEFAULT_OFF_HOURS_TEXT =
  'Tubu Tree trả lời từ 8:00 đến 21:00 mỗi ngày. Tin của bạn đã được ghi lại, nhân viên sẽ trả lời khi vào giờ.';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Kiểm dạng `chat.hours`: sai dạng thì lời nhắn ngoài giờ và cờ "đang ngoài giờ" tính sai lặng lẽ. */
export function chatHoursProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'phải là {"start":"08:00","end":"21:00"}';
  const { start, end } = value as Record<string, unknown>;
  if (typeof start !== 'string' || typeof end !== 'string' || !HHMM.test(start) || !HHMM.test(end)) {
    return 'start và end phải có dạng HH:MM (00:00–23:59)';
  }
  // So chuỗi HH:MM theo từ điển đúng bằng so giờ vì cùng độ dài, đệm số 0.
  return start < end ? null : 'start phải nhỏ hơn end';
}
