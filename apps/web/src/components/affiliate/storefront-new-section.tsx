'use client';

import { useState } from 'react';
import {
  BUILDER_COPY, COMBO_PCT_NEW_DEFAULT, STYLE_HINT, newSectionDto, parseComboPct, styleOptions, suggestedSectionTitle,
  type SectionStyle,
} from '@tubutree/app-core/commerce/storefront-builder';
import { ui } from '@/lib/guest-ui';
import { Field } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { LayoutPicker } from '@/components/mini/layout-picker';

const TITLE_MAX = 80;
const OPTIONS = styleOptions(null);

function NewSectionForm({ pending, onCreate }: { pending: boolean; onCreate: (dto: ReturnType<typeof newSectionDto>) => void }) {
  const [style, setStyle] = useState<SectionStyle>('GRID');
  const [title, setTitle] = useState(suggestedSectionTitle('GRID'));
  // Tên gợi ý chỉ đi theo kiểu cho tới khi người dùng gõ: sau đó đổi kiểu không được ghi đè chữ của họ.
  const [typed, setTyped] = useState(false);
  const [pctText, setPctText] = useState(String(COMBO_PCT_NEW_DEFAULT));
  const pct = parseComboPct(pctText);
  const valid = title.trim() !== '' && (style !== 'COMBO' || pct !== null);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <LayoutPicker
          value={style}
          options={OPTIONS}
          onChange={(next) => {
            setStyle(next);
            if (!typed) setTitle(suggestedSectionTitle(next));
          }}
        />
        <p className="mt-1.5 text-xs text-stone-600">{STYLE_HINT[style]}</p>
      </div>
      <Field label={BUILDER_COPY.sectionName}>
        <input
          className={ui.field}
          aria-label={BUILDER_COPY.sectionName}
          maxLength={TITLE_MAX}
          value={title}
          onChange={(e) => {
            setTyped(true);
            setTitle(e.target.value);
          }}
        />
      </Field>
      {style === 'COMBO' && (
        <div>
          <Field label={BUILDER_COPY.comboPct}>
            <input className={ui.field} aria-label={BUILDER_COPY.comboPct} inputMode="numeric" maxLength={3} value={pctText} onChange={(e) => setPctText(e.target.value)} />
          </Field>
          <p className="mt-1 text-xs text-stone-600">{BUILDER_COPY.comboPctHint}</p>
        </div>
      )}
      <button type="button" className={`${ui.btnPrimary} w-full`} disabled={!valid || pending} onClick={() => onCreate(newSectionDto({ style, title, comboPct: pct }))}>
        {pending ? 'Đang tạo…' : BUILDER_COPY.createAndAdd}
      </button>
    </div>
  );
}

/** Thêm khối: chọn kiểu (cả bốn ô mở), đặt tên, Combo thêm mức giảm. Form chỉ dựng khi sheet mở nên mỗi lần mở là một khối mới, tên gợi ý theo kiểu. */
export function StorefrontNewSection({ open, onClose, pending, onCreate }: {
  open: boolean;
  onClose: () => void;
  pending: boolean;
  onCreate: (dto: ReturnType<typeof newSectionDto>) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={BUILDER_COPY.addSection}>
      {open && <NewSectionForm pending={pending} onCreate={onCreate} />}
    </Sheet>
  );
}
