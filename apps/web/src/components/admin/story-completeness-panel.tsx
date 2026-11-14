'use client';

import type { CheckSource, CheckState, CompletenessRow, CompletenessVerdict, StoryCompleteness } from '@tubutree/app-core/commerce/story-completeness';
import { STORY_MIN_CONTRAST } from '@tubutree/app-core/commerce/story-completeness';
import type { ProductStoryConfig } from '@tubutree/shared-types';
import type { Tone } from '@/lib/recycling';
import { Notice, ToneBadge } from './ui';

const STATE_TEXT: Record<CheckState, string> = { ok: 'Đủ', warn: 'Cần xem', missing: 'Thiếu' };
const STATE_TONE: Record<CheckState, Tone> = { ok: 'success', warn: 'warning', missing: 'danger' };
const SOURCE_TEXT: Record<CheckSource, string> = { auto: 'Tự động từ sản phẩm', custom: 'Đã chỉnh tay' };
const AMBIENT_TEXT = { leaf: 'Xanh lá', amber: 'Hổ phách', rose: 'Hồng', sky: 'Xanh trời', sand: 'Cát' } as const;

/**
 * Trạng thái xuất bản của cấu hình đang soạn: đang bật công khai, bản nháp chờ duyệt (đã có cấu hình nhưng tắt),
 * đang hiện kịch bản mẫu hoặc tự sinh (chưa lưu cấu hình riêng nhưng khách vẫn thấy), hoặc không có gì để khách thấy.
 */
export type StoryPublication = 'live' | 'draft' | 'runtime' | 'none';

/** `fallback` là kịch bản mà trang khách dùng khi chưa có cấu hình riêng (mẫu theo slug hoặc tự sinh), đúng như `resolveStoryConfig` với `storyConfig: null`. */
export function storyPublication(
  config: Pick<ProductStoryConfig, 'enabled'> | null | undefined,
  fallback?: Pick<ProductStoryConfig, 'enabled'> | null,
): StoryPublication {
  if (config === null || config === undefined) return fallback?.enabled ? 'runtime' : 'none';
  return config.enabled ? 'live' : 'draft';
}

const PUBLICATION: Record<StoryPublication, { tone: Tone; label: string; note: string }> = {
  live: { tone: 'success', label: 'Đang bật công khai', note: 'Theo cấu hình đang soạn: khách đang thấy câu chuyện này trên trang sản phẩm sau khi bấm Lưu sản phẩm.' },
  draft: { tone: 'warning', label: 'Bản nháp chờ duyệt', note: 'Theo cấu hình đang soạn: bản nháp, chưa hiển thị cho khách sau khi bấm Lưu sản phẩm. Xem thử toàn màn hình, đối chiếu chữ với bao bì, rồi bật ô "Bật câu chuyện sản phẩm" và Lưu để công bố.' },
  runtime: { tone: 'info', label: 'Đang hiện kịch bản mẫu', note: 'Chưa lưu cấu hình riêng: khách đang thấy kịch bản mẫu hoặc tự sinh của sản phẩm này. Lưu cấu hình riêng (bật hoặc tắt) sẽ thay kịch bản đó; tắt rồi Lưu là ẩn câu chuyện khỏi khách.' },
  none: { tone: 'neutral', label: 'Chưa có kịch bản', note: 'Chưa lưu cấu hình riêng và chưa đủ dữ liệu để tự sinh: khách chưa thấy câu chuyện nào cho sản phẩm này.' },
};

const VERDICT: Record<CompletenessVerdict, { tone: 'success' | 'warning' | 'danger'; text: (n: number) => string }> = {
  ready: { tone: 'success', text: () => 'Sẵn sàng xuất bản: các chương đều đủ ảnh và nội dung, chữ đọc rõ trên nền cảnh.' },
  review: { tone: 'warning', text: (n) => `Cần xem lại ${n} mục trước khi xuất bản.` },
  blocked: { tone: 'danger', text: (n) => `Chưa nên xuất bản: còn ${n} mục thiếu hoặc chữ khó đọc trên nền cảnh.` },
};

function Row({ row }: { row: CompletenessRow }) {
  return (
    <li data-testid="story-check-row" data-key={row.key} data-state={row.state} data-source={row.source} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-xs text-stone-800">
      <ToneBadge tone={STATE_TONE[row.state]}>{STATE_TEXT[row.state]}</ToneBadge>
      <span className="font-medium text-stone-900">{row.label}</span>
      <ToneBadge tone={row.source === 'auto' ? 'info' : 'neutral'}>{SOURCE_TEXT[row.source]}</ToneBadge>
      <span className="min-w-0 basis-full break-words tabular-nums text-stone-600 sm:basis-auto">{row.note}</span>
    </li>
  );
}

/** Kiểm nhanh trước khi xuất bản: chương nào đủ, chương nào còn dùng nội dung tự sinh, chữ có đọc rõ trên nền cảnh. Chỉ báo, không chặn nút Lưu. */
export function StoryCompletenessPanel({ result, publication }: { result: StoryCompleteness; publication: StoryPublication }) {
  const v = VERDICT[result.verdict];
  const pub = PUBLICATION[publication];
  const rows = [result.stage, ...result.chapters, result.hud];
  return (
    <section data-testid="story-completeness" data-verdict={result.verdict} aria-label="Kiểm tra độ hoàn thiện câu chuyện" className="space-y-2 rounded-card border border-stone-200 p-3">
      <div className="text-sm font-medium text-stone-900">Kiểm tra độ hoàn thiện</div>
      <div className="flex flex-wrap items-center gap-2">
        <span data-testid="story-status" data-status={publication}>
          <ToneBadge tone={pub.tone}>{pub.label}</ToneBadge>
        </span>
        <span data-testid="story-status-note" className="min-w-0 basis-full break-words text-xs text-stone-700 sm:basis-auto">
          {pub.note}
        </span>
      </div>
      <Notice tone={v.tone} role="status">
        <span data-testid="story-completeness-verdict">{v.text(result.attention)}</span>
      </Notice>
      <ul className="divide-y divide-stone-100">
        {rows.map((r) => (
          <Row key={r.key} row={r} />
        ))}
      </ul>
      <div className="space-y-1 text-xs text-stone-700">
        <div className="font-medium text-stone-900">Độ tương phản chữ trên nền cảnh (cần từ {STORY_MIN_CONTRAST}:1)</div>
        <ul className="flex flex-wrap gap-2">
          {result.contrast.map((c) => (
            <li key={c.ambient} data-testid="story-contrast-row" data-ambient={c.ambient} data-pass={c.pass ? 'true' : 'false'}>
              <ToneBadge tone={c.pass ? 'success' : 'danger'}>
                {AMBIENT_TEXT[c.ambient]} <span className="tabular-nums">{c.ratio.toFixed(1)}:1</span> · {c.pass ? 'Đạt' : 'Không đạt'}
              </ToneBadge>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
