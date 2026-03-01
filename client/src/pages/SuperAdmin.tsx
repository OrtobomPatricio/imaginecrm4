import { useState } from "react";
import { trpc } from "@/lib/trpc";
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
  User,
  Mail,
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
  ToggleLeft,
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
  return new Date(d).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(d: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", {
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

function UsageBar({ label, current, limit, icon: Icon }: { label: string; current: number; limit: number; icon: any }) {
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
  icon: any;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <Card className="relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-1 ${color}`} />
      <CardContent className="pt-6 pb-4 px-5">
        <div className="flex items-center gap-3 mb-2">
          <div className={`p-2 rounded-lg bg-opacity-15 ${color.replace("bg-", "bg-")}/10`}>
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
            <SelectItem value="starter">Starter — $29/mes</SelectItem>
            <SelectItem value="pro">Pro — $99/mes</SelectItem>
            <SelectItem value="enterprise">Enterprise — $299/mes</SelectItem>
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
        description: `Sesión activa como ${data.targetUser.name} (${data.targetUser.email}). Recargando...`,
        duration: 3000,
      });
      // The backend already set the cookie. Redirect to dashboard.
      setTimeout(() => {
        window.location.href = "/";
      }, 1500);
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
                  onClick={() =>
                    impersonate.mutate({
                      targetUserId: u.id,
                      targetTenantId: tenant.id,
                    })
                  }
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

  const resetPassword = trpc.superadmin.forcePasswordReset.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Contraseña reseteada",
        description: `Contraseña temporal: ${data.tempPassword}`,
        duration: 15000,
      });
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

  const isSuspended = tenant.status === "suspended";
  const isPlatform = tenant.id === 1;

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Row header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
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
              return daysLeft <= 7 ? (
                <Badge variant="outline" className={`text-[10px] px-1.5 ${daysLeft <= 0 ? "border-red-500 text-red-500" : "border-amber-400 text-amber-500"}`}>
                  <Timer className="w-3 h-3 mr-0.5" />
                  {daysLeft <= 0 ? "Trial expirado" : `Trial: ${daysLeft}d`}
                </Badge>
              ) : null;
            })()}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
            <span className="flex items-center gap-1"><Hash className="w-3 h-3" />{tenant.id}</span>
            <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{tenant.slug}</span>
            <span className="flex items-center gap-1"><CalendarDays className="w-3 h-3" />{fmtDate(tenant.createdAt)}</span>
            {tenant.stripeCustomerId && (
              <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="w-3 h-3" />Stripe</span>
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
          {(tenant.stripeCustomerId || tenant.trialEndsAt) && (
            <div className="flex items-center gap-3 flex-wrap text-xs mb-3 p-2 rounded bg-muted/50">
              {tenant.stripeCustomerId && (
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-green-500" />
                  <span className="text-muted-foreground">Stripe:</span>
                  <code className="text-[10px] bg-muted px-1 rounded">{tenant.stripeCustomerId}</code>
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

  const connected = rows.filter((r: any) => r.isConnected).length;
  const total = rows.length;

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
          {rows.map((r: any) => (
            <Card key={r.id} className="p-3">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${r.isConnected ? "bg-green-500" : "bg-red-500"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{r.displayName || r.phoneNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.tenantName} · {r.phoneNumber} · {r.status}
                    {r.warmupDay != null && ` · Warmup día ${r.warmupDay}`}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <p className="font-medium">{r.totalMessagesSent ?? 0} enviados</p>
                  <p className="text-muted-foreground">Hoy: {r.messagesSentToday ?? 0}/{r.dailyMessageLimit ?? "∞"}</p>
                </div>
                <Badge variant="secondary" className={r.isConnected ? "text-green-600" : "text-red-500"}>
                  {r.isConnected ? "Online" : "Offline"}
                </Badge>
              </div>
            </Card>
          ))}
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

/* ════════════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ════════════════════════════════════════════════════════════════════════════ */

export default function SuperAdmin() {
  const [search, setSearch] = useState("");
  const [mainTab, setMainTab] = useState("overview");

  const whoami = trpc.superadmin.whoami.useQuery(undefined, { retry: 0 });

  const stats = trpc.superadmin.platformStats.useQuery(undefined, {
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
  const PLAN_PRICES: Record<string, number> = { free: 0, starter: 29, pro: 99, enterprise: 299 };
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
          <TabsList className="h-9 flex-wrap">
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
          </TabsList>

          {/* ─── OVERVIEW TAB ─── */}
          <TabsContent value="overview" className="mt-4 space-y-4">
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
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar tenant..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9"
                />
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
        </Tabs>
      )}
    </div>
  );
}
