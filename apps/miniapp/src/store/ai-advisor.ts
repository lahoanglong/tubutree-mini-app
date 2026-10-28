import { create } from 'zustand';
import type { AiProduct } from '../services/ai-api';
import { useAuthStore } from './auth';

export interface AdvisorMessage {
  role: 'user' | 'assistant';
  content: string;
  products?: AiProduct[];
  /** Tin xin lỗi do lần gọi trước thất bại: không đưa vào lịch sử khi thử lại, và là chỗ gắn nút "Thử lại". */
  failed?: boolean;
}

/** Đủ cho một buổi hỏi dài; cũ hơn nữa không còn gửi lên (chỉ 20 lượt cuối đi kèm mỗi câu hỏi). */
export const MAX_ADVISOR_MESSAGES = 40;

interface AiAdvisorState {
  messages: AdvisorMessage[];
  append: (m: AdvisorMessage) => void;
  /** Giữ `keep` tin đầu (thử lại bỏ tin xin lỗi). */
  truncate: (keep: number) => void;
  clear: () => void;
}

/**
 * Hội thoại với Trợ lý AI nằm trong bộ nhớ, không lưu xuống máy: AnimationRoutes gỡ trang khi khách mở sản phẩm, nên giữ ở
 * state của trang thì quay lại là mất hết.
 */
export const useAiAdvisorStore = create<AiAdvisorState>((set) => ({
  messages: [],
  append: (m) => set((s) => ({ messages: [...s.messages, m].slice(-MAX_ADVISOR_MESSAGES) })),
  truncate: (keep) => set((s) => ({ messages: s.messages.slice(0, keep) })),
  clear: () => set({ messages: [] }),
}));

// Đăng xuất hoặc đổi sang tài khoản khác thì xoá: máy dùng chung không để người sau đọc câu hỏi của người trước.
// Từ chưa đăng nhập sang có tài khoản (mở app) không xoá, kẻo mất câu hỏi đang gõ dở.
useAuthStore.subscribe((s, prev) => {
  if (prev.user && s.user?.id !== prev.user.id) useAiAdvisorStore.getState().clear();
});
