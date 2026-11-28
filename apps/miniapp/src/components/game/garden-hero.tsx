import { lazy, Suspense, useEffect, useState, type CSSProperties } from 'react';
import { Flame } from 'lucide-react';
import { hubCopy } from '@tubutree/app-core/game-hub/copy';
import { skyPhase, treeStage, treeStageLabel, type SkyPhase } from '@tubutree/app-core/game-hub/scene';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { treeTitle } from '@tubutree/app-core/tree-title';
import { usePublicConfig } from '../../hooks/use-public-config';
import type { GameProfile } from '../../services/game-api';
import type { ChristmasGardenProps } from '../season/christmas-garden';
import { formatNumber } from '../../utils/format';
import { sfx } from '../../utils/sfx';
import { Icon } from '../ui/icon';
import { Heading, Text } from '../ui/text';
import { GardenTreeArt } from './garden-tree-art';
import { WaterTank } from './water-tank';
import { WeekRhythm, type WeekRhythmProps } from './week-rhythm';
import '../../css/game-hub.css';

const t = gameNewbieCopy.hero;
// Cây thông tự trang trí: chunk riêng chỉ tải khi bật mùa Noel; tải lỗi thì giữ cây thường.
const ChristmasGarden = lazy(() => import('../season/christmas-garden').catch(() => ({ default: ({ plain }: ChristmasGardenProps) => <>{plain}</> })));
const SKY_REFRESH_MS = 5 * 60_000;
const DROPS = [
  { dx: -26, dd: 0 },
  { dx: -8, dd: 90 },
  { dx: 12, dd: 40 },
  { dx: 28, dd: 150 },
  { dx: 2, dd: 220 },
] as const;

/** Pha bầu trời theo giờ VN, đổi khi khách để trang mở qua mốc giờ. */
function useSkyPhase(): SkyPhase {
  const [sky, setSky] = useState(() => skyPhase(new Date()));
  useEffect(() => {
    const id = setInterval(() => setSky(skyPhase(new Date())), SKY_REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  return sky;
}

/**
 * Mỗi lượt tưới thành công (`waterTick` tăng) thì kêu "tách" nhỏ. Không suy từ số giọt giảm: mở lô hay tưới lô ở tab Khu vườn cũng làm giọt giảm
 * trong khi thẻ này đang ẩn.
 */
function useWaterSound(waterTick: number) {
  useEffect(() => {
    if (waterTick > 0) sfx.play('water');
  }, [waterTick]);
}

/**
 * Thẻ đầu tab Chăm vườn: bầu trời đổi theo giờ VN (bình minh, ngày, chiều tà, đêm), cây vector đung đưa theo giai đoạn, giọt nước rơi khi tưới,
 * viên chuỗi ngày, tiến độ tới lần thu hoạch, hai chip thành tích và dải Nhịp Sống Xanh 7 ngày. Chuyển động tắt khi giảm chuyển động (game-hub.css).
 * Viên chuỗi chỉ ghi "N ngày" để không lặp nguyên văn dòng "Chuỗi N ngày" của thẻ Điểm danh.
 */
export function GardenHero({
  eco,
  totalSeeds,
  streakDays,
  rhythm,
  harvestReady = false,
  wilted = false,
  tankCapacity,
  waterTick = 0,
}: {
  eco: GameProfile['ecoImpact'] | undefined;
  totalSeeds: number | undefined;
  streakDays: number | undefined;
  /** Dữ liệu hôm nay cho dải Nhịp Sống Xanh 7 Ngày (xem `WeekRhythm`). */
  rhythm: Omit<WeekRhythmProps, 'streakDays'>;
  harvestReady?: boolean;
  /** Cây quá hạn chưa tưới: héo nhưng giữ tiến độ. */
  wilted?: boolean;
  tankCapacity?: number;
  /** Số lượt tưới thành công trong lần mở trang; mỗi lần tăng thì giọt nước rơi lên cây. */
  waterTick?: number;
}) {
  const sky = useSkyPhase();
  useWaterSound(waterTick);
  const progress = eco ? Math.min(eco.progress, eco.target) : 0;
  const pct = eco && eco.target > 0 ? Math.min(100, Math.round((progress / eco.target) * 100)) : 0;
  const left = eco ? Math.max(0, eco.target - progress) : 0;
  const stage = treeStage(harvestReady ? 100 : pct, wilted);
  const xmas = usePublicConfig().seasonalTheme === 'christmas';
  const plain = <GardenTreeArt key={stage} stage={stage} label={hubCopy('hero.treeAria', { stage: treeStageLabel(stage) })} />;
  return (
    <div className="tubu-hero" data-sky={sky} data-season={xmas ? 'christmas' : undefined} data-testid="garden-hero">
      <span className="tubu-hero-orb" aria-hidden />
      <div className="tubu-hero-top">
        <WaterTank seeds={totalSeeds} capacity={tankCapacity} />
        {streakDays != null && streakDays > 0 && (
          <span className="tubu-hero-streak" role="img" aria-label={hubCopy('hero.streakAria', { n: formatNumber(streakDays) })} data-testid="hero-streak">
            <Icon icon={Flame} size="sm" tone="current" />
            <Text variant="label" tone="inverse" as="span" numeric style={{ fontWeight: 700 }}>
              {hubCopy('hero.streak', { n: formatNumber(streakDays) })}
            </Text>
          </span>
        )}
      </div>
      <div className="tubu-hero-stage" data-testid="garden-stage">
        {xmas ? (
          <Suspense fallback={plain}>
            <ChristmasGarden
              plain={plain}
              progress={{ streakDays: streakDays ?? 0, activeToday: rhythm.activeToday, drops: totalSeeds ?? 0, harvested: eco?.treesPlanted ?? 0 }}
            />
          </Suspense>
        ) : (
          plain
        )}
        {waterTick > 0 && (
          <span key={waterTick} className="tubu-drops" aria-hidden>
            {DROPS.map((d) => (
              <span key={d.dx} className="tubu-drop" style={{ '--dx': d.dx, '--dd': d.dd } as CSSProperties} />
            ))}
          </span>
        )}
      </div>
      <Heading variant="title-md" as="div" tone="inverse">
        {eco ? treeTitle(eco.treeType) : 'Vườn của bạn'}
      </Heading>
      <div role="progressbar" aria-label="Tiến độ cây" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="tubu-hero-progress">
        <span style={{ width: `${pct}%` }} />
      </div>
      <Text variant="body-sm" tone="inverse" as="div" style={{ fontWeight: 600 }}>
        {wilted ? t.wilted : harvestReady || left === 0 ? t.ready : t.remaining(left)}
      </Text>
      <ul className="tubu-hero-chips">
        <li className="tubu-hero-chip">
          <Text variant="label" tone="inverse" as="span" numeric>
            {formatNumber(progress)}/{formatNumber(eco?.target)}💧
          </Text>
        </li>
        <li className="tubu-hero-chip">
          <Text variant="label" tone="inverse" as="span" numeric>
            {t.harvested(eco?.treesPlanted ?? 0)}
          </Text>
        </li>
      </ul>
      <WeekRhythm streakDays={streakDays} {...rhythm} />
    </div>
  );
}
