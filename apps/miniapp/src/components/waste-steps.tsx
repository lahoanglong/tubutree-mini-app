import type { LucideIcon } from 'lucide-react';
import { Leaf, ListChecks, Package } from 'lucide-react';
import { wasteGuestCopy, wasteRulesSheetCopy, wasteStepStrip, type WasteStepKind } from '@tubutree/app-core/waste-copy';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { Icon } from './ui/icon';
import { Heading, Text } from './ui/text';
import '../css/waste-steps.css';

const STEP_ICON: Record<WasteStepKind, LucideIcon> = { pick: ListChecks, deliver: Package, points: Leaf };

/** Dải 3 bước có biểu tượng của màn Đổi rác; câu đầy đủ từng bước nằm trong `WasteRulesSheet`. */
export function WasteStepStrip({ flags }: { flags: { dropoff: boolean; mailin: boolean } }) {
  return (
    <ol className="tubu-waste-steps" aria-label={wasteRulesSheetCopy.stripLabel} data-testid="waste-step-strip">
      {wasteStepStrip(flags).map((s, i) => (
        <li key={s.kind} className="tubu-waste-step" data-step={s.kind}>
          <span className="tubu-waste-step-icon" aria-hidden="true">
            <Icon icon={STEP_ICON[s.kind]} tone="brand" />
            <span className="tubu-waste-step-num">{i + 1}</span>
          </span>
          <span>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

export interface WasteRulesSheetProps {
  open: boolean;
  onClose: () => void;
  /** Các bước đầy đủ; rỗng thì không có mục Các bước (sheet mở từ bước chọn món chỉ cần điều kiện từng món). */
  steps?: readonly string[];
  /** Cách giao đang mở cho khách (tên + một dòng); rỗng thì không có mục Cách giao. */
  methods?: readonly { label: string; line: string }[];
  /** Điều kiện nhận từng món (`itemRuleNotes`): chữ đã rời khỏi thẻ món để thẻ chỉ còn tên, tỉ lệ và bộ đếm. */
  items?: readonly { name: string; notes: readonly string[] }[];
  onFullRules: () => void;
}

/** Sheet "Thể lệ" của màn Đổi rác: các bước đầy đủ, cách giao đang mở, điều kiện từng món, lối sang trang Thể lệ chương trình. */
export function WasteRulesSheet({ open, onClose, steps = [], methods = [], items = [], onFullRules }: WasteRulesSheetProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={wasteRulesSheetCopy.title}
      footer={
        <Button
          variant="secondary"
          fullWidth
          onPress={() => {
            onClose();
            onFullRules();
          }}
        >
          {wasteGuestCopy.rulesLink}
        </Button>
      }
    >
      <div className="tubu-waste-rules" data-testid="waste-rules">
        {steps.length > 0 && (
          <section className="tubu-waste-rules-section">
            <Heading variant="title-sm" as="h3">
              {wasteRulesSheetCopy.stepsTitle}
            </Heading>
            <ol className="tubu-waste-rules-steps">
              {steps.map((t) => (
                <li key={t}>
                  <Text variant="body-sm" as="span">
                    {t}
                  </Text>
                </li>
              ))}
            </ol>
          </section>
        )}
        {methods.length > 0 && (
          <section className="tubu-waste-rules-section">
            <Heading variant="title-sm" as="h3">
              {wasteRulesSheetCopy.methodsTitle}
            </Heading>
            <ul className="tubu-waste-rules-methods">
              {methods.map((m) => (
                <li key={m.label}>
                  <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
                    {m.label}
                  </Text>
                  <Text variant="caption" tone="secondary" as="div">
                    {m.line}
                  </Text>
                </li>
              ))}
            </ul>
          </section>
        )}
        {items.length > 0 && (
          <section className="tubu-waste-rules-section" data-testid="waste-rules-items">
            <Heading variant="title-sm" as="h3">
              {wasteRulesSheetCopy.itemsTitle}
            </Heading>
            <ul className="tubu-waste-rules-methods">
              {items.map((it) => (
                <li key={it.name}>
                  <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
                    {it.name}
                  </Text>
                  {it.notes.map((n) => (
                    <Text key={n} variant="caption" tone="secondary" as="div">
                      {n}
                    </Text>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </BottomSheet>
  );
}
