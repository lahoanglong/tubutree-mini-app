import { HOME_COMBOS_LIMIT, fetchHomeCombos, fetchProductBundles, type BundleDTO } from '@tubutree/app-core/api/bundle';
import { coreHttp } from './core-http';
import { takePublicBlock } from './home-feed';

export const getProductBundles = (slug: string) => fetchProductBundles(coreHttp, slug);

/** Kệ combo Trang chủ: lần đầu lấy từ request gộp `/home`, các lần sau (làm mới, API cũ chưa có khối) gọi `/bundles/combos`. */
export async function getHomeCombos(): Promise<BundleDTO[]> {
  return (await takePublicBlock('combos')) ?? fetchHomeCombos(coreHttp, HOME_COMBOS_LIMIT);
}
