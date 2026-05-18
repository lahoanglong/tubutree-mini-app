// Orders Page — Lịch sử đơn hàng
import React, { useEffect, useState } from "react";
import { Box, Text, Spinner } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { orderApi } from "services/api";
import { formatDate, getOrderStatusText, getOrderStatusColor } from "utils/format";
import type { OrderRef } from "types";

const OrdersPage: React.FC = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => { loadOrders(); }, []);

  const loadOrders = async () => {
    try {
      const data = await orderApi.getAll();
      setOrders(data);
    } catch { setOrders([]); }
    finally { setLoading(false); }
  };

  const statuses = [null, "PENDING", "WAITING_PAYMENT", "COMPLETED", "CANCELLED"];
  const statusLabels = ["Tất cả", "Chờ xác nhận", "Chờ thanh toán", "Hoàn thành", "Đã hủy"];

  const filteredOrders = filter ? orders.filter(o => o.payment_status === filter) : orders;

  if (loading) {
    return <Box flex alignItems="center" justifyContent="center" style={{ padding: 60 }}><Spinner visible /></Box>;
  }

  return (
    <Box>
      <div className="section-header">
        <span className="section-header__title">Đơn hàng của tôi</span>
      </div>

      <div className="category-tabs">
        {statuses.map((s, i) => (
          <div key={i} className={`category-tabs__item ${filter === s ? 'category-tabs__item--active' : ''}`} onClick={() => setFilter(s)}>
            {statusLabels[i]}
          </div>
        ))}
      </div>

      {filteredOrders.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">📋</div>
          <div className="empty-state__title">Chưa có đơn hàng</div>
          <div className="empty-state__desc">Đơn hàng của bạn sẽ hiển thị ở đây</div>
        </div>
      ) : (
        filteredOrders.map(order => (
          <div key={order.id} className="order-card" onClick={() => navigate(`/order/${order.pos_order_id}`)}>
            <div className="order-card__header">
              <span className="order-card__id">#{order.pos_order_id}</span>
              <span className="order-card__status" style={{ background: getOrderStatusColor(order.payment_status) }}>
                {getOrderStatusText(order.payment_status)}
              </span>
            </div>
            <div className="order-card__date">📅 {formatDate(order.created_at)}</div>
            <div className="order-card__payment">💳 {order.payment_method}</div>
          </div>
        ))
      )}
    </Box>
  );
};

export default OrdersPage;
