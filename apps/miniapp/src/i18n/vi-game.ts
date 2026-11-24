/** Chữ của Vườn Tubu: nhiệm vụ, chặng mùa và nối chuỗi. Tách khỏi `vi.ts` vì chỉ màn tải lười dùng: `vi.ts` nằm trong gói đầu của Mini App. Quy tắc chữ như `vi.ts`. */
import { formatDrops, formatNumber, formatPoints } from '../utils/format';

export const viGame = {
  streakRepair: {
    title: (n: number) => `Bạn vừa mất chuỗi ${formatNumber(n)} ngày`,
    body: 'Hồi sinh ngay để giữ lại thành tích trước khi hết hạn.',
    cta: (cost: number) => `Hồi sinh (${formatDrops(cost)})`,
    ok: 'Đã hồi sinh chuỗi! 🌿',
  },
  seasonPass: {
    title: 'Chặng Mùa',
    subtitle: (title: string) => `Điểm danh mỗi ngày để lên bậc mùa "${title}"`,
    xp: (n: number) => `${formatNumber(n)} điểm kinh nghiệm`,
    tier: (n: number) => `Bậc ${n}`,
    free: 'Miễn phí',
    premium: 'Cao cấp',
    claim: 'Nhận',
    claimed: 'Đã nhận',
    locked: 'Chưa mở',
    premiumHint: 'Cần có gói định kỳ đã giao ít nhất một đơn để mở phần thưởng Cao cấp.',
    reward: (r: { type: 'SEEDS' | 'POINTS'; amount: number }) =>
      r.type === 'SEEDS' ? formatDrops(r.amount) : formatPoints(r.amount),
    claimOk: 'Đã nhận thưởng chặng mùa! 🎉',
  },
  missions: {
    claim: 'Nhận thưởng',
    claimOk: (points: number) => `Đã nhận +${formatNumber(points)} Điểm Xanh! 🌿`,
  },
} as const;
