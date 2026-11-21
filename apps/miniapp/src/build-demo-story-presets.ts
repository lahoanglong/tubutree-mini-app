import type { Plugin } from 'vite';

/**
 * `app-core/commerce/story-presets.ts` là kịch bản của 10 sản phẩm dữ liệu mẫu (migration demo catalog). PROD tắt mọi sản phẩm demo (go-live chặn khi còn),
 * nên trong gói Zalo bảng này không bao giờ khớp sản phẩm nào mà vẫn chiếm ~10 KB. Bản build thay nó bằng bảng rỗng; `findStoryPreset` vẫn tra
 * kịch bản thật (LAUNCH/CATALOG ở story-presets-launch.ts). Dev và e2e (vite dev, dữ liệu mẫu) giữ nguyên bảng, như trang /ds-gallery chỉ có ở DEV.
 * API, web và seed import tệp gốc nên không đổi.
 */
export const DEMO_STORY_PRESETS_FILE = /[\\/]app-core[\\/]src[\\/]commerce[\\/]story-presets\.ts$/;

export const DEMO_STORY_PRESETS_STUB = 'export const STORY_PRESETS = {};\n';

export function dropDemoStoryPresetsPlugin(): Plugin {
  return {
    name: 'tubu:drop-demo-story-presets',
    apply: 'build',
    enforce: 'pre',
    load(id) {
      return DEMO_STORY_PRESETS_FILE.test(id.split('?')[0] ?? id) ? DEMO_STORY_PRESETS_STUB : null;
    },
  };
}
