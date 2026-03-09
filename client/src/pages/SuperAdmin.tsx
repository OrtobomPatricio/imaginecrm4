import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { PermissionGuard } from "@/components/PermissionGuard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Building2,
  Users,
  MessageCircle,
  BarChart3,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Crown,
  Loader2,
  RefreshCw,
  UserCog,
  Pause,
  Play,
  ArrowUpCircle,
  ChevronDown,
  ChevronUp,
  Hash,
  Globe,
  CalendarDays,
  Phone,
  Target,
  Zap,
  Flag,
  Eye,
  LogIn,
  Copy,
  // User, Mail — unused
  Settings2,
  Layers,
  Bot,
  Lock,
  Code,
  FileDown,
  ClipboardCheck,
  Activity,
  Database,
  HardDrive,
  Wifi,
  WifiOff,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  TrendingUp,
  KeyRound,
  Timer,
  // ToggleLeft — unused
  ServerCrash,
  Inbox,
  Workflow,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  UserX,
  UserCheck,
  Megaphone,
  StickyNote,
  DollarSign,
  Trash2,
  Plus,
  Monitor,
  LogOut,
  CheckSquare,
  Square,
  Bell,
  // BellRing — unused
  Archive,
  Edit,
  SearchCode,
  Sliders,
  Save,
  MailIcon,
  // ServerIcon, ShieldQuestion, UserMinus — unused
  type LucideIcon,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

/* ─── helpers ─── */
function fmtDate(d: string | Date | null) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(d: string | Date | null) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function downloadCSV(rows: any[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => {
      const val = String(r[h] ?? "").replace(/"/g, '""');
      return `"${val}"`;
    }).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function UsageBar({ label, current, limit, icon: Icon }: { label: string; current: number; limit: number; icon: LucideIcon }) {
  const pct = limit > 0 ? Math.min((current / limit) * 100, 100) : 0;
  const isUnlimited = limit >= 999999;
  const color = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-green-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Icon className="w-3 h-3" /> {label}
        </span>
        <span className="font-medium">
          {current.toLocaleString()} / {isUnlimited ? "∞" : limit.toLocaleString()}
        </span>
      </div>
      <div className="w-full bg-muted rounded-full h-2">
        <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${isUnlimited ? Math.min(pct, 5) : pct}%` }} />
      </div>
      {!isUnlimited && pct >= 90 && (
        <p className="text-[10px] text-red-500 font-medium">⚠ {Math.round(pct)}% del límite</p>
      )}
    </div>
  );
}

const PLAN_COLORS: Record<string, string> = {
  free: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  starter: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  pro: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300",
  enterprise: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  suspended: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  canceled: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  admin: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300",
  supervisor: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  agent: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  viewer: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const FLAG_CATEGORY_ICONS: Record<string, any> = {
  Channels: Phone,
  Modules: Layers,
  Analytics: BarChart3,
  AI: Bot,
  Data: ClipboardCheck,
  Developer: Code,
  Enterprise: Building2,
  Security: Lock,
  GDPR: FileDown,
};

/* ─── KPI Card ─── */
function KpiCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <Card className="relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-1 ${color}`} />
      <CardContent className="pt-6 pb-4 px-5">
        <div className="flex items-center gap-3 mb-2">
          <div className={`p-2 rounded-lg ${color}/10`}>
            <Icon className="w-5 h-5 text-muted-foreground" />
          </div>
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {label}
          </span>
        </div>
        <p className="text-3xl font-extrabold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

/* ─── Change Plan Dialog ─── */
function ChangePlanDialog({
  tenant,
  onSuccess,
}: {
  tenant: { id: number; name: string; plan: string };
  onSuccess: () => void;
}) {
  const [plan, setPlan] = useState(tenant.plan);
  const { toast } = useToast();
  const changePlan = trpc.superadmin.changeTenantPlan.useMutation({
    onSuccess: () => {
      toast({ title: "Plan actualizado", description: `${tenant.name} → ${plan}` });
      onSuccess();
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
          <ArrowUpCircle className="w-3 h-3" /> Plan
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Cambiar Plan — {tenant.name}</DialogTitle>
          <DialogDescription>Selecciona el nuevo plan para este tenant.</DialogDescription>
        </DialogHeader>
        <Select value={plan} onValueChange={setPlan}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="free">Free — $0/mes</SelectItem>
            <SelectItem value="starter">Starter — $12.90/mes</SelectItem>
            <SelectItem value="pro">Pro — $32.90/mes</SelectItem>
            <SelectItem value="enterprise">Enterprise — $99.90/mes</SelectItem>
          </SelectContent>
        </Select>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancelar</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              onClick={() => changePlan.mutate({ tenantId: tenant.id, plan: plan as any })}
              disabled={plan === tenant.plan || changePlan.isPending}
            >
              {changePlan.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Guardar
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Feature Flags Dialog ─── */
function FeatureFlagsDialog({
  tenant,
}: {
  tenant: { id: number; name: string };
}) {
  const { toast } = useToast();
  const flags = trpc.superadmin.getFeatureFlags.useQuery(
    { tenantId: tenant.id },
    { enabled: false }
  );

  const setFlag = trpc.superadmin.setFeatureFlag.useMutation({
    onSuccess: () => {
      flags.refetch();
      toast({ title: "Flag actualizado" });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [open, setOpen] = useState(false);

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) flags.refetch();
  };

  const definitions = flags.data?.definitions ?? [];
  const currentFlags = flags.data?.flags ?? {};

  const grouped = definitions.reduce((acc, def) => {
    if (!acc[def.category]) acc[def.category] = [];
    acc[def.category].push(def);
    return acc;
  }, {} as Record<string, typeof definitions>);

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
          <Flag className="w-3 h-3" /> Flags
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="w-5 h-5 text-violet-500" />
            Feature Flags — {tenant.name}
          </DialogTitle>
          <DialogDescription>
            Activa o desactiva funcionalidades para este tenant. Los cambios son inmediatos.
          </DialogDescription>
        </DialogHeader>

        {flags.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5">
            {Object.entries(grouped).map(([category, defs]) => {
              const CategoryIcon = FLAG_CATEGORY_ICONS[category] ?? Settings2;
              return (
                <div key={category}>
                  <div className="flex items-center gap-2 mb-3">
                    <CategoryIcon className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                      {category}
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {defs.map((def) => {
                      const enabled = currentFlags[def.key] ?? false;
                      return (
                        <div
                          key={def.key}
                          className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <Label
                              htmlFor={`flag-${tenant.id}-${def.key}`}
                              className="text-sm font-medium cursor-pointer"
                            >
                              {def.label}
                            </Label>
                            <p className="text-xs text-muted-foreground truncate">{def.key}</p>
                          </div>
                          <Switch
                            id={`flag-${tenant.id}-${def.key}`}
                            checked={enabled}
                            onCheckedChange={(checked) =>
                              setFlag.mutate({
                                tenantId: tenant.id,
                                flag: def.key,
                                enabled: checked,
                              })
                            }
                            disabled={setFlag.isPending}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ─── Impersonate Dialog ─── */
function ImpersonateDialog({
  tenant,
}: {
  tenant: { id: number; name: string };
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const tenantUsers = trpc.superadmin.listTenantUsers.useQuery(
    { tenantId: tenant.id },
    { enabled: false }
  );

  const impersonate = trpc.superadmin.impersonateUser.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Impersonación iniciada",
        description: `Sesión activa como ${data.targetUser.name} (${data.targetUser.email}). Redirigiendo…`,
        duration: 2000,
      });
      // The backend already set the cookie. Full reload to pick up new session.
      window.location.href = "/";
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) tenantUsers.refetch();
  };

  const userList = tenantUsers.data ?? [];

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
          <LogIn className="w-3 h-3" /> Impersonar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="w-5 h-5 text-amber-500" />
            Impersonar Usuario — {tenant.name}
          </DialogTitle>
          <DialogDescription>
            Inicia sesión como cualquier usuario de este tenant. Todas las acciones quedarán registradas.
          </DialogDescription>
        </DialogHeader>

        {tenantUsers.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : userList.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No se encontraron usuarios en este tenant.
          </p>
        ) : (
          <div className="space-y-2">
            {userList.map((u: any) => (
              <div
                key={u.id}
                className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-bold">
                  {(u.name || u.email || "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{u.name || "Sin nombre"}</p>
                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                </div>
                <Badge className={`text-[10px] uppercase ${ROLE_COLORS[u.role] ?? ""}`}>
                  {u.role}
                </Badge>
                <Badge
                  variant="secondary"
                  className={`text-[10px] ${u.isActive ? "text-green-600" : "text-red-500"}`}
                >
                  {u.isActive ? "Activo" : "Inactivo"}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1 shrink-0"
                  onClick={() => {
                    const warning = !u.isActive
                      ? `⚠️ ${u.name || u.email} está INACTIVO. ¿Impersonar de todos modos?\n\nTodas las acciones quedarán registradas.`
                      : `¿Impersonar a ${u.name || u.email}?\n\nTu sesión actual se pausará y todas las acciones quedarán registradas.`;
                    if (confirm(warning)) {
                      impersonate.mutate({
                        targetUserId: u.id,
                        targetTenantId: tenant.id,
                      });
                    }
                  }}
                  disabled={impersonate.isPending}
                >
                  {impersonate.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <LogIn className="w-3 h-3" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ─── Tenant Users Panel (with user management) ─── */
function TenantUsersPanel({ tenantId }: { tenantId: number }) {
  const { toast } = useToast();
  const tenantUsers = trpc.superadmin.listTenantUsers.useQuery({ tenantId });
  const userList = tenantUsers.data ?? [];

  const toggleActive = trpc.superadmin.toggleUserActive.useMutation({
    onSuccess: (data) => {
      toast({ title: data.message });
      tenantUsers.refetch();
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [revealedResetUrl, setRevealedResetUrl] = useState<string | null>(null);
  const resetPassword = trpc.superadmin.forcePasswordReset.useMutation({
    onSuccess: (data) => {
      const fullUrl = `${window.location.origin}${data.resetUrl}`;
      setRevealedResetUrl(fullUrl);
      toast({ title: "Sesiones invalidadas", description: "Copiá el enlace de reset y compartilo de forma segura.", duration: 5000 });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (tenantUsers.isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mr-2" />
        <span className="text-xs text-muted-foreground">Cargando usuarios...</span>
      </div>
    );
  }

  if (userList.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2">Sin usuarios registrados.</p>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
        <Users className="w-3 h-3" /> Usuarios ({userList.length})
      </p>
      <div className="grid gap-1">
        {userList.map((u: any) => (
          <div
            key={u.id}
            className="flex items-center gap-2 text-xs py-1.5 px-2 rounded bg-muted/30"
          >
            <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold shrink-0">
              {(u.name || u.email || "?").charAt(0).toUpperCase()}
            </div>
            <span className="truncate flex-1 font-medium">{u.name || u.email}</span>
            <Badge className={`text-[9px] px-1.5 py-0 uppercase ${ROLE_COLORS[u.role] ?? ""}`}>
              {u.role}
            </Badge>
            <span className={`text-[10px] ${u.isActive ? "text-green-500" : "text-red-400"}`}>
              {u.isActive ? "●" : "○"}
            </span>
            {/* Toggle active */}
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              title={u.isActive ? "Desactivar usuario" : "Activar usuario"}
              onClick={() => toggleActive.mutate({ userId: u.id, isActive: !u.isActive })}
              disabled={toggleActive.isPending}
            >
              {u.isActive ? <UserX className="w-3 h-3 text-red-400" /> : <UserCheck className="w-3 h-3 text-green-500" />}
            </Button>
            {/* Reset password */}
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              title="Resetear contraseña"
              onClick={() => {
                if (confirm(`¿Resetear contraseña de ${u.name || u.email}?`)) {
                  resetPassword.mutate({ userId: u.id });
                }
              }}
              disabled={resetPassword.isPending}
            >
              <KeyRound className="w-3 h-3 text-amber-500" />
            </Button>
          </div>
        ))}
      </div>
      {revealedResetUrl && (
        <div className="mt-2 flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-md">
          <code className="text-xs font-mono flex-1 select-all break-all">{revealedResetUrl}</code>
          <Button variant="ghost" size="sm" className="h-6 text-xs shrink-0" onClick={() => { navigator.clipboard.writeText(revealedResetUrl); toast({ title: "Enlace copiado" }); }}>
            Copiar
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-xs shrink-0" onClick={() => setRevealedResetUrl(null)}>
            ✕
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─── Tenant Row (expandable) ─── */
function TenantRow({
  tenant,
  refetch,
}: {
  tenant: any;
  refetch: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState("actions");
  const { toast } = useToast();

  const suspend = trpc.superadmin.suspendTenant.useMutation({
    onSuccess: () => {
      toast({ title: "Tenant suspendido" });
      refetch();
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reactivate = trpc.superadmin.reactivateTenant.useMutation({
    onSuccess: () => {
      toast({ title: "Tenant reactivado" });
      refetch();
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const archive = trpc.superadmin.archiveTenant.useMutation({
    onSuccess: () => {
      toast({ title: "Tenant archivado" });
      refetch();
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const setTrialDate = trpc.superadmin.setTrialDate.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const setTenantMaint = trpc.superadmin.setTenantMaintenanceMode.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [trialInput, setTrialInput] = useState("");

  const isSuspended = tenant.status === "suspended";
  const isPlatform = tenant.id === 1;

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Row header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate">{tenant.name}</span>
            {isPlatform && (
              <Badge variant="outline" className="text-[10px] px-1.5 border-amber-400 text-amber-500">
                <Crown className="w-3 h-3 mr-0.5" /> Plataforma
              </Badge>
            )}
            {tenant.trialEndsAt && (() => {
              const daysLeft = Math.ceil((new Date(tenant.trialEndsAt).getTime() - Date.now()) / 86400000);
              return (
                <Badge variant="outline" className={`text-[10px] px-1.5 ${daysLeft <= 0 ? "border-red-500 text-red-500" : daysLeft <= 3 ? "border-red-400 text-red-400" : "border-amber-400 text-amber-500"}`}>
                  <Timer className="w-3 h-3 mr-0.5" />
                  {daysLeft <= 0 ? "Trial expirado" : `Trial: ${daysLeft}d`}
                </Badge>
              );
            })()}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
            <span className="flex items-center gap-1"><Hash className="w-3 h-3" />{tenant.id}</span>
            <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{tenant.slug}</span>
            <span className="flex items-center gap-1"><CalendarDays className="w-3 h-3" />{fmtDate(tenant.createdAt)}</span>
            {tenant.paypalSubscriptionId && (
              <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="w-3 h-3" />PayPal</span>
            )}
          </div>
        </div>

        {/* Stats chips */}
        <div className="hidden md:flex items-center gap-2">
          <Badge variant="secondary" className="text-xs gap-1">
            <Users className="w-3 h-3" /> {Number(tenant.userCount)}
          </Badge>
          <Badge variant="secondary" className="text-xs gap-1">
            <Target className="w-3 h-3" /> {Number(tenant.leadCount)}
          </Badge>
          <Badge variant="secondary" className="text-xs gap-1">
            <Phone className="w-3 h-3" /> {Number(tenant.waNumberCount)}
          </Badge>
        </div>

        {/* Plan + Status */}
        <Badge className={`text-[10px] font-bold uppercase ${PLAN_COLORS[tenant.plan] ?? ""}`}>
          {tenant.plan}
        </Badge>
        <Badge className={`text-[10px] font-bold uppercase ${STATUS_COLORS[tenant.status] ?? ""}`}>
          {tenant.status === "active" ? "Activo" : tenant.status === "suspended" ? "Suspendido" : tenant.status}
        </Badge>

        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="px-4 py-3 bg-muted/30 border-t">
          {/* Mobile stats */}
          <div className="flex md:hidden items-center gap-2 flex-wrap mb-3">
            <Badge variant="secondary" className="text-xs gap-1"><Users className="w-3 h-3" /> {Number(tenant.userCount)} usuarios</Badge>
            <Badge variant="secondary" className="text-xs gap-1"><Target className="w-3 h-3" /> {Number(tenant.leadCount)} leads</Badge>
            <Badge variant="secondary" className="text-xs gap-1"><Phone className="w-3 h-3" /> {Number(tenant.waNumberCount)} WA</Badge>
          </div>

          {/* Billing info row */}
          {(tenant.paypalSubscriptionId || tenant.trialEndsAt) && (
            <div className="flex items-center gap-3 flex-wrap text-xs mb-3 p-2 rounded bg-muted/50">
              {tenant.paypalSubscriptionId && (
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-green-500" />
                  <span className="text-muted-foreground">PayPal:</span>
                  <code className="text-[10px] bg-muted px-1 rounded">{tenant.paypalSubscriptionId}</code>
                </span>
              )}
              {tenant.trialEndsAt && (
                <span className="flex items-center gap-1">
                  <Timer className="w-3 h-3 text-amber-500" />
                  <span className="text-muted-foreground">Trial hasta:</span>
                  <span className="font-medium">{fmtDate(tenant.trialEndsAt)}</span>
                </span>
              )}
            </div>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="h-8 mb-3">
              <TabsTrigger value="actions" className="text-xs h-7 gap-1">
                <Settings2 className="w-3 h-3" /> Acciones
              </TabsTrigger>
              <TabsTrigger value="users" className="text-xs h-7 gap-1">
                <Users className="w-3 h-3" /> Usuarios
              </TabsTrigger>
              <TabsTrigger value="limits" className="text-xs h-7 gap-1">
                <BarChart3 className="w-3 h-3" /> Uso vs Límites
              </TabsTrigger>
              <TabsTrigger value="notes" className="text-xs h-7 gap-1">
                <StickyNote className="w-3 h-3" /> Notas
              </TabsTrigger>
            </TabsList>

            <TabsContent value="actions" className="mt-0">
              <div className="flex items-center gap-2 flex-wrap">
                <EditTenantDialog tenant={tenant} onSuccess={refetch} />
                <EditLimitsDialog tenantId={tenant.id} onSuccess={refetch} />

                <ChangePlanDialog
                  tenant={{ id: tenant.id, name: tenant.name, plan: tenant.plan }}
                  onSuccess={refetch}
                />

                <FeatureFlagsDialog
                  tenant={{ id: tenant.id, name: tenant.name }}
                />

                <ImpersonateDialog
                  tenant={{ id: tenant.id, name: tenant.name }}
                />

                {!isPlatform && (
                  isSuspended ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1 text-green-600 hover:text-green-700"
                      onClick={(e) => { e.stopPropagation(); reactivate.mutate({ tenantId: tenant.id }); }}
                      disabled={reactivate.isPending}
                    >
                      {reactivate.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                      Reactivar
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1 text-red-600 hover:text-red-700"
                      onClick={(e) => { e.stopPropagation(); suspend.mutate({ tenantId: tenant.id }); }}
                      disabled={suspend.isPending}
                    >
                      {suspend.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Pause className="w-3 h-3" />}
                      Suspender
                    </Button>
                  )
                )}

                {!isPlatform && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 text-red-600 hover:text-red-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`¿ARCHIVAR "${tenant.name}"? Se desactivarán todos sus usuarios y se cancelará la suscripción.`)) {
                        archive.mutate({ tenantId: tenant.id });
                      }
                    }}
                    disabled={archive.isPending}
                  >
                    {archive.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Archive className="w-3 h-3" />} Archivar
                  </Button>
                )}

                {/* Set Trial Date */}
                {!isPlatform && (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                        <Timer className="w-3 h-3" /> Trial
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-xs">
                      <DialogHeader><DialogTitle>Fecha de Trial — {tenant.name}</DialogTitle></DialogHeader>
                      <Input type="date" value={trialInput} onChange={(e) => setTrialInput(e.target.value)} className="h-9 text-sm" />
                      <DialogFooter className="gap-1">
                        <Button variant="ghost" size="sm" onClick={() => { setTrialDate.mutate({ tenantId: tenant.id, trialEndsAt: null }); }} disabled={setTrialDate.isPending}>
                          Quitar Trial
                        </Button>
                        <DialogClose asChild>
                          <Button size="sm" onClick={() => { if (trialInput) setTrialDate.mutate({ tenantId: tenant.id, trialEndsAt: trialInput }); }} disabled={!trialInput || setTrialDate.isPending}>
                            {setTrialDate.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                            Guardar
                          </Button>
                        </DialogClose>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}

                {/* Per-tenant maintenance mode */}
                {!isPlatform && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 text-amber-600 hover:text-amber-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      const enable = !tenant.maintenanceMode;
                      const msg = enable
                        ? `¿Activar mantenimiento para "${tenant.name}"?\n\nTodos los usuarios de este tenant quedarán bloqueados (tRPC + uploads). Solo Super Admin podrá operar.`
                        : `¿Desactivar mantenimiento para "${tenant.name}"?\n\nLos usuarios podrán volver a operar.`;
                      if (confirm(msg)) {
                        setTenantMaint.mutate({ tenantId: tenant.id, enabled: enable, message: enable ? "Tenant en mantenimiento. Volvemos pronto." : "" });
                      }
                    }}
                    disabled={setTenantMaint.isPending}
                  >
                    {setTenantMaint.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                    {tenant.maintenanceMode ? "Quitar Mant." : "Mantenimiento"}
                  </Button>
                )}
              </div>
            </TabsContent>

            <TabsContent value="users" className="mt-0">
              <TenantUsersPanel tenantId={tenant.id} />
            </TabsContent>

            <TabsContent value="limits" className="mt-0">
              <UsageVsLimitsPanel tenantId={tenant.id} />
            </TabsContent>

            <TabsContent value="notes" className="mt-0">
              <TenantNotesPanel tenantId={tenant.id} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SYSTEM HEALTH PANEL
   ═══════════════════════════════════════════════════════════════════ */
function SystemHealthPanel() {
  const health = trpc.superadmin.systemHealth.useQuery(undefined, { refetchInterval: 30000 });
  const d = health.data;

  if (health.isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!d) return <p className="text-sm text-muted-foreground text-center py-4">No se pudo obtener información del sistema.</p>;

  const items = [
    { label: "Node.js", value: d.nodeVersion, icon: Code },
    { label: "Entorno", value: d.nodeEnv, icon: Settings2 },
    { label: "Plataforma", value: d.platform, icon: ServerCrash },
    { label: "Uptime", value: d.uptimeFormatted, icon: Clock },
    { label: "Base de Datos", value: d.dbStatus, icon: Database, color: d.dbStatus === "connected" ? "text-green-500" : "text-red-500" },
    { label: "Redis", value: d.redisStatus, icon: Database, color: d.redisStatus === "connected" ? "text-green-500" : "text-red-500" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {items.map((item) => (
          <Card key={item.label} className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <item.icon className={`w-4 h-4 ${item.color ?? "text-muted-foreground"}`} />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">{item.label}</span>
            </div>
            <p className={`text-sm font-bold ${item.color ?? ""}`}>{item.value}</p>
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <HardDrive className="w-4 h-4" /> Memoria (MB)
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          {[
            { label: "RSS", value: d.memory.rss },
            { label: "Heap Usado", value: d.memory.heapUsed },
            { label: "Heap Total", value: d.memory.heapTotal },
            { label: "External", value: d.memory.external },
          ].map((m) => (
            <div key={m.label}>
              <p className="text-2xl font-bold">{m.value}</p>
              <p className="text-xs text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   WHATSAPP HEALTH PANEL
   ═══════════════════════════════════════════════════════════════════ */
function WhatsAppHealthPanel() {
  const waHealth = trpc.superadmin.whatsappHealth.useQuery();
  const rows = waHealth.data ?? [];

  if (waHealth.isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  // Derive online from BOTH fields to avoid contradictions
  const isOnline = (r: any) => r.isConnected && r.status !== "disconnected" && r.status !== "blocked";
  const connected = rows.filter(isOnline).length;
  const total = rows.length;

  const statusLabel: Record<string, string> = { active: "Activo", warming_up: "Calentamiento", blocked: "Bloqueado", disconnected: "Desconectado" };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Badge variant="secondary" className="gap-1 text-sm">
          <Wifi className="w-4 h-4 text-green-500" /> {connected} conectados
        </Badge>
        <Badge variant="secondary" className="gap-1 text-sm">
          <WifiOff className="w-4 h-4 text-red-500" /> {total - connected} desconectados
        </Badge>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">Sin números WhatsApp registrados.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r: any) => {
            const online = isOnline(r);
            return (
            <Card key={r.id} className="p-3">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${online ? "bg-green-500" : "bg-red-500"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{r.displayName || r.phoneNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.tenantName} · {r.phoneNumber} · {statusLabel[r.status] ?? r.status}
                    {r.warmupDay != null && ` · Warmup día ${r.warmupDay}`}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <p className="font-medium">{r.totalMessagesSent ?? 0} enviados</p>
                  <p className="text-muted-foreground">Hoy: {r.messagesSentToday ?? 0}/{r.dailyMessageLimit ?? "∞"}</p>
                </div>
                <Badge variant="secondary" className={online ? "text-green-600" : "text-red-500"}>
                  {online ? "Online" : "Offline"}
                </Badge>
              </div>
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ACTIVITY LOGS PANEL
   ═══════════════════════════════════════════════════════════════════ */
function ActivityLogsPanel() {
  const [filter, setFilter] = useState({ tenantId: undefined as number | undefined, action: "" });
  const [page, setPage] = useState(0);
  const limit = 30;

  const logs = trpc.superadmin.activityLogs.useQuery({
    tenantId: filter.tenantId,
    action: filter.action || undefined,
    limit,
    offset: page * limit,
  });

  const data = logs.data ?? { rows: [], total: 0 };
  const totalPages = Math.ceil(data.total / limit);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Filtrar por acción..."
          value={filter.action}
          onChange={(e) => { setFilter({ ...filter, action: e.target.value }); setPage(0); }}
          className="h-8 w-56 text-xs"
        />
        <Input
          placeholder="Tenant ID..."
          type="number"
          onChange={(e) => { setFilter({ ...filter, tenantId: e.target.value ? Number(e.target.value) : undefined }); setPage(0); }}
          className="h-8 w-28 text-xs"
        />
        <Badge variant="secondary" className="text-xs">{data.total} registros</Badge>
        <ExportActivityLogsButton tenantId={filter.tenantId} action={filter.action} />
      </div>

      {logs.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin registros de actividad.</p>
      ) : (
        <div className="space-y-1">
          {data.rows.map((log: any) => (
            <div key={log.id} className="flex items-center gap-3 px-3 py-2 rounded bg-muted/30 text-xs">
              <Activity className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground w-20 shrink-0">{fmtDateTime(log.createdAt)}</span>
              <Badge variant="outline" className="text-[10px] px-1.5 shrink-0">{log.tenantName ?? `T${log.tenantId}`}</Badge>
              <span className="font-medium text-blue-600 dark:text-blue-400 shrink-0">{log.action}</span>
              <span className="text-muted-foreground truncate flex-1">
                {log.entityType ? `${log.entityType}#${log.entityId}` : ""}
                {log.userName ? ` · ${log.userName}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-xs text-muted-foreground">Pág {page + 1} de {totalPages}</span>
          <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ACCESS LOGS PANEL (security)
   ═══════════════════════════════════════════════════════════════════ */
function AccessLogsPanel() {
  const [filter, setFilter] = useState({ tenantId: undefined as number | undefined, success: undefined as boolean | undefined });
  const [page, setPage] = useState(0);
  const limit = 30;

  const logs = trpc.superadmin.accessLogs.useQuery({
    tenantId: filter.tenantId,
    success: filter.success,
    limit,
    offset: page * limit,
  });

  const data = logs.data ?? { rows: [], total: 0 };
  const totalPages = Math.ceil(data.total / limit);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Tenant ID..."
          type="number"
          onChange={(e) => { setFilter({ ...filter, tenantId: e.target.value ? Number(e.target.value) : undefined }); setPage(0); }}
          className="h-8 w-28 text-xs"
        />
        <Select
          value={filter.success === undefined ? "all" : filter.success ? "ok" : "fail"}
          onValueChange={(v) => {
            setFilter({ ...filter, success: v === "all" ? undefined : v === "ok" });
            setPage(0);
          }}
        >
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="ok">Exitosos</SelectItem>
            <SelectItem value="fail">Fallidos</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="text-xs">{data.total} registros</Badge>
        <ExportAccessLogsButton tenantId={filter.tenantId} success={filter.success} />
      </div>

      {logs.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin registros de acceso.</p>
      ) : (
        <div className="space-y-1">
          {data.rows.map((log: any) => (
            <div key={log.id} className="flex items-center gap-3 px-3 py-2 rounded bg-muted/30 text-xs">
              {log.success ? (
                <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
              ) : (
                <XCircle className="w-3 h-3 text-red-500 shrink-0" />
              )}
              <span className="text-muted-foreground w-20 shrink-0">{fmtDateTime(log.createdAt)}</span>
              <Badge variant="outline" className="text-[10px] px-1.5 shrink-0">{log.tenantName ?? `T${log.tenantId}`}</Badge>
              <span className="font-medium shrink-0">{log.action}</span>
              <span className="text-muted-foreground truncate flex-1">
                {log.userName ?? ""} · {log.ipAddress ?? ""}
                {log.errorMessage ? ` · Error: ${log.errorMessage}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-xs text-muted-foreground">Pág {page + 1} de {totalPages}</span>
          <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ANALYTICS: GROWTH, TRIALS, CHURN, ONBOARDING
   ═══════════════════════════════════════════════════════════════════ */
function AnalyticsPanel() {
  const growth = trpc.superadmin.tenantGrowth.useQuery({ days: 30 });
  const trials = trpc.superadmin.expiringTrials.useQuery({ daysAhead: 14 });
  const inactive = trpc.superadmin.inactiveTenants.useQuery({ inactiveDays: 14 });
  const onboarding = trpc.superadmin.onboardingFunnel.useQuery();

  const growthData = growth.data ?? [];
  const trialList = trials.data ?? [];
  const inactiveList = inactive.data ?? [];
  const funnel = onboarding.data;

  const isLoading = growth.isLoading || trials.isLoading;

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      {/* Growth timeline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-500" /> Registros últimos 30 días
          </CardTitle>
        </CardHeader>
        <CardContent>
          {growthData.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin datos de crecimiento.</p>
          ) : (
            <div className="flex items-end gap-1 h-24">
              {growthData.map((d: any) => {
                const max = Math.max(...growthData.map((g: any) => g.count), 1);
                const height = (d.count / max) * 100;
                return (
                  <div
                    key={d.date}
                    className="flex-1 bg-green-500/80 rounded-t hover:bg-green-400 transition-colors relative group"
                    style={{ height: `${Math.max(height, 4)}%` }}
                    title={`${d.date}: ${d.count} registros`}
                  >
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                      {d.count}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Expiring trials */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Timer className="w-4 h-4 text-amber-500" /> Trials por Vencer (14 días)
              <Badge variant="secondary" className="ml-auto text-xs">{trialList.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trialList.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin trials por vencer.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {trialList.map((t: any) => (
                  <div key={t.id} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-muted/30">
                    <span className="font-medium">{t.name}</span>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-[10px] ${PLAN_COLORS[t.plan] ?? ""}`}>{t.plan}</Badge>
                      <span className={`font-bold ${Number(t.daysLeft) <= 3 ? "text-red-500" : "text-amber-500"}`}>
                        {Number(t.daysLeft) <= 0 ? "¡EXPIRADO!" : `${t.daysLeft}d`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Inactive tenants (churn risk) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" /> Riesgo de Churn (14+ días sin actividad)
              <Badge variant="secondary" className="ml-auto text-xs">{inactiveList.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {inactiveList.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin tenants inactivos. ¡Excelente!</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {inactiveList.map((t: any) => (
                  <div key={t.id} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-muted/30">
                    <span className="font-medium">{t.name}</span>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-[10px] ${PLAN_COLORS[t.plan] ?? ""}`}>{t.plan}</Badge>
                      <span className="text-red-500 font-bold">{t.daysSinceActivity}d inactivo</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Onboarding Funnel */}
      {funnel && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-blue-500" /> Funnel de Onboarding
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-7 gap-3 text-center">
              {[
                { label: "Total", value: funnel.total, pct: 100 },
                { label: "Empresa", value: funnel.company, pct: funnel.total ? Math.round((funnel.company / funnel.total) * 100) : 0 },
                { label: "Equipo", value: funnel.team, pct: funnel.total ? Math.round((funnel.team / funnel.total) * 100) : 0 },
                { label: "WhatsApp", value: funnel.whatsapp, pct: funnel.total ? Math.round((funnel.whatsapp / funnel.total) * 100) : 0 },
                { label: "Importar", value: funnel.importStep, pct: funnel.total ? Math.round((funnel.importStep / funnel.total) * 100) : 0 },
                { label: "1er Msg", value: funnel.firstMessage, pct: funnel.total ? Math.round((funnel.firstMessage / funnel.total) * 100) : 0 },
                { label: "Completo", value: funnel.fullyCompleted, pct: funnel.total ? Math.round((funnel.fullyCompleted / funnel.total) * 100) : 0 },
              ].map((s) => (
                <div key={s.label}>
                  <p className="text-lg font-bold">{s.value}</p>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                    <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${s.pct}%` }} />
                  </div>
                  <p className="text-[9px] text-muted-foreground mt-0.5">{s.pct}%</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revenue Timeline */}
      <RevenueTimelinePanel />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   USAGE VS LIMITS PANEL (per tenant)
   ═══════════════════════════════════════════════════════════════════ */
function UsageVsLimitsPanel({ tenantId }: { tenantId: number }) {
  const usage = trpc.superadmin.usageVsLimits.useQuery({ tenantId });
  const d = usage.data;

  if (usage.isLoading) return <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  if (!d) return <p className="text-xs text-muted-foreground">No se pudo obtener uso vs límites.</p>;

  return (
    <div className="space-y-3 max-w-md">
      <UsageBar label="Usuarios" current={d.users.current} limit={d.users.limit} icon={Users} />
      <UsageBar label="Leads" current={d.leads.current} limit={d.leads.limit} icon={Target} />
      <UsageBar label="WhatsApp" current={d.whatsapp.current} limit={d.whatsapp.limit} icon={Phone} />
      <UsageBar label="Mensajes/mes" current={d.messages.current} limit={d.messages.limit} icon={MessageCircle} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   EXPORT BUTTONS
   ═══════════════════════════════════════════════════════════════════ */
function ExportActivityLogsButton({ tenantId, action }: { tenantId?: number; action?: string }) {
  const { toast } = useToast();
  const exportQ = trpc.superadmin.exportActivityLogs.useQuery(
    { tenantId, action: action || undefined, limit: 5000 },
    { enabled: false }
  );

  const handleExport = async () => {
    const res = await exportQ.refetch();
    const rows = res.data ?? [];
    if (rows.length === 0) {
      toast({ title: "Sin datos para exportar" });
      return;
    }
    downloadCSV(rows, "activity_logs");
    toast({ title: `${rows.length} registros exportados` });
  };

  return (
    <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={handleExport} disabled={exportQ.isFetching}>
      {exportQ.isFetching ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileDown className="w-3 h-3" />}
      CSV
    </Button>
  );
}

function ExportAccessLogsButton({ tenantId, success }: { tenantId?: number; success?: boolean }) {
  const { toast } = useToast();
  const exportQ = trpc.superadmin.exportAccessLogs.useQuery(
    { tenantId, success, limit: 5000 },
    { enabled: false }
  );

  const handleExport = async () => {
    const res = await exportQ.refetch();
    const rows = res.data ?? [];
    if (rows.length === 0) {
      toast({ title: "Sin datos para exportar" });
      return;
    }
    downloadCSV(rows, "access_logs");
    toast({ title: `${rows.length} registros exportados` });
  };

  return (
    <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={handleExport} disabled={exportQ.isFetching}>
      {exportQ.isFetching ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileDown className="w-3 h-3" />}
      CSV
    </Button>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   QUEUES & STORAGE PANEL
   ═══════════════════════════════════════════════════════════════════ */
function QueuesStoragePanel() {
  const msgQueue = trpc.superadmin.messageQueueStats.useQuery();
  const wfJobs = trpc.superadmin.workflowJobStats.useQuery();
  const storage = trpc.superadmin.storageUsage.useQuery();

  const msgRows = msgQueue.data ?? [];
  const wfRows = wfJobs.data ?? [];
  const storageRows = storage.data ?? [];

  const isLoading = msgQueue.isLoading || wfJobs.isLoading || storage.isLoading;
  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  // Aggregate message queue by status
  const msgByStatus: Record<string, number> = {};
  for (const r of msgRows as any[]) {
    const s = String(r.status);
    msgByStatus[s] = (msgByStatus[s] || 0) + Number(r.cnt);
  }

  // Aggregate workflow jobs by status
  const wfByStatus: Record<string, number> = {};
  for (const r of wfRows as any[]) {
    const s = String(r.status);
    wfByStatus[s] = (wfByStatus[s] || 0) + Number(r.cnt);
  }

  const totalStorage = storageRows.reduce((sum: number, r: any) => sum + Number(r.totalBytes), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Message Queue */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Inbox className="w-4 h-4 text-blue-500" /> Cola de Mensajes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 mb-3">
              {Object.entries(msgByStatus).length === 0 ? (
                <p className="text-xs text-muted-foreground col-span-2">Sin mensajes en cola.</p>
              ) : (
                Object.entries(msgByStatus).map(([status, cnt]) => (
                  <div key={status} className="text-center p-2 rounded bg-muted/30">
                    <p className="text-lg font-bold">{cnt}</p>
                    <p className="text-[10px] text-muted-foreground uppercase">{status}</p>
                  </div>
                ))
              )}
            </div>
            {/* Per-tenant breakdown */}
            {msgRows.length > 0 && (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {msgRows.map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-muted/20">
                    <span>{r.tenantName}</span>
                    <span className="font-medium">{r.status}: {Number(r.cnt)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Workflow Jobs */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Workflow className="w-4 h-4 text-violet-500" /> Workflow Jobs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 mb-3">
              {Object.entries(wfByStatus).length === 0 ? (
                <p className="text-xs text-muted-foreground col-span-2">Sin workflow jobs.</p>
              ) : (
                Object.entries(wfByStatus).map(([status, cnt]) => (
                  <div key={status} className="text-center p-2 rounded bg-muted/30">
                    <p className="text-lg font-bold">{cnt}</p>
                    <p className="text-[10px] text-muted-foreground uppercase">{status}</p>
                  </div>
                ))
              )}
            </div>
            {wfRows.length > 0 && (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {wfRows.map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-muted/20">
                    <span>{r.tenantName}</span>
                    <span className="font-medium">{r.status}: {Number(r.cnt)} {Number(r.withErrors) > 0 ? `(${r.withErrors} errores)` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Storage Usage */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-amber-500" /> Almacenamiento
              <Badge variant="secondary" className="ml-auto text-xs">Total: {fmtBytes(totalStorage)}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {storageRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin archivos almacenados.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {storageRows.map((r: any) => (
                  <div key={r.tenantId} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-muted/30">
                    <span className="font-medium">{r.tenantName}</span>
                    <div className="text-right">
                      <span className="font-bold">{fmtBytes(Number(r.totalBytes))}</span>
                      <span className="text-muted-foreground ml-2">({Number(r.fileCount)} archivos)</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SESSION MANAGEMENT PANEL
   ═══════════════════════════════════════════════════════════════════ */
function SessionsPanel() {
  const { toast } = useToast();
  const [filterTenantId, setFilterTenantId] = useState<number | undefined>(undefined);
  const sessionsQ = trpc.superadmin.listSessions.useQuery({ tenantId: filterTenantId, limit: 100 });
  const rows = sessionsQ.data ?? [];

  const forceLogout = trpc.superadmin.forceLogout.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); sessionsQ.refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const forceLogoutTenant = trpc.superadmin.forceLogoutTenant.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); sessionsQ.refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (sessionsQ.isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Tenant ID..."
          type="number"
          onChange={(e) => setFilterTenantId(e.target.value ? Number(e.target.value) : undefined)}
          className="h-8 w-28 text-xs"
        />
        <Badge variant="secondary" className="text-xs gap-1">
          <Monitor className="w-3 h-3" /> {rows.length} sesiones activas
        </Badge>
        {filterTenantId && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1 text-red-600"
            onClick={() => {
              if (confirm(`¿Cerrar TODAS las sesiones del tenant ${filterTenantId}?`)) {
                forceLogoutTenant.mutate({ tenantId: filterTenantId });
              }
            }}
            disabled={forceLogoutTenant.isPending}
          >
            {forceLogoutTenant.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
            Cerrar todas del tenant
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin sesiones activas.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((s: any) => (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2 rounded bg-muted/30 text-xs">
              <Monitor className="w-3 h-3 text-green-500 shrink-0" />
              <span className="text-muted-foreground w-20 shrink-0">{fmtDateTime(s.lastActivityAt)}</span>
              <Badge variant="outline" className="text-[10px] px-1.5 shrink-0">{s.tenantName ?? `T${s.tenantId}`}</Badge>
              <span className="font-medium truncate">{s.userName ?? "—"}</span>
              <span className="text-muted-foreground truncate">{s.userEmail ?? ""}</span>
              <Badge className={`text-[9px] uppercase ${ROLE_COLORS[s.userRole] ?? ""}`}>{s.userRole ?? "?"}</Badge>
              <span className="text-muted-foreground truncate hidden lg:inline">{s.ipAddress ?? ""}</span>
              <span className="text-muted-foreground text-[10px] truncate hidden xl:inline max-w-[200px]">{s.userAgent ?? ""}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1 text-red-500 shrink-0 ml-auto"
                onClick={() => forceLogout.mutate({ sessionId: s.id })}
                disabled={forceLogout.isPending}
              >
                <LogOut className="w-3 h-3" /> Cerrar
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TENANT NOTES (Internal CRM notes per tenant)
   ═══════════════════════════════════════════════════════════════════ */
function TenantNotesPanel({ tenantId }: { tenantId: number }) {
  const { toast } = useToast();
  const notesQ = trpc.superadmin.getTenantNotes.useQuery({ tenantId });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const updateNotes = trpc.superadmin.updateTenantNotes.useMutation({
    onSuccess: () => {
      toast({ title: "Notas actualizadas" });
      notesQ.refetch();
      setEditing(false);
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const notes = notesQ.data?.notes ?? "";

  const handleEdit = () => {
    setDraft(notes);
    setEditing(true);
  };

  if (notesQ.isLoading) return <div className="flex justify-center py-2"><Loader2 className="w-3 h-3 animate-spin" /></div>;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
          <StickyNote className="w-3 h-3" /> Notas Internas
        </p>
        {!editing && (
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleEdit}>
            Editar
          </Button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="text-xs"
            placeholder="Notas internas sobre este tenant (solo visibles para Super Admin)..."
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => updateNotes.mutate({ tenantId, notes: draft })}
              disabled={updateNotes.isPending}
            >
              {updateNotes.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              Guardar
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : notes ? (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/30 px-2 py-1.5 rounded">{notes}</p>
      ) : (
        <p className="text-xs text-muted-foreground italic">Sin notas. Haz clic en Editar para agregar.</p>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   REVENUE TIMELINE PANEL
   ═══════════════════════════════════════════════════════════════════ */
function RevenueTimelinePanel() {
  const [months, setMonths] = useState(12);
  const timeline = trpc.superadmin.revenueTimeline.useQuery({ months });
  const data = timeline.data ?? [];

  if (timeline.isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const maxMrr = Math.max(...data.map(d => d.mrr), 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-500" /> MRR Timeline Estimado
          </CardTitle>
          <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="6">6 meses</SelectItem>
              <SelectItem value="12">12 meses</SelectItem>
              <SelectItem value="24">24 meses</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin datos de revenue.</p>
        ) : (
          <>
            <div className="flex items-end gap-1 h-32 mb-3">
              {data.map((d) => {
                const height = (d.mrr / maxMrr) * 100;
                return (
                  <div
                    key={d.month}
                    className="flex-1 bg-emerald-500/80 rounded-t hover:bg-emerald-400 transition-colors relative group cursor-default"
                    style={{ height: `${Math.max(height, 4)}%` }}
                    title={`${d.month}: $${d.mrr} MRR · ${d.tenantCount} tenants · ${d.paidCount} pagando`}
                  >
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-bold opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      ${d.mrr}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{data[0]?.month}</span>
              <span>{data[data.length - 1]?.month}</span>
            </div>
            {/* Summary row */}
            <div className="grid grid-cols-3 gap-3 mt-4 text-center">
              <div className="p-2 rounded bg-muted/30">
                <p className="text-lg font-bold text-emerald-600">${data[data.length - 1]?.mrr ?? 0}</p>
                <p className="text-[10px] text-muted-foreground">MRR Actual</p>
              </div>
              <div className="p-2 rounded bg-muted/30">
                <p className="text-lg font-bold">{data[data.length - 1]?.tenantCount ?? 0}</p>
                <p className="text-[10px] text-muted-foreground">Total Tenants</p>
              </div>
              <div className="p-2 rounded bg-muted/30">
                <p className="text-lg font-bold text-blue-600">{data[data.length - 1]?.paidCount ?? 0}</p>
                <p className="text-[10px] text-muted-foreground">Tenants Pago</p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ANNOUNCEMENTS PANEL
   ═══════════════════════════════════════════════════════════════════ */
function AnnouncementsPanel() {
  const { toast } = useToast();
  const announcements = trpc.superadmin.listAnnouncements.useQuery();
  const rows = announcements.data ?? [];

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [newType, setNewType] = useState<"info" | "warning" | "critical" | "maintenance">("info");

  const createAnn = trpc.superadmin.createAnnouncement.useMutation({
    onSuccess: () => {
      toast({ title: "Anuncio creado" });
      announcements.refetch();
      setShowCreate(false);
      setNewTitle("");
      setNewMessage("");
      setNewType("info");
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleAnn = trpc.superadmin.toggleAnnouncement.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); announcements.refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteAnn = trpc.superadmin.deleteAnnouncement.useMutation({
    onSuccess: () => { toast({ title: "Anuncio eliminado" }); announcements.refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const TYPE_COLORS: Record<string, string> = {
    info: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    warning: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    critical: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    maintenance: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300",
  };

  if (announcements.isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-violet-500" /> Anuncios de Plataforma
          <Badge variant="secondary" className="text-xs">{rows.length}</Badge>
        </h3>
        <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="w-3 h-3" /> Nuevo Anuncio
        </Button>
      </div>

      {/* Create form */}
      {showCreate && (
        <Card className="p-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Input
                placeholder="Título del anuncio..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="h-8 text-xs flex-1"
              />
              <Select value={newType} onValueChange={(v: any) => setNewType(v)}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea
              placeholder="Mensaje del anuncio..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              rows={3}
              className="text-xs"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => createAnn.mutate({ title: newTitle, message: newMessage, type: newType })}
                disabled={!newTitle || !newMessage || createAnn.isPending}
              >
                {createAnn.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                Publicar
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowCreate(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Announcements list */}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin anuncios. Crea uno para notificar a todos los tenants.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((a: any) => (
            <Card key={a.id} className={`p-3 ${a.active ? "" : "opacity-50"}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className={`text-[10px] uppercase ${TYPE_COLORS[a.type] ?? ""}`}>{a.type}</Badge>
                    <span className="text-sm font-semibold">{a.title}</span>
                    {!a.active && <Badge variant="outline" className="text-[10px]">Inactivo</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">{a.message}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{fmtDateTime(a.createdAt)}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Switch
                    checked={a.active}
                    onCheckedChange={(checked) => toggleAnn.mutate({ id: a.id, active: checked })}
                    disabled={toggleAnn.isPending}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-red-500"
                    onClick={() => {
                      if (confirm(`¿Eliminar anuncio "${a.title}"?`)) deleteAnn.mutate({ id: a.id });
                    }}
                    disabled={deleteAnn.isPending}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   BULK OPERATIONS PANEL
   ═══════════════════════════════════════════════════════════════════ */
function BulkOperationsPanel({ tenants: tenantList, refetch }: { tenants: any[]; refetch: () => void }) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkPlan, setBulkPlan] = useState<string>("starter");

  const bulkChangePlan = trpc.superadmin.bulkChangePlan.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); setSelected(new Set()); refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkSuspend = trpc.superadmin.bulkSuspend.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); setSelected(new Set()); refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkReactivate = trpc.superadmin.bulkReactivate.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); setSelected(new Set()); refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleTenant = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const selectAll = () => {
    if (selected.size === tenantList.filter(t => t.id !== 1).length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(tenantList.filter(t => t.id !== 1).map(t => t.id)));
    }
  };

  const selectedIds = Array.from(selected);
  const isPending = bulkChangePlan.isPending || bulkSuspend.isPending || bulkReactivate.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={selectAll}>
          {selected.size === tenantList.filter(t => t.id !== 1).length ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
          {selected.size > 0 ? `${selected.size} seleccionados` : "Seleccionar todos"}
        </Button>
        <Separator orientation="vertical" className="h-6" />
        {selected.size > 0 && (
          <>
            <Select value={bulkPlan} onValueChange={setBulkPlan}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => {
                if (confirm(`¿Cambiar plan a ${bulkPlan} para ${selectedIds.length} tenants?`)) {
                  bulkChangePlan.mutate({ tenantIds: selectedIds, plan: bulkPlan as any });
                }
              }}
              disabled={isPending}
            >
              {bulkChangePlan.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUpCircle className="w-3 h-3" />}
              Cambiar Plan
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1 text-red-600"
              onClick={() => {
                if (confirm(`¿Suspender ${selectedIds.length} tenants?`)) {
                  bulkSuspend.mutate({ tenantIds: selectedIds });
                }
              }}
              disabled={isPending}
            >
              {bulkSuspend.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Pause className="w-3 h-3" />}
              Suspender
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1 text-green-600"
              onClick={() => {
                if (confirm(`¿Reactivar ${selectedIds.length} tenants?`)) {
                  bulkReactivate.mutate({ tenantIds: selectedIds });
                }
              }}
              disabled={isPending}
            >
              {bulkReactivate.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              Reactivar
            </Button>
          </>
        )}
      </div>

      {/* Tenant selection list */}
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {tenantList.filter(t => t.id !== 1).map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-3 px-3 py-2 rounded cursor-pointer transition-colors text-xs ${
              selected.has(t.id) ? "bg-violet-50 dark:bg-violet-950 border border-violet-300 dark:border-violet-700" : "bg-muted/30 hover:bg-muted/50"
            }`}
            onClick={() => toggleTenant(t.id)}
          >
            {selected.has(t.id) ? (
              <CheckSquare className="w-4 h-4 text-violet-500 shrink-0" />
            ) : (
              <Square className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <span className="font-medium flex-1 truncate">{t.name}</span>
            <Badge className={`text-[10px] uppercase ${PLAN_COLORS[t.plan] ?? ""}`}>{t.plan}</Badge>
            <Badge className={`text-[10px] uppercase ${STATUS_COLORS[t.status] ?? ""}`}>
              {t.status === "active" ? "Activo" : t.status === "suspended" ? "Suspendido" : t.status}
            </Badge>
            <span className="text-muted-foreground">{Number(t.userCount)} users</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CREATE TENANT DIALOG
   ═══════════════════════════════════════════════════════════════════ */
function CreateTenantDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [plan, setPlan] = useState<string>("free");
  const [trialDate, setTrialDate] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [resetUrl, setResetUrl] = useState("");
  const { toast } = useToast();

  const create = trpc.superadmin.createTenant.useMutation({
    onSuccess: (d) => {
      if (d.resetUrl) {
        setResetUrl(`${window.location.origin}${d.resetUrl}`);
      }
      toast({ title: d.message });
      setName(""); setSlug(""); setPlan("free"); setTrialDate(""); setOwnerEmail(""); setOwnerName("");
      onSuccess();
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setResetUrl(""); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 text-xs gap-1">
          <Plus className="w-3 h-3" /> Nuevo Tenant
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Crear Tenant</DialogTitle>
          <DialogDescription>Crea una nueva organización con su owner inicial.</DialogDescription>
        </DialogHeader>

        {resetUrl ? (
          <div className="space-y-3">
            <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-3">
              <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-2">Tenant creado. Enviá este enlace al owner para que configure su contraseña:</p>
              <code className="text-xs break-all bg-white dark:bg-gray-900 p-2 rounded block">{resetUrl}</code>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={() => { navigator.clipboard.writeText(resetUrl); toast({ title: "URL copiada" }); }}>Copiar enlace</Button>
            <DialogClose asChild><Button variant="ghost" className="w-full">Cerrar</Button></DialogClose>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <Input placeholder="Nombre de empresa" value={name} onChange={(e) => { setName(e.target.value); if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")); }} className="h-9 text-sm" />
              <Input placeholder="slug (letras, números, guiones — sin guión al inicio/final)" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} className="h-9 text-sm" />
              {slug && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length >= 2 && (
                <p className="text-xs text-amber-600">El identificador no puede empezar ni terminar con guión.</p>
              )}
              {slug && slug.length === 1 && (
                <p className="text-xs text-amber-600">El identificador debe tener al menos 2 caracteres.</p>
              )}
              <Select value={plan} onValueChange={setPlan}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
              <div>
                <Label className="text-xs text-muted-foreground">Trial hasta (opcional)</Label>
                <Input type="date" value={trialDate} onChange={(e) => setTrialDate(e.target.value)} className="h-9 text-sm" />
              </div>
              <div className="border-t pt-3 space-y-2">
                <Label className="text-xs font-medium">Owner inicial (obligatorio)</Label>
                <Input placeholder="Email del owner *" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} className="h-9 text-sm" required />
                <Input placeholder="Nombre del owner *" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className="h-9 text-sm" required />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="ghost">Cancelar</Button></DialogClose>
              <Button onClick={() => create.mutate({ name, slug, plan: plan as any, trialEndsAt: trialDate || undefined, ownerEmail, ownerName })} disabled={!name || !slug || slug.length < 2 || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) || !ownerEmail || !ownerName || create.isPending}>
                {create.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null} Crear
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   EDIT TENANT DIALOG
   ═══════════════════════════════════════════════════════════════════ */
function EditTenantDialog({ tenant, onSuccess }: { tenant: any; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(tenant.name);
  const [slug, setSlug] = useState(tenant.slug);
  const [paypalSubId, setPaypalSubId] = useState(tenant.paypalSubscriptionId ?? "");
  const [trialDate, setTrialDate] = useState(tenant.trialEndsAt ? new Date(tenant.trialEndsAt).toISOString().slice(0, 10) : "");
  const { toast } = useToast();

  const update = trpc.superadmin.updateTenant.useMutation({
    onSuccess: () => { toast({ title: "Tenant actualizado" }); setOpen(false); onSuccess(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1"><Edit className="w-3 h-3" /> Editar</Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar Tenant — {tenant.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Nombre</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm" /></div>
          <div><Label className="text-xs">Slug</Label><Input value={slug} onChange={(e) => setSlug(e.target.value)} className="h-9 text-sm" /></div>
          <div><Label className="text-xs">PayPal Subscription ID</Label><Input value={paypalSubId} onChange={(e) => setPaypalSubId(e.target.value)} className="h-9 text-sm" placeholder="I-..." /></div>
          <div><Label className="text-xs">Trial hasta</Label><Input type="date" value={trialDate} onChange={(e) => setTrialDate(e.target.value)} className="h-9 text-sm" /></div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Cancelar</Button></DialogClose>
          <Button onClick={() => update.mutate({ tenantId: tenant.id, name, slug, paypalSubscriptionId: paypalSubId || null, trialEndsAt: trialDate || null })} disabled={update.isPending}>
            {update.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   EDIT LIMITS DIALOG
   ═══════════════════════════════════════════════════════════════════ */
function EditLimitsDialog({ tenantId, onSuccess }: { tenantId: number; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [maxUsers, setMaxUsers] = useState("");
  const [maxWa, setMaxWa] = useState("");
  const [maxMsg, setMaxMsg] = useState("");
  const { toast } = useToast();

  const update = trpc.superadmin.updateTenantLimits.useMutation({
    onSuccess: () => { toast({ title: "Límites actualizados" }); setOpen(false); onSuccess(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1"><Sliders className="w-3 h-3" /> Límites</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>Editar Límites</DialogTitle><DialogDescription>Deja vacío para mantener valor actual.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Max Usuarios</Label><Input type="number" value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} className="h-9 text-sm" placeholder="ej: 10" /></div>
          <div><Label className="text-xs">Max Números WA</Label><Input type="number" value={maxWa} onChange={(e) => setMaxWa(e.target.value)} className="h-9 text-sm" placeholder="ej: 5" /></div>
          <div><Label className="text-xs">Max Mensajes/Mes</Label><Input type="number" value={maxMsg} onChange={(e) => setMaxMsg(e.target.value)} className="h-9 text-sm" placeholder="ej: 50000" /></div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Cancelar</Button></DialogClose>
          <Button onClick={() => update.mutate({
            tenantId,
            ...(maxUsers ? { maxUsers: Number(maxUsers) } : {}),
            ...(maxWa ? { maxWhatsappNumbers: Number(maxWa) } : {}),
            ...(maxMsg ? { maxMessagesPerMonth: Number(maxMsg) } : {}),
          })} disabled={update.isPending}>
            {update.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ALL USERS PANEL (Cross-Tenant)
   ═══════════════════════════════════════════════════════════════════ */
function AllUsersPanel() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const limit = 50;

  const usersQuery = trpc.superadmin.listAllUsers.useQuery({
    search: search || undefined,
    role: roleFilter !== "all" ? roleFilter as any : undefined,
    limit,
    offset: page * limit,
  });

  const toggleActive = trpc.superadmin.toggleUserActive.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); usersQuery.refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const changeRole = trpc.superadmin.changeUserRole.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); usersQuery.refetch(); },
    onError: (e) => {
      if (e.message.includes("único owner")) {
        if (confirm(`${e.message}\n\n¿Forzar cambio de rol?`)) {
          changeRole.mutate({ ...changeRole.variables!, force: true });
        }
      } else {
        toast({ title: "Error", description: e.message, variant: "destructive" });
      }
    },
  });

  const deleteUser = trpc.superadmin.deleteUser.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); usersQuery.refetch(); },
    onError: (e) => {
      // If sole owner, offer force-delete
      if (e.message.includes("único owner")) {
        if (confirm(`${e.message}\n\n¿Forzar eliminación? El tenant será suspendido automáticamente.`)) {
          deleteUser.mutate({ userId: deleteUser.variables!.userId, force: true });
        }
      } else {
        toast({ title: "Error", description: e.message, variant: "destructive" });
      }
    },
  });

  const [revealedAllResetUrl, setRevealedAllResetUrl] = useState<string | null>(null);
  const resetPw = trpc.superadmin.forcePasswordReset.useMutation({
    onSuccess: (d) => {
      const fullUrl = `${window.location.origin}${d.resetUrl}`;
      setRevealedAllResetUrl(fullUrl);
      toast({ title: "Sesiones invalidadas", description: "Copiá el enlace de reset y compartilo de forma segura.", duration: 5000 });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rows = usersQuery.data?.rows ?? [];
  const total = usersQuery.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2"><Users className="w-5 h-5" /> Usuarios ({total})</h2>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={async () => {
          try {
            const res = await (trpc as any).superadmin.exportAllUsers.query({ limit: 5000 });
            downloadCSV(res ?? [], `users_${Date.now()}.csv`);
          } catch { /* handled by trpc error */ }
        }}>
          <FileDown className="w-3 h-3" /> Exportar CSV
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar por nombre o email..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9 h-9" />
        </div>
        <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(0); }}>
          <SelectTrigger className="h-9 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los roles</SelectItem>
            <SelectItem value="owner">Owner</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="supervisor">Supervisor</SelectItem>
            <SelectItem value="agent">Agent</SelectItem>
            <SelectItem value="viewer">Viewer</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {usersQuery.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin usuarios encontrados.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((u: any) => (
            <div key={u.id} className="flex items-center gap-3 px-3 py-2 rounded text-xs bg-muted/30 hover:bg-muted/50">
              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold shrink-0">
                {(u.name || u.email || "?").charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{u.name || "Sin nombre"}</p>
                <p className="text-[10px] text-muted-foreground truncate">{u.email} · {u.tenantName ?? `T${u.tenantId}`}</p>
              </div>
              <Select value={u.role} onValueChange={(r) => changeRole.mutate({ userId: u.id, role: r as any })}>
                <SelectTrigger className="h-6 w-24 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["owner", "admin", "supervisor", "agent", "viewer"].map(r => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className={`text-[10px] ${u.isActive ? "text-green-500" : "text-red-400"}`}>{u.isActive ? "Activo" : "Inactivo"}</span>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" title={u.isActive ? "Desactivar" : "Activar"} onClick={() => toggleActive.mutate({ userId: u.id, isActive: !u.isActive })}>
                {u.isActive ? <UserX className="w-3 h-3 text-red-400" /> : <UserCheck className="w-3 h-3 text-green-500" />}
              </Button>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" title="Resetear contraseña" onClick={() => confirm(`¿Resetear contraseña de ${u.name || u.email}?`) && resetPw.mutate({ userId: u.id })}>
                <KeyRound className="w-3 h-3 text-amber-500" />
              </Button>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" title="Eliminar usuario" onClick={() => confirm(`¿ELIMINAR permanentemente "${u.name || u.email}"?`) && deleteUser.mutate({ userId: u.id })}>
                <Trash2 className="w-3 h-3 text-red-500" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-xs text-muted-foreground">Página {page + 1} de {Math.ceil(total / limit)}</span>
          <Button variant="outline" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      )}

      {revealedAllResetUrl && (
        <div className="mt-2 flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-md">
          <code className="text-xs font-mono flex-1 select-all break-all">{revealedAllResetUrl}</code>
          <Button variant="ghost" size="sm" className="h-6 text-xs shrink-0" onClick={() => { navigator.clipboard.writeText(revealedAllResetUrl); toast({ title: "Enlace copiado" }); }}>
            Copiar
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-xs shrink-0" onClick={() => setRevealedAllResetUrl(null)}>
            ✕
          </Button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   GLOBAL SEARCH PANEL
   ═══════════════════════════════════════════════════════════════════ */
function GlobalSearchPanel() {
  const [query, setQuery] = useState("");
  const [entities, setEntities] = useState<string[]>(["leads", "conversations"]);
  const { toast } = useToast();

  const searchResult = trpc.superadmin.globalSearch.useQuery(
    { query, entities: entities as any[], limit: 20 },
    { enabled: query.length >= 2 }
  );

  const data = searchResult.data ?? { leads: [], conversations: [], messages: [] };
  const totalResults = data.leads.length + data.conversations.length + data.messages.length;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold flex items-center gap-2"><SearchCode className="w-5 h-5" /> Búsqueda Global Cross-Tenant</h2>
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar leads, conversaciones, mensajes..." value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9 h-9" />
        </div>
        <div className="flex items-center gap-2 text-xs">
          {(["leads", "conversations", "messages"] as const).map((e) => (
            <label key={e} className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={entities.includes(e)} onChange={() => {
                setEntities(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e]);
              }} className="rounded" />
              {e === "leads" ? "Leads" : e === "conversations" ? "Conversaciones" : "Mensajes"}
            </label>
          ))}
        </div>
      </div>

      {query.length < 2 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Ingresa al menos 2 caracteres para buscar.</p>
      ) : searchResult.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : totalResults === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin resultados para "{query}".</p>
      ) : (
        <div className="space-y-4">
          {data.leads.length > 0 && (
            <Card className="p-4">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><Target className="w-4 h-4 text-green-500" /> Leads ({data.leads.length})</h3>
              <div className="space-y-1">
                {data.leads.map((l: any) => (
                  <div key={l.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-muted/30">
                    <span className="font-medium flex-1 truncate">{l.name || l.phone || l.email}</span>
                    <span className="text-muted-foreground truncate">{l.email}</span>
                    <Badge variant="secondary" className="text-[10px]">{l.tenantName}</Badge>
                    <Badge className={`text-[10px] ${STATUS_COLORS[l.status] ?? ""}`}>{l.status}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {data.conversations.length > 0 && (
            <Card className="p-4">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><MessageCircle className="w-4 h-4 text-amber-500" /> Conversaciones ({data.conversations.length})</h3>
              <div className="space-y-1">
                {data.conversations.map((c: any) => (
                  <div key={c.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-muted/30">
                    <span className="font-medium flex-1 truncate">{c.contactName || c.contactPhone}</span>
                    <span className="text-muted-foreground">{c.contactPhone}</span>
                    <Badge variant="secondary" className="text-[10px]">{c.tenantName}</Badge>
                    <span className="text-[10px] text-muted-foreground">{fmtDateTime(c.lastMessageAt)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {data.messages.length > 0 && (
            <Card className="p-4">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><MessageCircle className="w-4 h-4 text-blue-500" /> Mensajes ({data.messages.length})</h3>
              <div className="space-y-1">
                {data.messages.map((m: any) => (
                  <div key={m.id} className="text-xs px-2 py-1.5 rounded bg-muted/30">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">{m.tenantName}</Badge>
                      <span className="text-muted-foreground">{m.sender}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">{fmtDateTime(m.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground truncate">{m.content}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   PLATFORM CONFIG PANEL
   ═══════════════════════════════════════════════════════════════════ */
function PlatformConfigPanel() {
  const { toast } = useToast();
  const config = trpc.superadmin.getPlatformConfig.useQuery();
  const update = trpc.superadmin.updatePlatformConfig.useMutation({
    onSuccess: () => { toast({ title: "Configuración guardada" }); config.refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [companyName, setCompanyName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [language, setLanguage] = useState("");
  const [currency, setCurrency] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [metaAppId, setMetaAppId] = useState("");
  const [metaVerifyToken, setMetaVerifyToken] = useState("");
  const [aiProvider, setAiProvider] = useState("");
  const [aiModel, setAiModel] = useState("");

  // Load config into state when data arrives
  const c = config.data;
  useEffect(() => {
    if (!c) return;
    setCompanyName(c.companyName ?? "");
    setTimezone(c.timezone ?? "");
    setLanguage(c.language ?? "");
    setCurrency(c.currency ?? "");
    const smtp = c.smtpConfig as any;
    if (smtp) { setSmtpHost(smtp.host ?? ""); setSmtpPort(String(smtp.port ?? "")); setSmtpUser(smtp.user ?? ""); setSmtpFrom(smtp.from ?? ""); }
    const meta = c.metaConfig as any;
    if (meta) { setMetaAppId(meta.appId ?? ""); setMetaVerifyToken(meta.verifyToken ?? ""); }
    const ai = c.aiConfig as any;
    if (ai) { setAiProvider(ai.provider ?? ""); setAiModel(ai.model ?? ""); }
  }, [c]);

  if (config.isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!c) return <p className="text-sm text-muted-foreground text-center py-8">No se pudo cargar la configuración de plataforma.</p>;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold flex items-center gap-2"><Settings2 className="w-5 h-5" /> Configuración de Plataforma</h2>

      {/* General */}
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Globe className="w-4 h-4" /> General</h3>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Nombre</Label><Input value={companyName || c.companyName} onChange={(e) => setCompanyName(e.target.value)} className="h-9 text-sm" /></div>
          <div><Label className="text-xs">Timezone</Label><Input value={timezone || c.timezone} onChange={(e) => setTimezone(e.target.value)} className="h-9 text-sm" /></div>
          <div><Label className="text-xs">Idioma</Label><Input value={language || c.language} onChange={(e) => setLanguage(e.target.value)} className="h-9 text-sm" /></div>
          <div><Label className="text-xs">Moneda</Label><Input value={currency || c.currency} onChange={(e) => setCurrency(e.target.value)} className="h-9 text-sm" /></div>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1" onClick={() => update.mutate({ companyName: companyName || undefined, timezone: timezone || undefined, language: language || undefined, currency: currency || undefined })} disabled={update.isPending}>
          <Save className="w-3 h-3" /> Guardar General
        </Button>
      </Card>

      {/* SMTP */}
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><MailIcon className="w-4 h-4" /> SMTP (Email)</h3>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Host</Label><Input value={smtpHost || ((c.smtpConfig as any)?.host ?? "")} onChange={(e) => setSmtpHost(e.target.value)} className="h-9 text-sm" placeholder="smtp.gmail.com" /></div>
          <div><Label className="text-xs">Port</Label><Input value={smtpPort || String((c.smtpConfig as any)?.port ?? "")} onChange={(e) => setSmtpPort(e.target.value)} className="h-9 text-sm" placeholder="587" /></div>
          <div><Label className="text-xs">User</Label><Input value={smtpUser || ((c.smtpConfig as any)?.user ?? "")} onChange={(e) => setSmtpUser(e.target.value)} className="h-9 text-sm" /></div>
          <div><Label className="text-xs">From</Label><Input value={smtpFrom || ((c.smtpConfig as any)?.from ?? "")} onChange={(e) => setSmtpFrom(e.target.value)} className="h-9 text-sm" placeholder="noreply@example.com" /></div>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1" onClick={() => update.mutate({
          smtpConfig: { host: smtpHost, port: Number(smtpPort) || 587, secure: false, user: smtpUser, from: smtpFrom },
        })} disabled={update.isPending}>
          <Save className="w-3 h-3" /> Guardar SMTP
        </Button>
      </Card>

      {/* Meta/WhatsApp */}
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Phone className="w-4 h-4" /> Meta / WhatsApp API</h3>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">App ID</Label><Input value={metaAppId || ((c.metaConfig as any)?.appId ?? "")} onChange={(e) => setMetaAppId(e.target.value)} className="h-9 text-sm" /></div>
          <div><Label className="text-xs">Verify Token</Label><Input value={metaVerifyToken || ((c.metaConfig as any)?.verifyToken ?? "")} onChange={(e) => setMetaVerifyToken(e.target.value)} className="h-9 text-sm" /></div>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1" onClick={() => update.mutate({
          metaConfig: { appId: metaAppId, verifyToken: metaVerifyToken },
        })} disabled={update.isPending}><Save className="w-3 h-3" /> Guardar Meta</Button>
      </Card>

      {/* AI */}
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Bot className="w-4 h-4" /> AI Configuration</h3>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Provider</Label><Input value={aiProvider || ((c.aiConfig as any)?.provider ?? "")} onChange={(e) => setAiProvider(e.target.value)} className="h-9 text-sm" placeholder="openai / anthropic" /></div>
          <div><Label className="text-xs">Model</Label><Input value={aiModel || ((c.aiConfig as any)?.model ?? "")} onChange={(e) => setAiModel(e.target.value)} className="h-9 text-sm" placeholder="gpt-4o-mini" /></div>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1" onClick={() => update.mutate({
          aiConfig: { provider: aiProvider as any, model: aiModel },
        })} disabled={update.isPending}><Save className="w-3 h-3" /> Guardar AI</Button>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ALERTS PANEL
   ═══════════════════════════════════════════════════════════════════ */
function AlertsPanel() {
  const { toast } = useToast();
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const limit = 50;

  const alerts = trpc.superadmin.listAlerts.useQuery({
    type: typeFilter !== "all" ? typeFilter as any : undefined,
    limit,
    offset: page * limit,
  }, { refetchInterval: 30000 });

  const markRead = trpc.superadmin.markAlertRead.useMutation({
    onSuccess: () => { alerts.refetch(); },
  });

  const generate = trpc.superadmin.generateAlerts.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); alerts.refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rows = alerts.data?.rows ?? [];
  const total = alerts.data?.total ?? 0;
  const unread = alerts.data?.unreadCount ?? 0;

  const SEVERITY_COLORS: Record<string, string> = {
    info: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    warning: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    critical: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  };

  const TYPE_LABELS: Record<string, string> = {
    trial_expiring: "Trial Expira",
    quota_exceeded: "Cuota Excedida",
    new_tenant: "Nuevo Tenant",
    error: "Error",
    churn_risk: "Riesgo Churn",
    security: "Seguridad",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Bell className="w-5 h-5" /> Alertas
          {unread > 0 && <Badge variant="destructive" className="text-xs">{unread} sin leer</Badge>}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Generar Alertas
          </Button>
          {unread > 0 && (
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => markRead.mutate({ all: true })}>
              <CheckCircle2 className="w-3 h-3" /> Marcar todas leídas
            </Button>
          )}
        </div>
      </div>

      <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
        <SelectTrigger className="h-9 w-48 text-xs"><SelectValue placeholder="Filtrar por tipo" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los tipos</SelectItem>
          <SelectItem value="trial_expiring">Trial Expira</SelectItem>
          <SelectItem value="quota_exceeded">Cuota Excedida</SelectItem>
          <SelectItem value="new_tenant">Nuevo Tenant</SelectItem>
          <SelectItem value="churn_risk">Riesgo Churn</SelectItem>
          <SelectItem value="error">Error</SelectItem>
          <SelectItem value="security">Seguridad</SelectItem>
        </SelectContent>
      </Select>

      {alerts.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin alertas. Pulsa "Generar Alertas" para escanear trials y churn.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((a: any) => (
            <Card key={a.id} className={`p-3 ${a.isRead ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className={`text-[10px] uppercase ${SEVERITY_COLORS[a.severity] ?? ""}`}>{a.severity}</Badge>
                    <Badge variant="outline" className="text-[10px]">{TYPE_LABELS[a.type] ?? a.type}</Badge>
                    <span className="text-sm font-semibold">{a.title}</span>
                    {a.tenantName && <span className="text-[10px] text-muted-foreground">· {a.tenantName}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{a.message}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{fmtDateTime(a.createdAt)}</p>
                </div>
                {!a.isRead && (
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => markRead.mutate({ alertId: a.id })}>
                    Leída
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {total > limit && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-xs text-muted-foreground">Página {page + 1} de {Math.ceil(total / limit)}</span>
          <Button variant="outline" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SUPERADMIN AUDIT LOG PANEL
   ═══════════════════════════════════════════════════════════════════ */
function SuperadminAuditPanel() {
  const [page, setPage] = useState(0);
  const limit = 50;

  const audit = trpc.superadmin.superadminAuditLog.useQuery({
    limit,
    offset: page * limit,
  });

  const rows = audit.data?.rows ?? [];
  const total = audit.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-violet-500" /> Acciones del SuperAdmin ({total})</h3>

      {audit.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin acciones registradas aún.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r: any) => (
            <div key={r.id} className="flex items-center gap-2 text-xs px-3 py-2 rounded bg-muted/30">
              <Shield className="w-3 h-3 text-violet-500 shrink-0" />
              <span className="font-mono text-[10px] text-violet-600 dark:text-violet-400">{r.action}</span>
              <span className="text-muted-foreground flex-1 truncate">
                {r.userName ?? `User#${r.userId}`} {r.tenantName ? `· ${r.tenantName}` : ""}
              </span>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">{fmtDateTime(r.createdAt)}</span>
              {r.details && (
                <span className="text-[10px] text-muted-foreground max-w-[200px] truncate" title={JSON.stringify(r.details)}>
                  {JSON.stringify(r.details).slice(0, 60)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {total > limit && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-xs text-muted-foreground">Página {page + 1} de {Math.ceil(total / limit)}</span>
          <Button variant="outline" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   IMPERSONATION AUDIT PANEL
   ═══════════════════════════════════════════════════════════════════ */
function ImpersonationAuditPanel() {
  const events = trpc.superadmin.listImpersonationEvents.useQuery({ limit: 100, offset: 0 });
  const stats = trpc.superadmin.getImpersonationStats.useQuery();

  const rows = events.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold flex items-center gap-2"><Eye className="w-5 h-5 text-amber-500" /> Registro de Impersonaciones ({events.data?.total ?? 0})</h2>

      {/* Stats summary */}
      {stats.isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : stats.data && (
        <div className="grid grid-cols-2 gap-4">
          <Card className="p-3">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">Por Admin</h3>
            {(stats.data.byAdmin as any[]).map((a: any) => (
              <div key={a.userId} className="flex items-center justify-between text-xs py-1">
                <span>{a.name || a.email}</span><Badge variant="secondary">{a.cnt}</Badge>
              </div>
            ))}
          </Card>
          <Card className="p-3">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">Por Tenant</h3>
            {(stats.data.byTenant as any[]).map((t: any) => (
              <div key={t.tenantId} className="flex items-center justify-between text-xs py-1">
                <span>{t.tenantName}</span><Badge variant="secondary">{t.cnt}</Badge>
              </div>
            ))}
          </Card>
        </div>
      )}

      {events.isLoading || events.isError ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin registros de impersonación.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r: any) => (
            <div key={r.id} className="flex items-center gap-2 text-xs px-3 py-2 rounded bg-muted/30">
              <Eye className="w-3 h-3 text-amber-500 shrink-0" />
              <span className="font-medium">{r.adminName || r.adminEmail}</span>
              <span className="text-muted-foreground">→</span>
              <Badge variant="outline" className="text-[10px]">{r.targetTenantName || `T#${r.targetTenantId}`}</Badge>
              <span className="text-[10px] text-muted-foreground ml-auto">{fmtDateTime(r.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ONBOARDING TRACKER PANEL
   ═══════════════════════════════════════════════════════════════════ */
function OnboardingTrackerPanel() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const progress = trpc.superadmin.listOnboardingProgress.useQuery({ status: statusFilter as any, limit: 100, offset: 0 });
  const rows = progress.data?.rows ?? [];

  const STEPS = ["companyCompleted", "teamCompleted", "whatsappCompleted", "importCompleted", "firstMessageCompleted"] as const;
  const STEP_LABELS: Record<string, string> = {
    companyCompleted: "Empresa", teamCompleted: "Equipo", whatsappCompleted: "WhatsApp",
    importCompleted: "Importar", firstMessageCompleted: "1er Mensaje",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-blue-500" /> Onboarding Tracker ({progress.data?.total ?? 0})</h2>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="completed">Completados</SelectItem>
            <SelectItem value="in_progress">En Progreso</SelectItem>
            <SelectItem value="stalled">Estancados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {progress.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin datos de onboarding.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r: any) => {
            const completed = STEPS.filter(s => r[s]).length;
            const pct = Math.round((completed / STEPS.length) * 100);
            const isStalled = !r.completedAt && r.hoursElapsed > 72;
            return (
              <Card key={r.id} className={`p-3 ${isStalled ? "border-amber-400" : ""}`}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold">{r.tenantName}</span>
                      <Badge className={`text-[10px] ${r.completedAt ? "bg-green-100 text-green-700" : isStalled ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                        {r.completedAt ? "Completado" : isStalled ? "Estancado" : "En progreso"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">{r.plan}</Badge>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {STEPS.map(s => (
                        <span key={s} className={`text-[9px] px-1.5 py-0.5 rounded ${r[s] ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-muted text-muted-foreground"}`}>
                          {STEP_LABELS[s]}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <p className="font-bold text-lg">{pct}%</p>
                    <p className="text-[10px] text-muted-foreground">{Math.round(r.hoursElapsed)}h transcurridas</p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   WORKFLOW OVERSIGHT PANEL
   ═══════════════════════════════════════════════════════════════════ */
function WorkflowOversightPanel() {
  const { toast } = useToast();
  const wfStats = trpc.superadmin.getWorkflowStats.useQuery();
  const wfList = trpc.superadmin.listAllWorkflows.useQuery({ limit: 100, offset: 0 });
  const [errorsFor, setErrorsFor] = useState<number | null>(null);
  const wfErrors = trpc.superadmin.getWorkflowErrors.useQuery({ workflowId: errorsFor ?? 0 }, { enabled: errorsFor !== null });
  const toggleWf = trpc.superadmin.toggleWorkflowActive.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); wfList.refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const s = wfStats.data;
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold flex items-center gap-2"><Workflow className="w-5 h-5 text-indigo-500" /> Workflows ({wfList.data?.total ?? 0})</h2>

      {wfStats.isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : s && (
        <div className="grid grid-cols-5 gap-3">
          <Card className="p-3 text-center"><p className="text-2xl font-bold">{Number(s.totalWorkflows)}</p><p className="text-[10px] text-muted-foreground">Total</p></Card>
          <Card className="p-3 text-center"><p className="text-2xl font-bold text-green-500">{Number(s.activeWorkflows)}</p><p className="text-[10px] text-muted-foreground">Activos</p></Card>
          <Card className="p-3 text-center"><p className="text-2xl font-bold">{Number(s.executions24h)}</p><p className="text-[10px] text-muted-foreground">Ejecuciones 24h</p></Card>
          <Card className="p-3 text-center"><p className="text-2xl font-bold text-red-500">{Number(s.failures24h)}</p><p className="text-[10px] text-muted-foreground">Fallos 24h</p></Card>
          <Card className="p-3 text-center"><p className="text-2xl font-bold text-amber-500">{Number(s.pendingJobs)}</p><p className="text-[10px] text-muted-foreground">Jobs Pendientes</p></Card>
        </div>
      )}

      {wfList.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="space-y-1">
          {(wfList.data?.rows ?? []).map((w: any) => {
            const total = Number(w.successCount) + Number(w.failCount);
            const rate = total > 0 ? Math.round((Number(w.successCount) / total) * 100) : 0;
            return (
              <div key={w.id} className="flex items-center gap-2 text-xs px-3 py-2 rounded bg-muted/30 hover:bg-muted/50">
                <Switch checked={w.isActive} onCheckedChange={(v) => toggleWf.mutate({ workflowId: w.id, isActive: v })} />
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{w.name}</span>
                  <span className="text-muted-foreground ml-2">{w.tenantName} · {w.triggerType}</span>
                </div>
                <span className="text-[10px] text-muted-foreground">{total} ejecuciones</span>
                <Badge className={`text-[10px] ${rate >= 90 ? "bg-green-100 text-green-700" : rate >= 50 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{rate}% éxito</Badge>
                <Badge variant="secondary" className="text-[10px]">{Number(w.pendingJobs)} pendientes</Badge>
                {Number(w.failCount) > 0 && (
                  <Button variant="ghost" size="sm" className="h-5 text-[10px] text-red-500" onClick={() => setErrorsFor(w.id)}>Ver errores</Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Error detail modal */}
      <Dialog open={errorsFor !== null} onOpenChange={() => setErrorsFor(null)}>
        <DialogContent className="max-w-lg max-h-[60vh] overflow-auto">
          <DialogHeader><DialogTitle>Errores del Workflow</DialogTitle></DialogHeader>
          {wfErrors.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
            <div className="space-y-1">
              {(wfErrors.data ?? []).map((e: any) => (
                <div key={e.id} className="text-xs p-2 rounded bg-red-50 dark:bg-red-950">
                  <p className="text-red-700 dark:text-red-300">{e.details}</p>
                  <p className="text-[10px] text-muted-foreground">{fmtDateTime(e.createdAt)} · {e.tenantName}</p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   WEBHOOK MANAGEMENT PANEL
   ═══════════════════════════════════════════════════════════════════ */
function WebhookManagementPanel() {
  const { toast } = useToast();
  const whList = trpc.superadmin.listAllWebhooks.useQuery({ limit: 100, offset: 0 });
  const [deliveryFor, setDeliveryFor] = useState<number | null>(null);
  const deliveries = trpc.superadmin.getWebhookDeliveries.useQuery({ webhookId: deliveryFor ?? 0 }, { enabled: deliveryFor !== null });
  const toggle = trpc.superadmin.toggleWebhook.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); whList.refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold flex items-center gap-2"><Globe className="w-5 h-5 text-cyan-500" /> Webhooks ({whList.data?.total ?? 0})</h2>

      {whList.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (whList.data?.rows ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin webhooks registrados.</p>
      ) : (
        <div className="space-y-1">
          {(whList.data?.rows ?? []).map((w: any) => {
            const total = Number(w.totalDeliveries);
            const ok = Number(w.successDeliveries);
            const rate = total > 0 ? Math.round((ok / total) * 100) : 0;
            return (
              <div key={w.id} className="flex items-center gap-2 text-xs px-3 py-2 rounded bg-muted/30">
                <Switch checked={w.active} onCheckedChange={(v) => toggle.mutate({ webhookId: w.id, active: v })} />
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{w.name}</span>
                  <span className="text-muted-foreground ml-2 text-[10px]">{w.tenantName} · {w.url?.slice(0, 40)}...</span>
                </div>
                <span className="text-[10px] text-muted-foreground">{total} entregas</span>
                <Badge className={`text-[10px] ${rate >= 90 ? "bg-green-100 text-green-700" : rate >= 50 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{rate}% éxito</Badge>
                <Button variant="ghost" size="sm" className="h-5 text-[10px]" onClick={() => setDeliveryFor(w.id)}>Entregas</Button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={deliveryFor !== null} onOpenChange={() => setDeliveryFor(null)}>
        <DialogContent className="max-w-md max-h-[60vh] overflow-auto">
          <DialogHeader><DialogTitle>Entregas Recientes</DialogTitle></DialogHeader>
          {deliveries.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
            <div className="space-y-1">
              {(deliveries.data ?? []).map((d: any) => (
                <div key={d.id} className={`text-xs p-2 rounded ${d.success ? "bg-green-50 dark:bg-green-950" : "bg-red-50 dark:bg-red-950"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{d.event}</span>
                    <Badge className={`text-[10px] ${d.success ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{d.responseStatus}</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{fmtDateTime(d.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CAMPAIGN MONITORING PANEL
   ═══════════════════════════════════════════════════════════════════ */
function CampaignMonitoringPanel() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const stats = trpc.superadmin.getCampaignStats.useQuery();
  const campaigns = trpc.superadmin.listAllCampaigns.useQuery({ status: statusFilter as any, limit: 100, offset: 0 });

  const s = stats.data;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2"><Megaphone className="w-5 h-5 text-pink-500" /> Campañas ({campaigns.data?.total ?? 0})</h2>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {stats.isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : s && (
        <div className="grid grid-cols-4 gap-3">
          <Card className="p-3 text-center"><p className="text-2xl font-bold text-green-500">{Number(s.running)}</p><p className="text-[10px] text-muted-foreground">Running</p></Card>
          <Card className="p-3 text-center"><p className="text-2xl font-bold">{Number(s.totalSent)}</p><p className="text-[10px] text-muted-foreground">Enviados</p></Card>
          <Card className="p-3 text-center"><p className="text-2xl font-bold text-blue-500">{Number(s.totalDelivered)}</p><p className="text-[10px] text-muted-foreground">Entregados</p></Card>
          <Card className="p-3 text-center"><p className="text-2xl font-bold text-red-500">{Number(s.totalFailed)}</p><p className="text-[10px] text-muted-foreground">Fallidos</p></Card>
        </div>
      )}

      {campaigns.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (campaigns.data?.rows ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin campañas.</p>
      ) : (
        <div className="space-y-1">
          {(campaigns.data?.rows ?? []).map((c: any) => {
            const delivRate = Number(c.messagesSent) > 0 ? Math.round((Number(c.messagesDelivered) / Number(c.messagesSent)) * 100) : 0;
            return (
              <div key={c.id} className="flex items-center gap-2 text-xs px-3 py-2 rounded bg-muted/30">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground ml-2">{c.tenantName} · {c.type}</span>
                </div>
                <Badge className={`text-[10px] ${STATUS_COLORS[c.status] ?? ""}`}>{c.status}</Badge>
                <span className="text-[10px] text-muted-foreground">{c.messagesSent}/{c.totalRecipients} enviados</span>
                <Badge className={`text-[10px] ${delivRate >= 90 ? "bg-green-100 text-green-700" : delivRate >= 50 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{delivRate}% entrega</Badge>
                <span className="text-[10px] text-muted-foreground">{fmtDateTime(c.startedAt || c.scheduledAt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TEMPLATE OVERSIGHT PANEL
   ═══════════════════════════════════════════════════════════════════ */
function TemplateOversightPanel() {
  const { toast } = useToast();
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const tplList = trpc.superadmin.listAllTemplates.useQuery({ type: typeFilter as any, limit: 100, offset: 0 });
  const tplStats = trpc.superadmin.getTemplateStats.useQuery();
  const copyTpl = trpc.superadmin.copyTemplateToTenant.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); tplList.refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const [copyTarget, setCopyTarget] = useState<{ templateId: number; targetTenantId: string } | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2"><Code className="w-5 h-5 text-teal-500" /> Templates ({tplList.data?.total ?? 0})</h2>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-32 h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="email">Email</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Template Stats per Tenant */}
      {(tplStats.data ?? []).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {(tplStats.data ?? []).map((s: any) => (
            <Card key={s.id} className="p-2">
              <p className="text-xs font-semibold truncate">{s.tenantName}</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-[9px]">WA: {s.whatsappCount}</Badge>
                <Badge variant="outline" className="text-[9px]">Email: {s.emailCount}</Badge>
                <Badge className="text-[9px] bg-muted">{s.totalTemplates} total</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}

      {tplList.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (tplList.data?.rows ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin templates.</p>
      ) : (
        <div className="space-y-1">
          {(tplList.data?.rows ?? []).map((t: any) => (
            <div key={t.id} className="flex items-center gap-2 text-xs px-3 py-2 rounded bg-muted/30">
              <div className="flex-1 min-w-0">
                <span className="font-medium">{t.name}</span>
                <span className="text-muted-foreground ml-2">{t.tenantName}</span>
              </div>
              <Badge variant="outline" className="text-[10px]">{t.type}</Badge>
              <span className="text-[10px] text-muted-foreground max-w-[200px] truncate">{t.content?.slice(0, 60)}</span>
              <Button variant="ghost" size="sm" className="h-5 text-[10px]" onClick={() => setCopyTarget({ templateId: t.id, targetTenantId: "" })}>
                <Copy className="w-3 h-3 mr-1" /> Copiar a…
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={copyTarget !== null} onOpenChange={() => setCopyTarget(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>Copiar Template</DialogTitle></DialogHeader>
          <Input placeholder="ID del tenant destino" value={copyTarget?.targetTenantId ?? ""} onChange={(e) => setCopyTarget(prev => prev ? { ...prev, targetTenantId: e.target.value } : null)} className="h-9 text-sm" />
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">Cancelar</Button></DialogClose>
            <Button onClick={() => {
              if (copyTarget) copyTpl.mutate({ templateId: copyTarget.templateId, targetTenantId: Number(copyTarget.targetTenantId) });
              setCopyTarget(null);
            }} disabled={!copyTarget?.targetTenantId}>Copiar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   LICENSE MANAGEMENT PANEL
   ═══════════════════════════════════════════════════════════════════ */
function LicenseManagementPanel() {
  const { toast } = useToast();
  const licList = trpc.superadmin.listAllLicenses.useQuery({ limit: 100, offset: 0 });
  const rotateKey = trpc.superadmin.rotateLicenseKey.useMutation({
    onSuccess: (d) => { toast({ title: "Clave rotada", description: d.newKey, duration: 10000 }); licList.refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const updateStatus = trpc.superadmin.updateLicenseStatus.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); licList.refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const updateFeatures = trpc.superadmin.updateLicenseFeatures.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); licList.refetch(); setEditFeaturesTarget(null); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [editFeaturesTarget, setEditFeaturesTarget] = useState<{ licenseId: number; features: string } | null>(null);

  const STATUS_COLORS_LIC: Record<string, string> = {
    active: "bg-green-100 text-green-700", expired: "bg-red-100 text-red-700",
    canceled: "bg-gray-100 text-gray-600", trial: "bg-blue-100 text-blue-700",
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold flex items-center gap-2"><KeyRound className="w-5 h-5 text-amber-500" /> Licencias ({licList.data?.total ?? 0})</h2>

      {licList.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (licList.data?.rows ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin licencias registradas.</p>
      ) : (
        <div className="space-y-1">
          {(licList.data?.rows ?? []).map((l: any) => (
            <div key={l.id} className="flex items-center gap-2 text-xs px-3 py-2 rounded bg-muted/30">
              <div className="flex-1 min-w-0">
                <span className="font-medium">{l.tenantName}</span>
                <span className="text-[10px] text-muted-foreground ml-2 font-mono">{l.key?.slice(0, 20)}...</span>
              </div>
              <Badge className={`text-[10px] ${STATUS_COLORS_LIC[l.status] ?? ""}`}>{l.status}</Badge>
              <span className="text-[10px] text-muted-foreground">{l.maxUsers}u / {l.maxWhatsappNumbers}wa / {l.maxMessagesPerMonth}msg</span>
              <Select value={l.status} onValueChange={(v) => updateStatus.mutate({ licenseId: l.id, status: v as any })}>
                <SelectTrigger className="h-6 w-20 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["active", "expired", "canceled", "trial"].map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" className="h-5 text-[10px]" onClick={() => confirm("¿Rotar clave de licencia?") && rotateKey.mutate({ licenseId: l.id })}>
                <RefreshCw className="w-3 h-3 mr-1" /> Rotar
              </Button>
              <Button variant="ghost" size="sm" className="h-5 text-[10px]" onClick={() => setEditFeaturesTarget({ licenseId: l.id, features: (l.features ?? []).join(", ") })}>
                <Sliders className="w-3 h-3 mr-1" /> Features
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Edit Features Dialog */}
      <Dialog open={editFeaturesTarget !== null} onOpenChange={() => setEditFeaturesTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Editar Features de Licencia</DialogTitle></DialogHeader>
          <DialogDescription className="text-xs">Ingresa features separados por coma (ej: whatsapp, email, workflows)</DialogDescription>
          <Textarea
            value={editFeaturesTarget?.features ?? ""}
            onChange={(e) => setEditFeaturesTarget(prev => prev ? { ...prev, features: e.target.value } : null)}
            className="text-sm"
            rows={3}
            placeholder="whatsapp, email, workflows, campaigns"
          />
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">Cancelar</Button></DialogClose>
            <Button
              onClick={() => {
                if (editFeaturesTarget) {
                  const features = editFeaturesTarget.features.split(",").map(s => s.trim()).filter(Boolean);
                  updateFeatures.mutate({ licenseId: editFeaturesTarget.licenseId, features });
                }
              }}
              disabled={updateFeatures.isPending}
            >
              {updateFeatures.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TENANT COMPARISON PANEL
   ═══════════════════════════════════════════════════════════════════ */
function TenantComparisonPanel() {
  const [ids, setIds] = useState<string>("");
  const tenantIds = ids.split(",").map(s => Number(s.trim())).filter(n => n > 0);
  const comp = trpc.superadmin.compareTenants.useQuery(
    { tenantIds },
    { enabled: tenantIds.length >= 2 }
  );

  const METRICS = [
    { key: "activeUsers", label: "Usuarios Activos" },
    { key: "totalLeads", label: "Leads" },
    { key: "totalConversations", label: "Conversaciones" },
    { key: "totalMessages", label: "Mensajes" },
    { key: "waNumbers", label: "Números WA" },
    { key: "activeWorkflows", label: "Workflows Activos" },
    { key: "totalCampaigns", label: "Campañas" },
    { key: "storageBytes", label: "Storage (bytes)" },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold flex items-center gap-2"><BarChart3 className="w-5 h-5 text-violet-500" /> Comparar Tenants</h2>
      <div className="flex items-center gap-2">
        <Input value={ids} onChange={(e) => setIds(e.target.value)} placeholder="IDs separados por coma (ej: 1,2,3)" className="h-9 max-w-xs" />
        <span className="text-xs text-muted-foreground">{tenantIds.length >= 2 ? `${tenantIds.length} tenants seleccionados` : "Mínimo 2 IDs"}</span>
      </div>

      {comp.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : tenantIds.length < 2 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Ingresa al menos 2 IDs de tenants para comparar.</p>
      ) : (comp.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin datos para esos IDs.</p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b">
                <th className="py-2 px-3 text-left font-semibold">Métrica</th>
                {(comp.data ?? []).map((t: any) => (
                  <th key={t.id} className="py-2 px-3 text-center font-semibold">
                    {t.name} <Badge variant="outline" className="text-[9px] ml-1">{t.plan}</Badge>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map(m => (
                <tr key={m.key} className="border-b hover:bg-muted/30">
                  <td className="py-1.5 px-3 font-medium">{m.label}</td>
                  {(comp.data ?? []).map((t: any) => {
                    const val = Number(t[m.key] ?? 0);
                    const max = Math.max(...(comp.data ?? []).map((x: any) => Number(x[m.key] ?? 0)));
                    return (
                      <td key={t.id} className={`py-1.5 px-3 text-center ${val === max && max > 0 ? "font-bold text-green-600" : ""}`}>
                        {m.key === "storageBytes" ? fmtBytes(val) : val.toLocaleString()}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   HEALTH SCORE PANEL
   ═══════════════════════════════════════════════════════════════════ */
function HealthScorePanel() {
  const scores = trpc.superadmin.computeHealthScores.useQuery();

  const scoreColor = (s: number) => s >= 70 ? "text-green-600" : s >= 40 ? "text-amber-500" : "text-red-500";
  const scoreBg = (s: number) => s >= 70 ? "bg-green-100" : s >= 40 ? "bg-amber-100" : "bg-red-100";

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold flex items-center gap-2"><Activity className="w-5 h-5 text-green-500" /> Health Scores</h2>

      {scores.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (scores.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin datos.</p>
      ) : (
        <div className="space-y-1">
          {(scores.data ?? []).sort((a: any, b: any) => a.healthScore - b.healthScore).map((t: any) => (
            <div key={t.id} className="flex items-center gap-3 text-xs px-3 py-2 rounded bg-muted/30">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${scoreBg(t.healthScore)} ${scoreColor(t.healthScore)}`}>
                {t.healthScore}
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-medium text-sm">{t.name}</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="outline" className="text-[10px]">{t.plan}</Badge>
                  <span className="text-[10px] text-muted-foreground">{t.activeUsers} usuarios · {t.recentLeads} leads 7d · {t.recentMessages} msgs 7d</span>
                </div>
              </div>
              <span className="text-[10px] text-muted-foreground">{t.lastActivity ? `Último: ${fmtDateTime(t.lastActivity)}` : "Sin actividad"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CHURN PREDICTION PANEL
   ═══════════════════════════════════════════════════════════════════ */
function ChurnPredictionPanel() {
  const churn = trpc.superadmin.churnPrediction.useQuery();

  const riskColor = (s: number) => s >= 60 ? "text-red-600" : s >= 30 ? "text-amber-500" : "text-green-600";
  const riskBg = (s: number) => s >= 60 ? "bg-red-100" : s >= 30 ? "bg-amber-100" : "bg-green-100";

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold flex items-center gap-2"><TrendingUp className="w-5 h-5 text-red-500" /> Predicción de Churn</h2>

      {churn.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (churn.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin datos.</p>
      ) : (
        <div className="space-y-2">
          {(churn.data ?? []).map((t: any) => (
            <Card key={t.id} className={`p-3 ${t.churnScore >= 60 ? "border-red-300" : ""}`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${riskBg(t.churnScore)} ${riskColor(t.churnScore)}`}>
                  {t.churnScore}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    <Badge variant="outline" className="text-[10px]">{t.plan}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {t.factors.map((f: string, i: number) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300">{f}</span>
                    ))}
                  </div>
                </div>
                <div className="text-right text-[10px] text-muted-foreground">
                  <p>{t.messagesLast7d} msgs 7d</p>
                  <p>{t.leadsLast7d} leads 7d</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAINTENANCE MODE PANEL
   ═══════════════════════════════════════════════════════════════════ */
function MaintenanceModePanel() {
  const { toast } = useToast();
  const status = trpc.superadmin.getMaintenanceStatus.useQuery();
  const [msg, setMsg] = useState("");
  const setMaintenance = trpc.superadmin.setMaintenanceMode.useMutation({
    onSuccess: (d) => { toast({ title: d.message }); status.refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" /> Modo Mantenimiento</h2>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Mantenimiento Global de Plataforma</h3>
            <p className="text-xs text-muted-foreground">Bloquea acceso a todos los tenants (excepto SuperAdmin).</p>
          </div>
          {status.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
            <Switch
              checked={status.data?.platformMaintenance ?? false}
              onCheckedChange={(v) => setMaintenance.mutate({ enabled: v, message: msg || "Sistema en mantenimiento. Volvemos pronto." })}
            />
          )}
        </div>
        <div>
          <Label className="text-xs">Mensaje de mantenimiento</Label>
          <Textarea
            value={msg || status.data?.message || ""}
            onChange={(e) => setMsg(e.target.value)}
            className="text-sm"
            rows={2}
            placeholder="Sistema en mantenimiento. Volvemos pronto."
          />
        </div>
        {status.data?.platformMaintenance && (
          <Badge variant="destructive" className="text-sm"><AlertTriangle className="w-4 h-4 mr-1" /> MANTENIMIENTO ACTIVO</Badge>
        )}
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   STORAGE OVERVIEW PANEL
   ═══════════════════════════════════════════════════════════════════ */
function StorageOverviewPanel() {
  const storage = trpc.superadmin.storageOverview.useQuery();
  const totalBytes = (storage.data ?? []).reduce((s: number, r: any) => s + Number(r.totalBytes), 0);

  const [retentionDays, setRetentionDays] = useState(365);
  const [purgeDataType, setPurgeDataType] = useState<string>("messages");
  const [showPurgePreview, setShowPurgePreview] = useState(false);
  const purgePreview = trpc.superadmin.previewRetentionPurge.useQuery(
    { retentionDays, dataType: purgeDataType as any },
    { enabled: showPurgePreview }
  );

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold flex items-center gap-2"><HardDrive className="w-5 h-5 text-gray-500" /> Storage por Tenant — Total: {fmtBytes(totalBytes)}</h2>

      {storage.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (storage.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin datos de archivos.</p>
      ) : (
        <div className="space-y-1">
          {(storage.data ?? []).map((r: any) => {
            const pct = totalBytes > 0 ? (Number(r.totalBytes) / totalBytes) * 100 : 0;
            return (
              <div key={r.tenantId} className="flex items-center gap-3 text-xs px-3 py-2 rounded bg-muted/30">
                <span className="font-medium flex-1">{r.tenantName}</span>
                <Badge variant="outline" className="text-[10px]">{r.plan}</Badge>
                <span className="text-muted-foreground">{Number(r.fileCount)} archivos</span>
                <span className="font-mono font-bold">{fmtBytes(Number(r.totalBytes))}</span>
                <div className="w-20 h-2 rounded bg-muted overflow-hidden">
                  <div className="h-full bg-blue-500 rounded" style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
                <span className="text-[10px] text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview Retention Purge */}
      <Separator />
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-red-500" /> Vista Previa de Purga por Retención
        </h3>
        <p className="text-xs text-muted-foreground">Previsualiza cuántos registros se eliminarían aplicando una política de retención.</p>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <Label className="text-xs">Tipo de datos</Label>
            <Select value={purgeDataType} onValueChange={(v) => { setPurgeDataType(v); setShowPurgePreview(false); }}>
              <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="messages">Mensajes</SelectItem>
                <SelectItem value="activity_logs">Activity Logs</SelectItem>
                <SelectItem value="access_logs">Access Logs</SelectItem>
                <SelectItem value="files">Archivos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Retención (días)</Label>
            <Input type="number" min={30} max={3650} value={retentionDays} onChange={(e) => { setRetentionDays(Number(e.target.value)); setShowPurgePreview(false); }} className="w-28 h-8 text-xs" />
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => { setShowPurgePreview(true); purgePreview.refetch(); }}>
            <Search className="w-3 h-3" /> Previsualizar
          </Button>
        </div>
        {showPurgePreview && (
          <div className="text-sm mt-2">
            {purgePreview.isLoading ? (
              <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Calculando...</span>
            ) : purgePreview.isError ? (
              <span className="text-red-500 text-xs">Error al calcular la purga.</span>
            ) : (
              <div className="flex items-center gap-2">
                <Badge variant={purgePreview.data?.count ? "destructive" : "secondary"} className="text-sm">
                  {(purgePreview.data?.count ?? 0).toLocaleString()} registros
                </Badge>
                <span className="text-xs text-muted-foreground">
                  de tipo <strong>{purgeDataType}</strong> con más de <strong>{retentionDays}</strong> días serían eliminados.
                </span>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   PLATFORM META / WHATSAPP CONFIGURATION PANEL
   ════════════════════════════════════════════════════════════════════════════ */

function PlatformMetaConfigPanel() {
  const { toast } = useToast();
  const metaQuery = trpc.superadmin.getPlatformMetaConfig.useQuery();
  const saveMeta = trpc.superadmin.savePlatformMetaConfig.useMutation({
    onSuccess: () => { toast({ title: "Configuración de Meta guardada" }); metaQuery.refetch(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [configId, setConfigId] = useState("");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (metaQuery.data && !initialized) {
      setAppId(metaQuery.data.appId ?? "");
      setConfigId(metaQuery.data.configId ?? "");
      setInitialized(true);
    }
  }, [metaQuery.data, initialized]);

  const isConfigured = !!metaQuery.data?.appId && !!metaQuery.data?.hasSecret;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold flex items-center gap-2">
        <Globe className="w-5 h-5 text-blue-500" /> Configuración de Meta para la Plataforma
      </h2>
      <p className="text-sm text-muted-foreground">
        Configura tu Meta App <strong>una sola vez</strong>. Todos los tenants heredarán esta configuración automáticamente
        y podrán conectar su WhatsApp con solo hacer clic en "Conectar WhatsApp" → iniciar sesión con Facebook → dar permisos.
      </p>

      {/* Status indicator */}
      <Card className={`p-4 border-2 ${isConfigured ? "border-green-200 bg-green-50/50 dark:bg-green-900/10 dark:border-green-800" : "border-amber-200 bg-amber-50/50 dark:bg-amber-900/10 dark:border-amber-800"}`}>
        <div className="flex items-center gap-3">
          {isConfigured ? (
            <>
              <CheckCircle2 className="w-6 h-6 text-green-600" />
              <div>
                <p className="font-semibold text-green-800 dark:text-green-300">Meta configurado correctamente</p>
                <p className="text-xs text-green-600 dark:text-green-400">
                  Todos los tenants pueden conectar WhatsApp con Embedded Signup.
                </p>
              </div>
            </>
          ) : (
            <>
              <AlertTriangle className="w-6 h-6 text-amber-600" />
              <div>
                <p className="font-semibold text-amber-800 dark:text-amber-300">Meta no configurado</p>
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Los tenants no podrán conectar WhatsApp hasta que configures los datos de tu Meta App aquí.
                </p>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Instructions */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Code className="w-4 h-4" /> Cómo obtener tus credenciales
        </h3>
        <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
          <li>Ve a <strong>developers.facebook.com</strong> y crea o selecciona tu app</li>
          <li>En "Configuración → Básica" copia el <strong>App ID</strong> y <strong>App Secret</strong></li>
          <li>En "WhatsApp → Configuración" activa <strong>Embedded Signup</strong></li>
          <li>Copia el <strong>Config ID</strong> del Embedded Signup (opcional pero recomendado)</li>
          <li>Pega los valores aquí abajo y guarda</li>
        </ol>
      </Card>

      {/* Form */}
      <Card className="p-4 space-y-4">
        <h3 className="text-sm font-semibold">Credenciales de Meta App</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Meta App ID *</Label>
            <Input
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="123456789012345"
              className="h-9 text-sm font-mono"
            />
          </div>
          <div>
            <Label className="text-xs">Meta App Secret *</Label>
            <Input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={metaQuery.data?.hasSecret ? "••••••••••••••••••• (guardado)" : "abc123def456..."}
              className="h-9 text-sm font-mono"
            />
            {metaQuery.data?.hasSecret && !appSecret && (
              <p className="text-[10px] text-green-600 mt-1">El secret ya está guardado y encriptado. Déjalo vacío para no cambiarlo.</p>
            )}
          </div>
        </div>
        <div>
          <Label className="text-xs">Embedded Signup Config ID (opcional)</Label>
          <Input
            value={configId}
            onChange={(e) => setConfigId(e.target.value)}
            placeholder="1234567890123456"
            className="h-9 text-sm font-mono"
          />
          <p className="text-[10px] text-muted-foreground mt-1">Se usa para preconfigurar el popup de Embedded Signup. Si no lo tienes, déjalo vacío.</p>
        </div>
        <Button
          onClick={() => saveMeta.mutate({
            appId: appId.trim(),
            appSecret: appSecret.trim() || undefined,
            embeddedSignupConfigId: configId.trim(),
          })}
          disabled={saveMeta.isPending || !appId.trim()}
          className="gap-2"
        >
          {saveMeta.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Guardar Configuración
        </Button>
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ════════════════════════════════════════════════════════════════════════════ */

export default function SuperAdmin() {
  return (
    <PermissionGuard roles={["owner"]}>
      <SuperAdminContent />
    </PermissionGuard>
  );
}

function SuperAdminContent() {
  const [search, setSearch] = useState("");
  const [mainTab, setMainTab] = useState("overview");

  const whoami = trpc.superadmin.whoami.useQuery(undefined, { retry: 0 });

  const stats = trpc.superadmin.platformStats.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const liveKpis = trpc.superadmin.liveKpis.useQuery(undefined, {
    refetchInterval: 15000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const tenantList = trpc.superadmin.listTenants.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const isLoading = stats.isLoading || tenantList.isLoading;
  const isError = stats.isError || tenantList.isError;

  const filteredTenants = (tenantList.data ?? []).filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      t.slug.toLowerCase().includes(q) ||
      t.plan.toLowerCase().includes(q) ||
      String(t.id).includes(q)
    );
  });

  /* counts */
  const planCounts = (tenantList.data ?? []).reduce(
    (acc, t) => {
      acc[t.plan] = (acc[t.plan] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  // Revenue estimation
  const PLAN_PRICES: Record<string, number> = { free: 0, starter: 12.90, pro: 32.90, enterprise: 99.90 };
  const monthlyRevenue = (tenantList.data ?? []).reduce((sum, t) => sum + (PLAN_PRICES[t.plan] ?? 0), 0);

  if (isError) {
    const errorMsg = stats.error?.message || tenantList.error?.message || "";
    const info = whoami.data;
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldAlert className="w-16 h-16 text-red-400" />
        <h2 className="text-xl font-bold">Acceso Denegado</h2>
        <p className="text-muted-foreground text-sm max-w-md text-center">
          Este panel es exclusivo para el creador de la plataforma (owner del tenant principal).
          Se requiere rol "owner" + tenantId=1.
        </p>
        {info && (
          <div className="bg-muted/50 rounded-lg p-4 text-xs font-mono space-y-1 max-w-md">
            <div><span className="text-muted-foreground">Tu rol:</span> <span className="font-bold">{info.role}</span></div>
            <div><span className="text-muted-foreground">Tu tenantId:</span> <span className="font-bold">{info.tenantId}</span></div>
            <div><span className="text-muted-foreground">Tu userId:</span> {info.userId}</div>
            <div><span className="text-muted-foreground">Tu email:</span> {info.email}</div>
            {info.tenantId !== 1 && (
              <div className="mt-2 text-amber-500">⚠ Tu tenantId es {info.tenantId}, no 1. El bootstrap debe asignar tenantId=1.</div>
            )}
          </div>
        )}
        {errorMsg && (
          <p className="text-xs text-red-400 font-mono max-w-md text-center">{errorMsg}</p>
        )}
        <Button variant="outline" onClick={() => window.location.href = "/"}>
          Volver al Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-violet-500" />
            <h1 className="text-2xl font-bold tracking-tight">Super Admin</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Panel de administración multi-tenant de ImagineCRM
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { stats.refetch(); tenantList.refetch(); }}
          disabled={isLoading}
          className="gap-1"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {/* Main Tabs */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs value={mainTab} onValueChange={setMainTab}>
          <TabsList className="h-auto flex-wrap gap-1 p-1.5">
            <TabsTrigger value="overview" className="text-xs gap-1">
              <BarChart3 className="w-3 h-3" /> Overview
            </TabsTrigger>
            <TabsTrigger value="tenants" className="text-xs gap-1">
              <Building2 className="w-3 h-3" /> Tenants
            </TabsTrigger>
            <TabsTrigger value="health" className="text-xs gap-1">
              <Activity className="w-3 h-3" /> Salud
            </TabsTrigger>
            <TabsTrigger value="logs" className="text-xs gap-1">
              <Eye className="w-3 h-3" /> Logs
            </TabsTrigger>
            <TabsTrigger value="analytics" className="text-xs gap-1">
              <TrendingUp className="w-3 h-3" /> Analytics
            </TabsTrigger>
            <TabsTrigger value="queues" className="text-xs gap-1">
              <Inbox className="w-3 h-3" /> Colas & Storage
            </TabsTrigger>
            <TabsTrigger value="sessions" className="text-xs gap-1">
              <Monitor className="w-3 h-3" /> Sesiones
            </TabsTrigger>
            <TabsTrigger value="announcements" className="text-xs gap-1">
              <Megaphone className="w-3 h-3" /> Anuncios
            </TabsTrigger>
            <TabsTrigger value="bulk" className="text-xs gap-1">
              <Layers className="w-3 h-3" /> Operaciones Masivas
            </TabsTrigger>
            <TabsTrigger value="users-global" className="text-xs gap-1">
              <Users className="w-3 h-3" /> Usuarios
            </TabsTrigger>
            <TabsTrigger value="search" className="text-xs gap-1">
              <SearchCode className="w-3 h-3" /> Búsqueda
            </TabsTrigger>
            <TabsTrigger value="config" className="text-xs gap-1">
              <Sliders className="w-3 h-3" /> Configuración
            </TabsTrigger>
            <TabsTrigger value="alerts" className="text-xs gap-1">
              <Bell className="w-3 h-3" /> Alertas
            </TabsTrigger>
            <TabsTrigger value="audit" className="text-xs gap-1">
              <ShieldCheck className="w-3 h-3" /> Auditoría
            </TabsTrigger>
            <TabsTrigger value="impersonation" className="text-xs gap-1">
              <Eye className="w-3 h-3" /> Impersonaciones
            </TabsTrigger>
            <TabsTrigger value="onboarding" className="text-xs gap-1">
              <ClipboardCheck className="w-3 h-3" /> Onboarding
            </TabsTrigger>
            <TabsTrigger value="workflows" className="text-xs gap-1">
              <Workflow className="w-3 h-3" /> Workflows
            </TabsTrigger>
            <TabsTrigger value="webhooks" className="text-xs gap-1">
              <Globe className="w-3 h-3" /> Webhooks
            </TabsTrigger>
            <TabsTrigger value="campaigns" className="text-xs gap-1">
              <Megaphone className="w-3 h-3" /> Campañas
            </TabsTrigger>
            <TabsTrigger value="templates" className="text-xs gap-1">
              <Code className="w-3 h-3" /> Templates
            </TabsTrigger>
            <TabsTrigger value="licenses" className="text-xs gap-1">
              <KeyRound className="w-3 h-3" /> Licencias
            </TabsTrigger>
            <TabsTrigger value="comparison" className="text-xs gap-1">
              <BarChart3 className="w-3 h-3" /> Comparar
            </TabsTrigger>
            <TabsTrigger value="health-scores" className="text-xs gap-1">
              <Activity className="w-3 h-3" /> Health Score
            </TabsTrigger>
            <TabsTrigger value="churn" className="text-xs gap-1">
              <TrendingUp className="w-3 h-3" /> Churn
            </TabsTrigger>
            <TabsTrigger value="maintenance" className="text-xs gap-1">
              <AlertTriangle className="w-3 h-3" /> Mantenimiento
            </TabsTrigger>
            <TabsTrigger value="storage" className="text-xs gap-1">
              <HardDrive className="w-3 h-3" /> Storage
            </TabsTrigger>
            <TabsTrigger value="platform-meta" className="text-xs gap-1">
              <Globe className="w-3 h-3" /> Meta/WhatsApp
            </TabsTrigger>
          </TabsList>

          {/* ─── OVERVIEW TAB ─── */}
          <TabsContent value="overview" className="mt-4 space-y-4">
            {/* Live KPIs (real-time, 15s refresh) */}
            {liveKpis.data && (
              <Card className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold flex items-center gap-1"><Activity className="w-3 h-3 text-green-500" /> KPIs en Tiempo Real</h3>
                  <Badge variant="outline" className="text-[9px] px-1.5">⚡ Auto-refresh 15s</Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    { label: "Tenants Activos", value: liveKpis.data.activeTenants, color: "text-violet-600" },
                    { label: "Usuarios Activos", value: liveKpis.data.activeUsers, color: "text-blue-600" },
                    { label: "Sesiones", value: liveKpis.data.activeSessions, color: "text-cyan-600" },
                    { label: "Msgs/última hora", value: liveKpis.data.messagesLastHour, color: "text-amber-600" },
                    { label: "Leads hoy", value: liveKpis.data.leadsToday, color: "text-green-600" },
                    { label: "Convs hoy", value: liveKpis.data.conversationsToday, color: "text-red-600" },
                  ].map((k) => (
                    <div key={k.label} className="text-center">
                      <p className={`text-xl font-bold ${k.color}`}>{k.value ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground">{k.label}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <div className="flex items-center justify-between">
              <div />
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={async () => {
                try {
                  const rows = await (trpc as any).superadmin.exportMetrics.query();
                  downloadCSV(rows ?? [], `metrics_${Date.now()}.csv`);
                } catch { /* handled by trpc error */ }
              }}>
                <FileDown className="w-3 h-3" /> Exportar Métricas CSV
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <KpiCard icon={Building2} label="Tenants" value={stats.data?.totalTenants ?? 0} color="bg-violet-500" />
              <KpiCard icon={Users} label="Usuarios Activos" value={stats.data?.totalUsers ?? 0} color="bg-blue-500" />
              <KpiCard icon={Target} label="Leads" value={stats.data?.totalLeads ?? 0} color="bg-green-500" />
              <KpiCard icon={MessageCircle} label="Conversaciones" value={stats.data?.totalConversations ?? 0} color="bg-amber-500" />
              <KpiCard icon={Zap} label="Mensajes" value={stats.data?.totalMessages ?? 0} color="bg-red-500" />
              <KpiCard icon={BarChart3} label="MRR Estimado" value={`$${monthlyRevenue}`} color="bg-emerald-500" />
            </div>

            {/* Plan distribution */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(["free", "starter", "pro", "enterprise"] as const).map((plan) => (
                <Card key={plan} className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase">{plan}</p>
                      <p className="text-2xl font-bold">{planCounts[plan] ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground">
                        ${PLAN_PRICES[plan]}/mes c/u = ${(planCounts[plan] ?? 0) * PLAN_PRICES[plan]}/mes
                      </p>
                    </div>
                    <Badge className={`text-[10px] uppercase ${PLAN_COLORS[plan]}`}>{plan}</Badge>
                  </div>
                </Card>
              ))}
            </div>

            {/* Feature summary */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-green-500" />
                  Funciones del Super Admin
                </CardTitle>
                <CardDescription className="text-xs">
                  Todas las acciones quedan registradas en los logs del servidor.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  {[
                    { icon: ArrowUpCircle, color: "text-violet-500", title: "Cambiar Plan", desc: "Sube o baja el plan de cualquier tenant." },
                    { icon: Flag, color: "text-blue-500", title: "Feature Flags", desc: "Activa/desactiva módulos por tenant." },
                    { icon: LogIn, color: "text-amber-500", title: "Impersonar", desc: "Entra como cualquier usuario." },
                    { icon: Pause, color: "text-red-500", title: "Suspender/Reactivar", desc: "Bloquea acceso sin borrar datos." },
                    { icon: Activity, color: "text-cyan-500", title: "System Health", desc: "Monitoreo de DB, Redis, memoria." },
                    { icon: Phone, color: "text-green-500", title: "WA Health", desc: "Estado de conexiones WhatsApp." },
                    { icon: Eye, color: "text-indigo-500", title: "Activity & Access Logs", desc: "Auditoría completa de acciones." },
                    { icon: TrendingUp, color: "text-emerald-500", title: "Analytics", desc: "Growth, trials, churn, onboarding." },
                    { icon: UserX, color: "text-orange-500", title: "Gestión Usuarios", desc: "Activar/desactivar y resetear contraseñas." },
                    { icon: Inbox, color: "text-pink-500", title: "Colas & Jobs", desc: "Monitoreo de message queue y workflows." },
                    { icon: FolderOpen, color: "text-teal-500", title: "Storage", desc: "Uso de almacenamiento por tenant." },
                    { icon: Timer, color: "text-yellow-500", title: "Trial Tracker", desc: "Trials por vencer y detección de churn." },
                    { icon: Monitor, color: "text-sky-500", title: "Sesiones", desc: "Viewer cross-tenant con force logout." },
                    { icon: Layers, color: "text-fuchsia-500", title: "Operaciones Masivas", desc: "Cambio de plan y suspensión en masa." },
                    { icon: StickyNote, color: "text-lime-500", title: "Notas Internas", desc: "CRM interno por tenant." },
                    { icon: DollarSign, color: "text-emerald-600", title: "Revenue Timeline", desc: "MRR histórico estimado." },
                    { icon: Megaphone, color: "text-purple-500", title: "Anuncios", desc: "Broadcasts a toda la plataforma." },
                  ].map((f) => (
                    <div key={f.title} className="flex items-start gap-2 p-2 rounded bg-muted/30">
                      <f.icon className={`w-4 h-4 ${f.color} shrink-0 mt-0.5`} />
                      <div>
                        <p className="font-medium">{f.title}</p>
                        <p className="text-muted-foreground">{f.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── TENANTS TAB ─── */}
          <TabsContent value="tenants" className="mt-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Tenants ({filteredTenants.length})
              </h2>
              <div className="flex items-center gap-2">
                <CreateTenantDialog onSuccess={() => tenantList.refetch()} />
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={async () => {
                  try {
                    const rows = await (trpc as any).superadmin.exportTenants.query();
                    downloadCSV(rows ?? [], `tenants_${Date.now()}.csv`);
                  } catch { /* handled by trpc error */ }
                }}>
                  <FileDown className="w-3 h-3" /> Exportar CSV
                </Button>
                <div className="relative w-52">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar tenant..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {filteredTenants.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  {search ? "No se encontraron tenants con esa búsqueda." : "No hay tenants registrados."}
                </div>
              ) : (
                filteredTenants.map((t) => (
                  <TenantRow key={t.id} tenant={t} refetch={() => tenantList.refetch()} />
                ))
              )}
            </div>
          </TabsContent>

          {/* ─── HEALTH TAB ─── */}
          <TabsContent value="health" className="mt-4 space-y-6">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
                <Activity className="w-5 h-5 text-green-500" /> Estado del Sistema
              </h2>
              <SystemHealthPanel />
            </div>
            <Separator />
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
                <Phone className="w-5 h-5 text-green-500" /> WhatsApp Health
              </h2>
              <WhatsAppHealthPanel />
            </div>
          </TabsContent>

          {/* ─── LOGS TAB ─── */}
          <TabsContent value="logs" className="mt-4 space-y-6">
            <Tabs defaultValue="activity">
              <TabsList className="h-8">
                <TabsTrigger value="activity" className="text-xs gap-1">
                  <Activity className="w-3 h-3" /> Activity Logs
                </TabsTrigger>
                <TabsTrigger value="access" className="text-xs gap-1">
                  <Lock className="w-3 h-3" /> Access Logs (Seguridad)
                </TabsTrigger>
              </TabsList>
              <TabsContent value="activity" className="mt-4">
                <ActivityLogsPanel />
              </TabsContent>
              <TabsContent value="access" className="mt-4">
                <AccessLogsPanel />
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* ─── ANALYTICS TAB ─── */}
          <TabsContent value="analytics" className="mt-4">
            <AnalyticsPanel />
          </TabsContent>

          {/* ─── QUEUES & STORAGE TAB ─── */}
          <TabsContent value="queues" className="mt-4">
            <QueuesStoragePanel />
          </TabsContent>

          {/* ─── SESSIONS TAB ─── */}
          <TabsContent value="sessions" className="mt-4">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
              <Monitor className="w-5 h-5 text-green-500" /> Sesiones Activas Cross-Tenant
            </h2>
            <SessionsPanel />
          </TabsContent>

          {/* ─── ANNOUNCEMENTS TAB ─── */}
          <TabsContent value="announcements" className="mt-4">
            <AnnouncementsPanel />
          </TabsContent>

          {/* ─── BULK OPERATIONS TAB ─── */}
          <TabsContent value="bulk" className="mt-4">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
              <Layers className="w-5 h-5 text-violet-500" /> Operaciones Masivas
            </h2>
            <BulkOperationsPanel tenants={tenantList.data ?? []} refetch={() => tenantList.refetch()} />
          </TabsContent>

          {/* ─── ALL USERS TAB ─── */}
          <TabsContent value="users-global" className="mt-4">
            <AllUsersPanel />
          </TabsContent>

          {/* ─── GLOBAL SEARCH TAB ─── */}
          <TabsContent value="search" className="mt-4">
            <GlobalSearchPanel />
          </TabsContent>

          {/* ─── PLATFORM CONFIG TAB ─── */}
          <TabsContent value="config" className="mt-4">
            <PlatformConfigPanel />
          </TabsContent>

          {/* ─── ALERTS TAB ─── */}
          <TabsContent value="alerts" className="mt-4">
            <AlertsPanel />
          </TabsContent>

          {/* ─── SUPERADMIN AUDIT LOG TAB ─── */}
          <TabsContent value="audit" className="mt-4">
            <SuperadminAuditPanel />
          </TabsContent>

          {/* ─── IMPERSONATION AUDIT TAB ─── */}
          <TabsContent value="impersonation" className="mt-4">
            <ImpersonationAuditPanel />
          </TabsContent>

          {/* ─── ONBOARDING TRACKER TAB ─── */}
          <TabsContent value="onboarding" className="mt-4">
            <OnboardingTrackerPanel />
          </TabsContent>

          {/* ─── WORKFLOWS TAB ─── */}
          <TabsContent value="workflows" className="mt-4">
            <WorkflowOversightPanel />
          </TabsContent>

          {/* ─── WEBHOOKS TAB ─── */}
          <TabsContent value="webhooks" className="mt-4">
            <WebhookManagementPanel />
          </TabsContent>

          {/* ─── CAMPAIGNS TAB ─── */}
          <TabsContent value="campaigns" className="mt-4">
            <CampaignMonitoringPanel />
          </TabsContent>

          {/* ─── TEMPLATES TAB ─── */}
          <TabsContent value="templates" className="mt-4">
            <TemplateOversightPanel />
          </TabsContent>

          {/* ─── LICENSES TAB ─── */}
          <TabsContent value="licenses" className="mt-4">
            <LicenseManagementPanel />
          </TabsContent>

          {/* ─── COMPARISON TAB ─── */}
          <TabsContent value="comparison" className="mt-4">
            <TenantComparisonPanel />
          </TabsContent>

          {/* ─── HEALTH SCORES TAB ─── */}
          <TabsContent value="health-scores" className="mt-4">
            <HealthScorePanel />
          </TabsContent>

          {/* ─── CHURN PREDICTION TAB ─── */}
          <TabsContent value="churn" className="mt-4">
            <ChurnPredictionPanel />
          </TabsContent>

          {/* ─── MAINTENANCE MODE TAB ─── */}
          <TabsContent value="maintenance" className="mt-4">
            <MaintenanceModePanel />
          </TabsContent>

          {/* ─── STORAGE OVERVIEW TAB ─── */}
          <TabsContent value="storage" className="mt-4">
            <StorageOverviewPanel />
          </TabsContent>

          {/* ─── PLATFORM META CONFIG TAB ─── */}
          <TabsContent value="platform-meta" className="mt-4">
            <PlatformMetaConfigPanel />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
