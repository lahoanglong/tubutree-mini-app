import type { StoryAmbient } from '@tubutree/shared-types';
import { STORY_AMBIENT_RGB, STORY_MIN_CONTRAST, STORY_TEXT_RGB } from '@tubutree/app-core/commerce/story-completeness';
import { describe, expect, it } from 'vitest';
import { ratio, tokenRgb } from '../test-support/contrast';

/**
 * Story Completeness Check ở Admin đo tương phản bằng bảng màu hằng của app-core (không đọc CSS lúc chạy). Bảng đó phải khớp token thật,
 * nếu không panel báo "Đạt" cho một cặp màu mà khách thấy khác.
 */
describe('bảng màu của Story Completeness Check khớp design-tokens', () => {
  it('chữ chính của cảnh là --color-text-primary', () => {
    expect([...STORY_TEXT_RGB]).toEqual(tokenRgb('--color-text-primary'));
  });

  it.each(Object.keys(STORY_AMBIENT_RGB) as StoryAmbient[])('nền cảnh %s khớp token --color-story-ambient và chữ chính đạt 4,5:1', (a) => {
    expect([...STORY_AMBIENT_RGB[a]]).toEqual(tokenRgb(`--color-story-ambient-${a}`));
    expect(ratio(tokenRgb('--color-text-primary'), tokenRgb(`--color-story-ambient-${a}`))).toBeGreaterThanOrEqual(STORY_MIN_CONTRAST);
  });
});
