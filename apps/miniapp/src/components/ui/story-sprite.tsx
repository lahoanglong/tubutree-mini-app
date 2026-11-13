import type { CSSProperties } from 'react';
import { toneVar } from '@tubutree/app-core/commerce/product-story';
import { STORY_SPRITES } from '@tubutree/app-core/commerce/story-sprites';
import { hideBrokenImage } from '@tubutree/app-core/image-fallback';

/** Sprite nguyên liệu: vector từ thư viện, màu theo token tone; spriteId lạ (cấu hình cũ) thì không vẽ gì thay vì ném lỗi. Trang trí nên luôn aria-hidden. */
export function StorySprite({ spriteId, imageUrl, style }: { spriteId?: string; imageUrl?: string; style?: CSSProperties }) {
  if (imageUrl) return <img src={imageUrl} alt="" loading="lazy" decoding="async" aria-hidden style={{ width: '100%', height: '100%', objectFit: 'contain', ...style }} onError={hideBrokenImage} />;
  const sprite = spriteId && Object.prototype.hasOwnProperty.call(STORY_SPRITES, spriteId) ? STORY_SPRITES[spriteId] : undefined;
  if (!sprite) return null;
  return (
    <svg viewBox={sprite.viewBox} aria-hidden focusable="false" style={{ width: '100%', height: '100%', display: 'block', ...style }}>
      {sprite.paths.map((p, i) => (
        <path key={i} d={p.d} fill={toneVar(p.tone)} />
      ))}
    </svg>
  );
}
