export interface ArcadeTip { text: string; chip?: { label: string; to: { miniapp: string; web: string } } }
export interface ArcadeTipStats { dodgedHazards?: number; correct?: number }

const SEARCH = encodeURIComponent('bồ hòn');
const ECO = [
  'Súc sạch vỏ chai trước khi phân loại để cả mẻ nhựa còn tái chế được.',
  'Tách nắp và vỏ chai khác loại nhựa giúp nhà máy tái chế phân loại dễ hơn.',
  'Bã bồ hòn, vỏ cam chanh và lá khô là rác hữu cơ, ủ lại thành phân cho cây.',
  'Dùng lại chai thuỷ tinh: mỗi lần châm đầy là bớt một vỏ nhựa dùng một lần.',
  'Phơi quần áo ngoài nắng thay cho sấy máy giúp tiết kiệm điện.',
  'Tắt vòi nước khi xả bọt rửa chén để bớt lãng phí nước.',
  'Mang theo túi vải khi đi chợ để bớt túi ni lông dùng một lần.',
];

const RECYCLE = { label: 'Mang vỏ chai đi Đổi rác', to: { miniapp: '/recycle', web: '/doi-rac' } };

// Chỉ hai câu có tên sản phẩm (hai claim đã duyệt); còn lại là kiến thức sống xanh. Refill Rush luôn kèm chip tới Đổi rác.
export function endTip(gameId: 'dew_catcher' | 'refill_rush', stats: ArcadeTipStats, rng: () => number = Math.random): ArcadeTip {
  const n = stats.dodgedHazards ?? 0;
  if (gameId === 'dew_catcher' && n >= 3) {
    return {
      text: `Bạn vừa né ${n} giọt hoá chất! Nước rửa chén Bồ Hòn TubuTree cũng 0% Paraben & SLS, dịu êm cho da tay mẹ.`,
      chip: { label: 'Xem Nước rửa chén Bồ Hòn', to: { miniapp: `/browse?q=${SEARCH}`, web: `/san-pham?q=${SEARCH}` } },
    };
  }
  const chip = gameId === 'refill_rush' ? RECYCLE : undefined;
  if (chip && (stats.correct ?? 0) >= 5) return { text: 'Mỗi vỏ chai TubuTree giữ lại đều đổi được Điểm Xanh & Quà tặng!', chip };
  return { text: ECO[Math.min(ECO.length - 1, Math.floor(rng() * ECO.length))]!, chip };
}
