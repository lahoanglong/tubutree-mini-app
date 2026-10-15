import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

/** Trần số điểm nhận (kể cả đang tắt): giữ danh sách khách thấy trong /refill/me gọn và chặn tạo hàng loạt nhầm. */
export const MAX_REFILL_LOCATIONS = 50;

/**
 * Khoá advisory của việc tạo điểm: đếm trần + lấy sortOrder lớn nhất rồi ghi là đọc-rồi-ghi, ở Read Committed hai admin
 * tạo cùng lúc đều đếm thấy 49 điểm (vượt trần) và cùng lấy max+1 (trùng sortOrder). Cùng quy ước pg_advisory_xact_lock(hashtext(...))
 * với lockAdminRoster: nhả tự động khi transaction kết thúc, câu đọc sau khoá thấy dữ liệu người trước vừa commit.
 */
export const REFILL_LOCATIONS_CREATE_LOCK_KEY = 'refill-locations:create';

const LOCATION_ORDER = [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] as const;

/** Dạng khách thấy: không lộ isActive/sortOrder (chỉ điểm đang bật mới được trả cho khách). */
export interface RefillLocationView {
  id: string;
  name: string;
  address: string;
  hours: string | null;
  phone: string | null;
}

/** Dạng một điểm nhận của bản app cũ (/refill/me.pickup): chưa có tên, trường nào trống là null. */
export interface LegacyPickupPoint {
  address: string | null;
  hours: string | null;
  phone: string | null;
}

export interface RefillLocationInput {
  name?: string;
  address?: string;
  hours?: string | null;
  phone?: string | null;
  isActive?: boolean;
}

const EMPTY_PICKUP: LegacyPickupPoint = { address: null, hours: null, phone: null };

/** Giờ/SĐT để trống hoặc null = không có (app ẩn dòng đó). */
const optionalText = (v: string | null | undefined): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Điểm nhận vỏ chai rỗng. Khách chỉ thấy điểm đang bật theo sortOrder; admin tạo/sửa/bật tắt/sắp xếp ở tab Đổi vỏ chai.
 * Không xoá cứng: yêu cầu đổi vỏ cũ còn trỏ vào điểm, tắt isActive là cách ngừng nhận mà giữ lịch sử.
 */
@Injectable()
export class RefillLocationsService {
  private readonly logger = new Logger(RefillLocationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  /** Điểm đang bật cho khách. `take` phòng bảng bị chèn quá trần bằng tay. */
  async listActive(): Promise<RefillLocationView[]> {
    const rows = await this.prisma.refillPickupLocation.findMany({
      where: { isActive: true },
      orderBy: [...LOCATION_ORDER],
      take: MAX_REFILL_LOCATIONS,
      select: { id: true, name: true, address: true, hours: true, phone: true },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, address: r.address, hours: r.hours, phone: r.phone }));
  }

  /**
   * Phần điểm nhận của /refill/me. `pickup` giữ dạng một điểm cho bản app cũ (điểm đầu tiên đang bật). Chỉ khi bảng chưa
   * từng có dòng nào mới đọc ba khoá SystemConfig refill.pickup_* (dự phòng một đợt để triển khai không làm trống màn hình);
   * admin đã tắt hết điểm thì khách thấy "chưa có điểm", không hiện lại địa chỉ cũ có thể đã đóng cửa.
   */
  async publicView(): Promise<{ pickupLocations: RefillLocationView[]; pickup: LegacyPickupPoint }> {
    const pickupLocations = await this.listActive();
    const first = pickupLocations[0];
    if (first) return { pickupLocations, pickup: { address: first.address, hours: first.hours, phone: first.phone } };
    const total = await this.prisma.refillPickupLocation.count();
    return { pickupLocations, pickup: total === 0 ? await this.legacyPickupPoint() : { ...EMPTY_PICKUP } };
  }

  /**
   * Điểm gắn vào yêu cầu đổi vỏ. Khách chọn thì phải là điểm còn bật (đã tắt/không có → 400 để chọn lại, không âm thầm đổi
   * sang điểm khác). Không gửi (bản app cũ chỉ biết một điểm) thì gán điểm đầu tiên đang bật — đúng điểm app đó đang hiện.
   */
  async resolveForReturn(client: Prisma.TransactionClient | PrismaService, requestedId: string | undefined): Promise<string | null> {
    if (requestedId) {
      const found = await client.refillPickupLocation.findUnique({ where: { id: requestedId }, select: { id: true, isActive: true } });
      if (!found) throw new BadRequestException('Điểm nhận vỏ không còn trong danh sách. Vui lòng tải lại trang rồi chọn lại điểm nhận.');
      if (!found.isActive) throw new BadRequestException('Điểm nhận này đã ngừng nhận vỏ. Vui lòng chọn điểm nhận khác.');
      return found.id;
    }
    const [first] = await client.refillPickupLocation.findMany({
      where: { isActive: true },
      orderBy: [...LOCATION_ORDER],
      take: 1,
      select: { id: true },
    });
    return first?.id ?? null;
  }

  async listAll() {
    return this.prisma.refillPickupLocation.findMany({ orderBy: [...LOCATION_ORDER], take: MAX_REFILL_LOCATIONS * 2 });
  }

  async create(adminId: string, input: RefillLocationInput & { name: string; address: string }) {
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${REFILL_LOCATIONS_CREATE_LOCK_KEY}))`;
      const agg = await tx.refillPickupLocation.aggregate({ _count: true, _max: { sortOrder: true } });
      if (agg._count >= MAX_REFILL_LOCATIONS) {
        throw new BadRequestException(`Tối đa ${MAX_REFILL_LOCATIONS} điểm nhận vỏ. Hãy tắt hoặc sửa điểm cũ thay vì thêm mới.`);
      }
      return tx.refillPickupLocation.create({
        data: {
          name: input.name,
          address: input.address,
          hours: optionalText(input.hours),
          phone: optionalText(input.phone),
          isActive: input.isActive ?? true,
          sortOrder: (agg._max.sortOrder ?? -1) + 1,
        },
      });
    });
    this.logger.warn(`Admin ${adminId} thêm điểm nhận vỏ ${created.id} ("${created.name}")${created.isActive ? '' : ' (đang tắt)'}.`);
    return created;
  }

  async update(adminId: string, id: string, input: RefillLocationInput) {
    const before = await this.prisma.refillPickupLocation.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Không tìm thấy điểm nhận vỏ.');
    const data: Prisma.RefillPickupLocationUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.address !== undefined) data.address = input.address;
    if (input.hours !== undefined) data.hours = optionalText(input.hours);
    if (input.phone !== undefined) data.phone = optionalText(input.phone);
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (Object.keys(data).length === 0) throw new BadRequestException('Không có thông tin nào để cập nhật.');
    const updated = await this.prisma.refillPickupLocation.update({ where: { id }, data });
    const toggled = input.isActive !== undefined && input.isActive !== before.isActive;
    this.logger.warn(
      `Admin ${adminId} sửa điểm nhận vỏ ${id} ("${before.name}"): ${Object.keys(data).join(', ')}` +
        (toggled ? ` → ${input.isActive ? 'BẬT' : 'TẮT'}` : ''),
    );
    return updated;
  }

  /** `ids` phải đúng bằng tập điểm hiện có: admin khác vừa thêm/đổi thì báo tải lại thay vì ghi đè thứ tự theo danh sách cũ. */
  async reorder(adminId: string, ids: string[]) {
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Danh sách thứ tự có id bị lặp.');
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.refillPickupLocation.findMany({ select: { id: true } });
      const have = new Set(current.map((r) => r.id));
      if (have.size !== ids.length || ids.some((id) => !have.has(id))) {
        throw new ConflictException('Danh sách điểm nhận đã thay đổi. Vui lòng tải lại rồi sắp xếp lại.');
      }
      // Cập nhật theo thứ tự id (không theo thứ tự mới) để hai admin sắp xếp cùng lúc khoá hàng cùng một chiều, không deadlock.
      const position = new Map(ids.map((id, index) => [id, index]));
      for (const id of [...ids].sort()) {
        await tx.refillPickupLocation.update({ where: { id }, data: { sortOrder: position.get(id)! } });
      }
    });
    this.logger.warn(`Admin ${adminId} sắp xếp lại ${ids.length} điểm nhận vỏ: ${ids.join(' > ')}`);
    return this.listAll();
  }

  /** Ba khoá SystemConfig cũ; trống/sai kiểu → null để app ẩn dòng đó. */
  private async legacyPickupPoint(): Promise<LegacyPickupPoint> {
    const text = async (key: string): Promise<string | null> => {
      const v = await this.config.get<unknown>(key, '');
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    };
    const [address, hours, phone] = await Promise.all([text('refill.pickup_address'), text('refill.pickup_hours'), text('refill.pickup_phone')]);
    return { address, hours, phone };
  }
}
