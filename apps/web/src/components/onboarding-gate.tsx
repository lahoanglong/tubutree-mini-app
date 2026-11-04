'use client';

import dynamic from 'next/dynamic';

// Giao diện quiz (câu hỏi, biểu tượng, lớp phủ) chỉ tải khi khảo sát bật: cờ đang tắt thì không đi kèm First Load của mọi trang.
const OnboardingGateInner = dynamic(() => import('./onboarding-gate-ui').then((m) => m.OnboardingGateInner), { ssr: false });

/**
 * Khảo sát chào mừng đang TẮT: lớp phủ che kín Trang chủ lần mở đầu, 9 chạm mà câu trả lời chưa được dùng ở đâu. Bật lại (`enabled`) khi câu
 * trả lời đã dùng cho "Gợi ý cho bạn"; khi đó phải là thẻ nhỏ trong trang, không phủ màn.
 */
export const ONBOARDING_SURVEY_ENABLED = false;

export function OnboardingGate({ enabled = ONBOARDING_SURVEY_ENABLED }: { enabled?: boolean } = {}) {
  return enabled ? <OnboardingGateInner /> : null;
}
