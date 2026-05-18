// Profile Page — Tài khoản
import React from "react";
import { Box, Text, Avatar } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { useRecoilValue } from "recoil";
import { userState } from "state/auth";

const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const user = useRecoilValue(userState);

  const menuItems = [
    { icon: "📋", label: "Đơn hàng của tôi", path: "/orders" },
    { icon: "📍", label: "Địa chỉ giao hàng", path: "/addresses" },
    { icon: "❤️", label: "Sản phẩm yêu thích", path: "/wishlist" },
    { icon: "🔔", label: "Thông báo", path: "/notifications" },
  ];

  return (
    <Box>
      {/* Profile Header */}
      <div className="profile-header">
        <img
          className="profile-header__avatar"
          src={user?.avatar || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 56 56'%3E%3Crect fill='%23a5d6a7' width='56' height='56' rx='28'/%3E%3Ctext x='50%25' y='55%25' text-anchor='middle' fill='%23fff' font-size='26'%3E👤%3C/text%3E%3C/svg%3E"}
          alt="Avatar"
        />
        <div>
          <div className="profile-header__name">{user?.name || "Khách"}</div>
          <div className="profile-header__phone">{user?.phone || "Chưa đăng nhập"}</div>
        </div>
      </div>

      {/* Menu */}
      <Box mt={2}>
        {menuItems.map((item, i) => (
          <div key={i} className="profile-menu__item" onClick={() => navigate(item.path)}>
            <span className="profile-menu__label">{item.icon} {item.label}</span>
            <span style={{ color: "#ccc" }}>›</span>
          </div>
        ))}
      </Box>

      {/* App Info */}
      <Box p={4} mt={4} style={{ textAlign: "center" }}>
        <Text size="xxSmall" style={{ color: "#bbb" }}>🌳 Tubu Tree v1.0.0</Text>
      </Box>
    </Box>
  );
};

export default ProfilePage;
