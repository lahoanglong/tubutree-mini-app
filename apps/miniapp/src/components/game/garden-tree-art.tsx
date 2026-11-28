import type { ReactNode } from 'react';
import type { TreeStage } from '@tubutree/app-core/game-hub/scene';

// Cây của thẻ đầu Vườn Xanh, vẽ vector theo giai đoạn (thay emoji 56px của hệ điều hành: mỗi máy vẽ một kiểu). Phần thân + tán nằm trong nhóm
// `.tubu-tree-sway` (đung đưa quanh gốc, tắt khi giảm chuyển động); đất đứng yên. Bản web giữ đúng các hình này.
const TRUNK = 'var(--clay-700)';
const SOIL = 'var(--clay-600)';
const GRASS = 'var(--forest-400)';
const LEAF = 'var(--forest-300)';
const LEAF_LIGHT = 'var(--forest-200)';
const LEAF_DEEP = 'var(--forest-500)';
const FRUIT = 'var(--honey-500)';
const BERRY = 'var(--clay-500)';
const DRY = 'var(--honey-600)';

const leaf = (x: number, y: number, rot: number, fill: string, s = 1) => (
  <path d={`M0 0c${6 * s} ${-8 * s} ${18 * s} ${-8 * s} ${22 * s} 0c${-6 * s} ${8 * s} ${-16 * s} ${8 * s} ${-22 * s} 0z`} transform={`translate(${x} ${y}) rotate(${rot})`} fill={fill} />
);

const PLANT: Record<TreeStage, ReactNode> = {
  sprout: (
    <>
      <path d="M60 96V74" stroke={LEAF_DEEP} strokeWidth="4" strokeLinecap="round" />
      {leaf(60, 78, -150, LEAF, 0.9)}
      {leaf(60, 74, -30, LEAF_LIGHT, 0.9)}
    </>
  ),
  sapling: (
    <>
      <path d="M60 96V52" stroke={TRUNK} strokeWidth="5" strokeLinecap="round" />
      {leaf(60, 82, -155, LEAF)}
      {leaf(60, 74, -25, LEAF_LIGHT)}
      {leaf(60, 64, -150, LEAF_DEEP)}
      {leaf(60, 56, -35, LEAF)}
      {leaf(60, 52, -90, LEAF_LIGHT, 0.8)}
    </>
  ),
  tree: (
    <>
      <path d="M60 96V58m0 14 12-10m-12 4-10-8" stroke={TRUNK} strokeWidth="6" strokeLinecap="round" />
      <circle cx="42" cy="50" r="18" fill={LEAF_DEEP} />
      <circle cx="78" cy="50" r="18" fill={LEAF_DEEP} />
      <circle cx="60" cy="34" r="24" fill={LEAF} />
      <circle cx="52" cy="28" r="8" fill={LEAF_LIGHT} opacity="0.7" />
    </>
  ),
  bloom: (
    <>
      <path d="M60 96V58m0 14 14-12m-14 4-12-9" stroke={TRUNK} strokeWidth="7" strokeLinecap="round" />
      <circle cx="38" cy="48" r="20" fill={LEAF_DEEP} />
      <circle cx="82" cy="48" r="20" fill={LEAF_DEEP} />
      <circle cx="60" cy="30" r="27" fill={LEAF} />
      <circle cx="50" cy="22" r="9" fill={LEAF_LIGHT} opacity="0.7" />
      <circle cx="44" cy="40" r="4.5" fill={FRUIT} />
      <circle cx="70" cy="22" r="4.5" fill={BERRY} />
      <circle cx="78" cy="50" r="4.5" fill={FRUIT} />
      <circle cx="58" cy="46" r="4.5" fill={BERRY} />
      <circle cx="34" cy="56" r="4" fill={BERRY} />
    </>
  ),
  wilted: (
    <>
      <path d="M60 96c0-14 2-24 10-32" stroke={TRUNK} strokeWidth="5" strokeLinecap="round" fill="none" />
      {leaf(62, 80, 150, DRY)}
      {leaf(66, 70, 40, DRY, 0.9)}
      {leaf(70, 64, 110, DRY, 0.8)}
    </>
  ),
};

export function GardenTreeArt({ stage, label }: { stage: TreeStage; label: string }) {
  return (
    <svg viewBox="0 0 120 108" className="tubu-tree-art" role="img" aria-label={label} data-stage={stage}>
      <ellipse cx="60" cy="100" rx="40" ry="7" fill={SOIL} />
      <path d="M26 98l4-7 3 7m48 0 4-8 3 8m-50 1 2-5 2 5" stroke={GRASS} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <g className={stage === 'wilted' ? undefined : 'tubu-tree-sway'}>{PLANT[stage]}</g>
    </svg>
  );
}
