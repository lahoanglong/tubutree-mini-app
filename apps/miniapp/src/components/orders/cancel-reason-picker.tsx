import { CANCEL_REASONS, CANCEL_REASON_TEXT_MAX, type CancelReasonCode } from '@tubutree/app-core/cancel-reasons';
import { Text } from '../ui/text';
import { Chip } from '../ui/chip';

export const CANCEL_REASON_REQUIRED = 'Bạn chọn lý do huỷ giúp Tubu nhé';

interface Props {
  code: CancelReasonCode | null;
  onCode: (c: CancelReasonCode) => void;
  text: string;
  onText: (t: string) => void;
  showError: boolean;
}

/** Lý do huỷ đơn chọn sẵn (như Shopee) + ô viết thêm khi chọn "Lý do khác". Cửa hàng dựa vào đây để biết vì sao khách bỏ đơn. */
export function CancelReasonPicker({ code, onCode, text, onText, showError }: Props) {
  return (
    <section aria-label="Lý do huỷ đơn">
      <Text variant="body-sm" as="div" style={{ fontWeight: 600, marginBottom: 6 }}>
        Lý do huỷ đơn
      </Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '4px 0' }}>
        {CANCEL_REASONS.map((r) => (
          <Chip key={r.code} size="sm" variant="choice" selected={code === r.code} onPress={() => onCode(r.code)}>
            {r.label}
          </Chip>
        ))}
      </div>
      {code === 'OTHER' && (
        <textarea
          aria-label="Mô tả lý do huỷ"
          value={text}
          onChange={(e) => onText(e.target.value)}
          maxLength={CANCEL_REASON_TEXT_MAX}
          placeholder="Bạn cho Tubu biết thêm nhé (không bắt buộc)…"
          rows={2}
          style={{
            width: '100%',
            marginTop: 8,
            padding: 10,
            borderRadius: 'var(--radius-control)',
            border: '1px solid var(--color-border-subtle)',
            fontSize: 14,
            fontFamily: 'inherit',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
      )}
      {showError && !code && (
        <div role="alert" style={{ marginTop: 6 }}>
          <Text variant="caption" tone="danger">
            {CANCEL_REASON_REQUIRED}
          </Text>
        </div>
      )}
    </section>
  );
}
