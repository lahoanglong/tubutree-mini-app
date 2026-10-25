import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchLegalDoc, type LegalSlug } from '../services/legal-api';
import { usePublicConfig } from '../hooks/use-public-config';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { ErrorState } from './ui/empty-state';
import { Skeleton } from './ui/skeleton';
import { Text } from './ui/text';
import { LegalMarkdown } from './legal-markdown';
import { getErrorMessage } from '../services/api';

export const POLICY_TITLES: Record<LegalSlug, string> = {
  'dieu-khoan': 'Điều khoản sử dụng',
  'bao-mat': 'Chính sách bảo mật',
  'doi-tra': 'Chính sách đổi trả',
  'van-chuyen': 'Chính sách vận chuyển',
};

/** Bản tóm tắt dùng khi admin chưa nhập nội dung đã duyệt. */
function fallbackBody(slug: LegalSlug, returnWindowDays: unknown): string {
  switch (slug) {
    case 'dieu-khoan':
      return 'Khi sử dụng Tubu Tree, bạn đồng ý mua sắm đúng mục đích cá nhân, cung cấp thông tin chính xác và không lạm dụng ưu đãi/điểm thưởng. Tubu Tree có quyền tạm khoá tài khoản có dấu hiệu gian lận. Giá và khuyến mãi có thể thay đổi theo thời điểm; đơn hàng chỉ được xác nhận sau khi thanh toán/được duyệt.';
    case 'bao-mat':
      return 'Tubu Tree thu thập tên, số điện thoại và địa chỉ nhận hàng để xử lý đơn và chăm sóc khách hàng. Chúng tôi KHÔNG bán hay chia sẻ dữ liệu cho bên thứ ba ngoài đối tác vận chuyển/thanh toán cần thiết. Bạn có thể yêu cầu xoá tài khoản & dữ liệu bất kỳ lúc nào trong mục Tài khoản.';
    case 'doi-tra': {
      const days = typeof returnWindowDays === 'number' && Number.isFinite(returnWindowDays) && returnWindowDays > 0 ? returnWindowDays : null;
      const window = days ? `trong ${days} ngày kể từ khi nhận` : 'trong thời hạn đổi/trả kể từ khi nhận';
      return `Đổi/trả áp dụng ${window}, với sản phẩm lỗi nhà sản xuất (hỏng bao bì, sai HSD, sai mã, không đúng mô tả). Gửi yêu cầu kèm ảnh minh chứng trong chi tiết đơn hàng. Tubu chịu phí ship 2 chiều cho lỗi từ nhà sản xuất; hoàn tiền vào Ví Tubu hoặc tài khoản ngân hàng bạn chọn sau khi duyệt.`;
    }
    case 'van-chuyen':
      return 'Tubu Tree giao hàng toàn quốc qua đối tác vận chuyển. Phí và mức miễn phí vận chuyển hiển thị ở giỏ hàng trước khi bạn đặt. Bạn xem trạng thái và mã vận đơn trong mục Đơn hàng của tài khoản.';
  }
}

/** Chính sách hiện ngay trong app (popup), không mở trang ngoài. `slug` null = đóng. */
export function PolicySheet({ slug, onClose }: { slug: LegalSlug | null; onClose: () => void }) {
  // Giữ slug cuối để nội dung không biến mất trong lúc sheet trượt xuống.
  const [shown, setShown] = useState<LegalSlug>('dieu-khoan');
  useEffect(() => {
    if (slug) setShown(slug);
  }, [slug]);
  const active = slug ?? shown;
  const cfg = usePublicConfig();
  const q = useQuery({ queryKey: ['legal-doc', active], queryFn: () => fetchLegalDoc(active), enabled: slug !== null, staleTime: 10 * 60_000 });

  return (
    <BottomSheet
      open={slug !== null}
      onClose={onClose}
      title={POLICY_TITLES[active]}
      size="full"
      footer={
        <Button fullWidth onPress={onClose}>
          Đã hiểu
        </Button>
      }
    >
      {q.isLoading ? (
        <div data-testid="policy-loading" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <Skeleton height={14} />
          <Skeleton height={14} width="90%" />
          <Skeleton height={14} width="75%" />
        </div>
      ) : q.isError ? (
        <ErrorState variant="inline" message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data?.content ? (
        <LegalMarkdown source={q.data.content} />
      ) : (
        <Text variant="body-sm" tone="secondary" as="p">
          {fallbackBody(active, cfg.returnWindowDays)}
        </Text>
      )}
    </BottomSheet>
  );
}
