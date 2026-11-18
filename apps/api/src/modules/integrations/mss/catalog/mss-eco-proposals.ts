import { Prisma } from '@prisma/client';
import type { MssEcoFactProposal } from '../../../catalog/mss-enrichment';
import { ECO_LIMITS, isEcoFactKind } from '../../../eco-impact/eco-facts.rules';

type EcoDb = Pick<Prisma.TransactionClient, 'productEcoFact'>;

export interface MssEcoProposalInput {
  productId: string;
  pancakeProductId: string;
  version: number;
  facts: readonly MssEcoFactProposal[];
  /** `pancake_variation_id` → id biến thể Tubu của sản phẩm này. */
  variations: ReadonlyMap<string, string>;
}

/** Ghi chú nội bộ của dòng nháp: admin biết dòng do MSS đề xuất, bản nào, ghi chú nguồn MSS gửi kèm. */
export function mssEcoSourceNote(pancakeProductId: string, version: number, note: string): string {
  const head = `Đề xuất từ MSS (sản phẩm Pancake ${pancakeProductId}, bản ${version})`;
  return (note ? `${head}: ${note}` : head).slice(0, ECO_LIMITS.sourceNote);
}

/**
 * Nhãn xanh MSS đề xuất thành dòng NHÁP của `product_eco_facts`, để admin xem nguồn rồi duyệt ở màn Sự thật xanh như dòng nhập tay. Chỉ tạo
 * khi sản phẩm (hoặc biến thể) chưa có dòng cùng loại ở bất kỳ trạng thái nào: dòng đã có (admin nhập, đã duyệt, đã ngừng dùng, hay nháp MSS
 * trước) thuộc về Tubu và không bị MSS sửa. Không bao giờ ghi trạng thái khác NHÁP, nên không có gì hiện cho khách khi chưa qua tay admin.
 * Hai lượt cùng sản phẩm chạy chồng: chỉ mục duy nhất (cả nhánh biến thể NULL) chặn dòng thứ hai, lượt thua đếm là "giữ".
 */
export async function proposeMssEcoFacts(db: EcoDb, input: MssEcoProposalInput): Promise<{ proposed: number; kept: number }> {
  let proposed = 0;
  let kept = 0;
  for (const f of input.facts) {
    if (!isEcoFactKind(f.kind)) continue;
    const variationId = f.variationId === null ? null : (input.variations.get(f.variationId) ?? undefined);
    // Biến thể MSS chưa có ở Tubu: không gắn nhầm lên cả sản phẩm.
    if (variationId === undefined) {
      kept += 1;
      continue;
    }
    const exists = await db.productEcoFact.findFirst({ where: { productId: input.productId, variationId, kind: f.kind }, select: { id: true } });
    if (exists) {
      kept += 1;
      continue;
    }
    try {
      await db.productEcoFact.create({
        data: {
          productId: input.productId,
          variationId,
          kind: f.kind,
          valueGrams: f.valueGrams,
          baselineText: f.baselineText,
          label: f.label,
          co2Grams: f.co2Grams,
          sourceUrl: f.sourceUrl,
          sourceNote: mssEcoSourceNote(input.pancakeProductId, input.version, f.sourceNote),
          status: 'DRAFT',
        },
      });
      proposed += 1;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        kept += 1;
        continue;
      }
      throw err;
    }
  }
  return { proposed, kept };
}
