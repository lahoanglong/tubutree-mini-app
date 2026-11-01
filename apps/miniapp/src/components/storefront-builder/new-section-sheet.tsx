import { useState } from 'react';
import { Input } from 'zmp-ui';
import {
  BUILDER_COPY, COMBO_PCT_NEW_DEFAULT, STYLE_HINT, newSectionDto, parseComboPct, styleOptions, suggestedSectionTitle,
  type SectionStyle,
} from '@tubutree/app-core/commerce/storefront-builder';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Field } from '../ui/form';
import { LayoutPicker } from '../ui/layout-picker';
import { Text } from '../ui/text';

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <LayoutPicker
          value={style}
          options={OPTIONS}
          onChange={(next) => {
            setStyle(next);
            if (!typed) setTitle(suggestedSectionTitle(next));
          }}
        />
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 6 }}>{STYLE_HINT[style]}</Text>
      </div>
      <Field label={BUILDER_COPY.sectionName}>
        <Input
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => {
            setTyped(true);
            setTitle(e.target.value);
          }}
        />
      </Field>
      {style === 'COMBO' && (
        <div>
          <Field label={BUILDER_COPY.comboPct}>
            <Input inputMode="numeric" maxLength={3} value={pctText} onChange={(e) => setPctText(e.target.value)} />
          </Field>
          <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 4 }}>{BUILDER_COPY.comboPctHint}</Text>
        </div>
      )}
      <Button
        fullWidth
        disabled={!valid}
        loading={pending}
        onPress={() => onCreate(newSectionDto({ style, title, comboPct: pct }))}
      >
        {BUILDER_COPY.createAndAdd}
      </Button>
    </div>
  );
}

/** Thêm khối: chọn kiểu (cả bốn ô mở), đặt tên, Combo thêm mức giảm. Form chỉ dựng khi sheet mở nên mỗi lần mở là một khối mới, tên gợi ý theo kiểu. */
export function NewSectionSheet({ open, onClose, pending, onCreate }: {
  open: boolean;
  onClose: () => void;
  pending: boolean;
  onCreate: (dto: ReturnType<typeof newSectionDto>) => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title={BUILDER_COPY.addSection}>
      {open && <NewSectionForm pending={pending} onCreate={onCreate} />}
    </BottomSheet>
  );
}
