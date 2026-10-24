'use client';

import { useState } from 'react';
import { BridgeCard } from './support-chat/bridge-card';
import { ConversationDetail } from './support-chat/conversation-detail';
import { ConversationList } from './support-chat/conversation-list';

/** Chat CSKH: kết nối cầu nối Zalo (chỉ ADMIN điều khiển) và hội thoại với khách (ADMIN + nhân viên CSKH). */
export function SupportChatTab({ isAdmin }: { isAdmin: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <BridgeCard isAdmin={isAdmin} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
        <ConversationList selectedId={selected} onSelect={setSelected} />
        {selected ? <ConversationDetail key={selected} id={selected} /> : <p className="text-sm text-stone-500">Chọn một hội thoại để xem tin.</p>}
      </div>
    </div>
  );
}
