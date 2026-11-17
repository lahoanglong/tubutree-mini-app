'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { MatcherEntry } from '@tubutree/shared-types';
import { MATCHER_PATH } from '@tubutree/app-core/game-mini/matcher';
import { matcherCopy } from '@tubutree/app-core/game-mini/matcher-copy';
import { matcherOn, matcherStatusQuery } from '@tubutree/app-core/game-mini/matcher-status';
import { coreHttp } from '@/lib/core-http';

/**
 * Một dòng chữ dẫn sang Chọn Chuẩn Xanh (Tư vấn, Trợ lý đang nghỉ, giỏ trống). Chỉ hiện khi máy chủ báo cờ `game.matcher_enabled` bật; cờ tắt,
 * đang tải hay lỗi thì không vẽ gì, nên trang chứa nó giữ nguyên như trước. `from` đi theo link để analytics biết khách vào từ đâu.
 */
export function MatcherEntryLink({ from, className = '' }: { from: MatcherEntry; className?: string }) {
  const { data } = useQuery(matcherStatusQuery(coreHttp));
  if (!matcherOn(data)) return null;
  return (
    <Link href={`${MATCHER_PATH}?from=${from}`} className={`inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-text-link)] underline underline-offset-2 ${className}`} data-testid={`matcher-entry-${from}`}>
      {matcherCopy('entry.link')}
    </Link>
  );
}
