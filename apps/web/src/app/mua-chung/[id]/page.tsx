import type { Metadata } from 'next';
import { GroupBuyView } from '../group-buy-view';

export const revalidate = 300;

const TITLE = 'Bạn được mời mua chung — Tubu Tree';
const DESCRIPTION = 'Vào nhóm mua chung để cùng nhận mã giảm giá khi đủ người.';

// Nội dung nhóm chỉ đọc được khi đã đăng nhập nên metadata chung, không lập chỉ mục từng link mời.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: false, follow: true },
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website' },
};

export default async function InvitedGroupBuyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GroupBuyView invitedId={id} />;
}
