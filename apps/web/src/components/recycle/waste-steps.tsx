'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Leaf, ListChecks, Package } from 'lucide-react';
import { wasteGuestCopy, wasteRulesSheetCopy, wasteStepStrip, type WasteStepKind } from '@tubutree/app-core/waste-copy';
import { Sheet } from '@/components/ui/sheet';
import { miniBtnSecondary } from '@/components/loyalty/mini-surface';

const STEP_ICON: Record<WasteStepKind, LucideIcon> = { pick: ListChecks, deliver: Package, points: Leaf };

/** Dải 3 bước có biểu tượng của màn Đổi rác (bản web của Mini `WasteStepStrip`, cùng lớp CSS ở waste-steps.css). */
export function WasteStepStrip({ flags }: { flags: { dropoff: boolean; mailin: boolean } }) {
  return (
    <ol className="tubu-waste-steps" aria-label={wasteRulesSheetCopy.stripLabel} data-testid="waste-step-strip">
      {wasteStepStrip(flags).map((s, i) => {
        const StepIcon = STEP_ICON[s.kind];
        return (
          <li key={s.kind} className="tubu-waste-step" data-step={s.kind}>
            <span className="tubu-waste-step-icon text-forest-700" aria-hidden="true">
              <StepIcon className="h-5 w-5" />
              <span className="tubu-waste-step-num">{i + 1}</span>
            </span>
            <span>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export interface WasteRulesSheetProps {
  open: boolean;
  onClose: () => void;
  steps: readonly string[];
  /** Cách giao đang mở cho khách (tên + một dòng); rỗng thì không có mục Cách giao. */
  methods?: readonly { label: string; line: string }[];
  rulesHref: string;
}

/** Sheet "Thể lệ" của màn Đổi rác (bản web của Mini `WasteRulesSheet`): các bước đầy đủ, cách giao đang mở, lối sang trang Thể lệ. */
export function WasteRulesSheet({ open, onClose, steps, methods = [], rulesHref }: WasteRulesSheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={wasteRulesSheetCopy.title}
      footer={
        <Link href={rulesHref} onClick={onClose} className={`${miniBtnSecondary} w-full`}>
          {wasteGuestCopy.rulesLink}
        </Link>
      }
    >
      <div className="tubu-waste-rules" data-testid="waste-rules">
        <section className="tubu-waste-rules-section">
          <h3 className="text-base font-semibold text-stone-900">{wasteRulesSheetCopy.stepsTitle}</h3>
          <ol className="tubu-waste-rules-steps text-sm text-stone-900">
            {steps.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </section>
        {methods.length > 0 && (
          <section className="tubu-waste-rules-section">
            <h3 className="text-base font-semibold text-stone-900">{wasteRulesSheetCopy.methodsTitle}</h3>
            <ul className="tubu-waste-rules-methods">
              {methods.map((m) => (
                <li key={m.label}>
                  <p className="text-sm font-semibold text-stone-900">{m.label}</p>
                  <p className="text-xs text-stone-600">{m.line}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  );
}
