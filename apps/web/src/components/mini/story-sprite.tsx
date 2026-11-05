import type { IngredientLayerSprite } from '@tubutree/shared-types';
import { STORY_SPRITES } from '@tubutree/app-core/commerce/story-sprites';
import { toneVar } from '@tubutree/app-core/commerce/product-story';

/** Một nguyên liệu của lớp "rơi vào": ảnh tải lên hoặc sprite vector. Chỉ để trang trí nên luôn ẩn khỏi trình đọc màn hình. */
export function StorySprite({ layer }: { layer: Pick<IngredientLayerSprite, 'spriteId' | 'imageUrl'> }) {
  if (layer.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={layer.imageUrl} alt="" loading="lazy" decoding="async" className="tubu-story-sprite" />;
  }
  const sprite = layer.spriteId && Object.prototype.hasOwnProperty.call(STORY_SPRITES, layer.spriteId) ? STORY_SPRITES[layer.spriteId] : undefined;
  if (!sprite) return null;
  return (
    <svg viewBox={sprite.viewBox} aria-hidden="true" focusable="false" className="tubu-story-sprite">
      {sprite.paths.map((p, i) => (
        <path key={i} d={p.d} fill={toneVar(p.tone)} />
      ))}
    </svg>
  );
}
