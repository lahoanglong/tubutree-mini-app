/**
 * Nhịp chơi người mới của Vườn Xanh: luật chọn nút chính, thẻ 3 bước và chữ dùng chung. Mini App (qua `vi.game.newbie`)
 * và web cùng đọc file này nên chữ và luật không lệch nhau.
 */

/** Lượng nước của một lần tưới lô phụ; nút chính "Tưới hết" gửi toàn bộ số giọt đang có. */
export const WATER_STEP = 20;

/**
 * Thưởng ngày N3, N6, N9... của chuỗi điểm danh: API ghi cứng 5 giọt (game-economy.service.ts), không có trong
 * `GET /game/profile`. Đổi ở API thì đổi ở đây.
 */
export const STREAK_3_SEEDS = 5;

export interface PrimaryWaterInput {
  totalSeeds: number;
  checkedInToday: boolean;
  dewToday: boolean;
  dailyLoginSeeds?: number;
  dewSeeds?: number;
  firstCheckinBonus?: number;
  /** Sức chứa bình: biết thì "+N💧" của nút nhận nước bị cắt theo chỗ trống (cùng luật với server), bình đầy thì bỏ "+N". */
  tankCapacity?: number;
}

export type PrimaryWaterAction =
  /** Chưa nhận nước hôm nay. `first`: lần điểm danh đầu (chỉ điểm danh, sương để bước 3). `withDew`: gộp luôn hứng sương. */
  | { kind: 'claim'; first: boolean; withDew: boolean; gain: number | null }
  | { kind: 'water'; drops: number }
  | { kind: 'earn' };

/** Nút chính trên cây: nhận nước hôm nay, tưới hết, hoặc mở sheet "Kiếm nước". Không bao giờ dẫn tới lỗi thiếu nước. */
export function primaryWaterAction(p: PrimaryWaterInput): PrimaryWaterAction {
  const seeds = Math.max(0, Math.floor(Number.isFinite(p.totalSeeds) ? p.totalSeeds : 0));
  if (!p.checkedInToday) {
    const bonus = p.firstCheckinBonus ?? 0;
    const first = bonus > 0;
    const withDew = !first && !p.dewToday;
    const raw =
      p.dailyLoginSeeds == null || (withDew && p.dewSeeds == null)
        ? null
        : p.dailyLoginSeeds + (first ? bonus : 0) + (withDew ? (p.dewSeeds ?? 0) : 0);
    const room = p.tankCapacity == null ? null : Math.max(0, p.tankCapacity - seeds);
    const gain = raw == null || room == null ? raw : room === 0 ? null : Math.min(raw, room);
    return { kind: 'claim', first, withDew, gain };
  }
  if (seeds >= WATER_STEP) return { kind: 'water', drops: seeds };
  return { kind: 'earn' };
}

/** Số giọt còn thiếu so với `cost`; 0 khi đủ. */
export function missingDrops(have: number, cost: number): number {
  return Math.max(0, Math.ceil(cost - (Number.isFinite(have) ? have : 0)));
}

export interface TutorialInput {
  lastCheckInAt: string | null | undefined;
  treesPlanted: number | null | undefined;
  dismissed: boolean;
}

export interface TutorialState {
  visible: boolean;
  /** Bước đang làm (1..3); 3 giữ tới khi khách bấm "Đã hiểu". */
  current: 1 | 2 | 3;
  done: [boolean, boolean, boolean];
}

/** Thẻ 3 bước dựng từ dữ liệu sẵn có: bước 1 xong khi đã điểm danh, bước 2 khi đã thu hoạch, bước 3 khi khách bấm "Đã hiểu". */
export function tutorialState(t: TutorialInput): TutorialState {
  const done: [boolean, boolean, boolean] = [t.lastCheckInAt != null, (t.treesPlanted ?? 0) >= 1, t.dismissed];
  const current = (done[0] ? (done[1] ? 3 : 2) : 1) as 1 | 2 | 3;
  return { visible: !t.dismissed, current, done };
}

/** Lô phụ chỉ hiện từ khi thu hoạch cây thứ 2, hoặc khi khách đã có lô phụ. */
export function extraPlotsVisible(treesPlanted: number | null | undefined, hasExtraPlot: boolean): boolean {
  return hasExtraPlot || (treesPlanted ?? 0) >= 2;
}

export const TUTORIAL_DISMISSED_KEY = 'tubu_game_tutorial_done';

const n = (v: number | null | undefined) => {
  const x = Number(v ?? 0);
  return ((Number.isFinite(x) ? x : 0) + 0).toLocaleString('vi-VN');
};
const drops = (v: number) => `${n(v)}💧`;

export const gameNewbieCopy = {
  loginToView: 'Đăng nhập để trồng cây, nhận nước và quà',
  treeWilted: 'Cây đang héo, tưới để cây xanh lại.',
  primary: {
    claim: (gain: number | null) => (gain == null ? 'Nhận nước hôm nay' : `Nhận nước hôm nay (+${drops(gain)})`),
    claimFirst: (gain: number | null) => (gain == null ? 'Điểm danh nhận nước' : `Điểm danh nhận ${drops(gain)}`),
    water: (d: number) => `Tưới hết (${drops(d)})`,
    earn: 'Kiếm thêm nước',
  },
  short: (missing: number) => `Còn thiếu ${drops(missing)}`,
  earn: {
    title: 'Kiếm nước',
    have: (have: number) => `Bạn đang có ${drops(have)}`,
    need: (missing: number) => `Bạn cần thêm ${drops(missing)} nữa.`,
    checkin: 'Điểm danh hôm nay',
    checkinCta: 'Điểm danh',
    dew: 'Hứng giọt sương',
    dewCta: 'Hứng sương',
    gain: (v: number) => `+${drops(v)}`,
    quiz: (left: number) => `Làm câu đố (còn ${left} câu)`,
    quizCta: 'Làm câu đố',
    quizHint: 'Trả lời đúng nhận thêm nước',
    friends: 'Nước từ bạn bè',
    friendsHint: 'Bạn bè có thể tặng nước cho bạn ở tab Cộng đồng.',
    friendsCta: 'Xem',
    allDone: 'Bạn đã làm hết việc kiếm nước hôm nay.',
    tomorrow: 'Điểm danh và hứng sương mở lại sau 0 giờ ngày mai.',
    loading: 'Đang tải việc kiếm nước...',
    error: 'Chưa tải được việc kiếm nước.',
    retry: 'Thử lại',
    close: 'Đóng',
  },
  tutorial: {
    title: 'Phiên đầu tiên của bạn',
    stepOf: (i: number) => `Bước ${i}/3`,
    steps: [
      { title: 'Nhận nước đầu tiên', hint: 'Bấm nút xanh bên dưới để điểm danh.' },
      { title: 'Tưới cây mầm', hint: 'Tưới hết nước để cây mầm lớn và thu hoạch ngay.' },
      { title: 'Kiếm nước cho cây tiếp theo', hint: 'Làm câu đố và hứng sương mỗi ngày.' },
    ],
    tomorrow: (v: number | null) => (v == null ? 'Ngày mai: điểm danh và hứng sương nhận thêm nước.' : `Ngày mai: điểm danh + sương = ${drops(v)}`),
    quizTotal: (v: number) => `Câu đố đúng hết thêm khoảng ${drops(v)}.`,
    gotIt: 'Đã hiểu',
  },
  checkin: {
    sub: (daily: number | null, first: number) =>
      daily == null
        ? 'Nhận giọt nước và Điểm Xanh mỗi ngày'
        : first > 0
          ? `Lần đầu nhận +${drops(daily + first)}, các ngày sau +${drops(daily)}, kèm Điểm Xanh`
          : `Nhận +${drops(daily)} và Điểm Xanh mỗi ngày`,
    dew: (v: number | null) => (v == null ? 'Hứng giọt sương' : `Hứng giọt sương (+${drops(v)})`),
    dayReward: (v: number) => `+${n(v)}`,
  },
  fund: {
    have: (have: number, cost: number) => `Bạn có ${n(have)} / ${n(cost)} Điểm Xanh`,
    howToEarn: 'Cách kiếm Điểm Xanh',
  },
  wheel: {
    have: (have: number, cost: number) => `Bạn có ${n(have)} / ${n(cost)} Điểm Xanh cho 1 lượt quay`,
    howToEarn: 'Cách kiếm Điểm Xanh',
  },
  community: {
    feedTitle: 'Bảng tin cộng đồng',
    feedHintReadOnly: 'Xem mẹo sống xanh từ mọi người',
  },
  missions: {
    doNow: 'Làm ngay',
    doNowFor: (title: string) => `Làm ngay: ${title}`,
    progressLabel: (title: string, progress: number, goal: number) => `${title}: ${progress}/${goal}`,
  },
  plots: {
    locked: 'Thu hoạch cây thứ 2 để mở thêm lô đất.',
  },
  harvest: {
    seedling: 'Cây mầm đầu tiên của bạn đã lớn! 🌱',
    grown: 'Cây ảo của bạn đã lớn 🌿',
    fund: 'Cây ảo của bạn đã lớn. Tubu sẽ góp 1 cây vào quỹ trồng cây 🌿',
    points: (v: number) => `+${n(v)} Điểm Xanh`,
    pointsCaption: 'Quà cây mầm, dùng khi mua hàng',
    guest: 'Đăng nhập Zalo để nhận quà khi thu hoạch.',
    guestCta: 'Đăng nhập Zalo',
    nextTree: (target: number) => `Cây tiếp theo cần ${drops(target)}`,
    shareCommunity: 'Chia sẻ lên Cộng đồng',
    shareCommunityBusy: 'Đang chia sẻ...',
    shareCommunityDone: 'Đã chia sẻ',
    shareCommunityOk: 'Đã chia sẻ lên Cộng đồng 🌳',
    shareCommunityAlready: 'Bạn đã chia sẻ cây này rồi',
    shareCommunityNote: 'Bài sẽ hiện tên của bạn trên Cộng đồng',
    shareFriends: 'Chia sẻ với bạn bè',
    shareTitle: 'Tôi vừa thu hoạch một cây ở Vườn Xanh 🌳',
    shareDescription: 'Vào Vườn Xanh của Tubu Tree trồng cây cùng tôi nhé!',
    capped: {
      DAY: 'Hôm nay bạn đã nhận mã giảm giá. Cây vẫn được tính, mai thu hoạch tiếp bạn sẽ có mã.',
      MONTH: 'Tháng này bạn đã nhận đủ mã giảm giá. Cây vẫn được tính, sang tháng bạn nhận mã tiếp nhé.',
    },
  },
} as const;

/** Đích của nút "Làm ngay" trên thẻ nhiệm vụ; mỗi app tự đổi sang đường dẫn của mình. */
export type MissionTarget = 'catalog' | 'delivered-orders' | 'invite' | 'checkin';

const MISSION_TARGETS: Record<string, MissionTarget> = {
  FIRST_ORDER: 'catalog',
  REVIEW_3: 'delivered-orders',
  INVITE_3: 'invite',
  CHECKIN_7: 'checkin',
};

/** Đích của nhiệm vụ theo `code`; mã lạ trả null để không hiện nút. */
export function missionTarget(code: string): MissionTarget | null {
  return Object.prototype.hasOwnProperty.call(MISSION_TARGETS, code) ? MISSION_TARGETS[code]! : null;
}

/** Mã khối điểm danh trong trang game, đích cuộn của nhiệm vụ "Chăm chỉ 7 ngày". */
export const GAME_CHECKIN_ANCHOR = 'game-checkin';
