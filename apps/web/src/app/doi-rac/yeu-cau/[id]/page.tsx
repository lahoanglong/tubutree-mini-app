import { RecycleRequestDetail } from '@/components/recycle/recycle-request';

export default async function RecycleRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RecycleRequestDetail id={id} />;
}
