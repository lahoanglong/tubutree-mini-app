import type { CampaignBanner } from '@tubutree/app-core/api/campaign';
import { fetchCampaigns } from '@tubutree/app-core/api/campaign';
import { coreHttp } from './core-http';
import { takePublicBlock } from './home-feed';

/** Banner đầu Trang chủ: lần đầu lấy từ request gộp `/home`, các lần sau (làm mới, API cũ chưa có khối) gọi `/campaigns`. */
export async function fetchHomeCampaigns(): Promise<CampaignBanner[]> {
  return (await takePublicBlock('campaigns')) ?? fetchCampaigns(coreHttp, 'HOME_TOP');
}
