import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Input, useSnackbar } from 'zmp-ui';
import { updateStorefront, type StorefrontEdit } from '../../services/storefront-api';
import { getErrorMessage, isStaleStateError, isTargetGoneError } from '../../services/api';
import { haptic } from '../../utils/haptic';
import { settleWithin } from '../../utils/settle-within';
import { vi } from '../../i18n/vi';
import { useUploadBusy } from '../../hooks/use-upload-busy';
import { useLockedMutation } from '../game/use-locked-mutation';
import { Button } from '../ui/button';
import { Text } from '../ui/text';
import { ImageUpload } from '../image-upload';
import { SCROLL_BODY } from './shared';

/**
 * Hồ sơ gian hàng: ảnh đại diện, ảnh bìa, lời nhắn. Ba trường này quyết định nhiệm vụ
 * "Hoàn thiện hồ sơ gian hàng" nhưng trước đây không có màn nào nhập được.
 */
export function ProfileSheet({
  sf,
  onClose,
  onSaved,
}: {
  sf: StorefrontEdit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [avatarUrl, setAvatarUrl] = useState(sf.avatarUrl ?? '');
  const [coverUrl, setCoverUrl] = useState(sf.coverUrl ?? '');
  const [headerNote, setHeaderNote] = useState(sf.headerNote ?? '');
  // Lưu lúc ảnh còn đang lên sẽ gửi ảnh cũ (hoặc rỗng) rồi đóng form, ảnh mới về sau bị bỏ.
  const { busy: imagesBusy, onBusyChange } = useUploadBusy();

  const saveMut = useLockedMutation({
    mutationFn: () =>
      // Gửi chuỗi RỖNG (không phải undefined) khi CTV chủ động xoá: undefined bị PATCH bỏ qua,
      // nên trước đây xoá ảnh bìa rồi bấm Lưu là snackbar báo thành công mà ảnh cũ vẫn còn trên
      // gian hàng công khai, thử lại bao nhiêu lần cũng vậy.
      updateStorefront({
        avatarUrl: avatarUrl.trim(),
        coverUrl: coverUrl.trim(),
        headerNote: headerNote.trim(),
      }),
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: vi.storefront.profileSaved, type: 'success' });
      onSaved();
      // Lệnh báo xong muộn sau khi khách đóng tấm rồi mở lại: TanStack vẫn chạy onSuccess của tấm cũ, `onClose` của cha sẽ đóng nhầm tấm mới. `onSaved` chỉ tải lại nên luôn chạy.
      if (mounted.current) onClose();
    },
    // Máy chủ từ chối vì gian hàng không còn khớp (vd 404 "Chưa có gian hàng"): tải lại gian hàng rồi mới nhả khoá, không thì bấm Lưu lại nhận đúng lỗi đó
    // trên dữ liệu cũ. Lần tải lại cũng 404 thì TanStack giữ dữ liệu cũ nên màn Gian hàng chưa tự đổi; việc đó thuộc màn Gian hàng, không xử lý ở đây.
    // Mất mạng, quá hạn, 401, 5xx không nói gì về gian hàng thật: nhả ngay để thử lại.
    onError: (e) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      const held = isStaleStateError(e) ? settleWithin(queryClient.invalidateQueries({ queryKey: ['my-storefront'] })) : undefined;
      // Tấm có ô nhập: chỉ đóng khi gian hàng không còn hoặc vừa đổi (404/409); 400/422 là lỗi ở chính ô nhập, giữ tấm để sửa.
      // Khoá nằm trong tấm nên đóng tấm là gỡ luôn khoá: đóng sau khi dữ liệu mới về (hoặc quá `settleWithin`), lúc khoá cũng vừa nhả.
      if (!isTargetGoneError(e)) return held;
      // Khách có thể đóng tấm rồi mở lại trong lúc chờ (tấm mới, khoá mới): TanStack vẫn chạy onError sau khi tấm cũ gỡ, chỉ báo đóng khi chính tấm này còn gắn.
      return (held ?? Promise.resolve()).then(() => {
        if (mounted.current) onClose();
      });
    },
  });

  const complete = !!(avatarUrl.trim() && coverUrl.trim() && headerNote.trim());

  return (
    <div style={SCROLL_BODY}>
      {/* Ảnh đại diện nhỏ nên nén mạnh hơn ảnh bìa — cả hai đi kèm mọi lượt xem gian hàng. */}
      <ImageUpload label={vi.storefront.avatar} value={avatarUrl} onChange={setAvatarUrl} onBusyChange={onBusyChange} disabled={saveMut.isPending} maxDim={400} quality={0.8} />
      <ImageUpload label={vi.storefront.cover} value={coverUrl} onChange={setCoverUrl} onBusyChange={onBusyChange} disabled={saveMut.isPending} maxDim={1000} quality={0.75} />

      <Text variant="label" as="div" style={{ marginBottom: 4 }}>{vi.storefront.headerNote}</Text>
      <Input.TextArea
        aria-label={vi.storefront.headerNote}
        value={headerNote}
        maxLength={200}
        placeholder={vi.storefront.headerNotePlaceholder}
        onChange={(e) => setHeaderNote(e.target.value)}
      />
      <Text variant="label" tone="tertiary" as="div" style={{ marginTop: 4 }}>
        {headerNote.length}/200
      </Text>

      {!complete && (
        <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 10 }}>
          Đủ cả ba mục sẽ hoàn thành nhiệm vụ “{vi.storefront.profileTitle.toLowerCase()}”.
        </Text>
      )}

      <Button
        fullWidth
        loading={saveMut.isPending}
        disabled={imagesBusy}
        onPress={() => {
          if (imagesBusy) return;
          saveMut.mutate();
        }}
        style={{ marginTop: 16 }}
      >
        {imagesBusy ? vi.common.imagesUploading : 'Lưu hồ sơ'}
      </Button>
      <Button fullWidth variant="secondary" style={{ marginTop: 8 }} onPress={onClose}>
        Đóng
      </Button>
    </div>
  );
}
