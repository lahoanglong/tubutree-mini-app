import { fillTemplate } from '../copy-template';

/**
 * Chữ trong bàn chơi của hai game thao tác (Ghép Mầm Xanh, Băng Chuyền Xanh) và dòng kết quả riêng của chúng. Tách khỏi `GAME_MINI_COPY` để
 * thẻ "Chơi hôm nay" không mang chữ của bàn chơi. Cùng luật chữ: `arcade.spec.ts` chạy `FORBIDDEN_TERMS` và ngân sách độ dài từng khoá.
 */
export const ARCADE_MINI_COPY = {
  'merge.tier.1': 'Hạt giống',
  'merge.tier.2': 'Mầm non',
  'merge.tier.3': 'Chồi lá',
  'merge.tier.4': 'Cây con',
  'merge.tier.5': 'Hoa xanh',
  'merge.tier.6': 'Quả lành',
  'merge.tier.7': 'Cổ thụ',
  'merge.tier.8': 'Rừng Tubu',
  'merge.score': 'Điểm',
  'merge.best': 'Kỷ lục',
  'merge.hint': 'Vuốt để ghép hai ô cùng loại',
  'merge.gridAria': 'Bàn ghép 4 nhân 4. Vuốt hoặc bấm phím mũi tên để dồn các ô.',
  'merge.tileAria': '{tier}, ô {n}',
  'merge.combo': 'Ghép {n} cặp!',
  'merge.win': 'Rừng Tubu!',
  'merge.over': 'Hết nước đi',
  'merge.reached': 'Vừa lên {tier}',
  'conveyor.bin.recycle': 'Tái chế',
  'conveyor.bin.organic': 'Hữu cơ',
  'conveyor.bin.refill': 'Refill',
  'conveyor.binAria': 'Bỏ {item} vào thùng {bin}',
  'conveyor.binsAria': 'Ba thùng phân loại',
  'conveyor.beltAria': 'Băng chuyền. Vuốt trái, xuống, phải hoặc chạm một thùng.',
  'conveyor.front': 'Món đầu băng: {item}',
  'conveyor.frontGolden': 'Món đầu băng: {item}, món vàng',
  'conveyor.empty': 'Món tiếp theo sắp tới',
  'conveyor.hint': 'Vuốt trái, xuống, phải hoặc chạm thùng',
  'conveyor.score': 'Điểm',
  'conveyor.combo': 'x{n}',
  'conveyor.comboAria': 'Nhân điểm x{n}, chuỗi {c} món đúng',
  'conveyor.golden': '+{n}',
  'conveyor.right': 'Đúng',
  'conveyor.wrong': 'Sai thùng',
  'conveyor.miss': 'Trôi mất',
  'sound.off': 'Tắt âm thanh',
  'sound.on': 'Bật âm thanh',
  'result.mergeLine': '{score} điểm · {moves} nước ghép',
  'result.conveyorLine': '{score} điểm · Chuỗi {combo} · {golden} món vàng',
  'result.best': 'Kỷ lục mới!',
  'result.bestWas': 'Kỷ lục của bạn: {n} điểm',
} as const;

export type ArcadeMiniCopyKey = keyof typeof ARCADE_MINI_COPY;

/** Số ký tự tối đa (sau khi điền biến thường gặp): tên bậc vừa ô 72px ở 360px, nhãn thùng vừa một dòng. */
export const ARCADE_MINI_COPY_MAX: Partial<Record<ArcadeMiniCopyKey, number>> = {
  'merge.tier.1': 10,
  'merge.tier.2': 10,
  'merge.tier.3': 10,
  'merge.tier.4': 10,
  'merge.tier.5': 10,
  'merge.tier.6': 10,
  'merge.tier.7': 10,
  'merge.tier.8': 10,
  'merge.score': 8,
  'merge.best': 8,
  'merge.hint': 36,
  'merge.combo': 16,
  'merge.win': 14,
  'merge.over': 14,
  'conveyor.bin.recycle': 8,
  'conveyor.bin.organic': 8,
  'conveyor.bin.refill': 8,
  'conveyor.hint': 40,
  'conveyor.right': 10,
  'conveyor.wrong': 10,
  'conveyor.miss': 10,
  'result.mergeLine': 36,
  'result.conveyorLine': 44,
  'result.best': 16,
};

export function arcadeCopy(key: ArcadeMiniCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(ARCADE_MINI_COPY[key], vars, key);
}
