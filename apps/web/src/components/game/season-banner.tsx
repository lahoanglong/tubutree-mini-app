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
      {(season.theme || season.region) && <div className="text-xs text-stone-700">{[season.theme, season.region].filter(Boolean).join(' · ')}</div>}
      {season.featuredSpecies.length > 0 && (
        <div className="mt-0.5 text-xs text-stone-600">Loài nổi bật mùa này: {season.featuredSpecies.map((s) => s.name).join(', ')}</div>
      )}
    </div>
  );
}
