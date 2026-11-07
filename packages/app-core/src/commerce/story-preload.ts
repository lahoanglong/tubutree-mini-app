import type { StoryStepView } from './product-story';

/**
 * Ảnh nguyên liệu tải lên (`imageUrl`) là ảnh raster duy nhất đổi theo bước của câu chuyện: sân khấu và sprite vector dựng sẵn trong bundle,
 * nên không có gì để tải thêm cho chúng. Trả địa chỉ ảnh của bước KẾ TIẾP, đúng chuỗi `<img src>` mà lớp sẽ dùng để trình duyệt trúng cache.
 */
export function storyPreloadUrls(steps: readonly Pick<StoryStepView, 'layers'>[], active: number): string[] {
  const next = steps[Math.min(steps.length - 1, Math.max(0, Math.trunc(active) || 0)) + 1];
  if (!next) return [];
  const urls: string[] = [];
  for (const l of next.layers) if (l.imageUrl && !urls.includes(l.imageUrl)) urls.push(l.imageUrl);
  return urls;
}

interface PreloadImage {
  decoding: string;
  src: string;
  setAttribute?: (name: string, value: string) => void;
}

export interface PreloadEnv {
  create?: () => PreloadImage;
  saveData?: boolean;
}

const WARMED_MAX = 64;
const warmed = new Set<string>();

function defaultCreate(): PreloadImage | null {
  const Ctor = (globalThis as { Image?: new () => PreloadImage }).Image;
  return typeof Ctor === 'function' ? new Ctor() : null;
}

function saveDataOn(): boolean {
  const nav = (globalThis as { navigator?: { connection?: { saveData?: boolean } } }).navigator;
  return nav?.connection?.saveData === true;
}

/**
 * Tải trước ảnh vào cache của trình duyệt bằng phần tử ảnh rời, không chặn luồng chính và không chen băng thông của ảnh đang xem (fetchpriority thấp).
 * Mỗi địa chỉ chỉ bắt đầu một lần. Khách bật tiết kiệm dữ liệu thì không tải gì. Trả số ảnh vừa bắt đầu tải.
 */
export function preloadImages(urls: readonly string[], env: PreloadEnv = {}): number {
  if (urls.length === 0 || (env.saveData ?? saveDataOn())) return 0;
  let started = 0;
  for (const url of urls) {
    if (!url || warmed.has(url)) continue;
    const img = env.create ? env.create() : defaultCreate();
    if (!img) return started;
    img.decoding = 'async';
    img.setAttribute?.('fetchpriority', 'low');
    img.src = url;
    if (warmed.size >= WARMED_MAX) warmed.clear();
    warmed.add(url);
    started += 1;
  }
  return started;
}

export function resetPreloadCache(): void {
  warmed.clear();
}

/** Mục Story cách khung nhìn bao xa thì bắt đầu tải trước ảnh chương kế (giá trị `rootMargin` của IntersectionObserver). */
export const STORY_PRELOAD_ROOT_MARGIN = '240px 0px';
