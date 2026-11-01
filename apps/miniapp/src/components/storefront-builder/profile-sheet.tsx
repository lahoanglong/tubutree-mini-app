import { useState } from 'react';
import { Input, useSnackbar } from 'zmp-ui';
import { useMutation } from '@tanstack/react-query';
import { updateStorefront, type StorefrontEdit } from '../../services/storefront-api';
import { getErrorMessage } from '../../services/api';
import { haptic } from '../../utils/haptic';
import { vi } from '../../i18n/vi';
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
  const [avatarUrl, setAvatarUrl] = useState(sf.avatarUrl ?? '');
  const [coverUrl, setCoverUrl] = useState(sf.coverUrl ?? '');
  const [headerNote, setHeaderNote] = useState(sf.headerNote ?? '');

  const saveMut = useMutation({
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
      onClose();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const complete = !!(avatarUrl.trim() && coverUrl.trim() && headerNote.trim());

  return (
    <div style={SCROLL_BODY}>
      {/* Ảnh đại diện nhỏ nên nén mạnh hơn ảnh bìa — cả hai đi kèm mọi lượt xem gian hàng. */}
      <ImageUpload label={vi.storefront.avatar} value={avatarUrl} onChange={setAvatarUrl} maxDim={400} quality={0.8} />
      <ImageUpload label={vi.storefront.cover} value={coverUrl} onChange={setCoverUrl} maxDim={1000} quality={0.75} />

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

      <Button fullWidth loading={saveMut.isPending} onPress={() => saveMut.mutate()} style={{ marginTop: 16 }}>
        Lưu hồ sơ
      </Button>
      <Button fullWidth variant="secondary" style={{ marginTop: 8 }} onPress={onClose}>
        Đóng
      </Button>
    </div>
  );
}
