import type { HarvestSpecies } from '../../services/game-api';

type Rarity = HarvestSpecies['rarity'];

// Cùng ngày theo giờ VN (UTC+7) — khớp dayKey backend, để khoá nút đã dùng trong ngày.
export function isSameVNDay(iso: string | null): boolean {
  if (!iso) return false;
  const key = (d: Date) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  return key(new Date(iso)) === key(new Date());
}

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

export function rarityColor(r: Rarity): string {
  return r === 'LEGENDARY' ? 'var(--sun-700)' : r === 'RARE' ? 'var(--leaf-600)' : 'var(--neutral-400)';
}

export function rarityLabel(r: Rarity): string {
  return r === 'LEGENDARY' ? '🌟 Huyền thoại' : r === 'RARE' ? '💎 Hiếm' : '🍃 Thường';
}
