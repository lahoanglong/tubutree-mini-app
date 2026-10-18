import type { Metadata } from 'next';
import { GroupBuyView } from './group-buy-view';

export const revalidate = 300;

const TITLE = 'Mua chung giá tốt — Tubu Tree';
const DESCRIPTION = 'Rủ thêm bạn cho đủ nhóm — đủ người, ai cũng nhận mã giảm giá khi mua chung trên Tubu Tree.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/mua-chung' },
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website' },
};

export default function GroupBuyPage() {
  return <GroupBuyView />;
}
