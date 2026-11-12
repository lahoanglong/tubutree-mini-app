import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Chip biến thể trên vòng cung (Câu chuyện sản phẩm) co lại theo `--arc-scale` (tới 0,6). Vùng chạm phủ thêm `::after` của `.tubu-hit-44-square` cũng co theo transform,
 * nên phải lớn lên theo nghịch đảo hệ số co thì sau khi co mới còn đủ 44px (đo thật ở apps/e2e w130-storefront-narrow.web.spec.ts: chip "Can 5L" từng chỉ còn 40px cao ở 320px).
 */
const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const WEB = read('mini.css');
const MINI = read('../../../../miniapp/src/css/story.css');

describe.each([
  ['web mini.css', WEB],
  ['Mini App story.css', MINI],
])('%s: vùng chạm chip vòng cung bù hệ số co', (_name, css) => {
  it('::after rộng/cao 44px chia cho --arc-scale', () => {
    const m = /\.tubu-story-arc-item\.tubu-hit-44-square::after\s*\{([^}]*)\}/.exec(css);
    expect(m, 'thiếu luật .tubu-story-arc-item.tubu-hit-44-square::after').not.toBeNull();
    expect(m![1]).toMatch(/width:\s*calc\(44px\s*\/\s*var\(--arc-scale,\s*1\)\)/);
    expect(m![1]).toMatch(/height:\s*calc\(44px\s*\/\s*var\(--arc-scale,\s*1\)\)/);
  });
});
