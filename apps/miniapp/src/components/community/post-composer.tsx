import { Box, Sheet, Text } from 'zmp-ui';
import type { FeedCategory } from '../../services/feed-api';

export default function PostComposer({ visible, onClose }: { visible: boolean; onClose: () => void; categories: FeedCategory[]; onPosted: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} autoHeight>
      <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
        <Text>Trình soạn bài đang hoàn thiện…</Text>
      </Box>
    </Sheet>
  );
}
