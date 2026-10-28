import { sameProvince, type WasteFeeEstimate, type WasteFeeTable } from '@tubutree/shared-types';

export function estimateMailinFee(table: WasteFeeTable, province: { code: string; name: string }): WasteFeeEstimate {
  const zone = table.zones.find((z) => z.provinceCodes.some((c) => sameProvince(c, province.code))) ?? table.defaultZone;
  return { zoneName: zone.name, provinceCode: province.code, provinceName: province.name, low: zone.low, high: zone.high };
}
