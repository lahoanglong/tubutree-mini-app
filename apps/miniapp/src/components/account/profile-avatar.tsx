import { Avatar } from 'zmp-ui';
import { avatarInitial } from '@tubutree/app-core/initials-avatar';

/** Ảnh đại diện của chính khách: có ảnh thì hiện ảnh, chưa có thì chữ cái đầu của tên trên nền xanh (giống web). */
export function ProfileAvatar({ name, src, size, style }: { name?: string | null; src?: string | null; size: number; style?: React.CSSProperties }) {
  if (src) return <Avatar size={size} src={src} style={style} />;
  return (
    <div
      data-testid="profile-avatar-initial"
      aria-hidden
      style={{
        width: size,
        height: size,
        flex: '0 0 auto',
        borderRadius: '50%',
        background: 'var(--forest-100)',
        color: 'var(--forest-800)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: Math.round(size * 0.44),
        lineHeight: 1,
        fontFamily: 'var(--font-ui)',
        userSelect: 'none',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {avatarInitial(name)}
    </div>
  );
}
