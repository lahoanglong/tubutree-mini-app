import { avatarInitial, avatarTone } from '@tubutree/app-core/initials-avatar';

/** Vòng tròn chữ cái đầu của tên đang hiển thị, thay ảnh Zalo của người khác trên màn công khai. Tên hiển thị đã nằm cạnh nên ẩn khỏi trình đọc màn hình. */
export function InitialsAvatar({ name, size = 32 }: { name: string; size?: number }) {
  const tone = avatarTone(name);
  return (
    <div
      data-testid="initials-avatar"
      aria-hidden
      style={{
        width: size,
        height: size,
        flex: '0 0 auto',
        borderRadius: '50%',
        background: tone.background,
        color: tone.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: Math.round(size * 0.44),
        lineHeight: 1,
        fontFamily: 'var(--font-ui)',
        userSelect: 'none',
      }}
    >
      {avatarInitial(name)}
    </div>
  );
}
