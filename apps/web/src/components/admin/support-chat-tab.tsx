'use client';

import { useState } from 'react';
import { SideDrawer, useNarrowScreen } from './side-drawer';
import { BridgeCard } from './support-chat/bridge-card';
import { ConversationDetail } from './support-chat/conversation-detail';
import { ConversationList } from './support-chat/conversation-list';

/** Chiều rộng từ đó hai cột (danh sách | tin) có chỗ: trùng điểm gãy `lg` của lưới bên dưới. */
const TWO_COLUMN_PX = 1024;

/**
 * Chat CSKH: kết nối cầu nối Zalo (chỉ ADMIN điều khiển) và hội thoại với khách (ADMIN + nhân viên CSKH). Khổ hẹp thu thẻ
 * cầu nối thành một dòng trạng thái và mở hội thoại trong ngăn kéo toàn màn, để tin không nằm dưới cả danh sách.
 */
export function SupportChatTab({ isAdmin }: { isAdmin: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const narrow = useNarrowScreen(TWO_COLUMN_PX);
  return (
    <div className={narrow ? 'space-y-3' : 'space-y-6'}>
      <BridgeCard isAdmin={isAdmin} compact={narrow} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
        <ConversationList selectedId={selected} onSelect={setSelected} />
        {narrow ? (
          selected && (
            <SideDrawer title="Hội thoại với khách" onClose={() => setSelected(null)}>
              <ConversationDetail key={selected} id={selected} />
            </SideDrawer>
          )
        ) : selected ? (
          <ConversationDetail key={selected} id={selected} />
        ) : (
          <p className="text-sm text-stone-500">Chọn một hội thoại để xem tin.</p>
        )}
      </div>
    </div>
  );
}
