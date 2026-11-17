import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BLOCKER_TEXT, approvalBlockers, httpsSourceUrl, isEcoFactStatus, type ApprovalBlocker, type EcoFactStatusName } from './eco-facts.rules';
import { csvRecords, parseEcoFactInput, type EcoFactInput } from './eco-facts.input';

const LIST_MAX = 500;

const ADMIN_SELECT = {
  id: true,
  productId: true,
  variationId: true,
  kind: true,
  valueGrams: true,
  baselineText: true,
  label: true,
  co2Grams: true,
  sourceUrl: true,
  sourceNote: true,
  status: true,
  approvedById: true,
  approvedAt: true,
  updatedAt: true,
  product: { select: { name: true, slug: true } },
  variation: { select: { name: true, sku: true } },
} satisfies Prisma.ProductEcoFactSelect;

type AdminRow = Prisma.ProductEcoFactGetPayload<{ select: typeof ADMIN_SELECT }>;

export interface AdminEcoFact {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  variationId: string | null;
  variationName: string | null;
  variationSku: string | null;
  kind: string;
  valueGrams: number | null;
  baselineText: string | null;
  label: string | null;
  co2Grams: number | null;
  sourceUrl: string;
  sourceNote: string;
  status: EcoFactStatusName;
  approvedById: string | null;
  approvedAt: string | null;
  updatedAt: string;
  /** Lý do chưa duyệt được (rỗng: duyệt được), kèm câu tiếng Việt để thẻ admin hiện thẳng. */
  blockers: { code: ApprovalBlocker; message: string }[];
}

export interface EcoImportResult {
  created: number;
  updated: number;
  /** Dòng đã duyệt không bị nhập đè (muốn sửa thì sửa từng dòng ở form, dòng sẽ về nháp). */
  skippedApproved: number;
  errors: { line: number; message: string }[];
}

const CONTENT_KEYS = ['valueGrams', 'baselineText', 'label', 'co2Grams', 'sourceUrl', 'sourceNote'] as const;

function view(r: AdminRow): AdminEcoFact {
  return {
    id: r.id,
    productId: r.productId,
    productName: r.product.name,
    productSlug: r.product.slug,
    variationId: r.variationId,
    variationName: r.variation?.name ?? null,
    variationSku: r.variation?.sku ?? null,
    kind: r.kind,
    valueGrams: r.valueGrams,
    baselineText: r.baselineText,
    label: r.label,
    co2Grams: r.co2Grams,
    sourceUrl: r.sourceUrl,
    sourceNote: r.sourceNote,
    status: r.status,
    approvedById: r.approvedById,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
    blockers: approvalBlockers(r).map((code) => ({ code, message: BLOCKER_TEXT[code] })),
  };
}

const isUniqueViolation = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Quản trị "Sự thật xanh". Thêm, sửa và nhập CSV chỉ tạo NHÁP; dòng đã duyệt mà bị sửa nội dung thì về nháp (phải duyệt lại). Duyệt bị chặn
 * khi thiếu nguồn https, ghi chú nguồn, số gam (Giảm nhựa), chữ hiển thị (giấy tờ, vùng nguyên liệu) hoặc chữ dính bộ chặn tuyên bố.
 */
@Injectable()
export class EcoFactsAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(status: unknown): Promise<{ items: AdminEcoFact[] }> {
    const where: Prisma.ProductEcoFactWhereInput = isEcoFactStatus(status) ? { status } : {};
    const rows = await this.prisma.productEcoFact.findMany({ where, select: ADMIN_SELECT, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: LIST_MAX });
    return { items: rows.map(view) };
  }

  private async resolveTarget(input: EcoFactInput): Promise<{ productId: string; variationId: string | null }> {
    const product = await this.prisma.product.findUnique({ where: { slug: input.productSlug }, select: { id: true } });
    if (!product) throw new BadRequestException(`Không có sản phẩm mã "${input.productSlug}".`);
    if (!input.variationSku) return { productId: product.id, variationId: null };
    const variation = await this.prisma.variation.findUnique({ where: { sku: input.variationSku }, select: { id: true, productId: true } });
    if (!variation || variation.productId !== product.id) throw new BadRequestException(`SKU "${input.variationSku}" không thuộc sản phẩm này.`);
    return { productId: product.id, variationId: variation.id };
  }

  private parse(body: unknown): EcoFactInput {
    const parsed = parseEcoFactInput(body);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    return parsed.value;
  }

  private content(input: EcoFactInput) {
    return {
      valueGrams: input.valueGrams,
      baselineText: input.baselineText,
      label: input.label,
      co2Grams: input.co2Grams,
      sourceUrl: httpsSourceUrl(input.sourceUrl) ?? input.sourceUrl,
      sourceNote: input.sourceNote,
    };
  }

  async create(body: unknown): Promise<AdminEcoFact> {
    const input = this.parse(body);
    const target = await this.resolveTarget(input);
    try {
      const row = await this.prisma.productEcoFact.create({ data: { ...target, kind: input.kind, ...this.content(input), status: 'DRAFT' }, select: ADMIN_SELECT });
      return view(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Sản phẩm (hoặc phân loại) này đã có sự thật cùng loại: sửa dòng đó thay vì thêm mới.');
      throw e;
    }
  }

  /** Sửa nội dung; sản phẩm, phân loại và loại không đổi được (xoá mềm bằng Ngừng dùng rồi thêm dòng mới). */
  async update(id: string, body: unknown): Promise<AdminEcoFact> {
    const row = await this.prisma.productEcoFact.findUnique({ where: { id }, select: ADMIN_SELECT });
    if (!row) throw new NotFoundException('Không tìm thấy sự thật này.');
    // Khoá không gửi giữ giá trị cũ (PATCH), nên một form cũ thiếu trường không xoá mất nguồn hay số gam.
    const current = { valueGrams: row.valueGrams, baselineText: row.baselineText, label: row.label, co2Grams: row.co2Grams, sourceUrl: row.sourceUrl, sourceNote: row.sourceNote };
    const input = this.parse({ ...current, ...(body && typeof body === 'object' ? body : {}), productSlug: row.product.slug, variationSku: row.variation?.sku ?? null, kind: row.kind });
    const next = this.content(input);
    const changed = CONTENT_KEYS.some((k) => next[k] !== row[k]);
    if (!changed) return view(row);
    const expected = (body as Record<string, unknown> | null)?.expectedUpdatedAt;
    if (typeof expected === 'string' && expected !== row.updatedAt.toISOString()) throw new ConflictException('Dòng này vừa được người khác sửa. Tải lại rồi sửa tiếp.');
    const data = row.status === 'APPROVED' ? { ...next, status: 'DRAFT' as const, approvedById: null, approvedAt: null } : next;
    const res = await this.prisma.productEcoFact.updateMany({ where: { id, updatedAt: row.updatedAt }, data });
    if (res.count === 0) throw new ConflictException('Dòng này vừa được người khác sửa. Tải lại rồi sửa tiếp.');
    return view((await this.prisma.productEcoFact.findUniqueOrThrow({ where: { id }, select: ADMIN_SELECT })) as AdminRow);
  }

  /**
   * Duyệt đúng bản admin đang xem: `expectedUpdatedAt` phải khớp dòng hiện tại, và lệnh ghi có điều kiện `updatedAt` nên một lần sửa chen giữa
   * (người khác đổi số, đổi nguồn) làm lệnh duyệt thất bại thay vì duyệt nội dung chưa ai xem.
   */
  async approve(id: string, adminId: string, body: unknown): Promise<AdminEcoFact> {
    const row = await this.prisma.productEcoFact.findUnique({ where: { id }, select: ADMIN_SELECT });
    if (!row) throw new NotFoundException('Không tìm thấy sự thật này.');
    const expected = (body as Record<string, unknown> | null)?.expectedUpdatedAt;
    if (typeof expected !== 'string' || expected !== row.updatedAt.toISOString()) throw new ConflictException('Dòng này vừa đổi. Tải lại, xem lại rồi duyệt.');
    if (row.status === 'APPROVED') return view(row);
    const blockers = approvalBlockers(row);
    if (blockers.length > 0) throw new BadRequestException(blockers.map((b) => BLOCKER_TEXT[b]).join(' '));
    const res = await this.prisma.productEcoFact.updateMany({
      where: { id, updatedAt: row.updatedAt, status: { not: 'APPROVED' } },
      data: { status: 'APPROVED', approvedById: adminId, approvedAt: new Date() },
    });
    if (res.count === 0) throw new ConflictException('Dòng này vừa đổi. Tải lại, xem lại rồi duyệt.');
    return view((await this.prisma.productEcoFact.findUniqueOrThrow({ where: { id }, select: ADMIN_SELECT })) as AdminRow);
  }

  /** Ngừng dùng: sự thật thôi hiện ở thẻ, trang sản phẩm và không còn được cộng vào Hộ chiếu Xanh. Gọi lại không đổi gì. */
  async retire(id: string): Promise<AdminEcoFact> {
    const row = await this.prisma.productEcoFact.findUnique({ where: { id }, select: { id: true } });
    if (!row) throw new NotFoundException('Không tìm thấy sự thật này.');
    await this.prisma.productEcoFact.updateMany({ where: { id, status: { not: 'RETIRED' } }, data: { status: 'RETIRED' } });
    return view((await this.prisma.productEcoFact.findUniqueOrThrow({ where: { id }, select: ADMIN_SELECT })) as AdminRow);
  }

  /** Nhập CSV thành nháp: dòng mới tạo, dòng nháp/ngừng dùng cập nhật (về nháp), dòng đã duyệt bỏ qua. Lỗi từng dòng không chặn dòng khác. */
  async importCsv(body: unknown): Promise<EcoImportResult> {
    const csv = (body as Record<string, unknown> | null)?.csv;
    if (typeof csv !== 'string') throw new BadRequestException('Thiếu nội dung CSV.');
    const parsed = csvRecords(csv);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    const out: EcoImportResult = { created: 0, updated: 0, skippedApproved: 0, errors: [] };
    for (const rec of parsed.records) {
      const input = parseEcoFactInput(rec.data);
      if (!input.ok) {
        out.errors.push({ line: rec.line, message: input.error });
        continue;
      }
      try {
        const target = await this.resolveTarget(input.value);
        const existing = await this.prisma.productEcoFact.findFirst({ where: { ...target, kind: input.value.kind }, select: { id: true, status: true } });
        if (existing?.status === 'APPROVED') {
          out.skippedApproved += 1;
          continue;
        }
        const content = this.content(input.value);
        if (existing) {
          const res = await this.prisma.productEcoFact.updateMany({ where: { id: existing.id, status: { not: 'APPROVED' } }, data: { ...content, status: 'DRAFT', approvedById: null, approvedAt: null } });
          if (res.count === 0) out.skippedApproved += 1;
          else out.updated += 1;
        } else {
          await this.prisma.productEcoFact.create({ data: { ...target, kind: input.value.kind, ...content, status: 'DRAFT' } });
          out.created += 1;
        }
      } catch (e) {
        if (e instanceof BadRequestException) out.errors.push({ line: rec.line, message: String(e.message) });
        else if (isUniqueViolation(e)) out.errors.push({ line: rec.line, message: 'Trùng với dòng vừa nhập (cùng sản phẩm, phân loại, loại).' });
        else throw e;
      }
    }
    return out;
  }
}
