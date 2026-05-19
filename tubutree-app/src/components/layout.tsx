// Layout — Bottom Navigation + Routes
import React from "react";
import { AnimationRoutes, BottomNavigation, Page } from "zmp-ui";
import { Route } from "react-router-dom";
import { useRecoilValue } from "recoil";
import { cartCountState } from "state/cart";

// Pages
import HomePage from "pages/home";
import ProductDetailPage from "pages/product-detail";
import CartPage from "pages/cart";
import CheckoutPage from "pages/checkout";
import OrdersPage from "pages/orders";
import OrderDetailPage from "pages/order-detail";
import ProfilePage from "pages/profile";
import AddressesPage from "pages/addresses";
import WishlistPage from "pages/wishlist";
import NotificationsPage from "pages/notifications";
import MyCapabilitiesPage from "pages/my-capabilities";
import BecomeAffiliatePage from "pages/become-affiliate";
import BecomeAgentPage from "pages/become-agent";
import AdminPage from "pages/admin";
import PointsPage from "pages/points";
import AffiliateHubPage from "pages/affiliate-hub";
import AgentHubPage from "pages/agent-hub";
import WalletPayoutPage from "pages/wallet-payout";
import VouchersPage from "pages/vouchers";
import RequireCapability from "./require-capability";

const Layout: React.FC = () => {
  const cartCount = useRecoilValue(cartCountState);

  return (
    <Page className="page-container" hideScrollbar>
      <AnimationRoutes>
        <Route path="/" element={<HomePage />} />
        <Route path="/product/:id" element={<ProductDetailPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/order/:id" element={<OrderDetailPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/addresses" element={<AddressesPage />} />
        <Route path="/wishlist" element={<WishlistPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/my-capabilities" element={<RequireCapability require="auth"><MyCapabilitiesPage /></RequireCapability>} />
        <Route path="/become-affiliate" element={<RequireCapability require="auth"><BecomeAffiliatePage /></RequireCapability>} />
        <Route path="/become-agent" element={<RequireCapability require="auth"><BecomeAgentPage /></RequireCapability>} />
        <Route path="/admin" element={<RequireCapability require="admin"><AdminPage /></RequireCapability>} />
        <Route path="/points" element={<RequireCapability require="auth"><PointsPage /></RequireCapability>} />
        <Route path="/affiliate-hub" element={<RequireCapability require="affiliate"><AffiliateHubPage /></RequireCapability>} />
        <Route path="/agent-hub" element={<RequireCapability require="agent"><AgentHubPage /></RequireCapability>} />
        <Route path="/wallet" element={<RequireCapability require="affiliate"><WalletPayoutPage /></RequireCapability>} />
        <Route path="/vouchers" element={<RequireCapability require="auth"><VouchersPage /></RequireCapability>} />
      </AnimationRoutes>

      <BottomNavigation fixed>
        <BottomNavigation.Item
          key="home"
          label="Trang chủ"
          icon={<IconHome />}
          activeIcon={<IconHome active />}
          linkTo="/"
        />
        <BottomNavigation.Item
          key="orders"
          label="Đơn hàng"
          icon={<IconOrder />}
          activeIcon={<IconOrder active />}
          linkTo="/orders"
        />
        <BottomNavigation.Item
          key="cart"
          label="Giỏ hàng"
          icon={<IconCart count={cartCount} />}
          activeIcon={<IconCart count={cartCount} active />}
          linkTo="/cart"
        />
        <BottomNavigation.Item
          key="profile"
          label="Tài khoản"
          icon={<IconProfile />}
          activeIcon={<IconProfile active />}
          linkTo="/profile"
        />
      </BottomNavigation>
    </Page>
  );
};

// === Simple SVG Icons ===

const IconHome = ({ active }: { active?: boolean }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path
      d="M3 12L5 10M5 10L12 3L19 10M5 10V20C5 20.55 5.45 21 6 21H9M19 10L21 12M19 10V20C19 20.55 18.55 21 18 21H15M9 21C9.55 21 10 20.55 10 20V16C10 15.45 10.45 15 11 15H13C13.55 15 14 15.45 14 16V20C14 20.55 14.45 21 15 21M9 21H15"
      stroke={active ? "#2E7D32" : "#999"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
);

const IconOrder = ({ active }: { active?: boolean }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path
      d="M9 5H7C5.89543 5 5 5.89543 5 7V19C5 20.1046 5.89543 21 7 21H17C18.1046 21 19 20.1046 19 19V7C19 5.89543 18.1046 5 17 5H15M9 5C9 6.10457 9.89543 7 11 7H13C14.1046 7 15 6.10457 15 5M9 5C9 3.89543 9.89543 3 11 3H13C14.1046 3 15 3.89543 15 5M12 12H15M12 16H15M9 12H9.01M9 16H9.01"
      stroke={active ? "#2E7D32" : "#999"} strokeWidth="2" strokeLinecap="round"
    />
  </svg>
);

const IconCart = ({ active, count }: { active?: boolean; count: number }) => (
  <div style={{ position: "relative" }}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 3H5L5.4 5M7 13H17L21 5H5.4M7 13L5.4 5M7 13L4.707 15.293C4.077 15.923 4.523 17 5.414 17H17M17 17C15.895 17 15 17.895 15 19C15 20.105 15.895 21 17 21C18.105 21 19 20.105 19 19C19 17.895 18.105 17 17 17ZM9 19C9 20.105 8.105 21 7 21C5.895 21 5 20.105 5 19C5 17.895 5.895 17 7 17C8.105 17 9 17.895 9 19Z"
        stroke={active ? "#2E7D32" : "#999"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
    {count > 0 && (
      <span style={{
        position: "absolute", top: -6, right: -8,
        background: "#F44336", color: "#fff", fontSize: 10,
        borderRadius: 10, padding: "1px 5px", fontWeight: 700,
      }}>
        {count > 99 ? "99+" : count}
      </span>
    )}
  </div>
);

const IconProfile = ({ active }: { active?: boolean }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path
      d="M16 7C16 9.20914 14.2091 11 12 11C9.79086 11 8 9.20914 8 7C8 4.79086 9.79086 3 12 3C14.2091 3 16 4.79086 16 7ZM12 14C8.13401 14 5 17.134 5 21H19C19 17.134 15.866 14 12 14Z"
      stroke={active ? "#2E7D32" : "#999"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
);

export default Layout;
