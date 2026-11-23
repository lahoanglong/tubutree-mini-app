'use client';

// Nguồn: apps/miniapp/src/components/cart/cart-nudges.tsx (cùng chữ, cùng test-id, cùng luật hiện).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { refillFirstOn } from '@tubutree/app-core/refill/refill-api';
import { refillCartEducation, refillLandingQuery } from '@tubutree/app-core/refill/refill-landing';
import type { SubscriptionSuggestion } from '@tubutree/app-core/commerce/green-box';
import { RefillEntryRow } from '@/components/refill/refill-landing-entry';
import { SubscriptionSuggestionRow, SuggestedSubscribe, useSubscriptionSuggestion } from '@/components/reorder/subscription-suggestion';
import { coreHttp } from '@/lib/core-http';
import { usePublicConfig } from '@/lib/use-public-config';

export interface CartNudgesProps {
  /** Các dòng giỏ hiện có. */
  lines: readonly { slug: string; variationId: string }[];
  /** Slug chai đang có liên kết đổi Refill một chạm (khách mua lại): không mời xem trang Refill cho chai đó nữa. */
  swapSlugs?: ReadonlySet<string>;
  /** Giỏ tài khoản: thêm dòng gợi ý giao định kỳ cho món trong giỏ (cần đăng nhập). */
  account?: boolean;
}

/**
 * Hai dòng gọn dưới danh sách món của Giỏ (chunk tải sau, không giữ chỗ vì nằm dưới các dòng giỏ):
 * - "Đã có chai sẵn? Xem gói Refill tiết kiệm tới X%" (cờ `catalog.refill_first_enabled`, cùng hàng lối vào Refill của hub): giỏ có chai đã ghép cặp mà khách chưa có lối đổi một chạm.
 *   Chỉ dẫn sang trang Tiết kiệm với Refill, không đổi thẳng: khách mua chai lần đầu chưa có chai để rót.
 * - Gợi ý giao định kỳ (`useSubscriptionSuggestion`) cho món trong giỏ khách hay mua lại, chạm mở sheet Đặt định kỳ tải lười.
 * Không có gì để nói thì không vẽ.
 */
export function CartNudges({ lines, swapSlugs, account = false }: CartNudgesProps) {
  const on = refillFirstOn(usePublicConfig());
  const landingQ = useQuery({ ...refillLandingQuery(coreHttp), enabled: on && lines.length > 0 });
  const edu = on ? refillCartEducation(landingQ.data, lines.map((l) => l.slug), swapSlugs) : null;
  const { suggestion, discountFraction } = useSubscriptionSuggestion(account, lines.map((l) => l.variationId));
  const [subscribeTo, setSubscribeTo] = useState<SubscriptionSuggestion | null>(null);
  if (!edu && !suggestion && !subscribeTo) return null;
  return (
    <div className="mt-3 flex flex-col gap-2">
      {edu && <RefillEntryRow title={edu.text} testId="cart-refill-edu" />}
      {suggestion && <SubscriptionSuggestionRow suggestion={suggestion} discountFraction={discountFraction} onAccept={setSubscribeTo} />}
      {subscribeTo && <SuggestedSubscribe suggestion={subscribeTo} onDone={() => setSubscribeTo(null)} />}
    </div>
  );
}
