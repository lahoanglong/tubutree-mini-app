'use client';

import type { CheckSource, CheckState, CompletenessRow, CompletenessVerdict, StoryCompleteness } from '@tubutree/app-core/commerce/story-completeness';
import { STORY_MIN_CONTRAST } from '@tubutree/app-core/commerce/story-completeness';
import type { Tone } from '@/lib/recycling';
import { Notice, ToneBadge } from './ui';

const STATE_TEXT: Record<CheckState, string> = { ok: 'Đủ', warn: 'Cần xem', missing: 'Thiếu' };
const STATE_TONE: Record<CheckState, Tone> = { ok: 'success', warn: 'warning', missing: 'danger' };
const SOURCE_TEXT: Record<CheckSource, string> = { auto: 'Tự động từ sản phẩm', custom: 'Đã chỉnh tay' };
const AMBIENT_TEXT = { leaf: 'Xanh lá', amber: 'Hổ phách', rose: 'Hồng', sky: 'Xanh trời', sand: 'Cát' } as const;

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
export function StoryCompletenessPanel({ result }: { result: StoryCompleteness }) {
  const v = VERDICT[result.verdict];
  const rows = [result.stage, ...result.chapters, result.hud];
  return (
    <section data-testid="story-completeness" data-verdict={result.verdict} aria-label="Kiểm tra độ hoàn thiện câu chuyện" className="space-y-2 rounded-card border border-stone-200 p-3">
      <div className="text-sm font-medium text-stone-900">Kiểm tra độ hoàn thiện</div>
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
