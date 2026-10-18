import { Check, Droplets, Earth, Sprout, TreePine, Trees, type LucideIcon } from 'lucide-react';
import type { Forest, GameProfile } from '@tubutree/app-core/api/game';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from './format';
import { GameCard } from './game-card';

// Tác động xanh (§6.7.7). Không quy đổi khí thải cho phần cây khách góp: chưa có cây nào được trồng thật. 🌿 trong lời cảm ơn là lời chúc (nội dung).
export function EcoImpact({
  eco,
  totalSeeds,
  forest,
}: {
  eco: GameProfile['ecoImpact'] | undefined;
  totalSeeds: number | undefined;
  forest: Forest | undefined;
}) {
  return (
    <GameCard title="Tác động xanh của bạn" icon={Earth}>
      <div className="flex gap-2">
        <EcoStat icon={TreePine} value={formatNumber(eco?.treesPlanted)} label="Cây đã góp quỹ" />
        <EcoStat icon={Droplets} value={formatNumber(totalSeeds)} label="Giọt nước đã góp" />
      </div>
      {(forest?.count ?? 0) > 0 ? (
        <>
          <p className="mt-2 text-xs text-forest-700">Cảm ơn bạn! Bạn đã góp {formatNumber(forest?.count)} cây vào quỹ trồng cây của Tubu 🌿</p>
          {/* Đóng góp của tôi — mã ghi nhận từng cây (§6.7.7) */}
          <div className="mt-3 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-900">
              <Trees className="h-4 w-4 text-forest-600" aria-hidden="true" />
              Đóng góp của tôi
            </div>
            {forest!.trees.slice(0, 5).map((t) => (
              <div key={t.certificateCode} className="flex items-center justify-between gap-2 rounded-control bg-stone-50 px-3 py-2">
                <div>
                  <div className="text-xs font-semibold tracking-wide text-forest-700">{t.certificateCode}</div>
                  <div className="text-xs text-stone-600">{t.treeType}</div>
                </div>
                {t.status === 'PLANTED' ? (
                  <Badge tone="success" size="sm" icon={Check}>
                    Đã trồng
                  </Badge>
                ) : (
                  <Badge tone="neutral" size="sm" icon={Sprout}>
                    Đã góp quỹ
                  </Badge>
                )}
              </div>
            ))}
            {forest!.count > 5 && <p className="text-xs text-stone-600">…và {formatNumber(forest!.count - 5)} cây khác</p>}
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs text-stone-600">Chăm cây ảo đến khi thu hoạch để Tubu góp 1 cây vào quỹ trồng cây.</p>
      )}
    </GameCard>
  );
}

function EcoStat({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-control bg-stone-50 p-2 text-center">
      <Icon className="mx-auto h-5 w-5 text-forest-600" aria-hidden="true" />
      <div className="text-sm font-bold text-forest-700">{value}</div>
      <div className="text-xs text-stone-600">{label}</div>
    </div>
  );
}
