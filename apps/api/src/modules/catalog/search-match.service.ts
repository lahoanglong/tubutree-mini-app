import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { PUBLIC_PRODUCT_WHERE } from './public-product';
import { foldVietnamese } from './search-text';
import {
  SEARCH_FUZZY_FLAG,
  buildVocabulary,
  clipDidYouMean,
  correctPhrase,
  exactMatch,
  fuzzyMatchSql,
  fuzzySessionSql,
  shouldTryFuzzy,
  synonymQuery,
  type TextMatch,
  type Vocabulary,
} from './search-fuzzy';

const SYNONYM_TTL_MS = 5 * 60_000;
const VOCAB_TTL_MS = 10 * 60_000;
/** Trần số từ đồng nghĩa đọc vào bộ nhớ: bảng do admin gõ tay, vài chục dòng. */
const SYNONYM_MAX = 500;

const ROW_SELECT = { id: true, term: true, canonical: true, isActive: true, updatedAt: true } as const;

export interface SearchSynonymRow {
  id: string;
  term: string;
  canonical: string;
  isActive: boolean;
  updatedAt: Date;
}

/**
 * Bước "chịu gõ sai" sau bước khớp chính xác của `CatalogService` (cờ `catalog.search_fuzzy_enabled`, mặc định tắt):
 * 1. từ đồng nghĩa: cụm khách gõ chứa `term` thì tìm chính xác thêm theo `canonical`, kết quả nối sau;
 * 2. vẫn dưới 3 món và từ khoá đủ dài: sửa chính tả theo từ vựng tên hàng (cụm sửa được thì tìm chính xác) rồi `word_similarity` qua chỉ
 *    mục trigram.
 * Cờ tắt hay lỗi đọc thì trả nguyên kết quả chính xác: không đổi id hay thứ tự.
 */
@Injectable()
export class SearchMatchService {
  private readonly logger = new Logger(SearchMatchService.name);
  private synonymCache: { rows: { term: string; canonical: string }[]; expiresAt: number } | null = null;
  private vocabCache: { vocab: Vocabulary; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  async enabled(): Promise<boolean> {
    if (!this.config) return false;
    try {
      return (await this.config.get<boolean>(SEARCH_FUZZY_FLAG, false)) === true;
    } catch {
      return false;
    }
  }

  /** `exact(q)` là bước khớp chính xác của CatalogService (cùng điều kiện công khai và thứ tự). */
  async refine(raw: string, exactIds: string[], exact: (q: string) => Promise<string[]>): Promise<TextMatch> {
    if (!(await this.enabled())) return exactMatch(exactIds);
    try {
      return await this.refineOn(foldVietnamese(raw), exactIds, exact);
    } catch (err) {
      this.logger.warn(`Bước tìm gần đúng lỗi, giữ kết quả chính xác: ${err instanceof Error ? err.message : String(err)}`);
      return exactMatch(exactIds);
    }
  }

  private async refineOn(folded: string, exactIds: string[], exact: (q: string) => Promise<string[]>): Promise<TextMatch> {
    let ids = exactIds;
    const alt = synonymQuery(folded, await this.synonyms());
    if (alt) ids = union(ids, await exact(alt));
    if (!shouldTryFuzzy(folded, ids.length)) return exactMatch(ids);

    const fix = correctPhrase(folded, await this.vocabulary());
    const fixIds = fix ? await exact(fix.folded) : [];
    const fuzzy = await this.fuzzy(folded);
    const extra = union(fixIds, fuzzy.map((r) => r.id)).filter((id) => !ids.includes(id));
    if (ids.length > 0 || extra.length === 0) return exactMatch(union(ids, extra));
    const nearest = fix && fixIds.length > 0 ? fix.display : (fuzzy[0]?.name ?? null);
    return { ids: extra, corrected: true, didYouMean: nearest ? clipDidYouMean(nearest) : null };
  }

  /** Cấu hình phiên chỉ sống trong transaction đọc này (SET LOCAL), không đổi kết nối dùng chung. */
  private fuzzy(folded: string): Promise<{ id: string; name: string }[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(fuzzySessionSql());
      return tx.$queryRaw<{ id: string; name: string }[]>(fuzzyMatchSql(folded));
    });
  }

  private async synonyms(): Promise<{ term: string; canonical: string }[]> {
    const now = Date.now();
    if (this.synonymCache && this.synonymCache.expiresAt > now) return this.synonymCache.rows;
    const rows = await this.prisma.searchSynonym.findMany({ where: { isActive: true }, select: { term: true, canonical: true }, take: SYNONYM_MAX });
    this.synonymCache = { rows, expiresAt: now + SYNONYM_TTL_MS };
    return rows;
  }

  private async vocabulary(): Promise<Vocabulary> {
    const now = Date.now();
    if (this.vocabCache && this.vocabCache.expiresAt > now) return this.vocabCache.vocab;
    const rows = await this.prisma.product.findMany({ where: PUBLIC_PRODUCT_WHERE, select: { name: true } });
    const vocab = buildVocabulary(rows.map((r) => r.name));
    this.vocabCache = { vocab, expiresAt: now + VOCAB_TTL_MS };
    return vocab;
  }

  // Thẻ admin "Từ khoá tìm kiếm" (/admin/tu-khoa-tim). Ghi xong thì bỏ bộ nhớ đệm của tiến trình này; tiến trình khác tự làm mới sau 5 phút.

  listSynonyms(): Promise<SearchSynonymRow[]> {
    return this.prisma.searchSynonym.findMany({ orderBy: [{ term: 'asc' }], take: SYNONYM_MAX, select: ROW_SELECT });
  }

  async createSynonym(input: { term: string; canonical: string; isActive?: boolean }): Promise<SearchSynonymRow> {
    const { term, canonical } = normalizePair(input.term, input.canonical);
    try {
      const row = await this.prisma.searchSynonym.create({ data: { term, canonical, isActive: input.isActive ?? true }, select: ROW_SELECT });
      this.synonymCache = null;
      return row;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Đã có từ đồng nghĩa cho "${term}".`);
      }
      throw err;
    }
  }

  async updateSynonym(id: string, input: { canonical?: string; isActive?: boolean }): Promise<SearchSynonymRow> {
    const current = await this.prisma.searchSynonym.findUnique({ where: { id }, select: { term: true } });
    if (!current) throw new NotFoundException('Không tìm thấy từ đồng nghĩa.');
    const data: Prisma.SearchSynonymUpdateInput = {};
    if (input.canonical !== undefined) data.canonical = normalizePair(current.term, input.canonical).canonical;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    const res = await this.prisma.searchSynonym.updateMany({ where: { id }, data });
    if (res.count === 0) throw new NotFoundException('Không tìm thấy từ đồng nghĩa.');
    this.synonymCache = null;
    return this.prisma.searchSynonym.findUniqueOrThrow({ where: { id }, select: ROW_SELECT });
  }

  async removeSynonym(id: string): Promise<{ ok: true }> {
    const res = await this.prisma.searchSynonym.deleteMany({ where: { id } });
    if (res.count === 0) throw new NotFoundException('Không tìm thấy từ đồng nghĩa.');
    this.synonymCache = null;
    return { ok: true };
  }
}

/** Hai vế lưu dạng gấp dấu; giống nhau thì vô nghĩa (tìm thêm đúng cụm cũ). DTO đã kiểm độ dài, kiểm lại sau khi gấp. */
export function normalizePair(rawTerm: string, rawCanonical: string): { term: string; canonical: string } {
  const term = foldVietnamese(rawTerm);
  const canonical = foldVietnamese(rawCanonical);
  if (term.length < 2 || canonical.length < 2 || term.length > 60 || canonical.length > 60) {
    throw new BadRequestException('Mỗi vế cần từ 2 tới 60 ký tự.');
  }
  if (term === canonical) throw new BadRequestException('Hai vế giống nhau sau khi bỏ dấu.');
  return { term, canonical };
}

function union(a: string[], b: string[]): string[] {
  if (b.length === 0) return a;
  const seen = new Set(a);
  const out = [...a];
  for (const id of b) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
