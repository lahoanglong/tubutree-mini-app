import type { CSSProperties, ReactNode } from 'react';
import { Text } from './text';

export interface KeyValueRowProps {
  label: ReactNode;
  value: ReactNode;
  emphasis?: boolean;
  tone?: 'primary' | 'danger' | 'success';
  className?: string;
  style?: CSSProperties;
  /** Móc cho số đo ds-parity (apps/e2e/tests/support/ds-parity.ts). */
  dataDs?: string;
}

/** Dòng nhãn-giá trị — thay `Row` định nghĩa lặp lại cho tổng tiền/phí ship/giảm giá trong các
 * trang tóm tắt đơn hàng (audit A4-19). `emphasis` phóng cỡ chữ + đậm hơn cho dòng "Tổng cộng". */
export function KeyValueRow({ label, value, emphasis, tone = 'primary', className, style, dataDs }: KeyValueRowProps) {
  return (
    <div className={className} data-ds={dataDs} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', ...style }}>
      <Text variant="body-sm" tone="secondary">
        {label}
      </Text>
      <Text
        variant="body-sm"
        tone={tone}
        style={{ fontWeight: emphasis ? 700 : 600, fontSize: emphasis ? 'var(--type-title-sm-size)' : undefined, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Text>
    </div>
  );
}
