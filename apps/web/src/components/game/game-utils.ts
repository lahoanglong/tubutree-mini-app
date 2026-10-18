import type { HarvestSpecies } from '@tubutree/app-core/api/game';

// Cùng ngày theo giờ VN (UTC+7) — khớp dayKey backend, để khoá nút đã dùng trong ngày.
export function isSameVNDay(iso: string | null): boolean {
  if (!iso) return false;
  const key = (d: Date) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  return key(new Date(iso)) === key(new Date());
}

// Emoji ở đây là nội dung phân loại của câu hỏi, không phải icon chức năng.
export function categoryLabel(cat: string): string {
  const map: Record<string, string> = {
    cay: '🌳 Cây cối',
    nuoc: '💧 Nước',
    dat: '🌍 Đất',
    khong_khi: '🌬️ Không khí',
    dong_vat: '🐾 Động vật',
    tai_che: '♻️ Tái chế',
    nang_luong: '⚡ Năng lượng',
    nature: '🌿 Thiên nhiên',
  };
  return map[cat] ?? '🌿 Thiên nhiên';
}

export function difficultyLabel(d: number): string {
  return d >= 3 ? 'Khó' : d === 2 ? 'Vừa' : 'Dễ';
}

type Rarity = HarvestSpecies['rarity'];

export function rarityLabel(r: Rarity): string {
  return r === 'LEGENDARY' ? '🌟 Huyền thoại' : r === 'RARE' ? '💎 Hiếm' : '🍃 Thường';
}

// Class đầy đủ (không ghép chuỗi) để Tailwind quét thấy.
export function rarityText(r: Rarity): string {
  return r === 'LEGENDARY' ? 'text-honey-600' : r === 'RARE' ? 'text-sage-600' : 'text-stone-600';
}

export function rarityBorder(r: Rarity): string {
  return r === 'LEGENDARY' ? 'border-honey-600' : r === 'RARE' ? 'border-sage-600' : 'border-stone-450';
}
