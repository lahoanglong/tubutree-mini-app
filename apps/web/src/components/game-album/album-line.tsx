'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { albumQuery } from '@tubutree/app-core/game-album/api';
import { albumCopy } from '@tubutree/app-core/game-album/copy';
import { ALBUM_PATH, albumEntry, albumNewCards } from '@tubutree/app-core/game-album/view';
import { Card, Icon, Text } from '@/components/mini';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import './album.css';

/**
 * Dòng của sổ ở trang khác, cùng hành vi với Mini App (`apps/miniapp/.../album-screen.tsx`, `AlbumLine`). Không có `roundId`: dòng lối vào
 * "Sổ tay Xanh · n/m thẻ" kèm vòng tiến độ ở Vườn Xanh, dưới "Chơi hôm nay". Có `roundId` (màn kết quả ván đã lưu): dòng "+N thẻ mới vào Sổ
 * tay Xanh" khi ván vừa mở thẻ mới. Khách chưa đăng nhập không gọi API. Cờ tắt (404), lỗi mạng, sổ chưa có thẻ hay ván không mở thẻ mới thì không vẽ gì.
 */
export function AlbumLine({ roundId }: { roundId?: string | null }) {
  const phase = useAuthPhase();
  const r = useQuery({ ...albumQuery(coreHttp, true), enabled: roundId !== null && phase === 'authenticated' }).data;
  if (roundId !== undefined) {
    const n = albumNewCards(r, roundId);
    return n > 0 ? (
      <Link href={ALBUM_PATH.web} className="tubu-mg-link" data-testid="album-new-cards">
        {albumCopy('newCards', { n })}
      </Link>
    ) : null;
  }
  const e = albumEntry(r);
  return (
    e && (
      <Card variant="flat" padding={16}>
        <Link href={ALBUM_PATH.web} className="tubu-mg-row" data-testid="album-entry">
          <svg viewBox="0 0 36 36" width="40" height="40" fill="none" strokeWidth="4" aria-hidden className="album-ring">
            <circle cx="18" cy="18" r="15" />
            <circle cx="18" cy="18" r="15" pathLength={100} strokeDasharray={`${e.pct} 100`} />
          </svg>
          <Text variant="body-md" as="span" className="tubu-mg-row-text">
            {e.text}
          </Text>
          <Icon icon={ChevronRight} size="sm" tone="muted" />
        </Link>
      </Card>
    )
  );
}
