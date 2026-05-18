// Notifications Page — Thông báo
import React, { useEffect, useState } from "react";
import { Box, Text, Spinner, useSnackbar } from "zmp-ui";
import { notificationApi } from "services/api";
import { formatDateTime } from "utils/format";
import type { Notification } from "types";

const NotificationsPage: React.FC = () => {
  const { openSnackbar } = useSnackbar();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadNotifications(); }, []);

  const loadNotifications = async () => {
    try {
      const data = await notificationApi.getAll();
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch { }
    finally { setLoading(false); }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationApi.markAllRead();
      openSnackbar({ text: "Đã đánh dấu tất cả đã đọc", type: "success" });
      loadNotifications();
    } catch { }
  };

  const handleMarkRead = async (id: number) => {
    try {
      await notificationApi.markRead(id);
      loadNotifications();
    } catch { }
  };

  if (loading) return <Box flex alignItems="center" justifyContent="center" style={{ padding: 60 }}><Spinner visible /></Box>;

  return (
    <Box>
      <div className="section-header">
        <span className="section-header__title">Thông báo {unreadCount > 0 && `(${unreadCount} mới)`}</span>
        {unreadCount > 0 && <span className="section-header__more" onClick={handleMarkAllRead}>Đọc tất cả</span>}
      </div>

      {notifications.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">🔔</div>
          <div className="empty-state__title">Không có thông báo</div>
          <div className="empty-state__desc">Thông báo đơn hàng sẽ hiển thị ở đây</div>
        </div>
      ) : (
        notifications.map(notif => (
          <Box
            key={notif.id}
            p={4}
            onClick={() => !notif.is_read && handleMarkRead(notif.id)}
            style={{
              background: notif.is_read ? "#fff" : "#E8F5E9",
              borderBottom: "1px solid #f0f0f0",
              cursor: "pointer",
            }}
          >
            <Box flex justifyContent="space-between" alignItems="center">
              <Text bold size="small">{notif.title}</Text>
              {!notif.is_read && <span style={{ width: 8, height: 8, borderRadius: 4, background: "#2E7D32" }} />}
            </Box>
            <Text size="xSmall" style={{ color: "#666", marginTop: 4 }}>{notif.body}</Text>
            <Text size="xxSmall" style={{ color: "#bbb", marginTop: 6 }}>{formatDateTime(notif.created_at)}</Text>
          </Box>
        ))
      )}
    </Box>
  );
};

export default NotificationsPage;
