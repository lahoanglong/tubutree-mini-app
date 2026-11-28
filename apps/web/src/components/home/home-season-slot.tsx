'use client';

import dynamic from 'next/dynamic';
import type { CSSProperties } from 'react';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import { CHRISTMAS_HERO_HEIGHT, normalizeSeasonalTheme, seasonHasHomeTheme } from '@tubutree/app-core/seasonal/seasonal-theme';
import { usePublicConfig } from '@/lib/use-public-config';

const WAIT: CSSProperties = { height: CHRISTMAS_HERO_HEIGHT };

// Không dựng ở server: thẻ đọc giờ máy, trạng thái điểm danh và lựa chọn ❄️ trên máy khách. HTML đầu (ISR) giữ đúng chiều cao thẻ nên thẻ thật thế chỗ mà trang không nhảy.
const ChristmasHome = dynamic(() => import('./season/christmas-home'), {
  ssr: false,
  loading: () => <div aria-hidden="true" data-testid="home-season-wait" style={WAIT} />,
});

/**
 * Chỗ gắn khối mùa lễ của Trang chủ web (ngay dưới dải ngữ cảnh; từ lg nằm cùng cột phải với dải ngữ cảnh), bản web của
 * `apps/miniapp/src/components/home/home-season-slot.tsx`. Mùa đọc từ cấu hình công khai dựng sẵn ở server (`initialConfig`, ISR) rồi bản mới:
 * "none"/"tet" (chưa có giao diện) không vẽ gì và không tải chunk Noel nào.
 */
export function HomeSeasonSlot({ initialConfig }: { initialConfig?: PublicConfig }) {
  const cfg = usePublicConfig(initialConfig);
  if (!seasonHasHomeTheme(normalizeSeasonalTheme(cfg.seasonalTheme))) return null;
  return (
    <div data-home-block="season" style={SHELL}>
      <ChristmasHome />
    </div>
  );
}

// Lề trên như mọi khối Trang chủ (vỏ khối đặt lề, khối con không tự đặt).
const SHELL: CSSProperties = { marginTop: 'var(--space-block)' };
