/** Link là file video trực tiếp (mp4/webm/m4v) qua https, phát được bằng thẻ <video> ngay trong app. */
export function isDirectVideoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /\.(mp4|webm|m4v)$/i.test(u.pathname);
  } catch {
    return false;
  }
}
