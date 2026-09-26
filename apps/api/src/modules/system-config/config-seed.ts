import type { Prisma } from '@prisma/client';

/** Một dòng SystemConfig mặc định trong prisma/seed.ts. */
export type ConfigSeed = {
  key: string;
  value: Prisma.InputJsonValue;
  category: string;
  description: string;
  /**
   * Key do ADMIN sở hữu giá trị (nhập ở tab Cấu hình) — seed chỉ TẠO khi chưa có, không bao giờ ghi
   * đè. Runbook deploy chạy lại seed mỗi lần deploy: key thường bị reset về mặc định là chủ ý (đồng
   * bộ tham số nghiệp vụ theo spec), nhưng key admin nhập (vd kho lấy hàng Gomdon, công tắc bật thu
   * gom) mà bị reset thì mỗi lần deploy tính năng lại âm thầm tắt/sai.
   */
  createOnly?: boolean;
};

/** Tham số upsert cho 1 dòng seed — tách ra để test được hành vi "không ghi đè" mà không cần DB. */
export function configSeedUpsertArgs(cfg: ConfigSeed): Prisma.SystemConfigUpsertArgs {
  const { createOnly, ...row } = cfg;
  return {
    where: { key: row.key },
    update: createOnly ? {} : { value: row.value, category: row.category, description: row.description },
    create: row,
  };
}
