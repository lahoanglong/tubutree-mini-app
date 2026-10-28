import { useSyncExternalStore } from 'react';
import type { AiProduct } from '@tubutree/app-core/api/ai';

export interface AdvisorMessage {
  role: 'user' | 'assistant';
  content: string;
  products?: AiProduct[];
  /** Tin xin lỗi do lần gọi trước thất bại: không đưa vào lịch sử khi thử lại, và là chỗ gắn nút "Thử lại". */
  failed?: boolean;
}

/** Đủ cho một buổi hỏi dài; cũ hơn nữa không còn gửi lên (chỉ 20 lượt cuối đi kèm mỗi câu hỏi). */
export const MAX_ADVISOR_MESSAGES = 40;

const EMPTY: readonly AdvisorMessage[] = Object.freeze([]);
const listeners = new Set<() => void>();
let owner: string | null = null;
let messages: readonly AdvisorMessage[] = EMPTY;

function set(next: readonly AdvisorMessage[]) {
  messages = next;
  listeners.forEach((fn) => fn());
}

/**
 * Hội thoại với Trợ lý AI nằm trong bộ nhớ của tab (không lưu xuống máy): trang bị gỡ khi khách mở sản phẩm, nên giữ ở state
 * của trang thì quay lại là mất hết. Gắn với id người dùng: người khác đăng nhập trên cùng tab không đọc được hội thoại cũ,
 * kể cả khi đăng xuất xảy ra lúc trang này không mở.
 */
export function useAdvisorMessages(userId: string): readonly AdvisorMessage[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => (owner === userId ? messages : EMPTY),
    () => EMPTY,
  );
}

export function appendAdvisorMessage(userId: string, m: AdvisorMessage): void {
  const base = owner === userId ? messages : EMPTY;
  owner = userId;
  set([...base, m].slice(-MAX_ADVISOR_MESSAGES));
}

/** Giữ `keep` tin đầu (thử lại bỏ tin xin lỗi). */
export function truncateAdvisorMessages(userId: string, keep: number): void {
  if (owner !== userId) return;
  set(messages.slice(0, keep));
}

export function clearAdvisorMessages(): void {
  owner = null;
  set(EMPTY);
}
