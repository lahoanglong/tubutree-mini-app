import type { ComponentProps, ReactNode } from 'react';
import { Checkbox as ZCheckbox, Radio as ZRadio, Switch as ZSwitch } from 'zmp-ui';
import { Text } from './text';

export interface FieldProps {
  label: string;
  error?: string;
  children: ReactNode;
}

/** Khung nhãn + nội dung + lỗi cho một control (Input/Checkbox/...), dùng chung 1 kiểu hiển thị
 * lỗi thay vì mỗi form tự vẽ lại (audit DS v2 — chuẩn hoá form control). */
export function Field({ label, error, children }: FieldProps) {
  return (
    <div>
      <Text variant="caption" tone="secondary" as="div" style={{ marginBottom: 4 }}>
        {label}
      </Text>
      {children}
      {error && (
        // "⚠ " is kept as its own element (not concatenated into the same text node as `error`)
        // so testing-library's getNodeText — which only reads an element's own direct text-node
        // children — still matches on the raw error string alone.
        <Text variant="caption" tone="danger" as="div" style={{ marginTop: 2 }}>
          <span aria-hidden="true">⚠ </span>
          {error}
        </Text>
      )}
    </div>
  );
}

function hitArea(testId: string, children: ReactNode) {
  return (
    <div data-testid={testId} style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}>
      {children}
    </div>
  );
}

// ZaUI's own CheckboxProps declares `value: string | number` as REQUIRED (it's only actually
// needed inside a <Checkbox.Group>) — forwarding React.ComponentProps<typeof ZCheckbox> as-is
// would force every standalone caller to pass a meaningless `value`. Make it optional here and
// default it, since a standalone Checkbox never reads it.
export type CheckboxProps = Omit<ComponentProps<typeof ZCheckbox>, 'value'> & { value?: string | number };

/** Checkbox đã theme sẵn qua ZaUI bridge (Task 4) — wrapper này CHỈ thêm vùng chạm tối thiểu
 * 44px, không tự vẽ lại hành vi check/uncheck (audit DS v2 44px touch target). */
export function Checkbox({ value = '', ...rest }: CheckboxProps) {
  return hitArea('checkbox-hit-area', <ZCheckbox value={value} {...rest} />);
}

export type RadioProps = ComponentProps<typeof ZRadio>;

/** Radio đã theme sẵn qua ZaUI bridge (Task 4) — wrapper này CHỈ thêm vùng chạm tối thiểu 44px. */
export function Radio(props: RadioProps) {
  return hitArea('radio-hit-area', <ZRadio {...props} />);
}

export type SwitchProps = ComponentProps<typeof ZSwitch>;

/** Switch đã theme sẵn qua ZaUI bridge (Task 4) — wrapper này CHỈ thêm vùng chạm tối thiểu 44px. */
export function Switch(props: SwitchProps) {
  return hitArea('switch-hit-area', <ZSwitch {...props} />);
}
