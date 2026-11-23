import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

type Status = 'error' | 'success' | '';

interface FieldBits {
  /** Nhãn hiện trên ô, gắn bằng `<label htmlFor>` (trình đọc màn hình đọc được, chạm nhãn là vào ô). */
  label?: ReactNode;
  /** `error`: viền màu lỗi và `aria-invalid` (trừ khi bên gọi tự đặt `aria-invalid`). */
  status?: Status;
}

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> &
  FieldBits & {
    /** Lớp thêm cho chính `<input>` (vd `tubu-nums` cho số điện thoại). */
    inputClassName?: string;
  };
export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldBits;

function cls(base: string, status: Status | undefined, extra?: string) {
  return [base, status === 'error' && 'tubu-input--error', extra].filter(Boolean).join(' ');
}

function Labelled({ id, label, children }: { id: string; label: ReactNode; children: ReactNode }) {
  return (
    <div className="tubu-input-group">
      <label htmlFor={id} className="tubu-input-label">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Ô nhập chữ DS (thay `zmp-ui` Input: bỏ ~16 KB JS và luật CSS của nó). Một `<input>` thật tự vẽ viền: cao 48px (vùng chạm ≥ 44),
 * viền `--color-border-strong`, focus đổi viền sang `--color-border-focus` (không thêm vòng: luật focus chung loại trừ `input`), lỗi viền
 * `--color-status-danger-fg`. `ref` trỏ thẳng vào `<input>`. Kiểu ở `tokens.css` (`.tubu-input`).
 */
const InputBase = forwardRef<HTMLInputElement, InputProps>(function Input({ label, status, inputClassName, className, id, type = 'text', ...rest }, ref) {
  const autoId = useId();
  const inputId = id ?? (label ? autoId : undefined);
  const field = (
    <input
      ref={ref}
      id={inputId}
      type={type}
      {...rest}
      aria-invalid={rest['aria-invalid'] ?? (status === 'error' || undefined)}
      className={cls('tubu-input', status, [inputClassName, className].filter(Boolean).join(' '))}
    />
  );
  return label ? <Labelled id={inputId as string} label={label}>{field}</Labelled> : field;
});

/** Ô nhập nhiều dòng: cùng viền với `Input`, đệm 12px, cao tối thiểu 120px, không kéo giãn tay. */
const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({ label, status, className, id, ...rest }, ref) {
  const autoId = useId();
  const inputId = id ?? (label ? autoId : undefined);
  const field = (
    <textarea
      ref={ref}
      id={inputId}
      {...rest}
      aria-invalid={rest['aria-invalid'] ?? (status === 'error' || undefined)}
      className={cls('tubu-input tubu-input--area', status, className)}
    />
  );
  return label ? <Labelled id={inputId as string} label={label}>{field}</Labelled> : field;
});

export const Input = Object.assign(InputBase, { TextArea });
