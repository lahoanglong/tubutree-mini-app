import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

type Rarity = 'COMMON' | 'RARE' | 'LEGENDARY';
const RARITY_WEIGHT: Record<Rarity, number> = { COMMON: 70, RARE: 25, LEGENDARY: 5 };

interface SpeciesRow {
  id: string;
  name: string;
  rarity: Rarity;
  emoji: string;
  region: string | null;
  story: string | null;
  ecoFact: string | null;
}

/**
 * Vườn Xanh 2.0 Phase 3 — sổ tay loài cây. Mỗi lần thu hoạch, user sưu tập 1 loài
 * (weighted theo rarity: COMMON 70 / RARE 25 / LEGENDARY 5). Codex hiển thị lưới
 * đã/chưa mở; story + ecoFact chỉ lộ khi đã sưu tập (động lực sưu tập + học sinh thái).
 */
@Injectable()
export class GameCollectionService {
  constructor(private readonly prisma: PrismaService) {}

  private weightOf(rarity: Rarity): number {
    return RARITY_WEIGHT[rarity] ?? 50;
  }

  /** Chọn loài theo trọng số rarity. rand ∈ [0,1). */
  private pickWeighted(list: SpeciesRow[], rand: number): SpeciesRow {
    const total = list.reduce((s, sp) => s + this.weightOf(sp.rarity), 0);
    let r = rand * total;
    for (const sp of list) {
      r -= this.weightOf(sp.rarity);
      if (r < 0) return sp;
    }
    return list[list.length - 1]!; // caller đảm bảo list không rỗng
  }

  /** Thu hoạch → sưu tập 1 loài. Trả loài (kèm story/ecoFact để reveal) hoặc null. */
  async collectOnHarvest(userId: string, rand: number = Math.random()) {
    const all = (await this.prisma.plantSpecies.findMany()) as unknown as SpeciesRow[];
    if (!all.length) return null;
    const picked = this.pickWeighted(all, rand);
    await this.prisma.userSpecies.upsert({
      where: { userId_speciesId: { userId, speciesId: picked.id } },
      create: { userId, speciesId: picked.id, count: 1 },
      update: { count: { increment: 1 } },
    });
    return {
      id: picked.id,
      name: picked.name,
      rarity: picked.rarity,
      emoji: picked.emoji,
      region: picked.region,
      story: picked.story,
      ecoFact: picked.ecoFact,
    };
  }

  /** Sổ tay đầy đủ: mọi loài + trạng thái sở hữu. Khoá story/ecoFact khi chưa mở. */
  async getCodex(userId: string) {
    const all = (await this.prisma.plantSpecies.findMany({
      orderBy: [{ rarity: 'asc' }, { name: 'asc' }],
    })) as unknown as SpeciesRow[];
    const mine = await this.prisma.userSpecies.findMany({ where: { userId } });
    const counts = new Map(mine.map((m) => [m.speciesId, m.count]));
    return all.map((sp) => {
      const owned = counts.has(sp.id);
      return {
        id: sp.id,
        name: sp.name,
        rarity: sp.rarity,
        emoji: sp.emoji,
        region: sp.region,
        owned,
        count: counts.get(sp.id) ?? 0,
        story: owned ? sp.story : null,
        ecoFact: owned ? sp.ecoFact : null,
      };
    });
  }
}
