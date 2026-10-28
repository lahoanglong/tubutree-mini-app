import { avatarInitial } from '@tubutree/app-core/initials-avatar';

/** Ảnh đại diện của chính khách: có ảnh thì hiện ảnh, chưa có thì chữ cái đầu của tên trên nền xanh (giống Mini App). */
export function ProfileAvatar({ name, src, size, className = '' }: { name?: string | null; src?: string | null; size: number; className?: string }) {
  const box = { width: size, height: size };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- URL Cloudinary, domain không cố định
    return <img src={src} alt="" style={box} className={`flex-none rounded-full bg-forest-100 object-cover ${className}`} />;
  }
  return (
    <span
      data-testid="profile-avatar-initial"
      aria-hidden="true"
      style={{ ...box, fontSize: Math.round(size * 0.44) }}
      className={`flex flex-none select-none items-center justify-center rounded-full bg-forest-100 font-ui font-bold leading-none text-forest-800 ${className}`}
    >
      {avatarInitial(name)}
    </span>
  );
}
