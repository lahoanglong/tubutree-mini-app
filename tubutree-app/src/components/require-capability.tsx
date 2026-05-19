/**
 * RequireCapability — Route-level guard.
 *
 * Fetch /api/me/capabilities lúc mount; nếu user thiếu capability cần thiết
 * → redirect về /profile với snackbar thông báo. Tránh hiển thị page rỗng
 * hoặc spinner mãi mãi cho user không có quyền.
 *
 * Usage:
 *   <RequireCapability require="affiliate"><AffiliateHubPage /></RequireCapability>
 *   <RequireCapability require="agent"><AgentHubPage /></RequireCapability>
 *   <RequireCapability require="admin"><AdminPage /></RequireCapability>
 *   <RequireCapability require="auth"><AnyAuthedPage /></RequireCapability>
 */
import React, { useEffect, useState } from "react";
import { Box, Spinner, Text, useSnackbar } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { meApi } from "services/api";
import type { MyCapabilities } from "types";

type Requirement = "auth" | "affiliate" | "agent" | "admin";

interface Props {
  require: Requirement;
  children: React.ReactNode;
}

const REQ_LABELS: Record<Requirement, string> = {
  auth: "đăng nhập",
  affiliate: "Cộng tác viên",
  agent: "Đại lý",
  admin: "Admin",
};

const RequireCapability: React.FC<Props> = ({ require, children }) => {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [state, setState] = useState<"loading" | "ok" | "denied">("loading");

  useEffect(() => {
    let cancelled = false;
    meApi.getCapabilities()
      .then(caps => {
        if (cancelled) return;
        const allowed = checkAllowed(caps, require);
        if (allowed) {
          setState("ok");
        } else {
          setState("denied");
          openSnackbar({
            text: `Tính năng dành cho ${REQ_LABELS[require]}.`,
            type: "error",
          });
          navigate("/profile", { replace: true });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setState("denied");
        openSnackbar({ text: "Vui lòng đăng nhập", type: "error" });
        navigate("/", { replace: true });
      });
    return () => { cancelled = true; };
  }, [require]);

  if (state === "loading") {
    return (
      <Box flex flexDirection="column" alignItems="center" justifyContent="center" style={{ padding: 60, minHeight: "60vh" }}>
        <Spinner visible />
        <Text style={{ marginTop: 12, color: "#888" }} size="small">Đang kiểm tra quyền…</Text>
      </Box>
    );
  }
  if (state === "denied") return null;
  return <>{children}</>;
};

function checkAllowed(caps: MyCapabilities, req: Requirement): boolean {
  if (caps.user.is_banned) return false;
  if (req === "auth") return true;
  if (req === "affiliate") return caps.user.affiliate_enabled;
  if (req === "agent") return caps.user.agent_enabled;
  if (req === "admin") return caps.user.is_admin;
  return false;
}

export default RequireCapability;
