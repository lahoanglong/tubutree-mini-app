'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setConfig, type ConfigRow } from '@/lib/admin-client';
import { configValue } from '@/lib/admin-config-forms';
import { FEATURE_FLAGS, type FeatureFlag } from '@/lib/admin-feature-flags';
import { useConfirm } from './confirm-dialog';
import { Notice, ToneBadge } from './ui';

/** Khoá nào chưa có dòng trong DB vẫn lưu được: API tự tạo dòng cho các khoá có luật ghi riêng. */
export function FeatureFlagsCard({ rows }: { rows: ConfigRow[] | undefined }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [failure, setFailure] = useState<{ key: string; text: string } | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const toggle = useMutation({
    mutationFn: async ({ flag, next }: { flag: FeatureFlag; next: boolean }) => {
      const ok = await confirm({
        title: next ? `Bật "${flag.label}"?` : `Tắt "${flag.label}"?`,
        message: `${flag.description}\n\n${next ? flag.onWarning ?? 'Có hiệu lực ngay.' : 'Tính năng ngừng với khách ngay. Dữ liệu đã có được giữ nguyên.'}`,
        confirmLabel: next ? 'Bật' : 'Tắt',
        tone: next ? 'default' : 'danger',
      });
      if (!ok) return null;
      await setConfig(flag.key, next);
      return flag.key;
    },
    onSuccess: (key) => {
      if (key === null) return;
      setFailure(null);
      setSavedKey(key);
      void qc.invalidateQueries({ queryKey: ['admin-config'] });
    },
    onError: (e, { flag }) => {
      setSavedKey(null);
      setFailure({ key: flag.key, text: e instanceof Error ? e.message : 'Không lưu được, thử lại sau.' });
    },
  });

  return (
    <section aria-labelledby="feature-flags-title" data-feature-flags className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <h2 id="feature-flags-title" className="font-display text-base font-semibold text-stone-900">Bật/tắt tính năng</h2>
      <p className="mt-0.5 text-xs text-stone-600">Bấm công tắc để bật hoặc tắt với khách. Mỗi lần đổi đều hỏi lại trước khi lưu.</p>
      <ul className="mt-3 divide-y divide-stone-200">
        {FEATURE_FLAGS.map((flag) => {
          const on = configValue<unknown>(rows, flag.key, flag.fallback) === true;
          const busy = toggle.isPending && toggle.variables?.flag.key === flag.key;
          return (
            <li key={flag.key} data-flag={flag.key} className="flex items-start gap-3 py-3">
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={flag.label}
                disabled={!rows || toggle.isPending}
                onClick={() => toggle.mutate({ flag, next: !on })}
                className="mt-0.5 inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center sm:min-h-[36px] sm:min-w-[36px]"
              >
                <span className={`relative inline-block h-6 w-11 rounded-full transition-colors ${on ? 'bg-forest-600' : 'bg-stone-400'} ${busy ? 'opacity-60' : ''}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-stone-0 transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
                </span>
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-stone-900">{flag.label}</p>
                  <ToneBadge tone={on ? 'success' : 'neutral'}>{on ? 'Đang bật' : 'Đang tắt'}</ToneBadge>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-stone-600">{flag.description}</p>
                {failure?.key === flag.key && <div className="mt-1.5"><Notice tone="danger" role="alert">{failure.text}</Notice></div>}
                {savedKey === flag.key && !failure && <p role="status" className="mt-1 text-xs text-success-fg">Đã lưu.</p>}
              </div>
            </li>
          );
        })}
      </ul>
      {dialog}
    </section>
  );
}
