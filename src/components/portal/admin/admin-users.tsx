"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, ShieldCheck, UserCheck, Plus, Pencil, KeyRound, Eye, EyeOff } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/client";
import { Column, ConfirmDialog, DataTable, PageHeader, StatusBadge, fmtRelative } from "@/components/portal/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type UserRow = {
  id: string; email: string; name: string; role: string; status: string;
  totpEnabled: boolean; lastActiveAt: string | null; createdAt: string;
  tenantName: string | null; tenantPlan: string | null; workspaceRole: string | null;
};

export function AdminUsers() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "", email: "", password: "", role: "MEMBER", enforceTwoFactor: false,
  });

  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState({
    name: "", email: "", role: "MEMBER", status: "ACTIVE", enforceTwoFactor: false,
  });

  const [resetPasswordUser, setResetPasswordUser] = useState<UserRow | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "users", page, search],
    queryFn: () => apiGet<{ rows: UserRow[]; total: number; perPage: number }>(`/api/admin/users?page=${page}&perPage=10&q=${encodeURIComponent(search)}`),
  });

  const act = useMutation({
    mutationFn: (vars: { op: string; id: string; data?: Record<string, unknown> }) =>
      apiPost<{ ok: boolean; message: string }>("/api/admin/users", vars),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const columns: Column<UserRow>[] = [
    {
      key: "name", header: "User",
      render: (u) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{u.name}</p>
          <p className="truncate text-xs text-muted-foreground">{u.email}</p>
        </div>
      ),
    },
    {
      key: "role", header: "Role",
      render: (u) => (
        <span className="text-sm capitalize">
          {u.role === "PLATFORM_ADMIN" ? "Platform admin" : u.workspaceRole ? `${u.workspaceRole.toLowerCase()} · workspace` : "Member"}
        </span>
      ),
    },
    {
      key: "tenant", header: "Tenant",
      render: (u) => u.tenantName ? (
        <div className="min-w-0">
          <p className="truncate text-sm">{u.tenantName}</p>
          {u.tenantPlan && <StatusBadge status={u.tenantPlan} className="mt-0.5" />}
        </div>
      ) : <span className="text-sm text-muted-foreground">VOIRIA SASU (Docurama)</span>,
    },
    {
      key: "2fa", header: "2FA",
      render: (u) => u.totpEnabled
        ? <span className="inline-flex items-center gap-1 text-sm text-success"><ShieldCheck className="h-4 w-4" aria-hidden /> Enabled</span>
        : <span className="text-sm text-muted-foreground">Not set</span>,
    },
    { key: "status", header: "Status", render: (u) => <StatusBadge status={u.status} /> },
    { key: "active", header: "Last active", render: (u) => <span className="text-sm text-muted-foreground">{fmtRelative(u.lastActiveAt)}</span> },
    {
      key: "actions", header: <span className="sr-only">Actions</span>, className: "w-36",
      render: (u) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 text-muted-foreground hover:text-foreground"
            aria-label={`Edit ${u.name}`}
            title="Edit user details"
            onClick={() => {
              setEditUser(u);
              setEditForm({
                name: u.name,
                email: u.email,
                role: u.role,
                status: u.status,
                enforceTwoFactor: u.totpEnabled,
              });
            }}
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 text-muted-foreground hover:text-foreground"
            aria-label={`Reset password for ${u.name}`}
            title="Reset password"
            onClick={() => {
              setResetPasswordUser(u);
              setResetPasswordValue("");
              setShowPassword(false);
            }}
          >
            <KeyRound className="h-4 w-4" aria-hidden />
          </Button>

          {!u.totpEnabled && u.role !== "PLATFORM_ADMIN" && (
            <Button
              variant="ghost" size="icon" className="h-11 w-11" aria-label={`Enforce two-factor for ${u.name}`}
              title="Enforce two-factor authentication"
              onClick={() => act.mutate({ op: "force-2fa", id: u.id })}
            >
              <ShieldCheck className="h-4 w-4" aria-hidden />
            </Button>
          )}

          {u.role !== "PLATFORM_ADMIN" && (
            u.status === "ACTIVE" ? (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon" className="h-11 w-11 text-destructive" aria-label={`Deactivate ${u.name}`} title="Deactivate">
                    <Ban className="h-4 w-4" aria-hidden />
                  </Button>
                }
                title={`Deactivate ${u.name}?`}
                description="The user is signed out everywhere and cannot sign in until reactivated. Their documents and memberships are preserved."
                confirmLabel="Deactivate user"
                onConfirm={() => act.mutateAsync({ op: "toggle-status", id: u.id })}
              />
            ) : (
              <Button
                variant="ghost" size="icon" className="h-11 w-11 text-success" aria-label={`Reactivate ${u.name}`} title="Reactivate"
                onClick={() => act.mutate({ op: "toggle-status", id: u.id })}
              >
                <UserCheck className="h-4 w-4" aria-hidden />
              </Button>
            )
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Platform-wide directory. Create users, edit profiles, reset credentials, enforce 2FA and audit activity - every action lands in the audit chain."
        actions={
          <Button
            className="h-11 gap-1.5"
            onClick={() => {
              setCreateForm({ name: "", email: "", password: "", role: "MEMBER", enforceTwoFactor: false });
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden /> Create User
          </Button>
        }
      />
      <DataTable<UserRow>
        ariaLabel="User directory"
        columns={columns}
        rows={data?.rows ?? []}
        total={data?.total}
        page={page}
        perPage={data?.perPage ?? 10}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onPageChange={setPage}
        onSearch={(q) => { setSearch(q); setPage(1); }}
        searchPlaceholder="Search by name, email or tenant…"
        onRetry={() => refetch()}
        emptyTitle="No users match your search"
        emptyDescription="Try a different name, email or tenant."
      />

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create User Account</DialogTitle>
            <DialogDescription>
              Create a new platform or workspace user. The password must be at least 8 characters.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cu-name">Full Name</Label>
              <Input
                id="cu-name"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="Jane Doe"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cu-email">Email Address</Label>
              <Input
                id="cu-email"
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                placeholder="jane.doe@example.com"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cu-pass">Initial Password</Label>
              <Input
                id="cu-pass"
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                placeholder="Minimum 8 characters"
                className="h-10"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cu-role">Role</Label>
              <select
                id="cu-role"
                value={createForm.role}
                onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="MEMBER">Member</option>
                <option value="PLATFORM_ADMIN">Platform Admin</option>
              </select>
            </div>
            <label className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm font-medium">Enforce Two-Factor Authentication</span>
              <Switch
                checked={createForm.enforceTwoFactor}
                onCheckedChange={(v) => setCreateForm({ ...createForm, enforceTwoFactor: v })}
              />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                act.mutate({ op: "create", id: "", data: createForm });
                setCreateOpen(false);
              }}
              disabled={act.isPending || !createForm.name.trim() || !createForm.email.trim() || createForm.password.length < 8}
            >
              Create User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!editUser} onOpenChange={(v) => !v && setEditUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User Profile</DialogTitle>
            <DialogDescription>
              Update user contact details, platform role, or account status.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="eu-name">Full Name</Label>
              <Input
                id="eu-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eu-email">Email Address</Label>
              <Input
                id="eu-email"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eu-role">Platform Role</Label>
              <select
                id="eu-role"
                value={editForm.role}
                onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="MEMBER">Member</option>
                <option value="PLATFORM_ADMIN">Platform Admin</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eu-status">Account Status</Label>
              <select
                id="eu-status"
                value={editForm.status}
                onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
                <option value="SUSPENDED">SUSPENDED</option>
              </select>
            </div>
            <label className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm font-medium">Two-Factor Authentication Enforced</span>
              <Switch
                checked={editForm.enforceTwoFactor}
                onCheckedChange={(v) => setEditForm({ ...editForm, enforceTwoFactor: v })}
              />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (editUser) {
                  act.mutate({ op: "update", id: editUser.id, data: editForm });
                }
                setEditUser(null);
              }}
              disabled={act.isPending || !editForm.name.trim() || !editForm.email.trim()}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetPasswordUser} onOpenChange={(v) => !v && setResetPasswordUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password - {resetPasswordUser?.name}</DialogTitle>
            <DialogDescription>
              Set a new secure password for {resetPasswordUser?.email}. The user will be required to authenticate with this password on their next login.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="rp-pass">New Password</Label>
              <div className="relative">
                <Input
                  id="rp-pass"
                  type={showPassword ? "text" : "password"}
                  value={resetPasswordValue}
                  onChange={(e) => setResetPasswordValue(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="h-10 pr-10"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => {
                const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
                const generated = Array.from({ length: 14 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
                setResetPasswordValue(generated);
                setShowPassword(true);
              }}
            >
              Generate Strong Password
            </Button>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPasswordUser(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (resetPasswordUser) {
                  act.mutate({ op: "reset-password", id: resetPasswordUser.id, data: { newPassword: resetPasswordValue } });
                }
                setResetPasswordUser(null);
              }}
              disabled={act.isPending || resetPasswordValue.length < 8}
            >
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
