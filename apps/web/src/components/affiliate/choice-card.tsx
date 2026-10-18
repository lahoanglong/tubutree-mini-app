export interface ChoiceCardProps {
  active: boolean;
  title: string;
  sub: string;
  onPress: () => void;
  /** Phương án không dùng được: mờ, bấm không đổi gì; lý do nằm ở phần tử `describedBy` (chữ không mờ để đọc được). */
  disabled?: boolean;
  describedBy?: string;
}

/** Thẻ chọn một trong vài phương án (rút tiền về đâu, thu tiền kiểu nào): nút thật có `aria-pressed`, vùng chạm cao >= 44px. */
export function ChoiceCard({ active, title, sub, onPress, disabled = false, describedBy }: ChoiceCardProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy}
      onClick={disabled ? undefined : onPress}
      className={`min-h-11 flex-1 rounded-control border-[1.5px] p-3 text-left ${
        active ? 'border-forest-600 bg-forest-50' : 'border-stone-200 bg-stone-0'
      } ${disabled ? 'cursor-default' : 'cursor-pointer active:scale-95'}`}
    >
      <div className={`text-sm font-semibold ${disabled ? 'text-stone-500' : active ? 'text-forest-700' : 'text-stone-900'}`}>{title}</div>
      <div className={`text-xs ${disabled ? 'text-stone-500' : 'text-stone-600'}`}>{sub}</div>
    </button>
  );
}
