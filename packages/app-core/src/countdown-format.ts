/**
 * Chữ đếm ngược cho `ms` còn lại, làm tròn LÊN theo phút (phút cuối không hiện "0h 00m" khi chưa hết giờ). Hết giờ → ''.
 * Dưới 24 giờ: "Xh YYm". Từ 24 giờ: "N ngày H giờ" (bỏ "H giờ" khi tròn ngày), vì "143h 52m" khó đọc.
 */
export function formatCountdown(ms: number): string {
  if (!(ms > 0)) return '';
  const totalMin = Math.ceil(ms / 60_000);
  if (totalMin >= 24 * 60) {
    const days = Math.floor(totalMin / (24 * 60));
    const hours = Math.floor((totalMin % (24 * 60)) / 60);
    return hours > 0 ? `${days} ngày ${hours} giờ` : `${days} ngày`;
  }
  return `${Math.floor(totalMin / 60)}h ${(totalMin % 60).toString().padStart(2, '0')}m`;
}
