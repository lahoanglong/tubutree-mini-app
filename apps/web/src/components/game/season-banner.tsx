import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { Leaf } from 'lucide-react';
import type { Season } from '@tubutree/app-core/api/game';

// Emoji của loài nổi bật là dữ liệu từ máy chủ (nội dung game).
export function SeasonBanner({ season }: { season: Season }) {
  return (
    <div className="rounded-card border border-forest-200 bg-stone-0 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-forest-700">
          <Leaf className="h-4 w-4" aria-hidden="true" />
          {season.name}
        </span>
        <span className="text-lg" aria-hidden="true">
          {season.featuredSpecies.map((s) => s.emoji).join(' ')}
        </span>
      </div>
      {(season.theme || season.region) && <div className="text-caption text-stone-700">{[season.theme, season.region].filter(Boolean).join(' · ')}</div>}
      {season.featuredSpecies.length > 0 && (
        <div className="mt-0.5 text-caption text-stone-600">Loài nổi bật mùa này: {season.featuredSpecies.map((s) => s.name).join(', ')}</div>
      )}
    </div>
  );
}

/** Không có mùa nào đang chạy (chưa tạo mùa mới hoặc mùa cũ đã hết hạn): nói rõ thay vì để trống hay hiện mùa cũ. */
export function SeasonEmpty() {
  return (
    <div data-testid="season-empty" className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-stone-700">
        <Leaf className="h-4 w-4" aria-hidden="true" />
        {gameNewbieCopy.seasonEmpty.title}
      </span>
      <p className="mt-0.5 text-caption text-stone-600">{gameNewbieCopy.seasonEmpty.body}</p>
    </div>
  );
}
