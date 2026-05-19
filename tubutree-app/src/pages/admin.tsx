// Admin Page — Duyệt đơn CTV/Đại lý, ban user, voucher/payout/agent-tier
import React, { useEffect, useState } from "react";
import { Box, Text, Button, Input, Tabs, useSnackbar, Modal } from "zmp-ui";
import { adminApi, voucherApi, payoutApi, agentPricingApi } from "services/api";
import KycImage from "components/kyc-image";
import type {
  AffiliateApplication, AgentApplication, AdminUserItem, AppStatus,
  Voucher, Payout, AgentTier,
} from "types";

const formatVnd = (s: string | number) => Number(s).toLocaleString() + " ₫";

/** Reusable reason-input modal — dùng cho ban, suspend, reject. */
interface ReasonModalProps {
  visible: boolean;
  title: string;
  placeholder?: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}
const ReasonModal: React.FC<ReasonModalProps> = ({ visible, title, placeholder, onConfirm, onClose }) => {
  const [val, setVal] = useState("");
  useEffect(() => { if (visible) setVal(""); }, [visible]);
  return (
    <Modal visible={visible} onClose={onClose} title={title}>
      <Box p={2}>
        <Input value={val} onChange={e => setVal(e.target.value)} placeholder={placeholder || "Lý do…"} />
        <Box mt={2} style={{ display: "flex", gap: 8 }}>
          <Button fullWidth variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button fullWidth onClick={() => { if (val.trim()) { onConfirm(val.trim()); onClose(); } }}>Xác nhận</Button>
        </Box>
      </Box>
    </Modal>
  );
};

/** Yes/No confirm modal. */
interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onClose: () => void;
}
const ConfirmModal: React.FC<ConfirmModalProps> = ({ visible, title, message, onConfirm, onClose }) => (
  <Modal visible={visible} onClose={onClose} title={title}>
    <Box p={2}>
      <Text size="small" style={{ marginBottom: 12 }}>{message}</Text>
      <Box style={{ display: "flex", gap: 8 }}>
        <Button fullWidth variant="secondary" onClick={onClose}>Huỷ</Button>
        <Button fullWidth onClick={() => { onConfirm(); onClose(); }}>Xác nhận</Button>
      </Box>
    </Box>
  </Modal>
);

type AnyApp = AffiliateApplication | AgentApplication;

const StatusBadge: React.FC<{ status: AppStatus }> = ({ status }) => {
  const map: Record<AppStatus, { c: string; bg: string }> = {
    PENDING:   { c: "#92400e", bg: "#fef3c7" },
    APPROVED:  { c: "#065f46", bg: "#d1fae5" },
    REJECTED:  { c: "#991b1b", bg: "#fee2e2" },
    SUSPENDED: { c: "#7f1d1d", bg: "#fecaca" },
  };
  const s = map[status];
  return <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, color: s.c, background: s.bg }}>{status}</span>;
};

const ApplicationTab: React.FC<{ kind: "affiliate" | "agent" }> = ({ kind }) => {
  const { openSnackbar } = useSnackbar();
  const [status, setStatus] = useState<AppStatus | "">("PENDING");
  const [items, setItems] = useState<AnyApp[]>([]);
  const [detail, setDetail] = useState<AnyApp | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = async () => {
    const params: any = { page: 1, limit: 50 };
    if (status) params.status = status;
    const r = await adminApi.listApplications(kind, params);
    setItems(r.data as AnyApp[]);
  };
  useEffect(() => { load(); }, [status]);

  const handleApprove = async (id: number) => {
    try { await adminApi.approve(kind, id); openSnackbar({ text: "Đã duyệt", type: "success" }); setDetail(null); load(); }
    catch (e: any) { openSnackbar({ text: e.response?.data?.error || e.message, type: "error" }); }
  };
  const handleReject = async (id: number) => {
    if (!rejectReason.trim()) { openSnackbar({ text: "Nhập lý do", type: "error" }); return; }
    try { await adminApi.reject(kind, id, rejectReason); openSnackbar({ text: "Đã từ chối", type: "success" }); setDetail(null); setRejectReason(""); load(); }
    catch (e: any) { openSnackbar({ text: e.response?.data?.error || e.message, type: "error" }); }
  };
  const [suspendModal, setSuspendModal] = useState<number | null>(null);
  const handleSuspend = (id: number) => setSuspendModal(id);
  const doSuspend = async (id: number, reason: string) => {
    try { await adminApi.suspend(kind, id, reason); openSnackbar({ text: "Đã tạm ngưng", type: "success" }); setDetail(null); load(); }
    catch (e: any) { openSnackbar({ text: e.response?.data?.error || e.message, type: "error" }); }
  };
  const handleRestore = async (id: number) => {
    try { await adminApi.restore(kind, id); openSnackbar({ text: "Đã khôi phục", type: "success" }); setDetail(null); load(); }
    catch (e: any) { openSnackbar({ text: e.response?.data?.error || e.message, type: "error" }); }
  };

  return (
    <Box>
      <Box style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {(["PENDING", "APPROVED", "REJECTED", "SUSPENDED", ""] as const).map(s => (
          <Button key={s || "ALL"} size="small"
                  variant={status === s ? "primary" : "secondary"}
                  onClick={() => setStatus(s as any)}>
            {s || "Tất cả"}
          </Button>
        ))}
      </Box>

      {items.length === 0 && <Text style={{ color: "#999" }}>Chưa có đơn nào.</Text>}

      {items.map(app => (
        <div key={app.id} style={{ background: "#fff", padding: 12, borderRadius: 10, marginBottom: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
             onClick={() => setDetail(app)}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Text size="small" bold>#{app.id} — User #{app.user_id}</Text>
            <StatusBadge status={app.status} />
          </div>
          <Text size="xSmall" style={{ color: "#666" }}>{new Date(app.submitted_at).toLocaleString()}</Text>
        </div>
      ))}

      <ReasonModal
        visible={suspendModal != null}
        title="Tạm ngưng"
        placeholder="Lý do tạm ngưng…"
        onConfirm={(r) => suspendModal != null && doSuspend(suspendModal, r)}
        onClose={() => setSuspendModal(null)}
      />

      <Modal visible={!!detail} onClose={() => setDetail(null)} title={`Đơn #${detail?.id}`}>
        {detail && (
          <Box p={2}>
            <Text size="small">User ID: {detail.user_id}</Text>
            <Text size="small">CCCD: {detail.cccd_number}</Text>
            <Text size="small">Bank: {detail.bank_name} — {detail.bank_account_no} ({detail.bank_account_name})</Text>
            {"warehouse_address" in detail && (
              <Text size="small">Kho: {(detail as AgentApplication).warehouse_address}</Text>
            )}
            {"expected_monthly_revenue" in detail && (
              <Text size="small">Doanh số dự kiến: {String((detail as AgentApplication).expected_monthly_revenue)} VND</Text>
            )}
            <Box mt={2}>
              <KycImage relativeUrl={detail.cccd_front_url} alt="CCCD"
                        style={{ width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 6 }} />
              {"cccd_back_url" in detail && (
                <KycImage relativeUrl={(detail as AgentApplication).cccd_back_url} alt="CCCD back"
                          style={{ width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 6, marginTop: 8 }} />
              )}
              {"selfie_url" in detail && (
                <KycImage relativeUrl={(detail as AgentApplication).selfie_url} alt="Selfie"
                          style={{ width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 6, marginTop: 8 }} />
              )}
            </Box>

            {detail.status === "PENDING" && (
              <Box mt={2}>
                <Input label="Lý do (nếu từ chối)" value={rejectReason}
                       onChange={e => setRejectReason(e.target.value)} />
                <Box mt={2} style={{ display: "flex", gap: 8 }}>
                  <Button fullWidth onClick={() => handleApprove(detail.id)}>Duyệt</Button>
                  <Button fullWidth variant="secondary" onClick={() => handleReject(detail.id)}>Từ chối</Button>
                </Box>
              </Box>
            )}
            {detail.status === "APPROVED" && (
              <Button fullWidth variant="secondary" onClick={() => handleSuspend(detail.id)} style={{ marginTop: 12 }}>
                Tạm ngưng
              </Button>
            )}
            {detail.status === "SUSPENDED" && (
              <Button fullWidth onClick={() => handleRestore(detail.id)} style={{ marginTop: 12 }}>
                Khôi phục
              </Button>
            )}
          </Box>
        )}
      </Modal>
    </Box>
  );
};

const UsersTab: React.FC = () => {
  const { openSnackbar } = useSnackbar();
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<AdminUserItem[]>([]);

  const load = async () => {
    const r = await adminApi.listUsers({ search: search || undefined, page: 1, limit: 30 });
    setUsers(r.data);
  };
  useEffect(() => { load(); }, []);

  const [banTarget, setBanTarget] = useState<AdminUserItem | null>(null);
  const handleBan = (u: AdminUserItem) => setBanTarget(u);
  const doBan = async (u: AdminUserItem, reason: string) => {
    try { await adminApi.banUser(u.id, reason); openSnackbar({ text: "Đã ban", type: "success" }); load(); }
    catch (e: any) { openSnackbar({ text: e.response?.data?.error || e.message, type: "error" }); }
  };
  const handleUnban = async (u: AdminUserItem) => {
    try { await adminApi.unbanUser(u.id); openSnackbar({ text: "Đã unban", type: "success" }); load(); }
    catch (e: any) { openSnackbar({ text: e.response?.data?.error || e.message, type: "error" }); }
  };

  return (
    <Box>
      <Box style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Input placeholder="Tìm theo tên/SĐT/Zalo UID" value={search} onChange={e => setSearch(e.target.value)} />
        <Button size="small" onClick={load}>Tìm</Button>
      </Box>

      {users.map(u => (
        <div key={u.id} style={{ background: "#fff", padding: 10, borderRadius: 10, marginBottom: 8 }}>
          <Text size="small" bold>{u.name || "(no name)"} — {u.phone || "(no phone)"}</Text>
          <Text size="xSmall" style={{ color: "#666" }}>
            Zalo UID: {u.zalo_uid}
            {u.affiliate_enabled && " · CTV"}
            {u.agent_enabled && " · Đại lý"}
            {u.is_admin && " · ADMIN"}
            {u.is_banned && " · ⛔ BANNED"}
          </Text>
          {u.ban_reason && (<Text size="xSmall" style={{ color: "#991b1b" }}>Reason: {u.ban_reason}</Text>)}
          <Box mt={1}>
            {u.is_banned
              ? <Button size="small" onClick={() => handleUnban(u)}>Unban</Button>
              : <Button size="small" variant="secondary" onClick={() => handleBan(u)}>Ban</Button>
            }
          </Box>
        </div>
      ))}

      <ReasonModal
        visible={banTarget != null}
        title={`Ban "${banTarget?.name || ""}"`}
        placeholder="Lý do ban…"
        onConfirm={(r) => banTarget && doBan(banTarget, r)}
        onClose={() => setBanTarget(null)}
      />
    </Box>
  );
};

// ============ PAYOUT ADMIN TAB ============
const PayoutsAdminTab: React.FC = () => {
  const { openSnackbar } = useSnackbar();
  const [status, setStatus] = useState<string>("PENDING");
  const [items, setItems] = useState<Payout[]>([]);
  const [rejectTarget, setRejectTarget] = useState<number | null>(null);
  const [completeTarget, setCompleteTarget] = useState<number | null>(null);

  const load = async () => {
    const params: any = { page: 1, limit: 50 };
    if (status) params.status = status;
    const r = await payoutApi.adminList(params);
    setItems(r.data);
  };
  useEffect(() => { load(); }, [status]);

  const handle = async (fn: () => Promise<any>, ok: string) => {
    try { await fn(); openSnackbar({ text: ok, type: "success" }); load(); }
    catch (e: any) { openSnackbar({ text: e.response?.data?.error || e.message, type: "error" }); }
  };

  return (
    <Box>
      <Box style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {(["PENDING", "APPROVED", "COMPLETED", "REJECTED", ""] as const).map(s => (
          <Button key={s || "ALL"} size="small"
                  variant={status === s ? "primary" : "secondary"}
                  onClick={() => setStatus(s)}>
            {s || "Tất cả"}
          </Button>
        ))}
      </Box>

      {items.length === 0 && <Text style={{ color: "#999" }}>Chưa có lệnh nào.</Text>}

      {items.map(p => (
        <div key={p.id} style={{ background: "#fff", padding: 12, borderRadius: 10, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Text size="small" bold>#{p.id} · User #{p.user_id} · {formatVnd(p.amount_vnd)}</Text>
            <Text size="xSmall" style={{ color: "#666" }}>{p.status}</Text>
          </div>
          <Text size="xSmall" style={{ color: "#666" }}>
            {p.bank_name} {p.bank_account_no} ({p.bank_account_name}) · {new Date(p.requested_at).toLocaleString()}
          </Text>
          {p.reject_reason && <Text size="xSmall" style={{ color: "#991b1b" }}>{p.reject_reason}</Text>}
          <Box mt={1} style={{ display: "flex", gap: 8 }}>
            {p.status === "PENDING" && (
              <>
                <Button size="small" onClick={() => handle(() => payoutApi.adminApprove(p.id), "Đã duyệt")}>Duyệt</Button>
                <Button size="small" variant="secondary" onClick={() => setRejectTarget(p.id)}>Từ chối</Button>
              </>
            )}
            {p.status === "APPROVED" && (
              <Button size="small" onClick={() => setCompleteTarget(p.id)}>Đã chuyển khoản</Button>
            )}
          </Box>
        </div>
      ))}

      <ReasonModal
        visible={rejectTarget != null}
        title="Từ chối payout"
        placeholder="Lý do từ chối…"
        onConfirm={(r) => rejectTarget != null && handle(() => payoutApi.adminReject(rejectTarget, r), "Đã từ chối")}
        onClose={() => setRejectTarget(null)}
      />
      <ConfirmModal
        visible={completeTarget != null}
        title="Xác nhận chuyển khoản"
        message="Bạn xác nhận đã chuyển khoản cho user?"
        onConfirm={() => completeTarget != null && handle(() => payoutApi.adminComplete(completeTarget), "Đã hoàn tất")}
        onClose={() => setCompleteTarget(null)}
      />
    </Box>
  );
};

// ============ VOUCHER ADMIN TAB ============
const VouchersAdminTab: React.FC = () => {
  const { openSnackbar } = useSnackbar();
  const [items, setItems] = useState<Voucher[]>([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({
    code: "", description: "", type: "PERCENT" as "PERCENT" | "FIXED",
    value: "10", min_order_vnd: "0", max_discount_vnd: "",
    valid_from: new Date().toISOString().slice(0, 10),
    valid_to: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    per_user_uses: "1", total_uses: "",
  });

  const load = async () => {
    const r = await voucherApi.adminList();
    setItems(r.data);
  };
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    try {
      await voucherApi.adminCreate({
        code: form.code.toUpperCase(),
        description: form.description,
        type: form.type,
        value: Number(form.value),
        min_order_vnd: form.min_order_vnd ? form.min_order_vnd : "0" as any,
        max_discount_vnd: form.max_discount_vnd ? (form.max_discount_vnd as any) : null,
        per_user_uses: Number(form.per_user_uses),
        total_uses: form.total_uses ? Number(form.total_uses) : null,
        valid_from: new Date(form.valid_from).toISOString(),
        valid_to: new Date(form.valid_to).toISOString(),
      });
      openSnackbar({ text: "Đã tạo voucher", type: "success" });
      setModal(false); load();
    } catch (e: any) {
      openSnackbar({ text: e.response?.data?.error || e.message, type: "error" });
    }
  };

  const [deactivateTarget, setDeactivateTarget] = useState<number | null>(null);
  const handleDeactivate = (id: number) => setDeactivateTarget(id);
  const doDeactivate = async (id: number) => {
    try { await voucherApi.adminDeactivate(id); openSnackbar({ text: "Đã tắt", type: "success" }); load(); }
    catch (e: any) { openSnackbar({ text: e.message, type: "error" }); }
  };

  return (
    <Box>
      <Button size="small" onClick={() => setModal(true)} style={{ marginBottom: 12 }}>+ Tạo voucher</Button>

      {items.map(v => (
        <div key={v.id} style={{ background: "#fff", padding: 12, borderRadius: 10, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Text size="small" bold style={{ fontFamily: "monospace" }}>{v.code}</Text>
            <Text size="xSmall" style={{ color: v.is_active ? "#065f46" : "#991b1b" }}>{v.is_active ? "ACTIVE" : "OFF"}</Text>
          </div>
          <Text size="xSmall">{v.description}</Text>
          <Text size="xSmall" style={{ color: "#666" }}>
            {v.type === "PERCENT" ? `${v.value}%${v.max_discount_vnd ? ` (max ${formatVnd(v.max_discount_vnd)})` : ""}` : formatVnd(v.value)}
            {" · "}Min {formatVnd(v.min_order_vnd)}
            {" · "}{v.used_count}/{v.total_uses ?? "∞"} lượt
          </Text>
          {v.is_active && <Button size="small" variant="secondary" onClick={() => handleDeactivate(v.id)} style={{ marginTop: 4 }}>Tắt</Button>}
        </div>
      ))}

      <ConfirmModal
        visible={deactivateTarget != null}
        title="Tắt voucher"
        message="Voucher này sẽ không dùng được nữa. Tiếp tục?"
        onConfirm={() => deactivateTarget != null && doDeactivate(deactivateTarget)}
        onClose={() => setDeactivateTarget(null)}
      />

      <Modal visible={modal} onClose={() => setModal(false)} title="Tạo voucher">
        <Box p={2}>
          <Input label="Code *" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="KM20" />
          <Input label="Mô tả *" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Giảm 20% tối đa 50k" />
          <Box style={{ display: "flex", gap: 8 }}>
            <Button size="small" variant={form.type === "PERCENT" ? "primary" : "secondary"} onClick={() => setForm({ ...form, type: "PERCENT" })}>%</Button>
            <Button size="small" variant={form.type === "FIXED" ? "primary" : "secondary"} onClick={() => setForm({ ...form, type: "FIXED" })}>Số tiền</Button>
          </Box>
          <Input label={form.type === "PERCENT" ? "% giảm" : "Số tiền giảm (VND)"} value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} />
          {form.type === "PERCENT" && (
            <Input label="Max discount (VND, để trống = không giới hạn)" value={form.max_discount_vnd} onChange={e => setForm({ ...form, max_discount_vnd: e.target.value.replace(/\D/g, "") })} />
          )}
          <Input label="Đơn tối thiểu (VND)" value={form.min_order_vnd} onChange={e => setForm({ ...form, min_order_vnd: e.target.value.replace(/\D/g, "") })} />
          <Input label="Mỗi user dùng tối đa" value={form.per_user_uses} onChange={e => setForm({ ...form, per_user_uses: e.target.value.replace(/\D/g, "") })} />
          <Input label="Tổng lượt (để trống = ∞)" value={form.total_uses} onChange={e => setForm({ ...form, total_uses: e.target.value.replace(/\D/g, "") })} />
          <Input label="Từ ngày" type="text" value={form.valid_from} onChange={e => setForm({ ...form, valid_from: e.target.value })} placeholder="YYYY-MM-DD" />
          <Input label="Đến ngày" type="text" value={form.valid_to} onChange={e => setForm({ ...form, valid_to: e.target.value })} placeholder="YYYY-MM-DD" />
          <Button fullWidth onClick={handleCreate} style={{ marginTop: 12 }}>Tạo</Button>
        </Box>
      </Modal>
    </Box>
  );
};

// ============ AGENT TIERS ADMIN TAB ============
const AgentTiersAdminTab: React.FC = () => {
  const { openSnackbar } = useSnackbar();
  const [tiers, setTiers] = useState<AgentTier[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);

  const load = async () => {
    const [t, p] = await Promise.all([
      agentPricingApi.listTiers(),
      agentPricingApi.listAgentProfiles(),
    ]);
    setTiers(t); setProfiles(p);
  };
  useEffect(() => { load(); }, []);

  const setTier = async (userId: number, tierId: number) => {
    try { await agentPricingApi.setAgentTier(userId, tierId); openSnackbar({ text: "Đã cập nhật tier", type: "success" }); load(); }
    catch (e: any) { openSnackbar({ text: e.message, type: "error" }); }
  };

  return (
    <Box>
      <Text bold>Các tier hiện có</Text>
      {tiers.map(t => (
        <div key={t.id} style={{ background: "#fff", padding: 10, borderRadius: 8, marginTop: 6 }}>
          <Text size="small" bold>{t.code} — {t.name}</Text>
          <Text size="xSmall" style={{ color: "#666" }}>
            Giảm {t.discount_pct}% · Min đơn {formatVnd(t.min_order_vnd)}
          </Text>
        </div>
      ))}

      <Box mt={3}>
        <Text bold>Đại lý hiện có</Text>
        {profiles.map(p => (
          <div key={p.user_id} style={{ background: "#fff", padding: 10, borderRadius: 8, marginTop: 6 }}>
            <Text size="small" bold>#{p.user_id} {p.user?.name}</Text>
            <Text size="xSmall" style={{ color: "#666" }}>{p.user?.phone} · Tier hiện tại: <b>{p.tier.code}</b></Text>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {tiers.map(t => (
                <Button key={t.id} size="small"
                        variant={p.tier_id === t.id ? "primary" : "secondary"}
                        onClick={() => setTier(p.user_id, t.id)}>
                  {t.code}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </Box>
    </Box>
  );
};

const AdminPage: React.FC = () => (
  <Box p={3}>
    <Text.Title>⚙️ Admin</Text.Title>
    <Tabs id="admin-tabs">
      <Tabs.Tab key="aff" label="Đơn CTV"><ApplicationTab kind="affiliate" /></Tabs.Tab>
      <Tabs.Tab key="agt" label="Đơn Đại lý"><ApplicationTab kind="agent" /></Tabs.Tab>
      <Tabs.Tab key="usr" label="Users"><UsersTab /></Tabs.Tab>
      <Tabs.Tab key="pay" label="Rút tiền"><PayoutsAdminTab /></Tabs.Tab>
      <Tabs.Tab key="vou" label="Voucher"><VouchersAdminTab /></Tabs.Tab>
      <Tabs.Tab key="tier" label="Tier ĐL"><AgentTiersAdminTab /></Tabs.Tab>
    </Tabs>
  </Box>
);

export default AdminPage;
