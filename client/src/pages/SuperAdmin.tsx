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

/* ─── helpers ─── */
function fmtDate(d: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
        description: `Ahora actúas como ${data.targetUser.name} (${data.targetUser.email})`,
      });
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

/* ─── Tenant Users Panel ─── */
function TenantUsersPanel({ tenantId }: { tenantId: number }) {
  const tenantUsers = trpc.superadmin.listTenantUsers.useQuery({ tenantId });
  const userList = tenantUsers.data ?? [];

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
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
            <span className="flex items-center gap-1"><Hash className="w-3 h-3" />{tenant.id}</span>
            <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{tenant.slug}</span>
            <span className="flex items-center gap-1"><CalendarDays className="w-3 h-3" />{fmtDate(tenant.createdAt)}</span>
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

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="h-8 mb-3">
              <TabsTrigger value="actions" className="text-xs h-7 gap-1">
                <Settings2 className="w-3 h-3" /> Acciones
              </TabsTrigger>
              <TabsTrigger value="users" className="text-xs h-7 gap-1">
                <Users className="w-3 h-3" /> Usuarios
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
          </Tabs>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ════════════════════════════════════════════════════════════════════════════ */

export default function SuperAdmin() {
  const [search, setSearch] = useState("");

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

      {/* KPIs */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <KpiCard
              icon={Building2}
              label="Tenants"
              value={stats.data?.totalTenants ?? 0}
              color="bg-violet-500"
            />
            <KpiCard
              icon={Users}
              label="Usuarios Activos"
              value={stats.data?.totalUsers ?? 0}
              color="bg-blue-500"
            />
            <KpiCard
              icon={Target}
              label="Leads"
              value={stats.data?.totalLeads ?? 0}
              color="bg-green-500"
            />
            <KpiCard
              icon={MessageCircle}
              label="Conversaciones"
              value={stats.data?.totalConversations ?? 0}
              color="bg-amber-500"
            />
            <KpiCard
              icon={Zap}
              label="Mensajes"
              value={stats.data?.totalMessages ?? 0}
              color="bg-red-500"
            />
            <KpiCard
              icon={BarChart3}
              label="MRR Estimado"
              value={`$${monthlyRevenue}`}
              color="bg-emerald-500"
            />
          </div>

          {/* Plan distribution row */}
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

          <Separator />

          {/* Tenant list */}
          <div>
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
          </div>

          {/* Feature summary */}
          <Separator />
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div className="flex items-start gap-2 p-2 rounded bg-muted/30">
                  <ArrowUpCircle className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Cambiar Plan</p>
                    <p className="text-muted-foreground">Sube o baja el plan de cualquier tenant (free/starter/pro/enterprise).</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-2 rounded bg-muted/30">
                  <Flag className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Feature Flags</p>
                    <p className="text-muted-foreground">Activa/desactiva módulos por tenant: WhatsApp, IA, campañas, reportes, etc.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-2 rounded bg-muted/30">
                  <LogIn className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Impersonar Usuario</p>
                    <p className="text-muted-foreground">Entra como cualquier usuario para debugging o soporte.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-2 rounded bg-muted/30">
                  <Pause className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Suspender/Reactivar</p>
                    <p className="text-muted-foreground">Bloquea acceso al tenant sin borrar datos. Reactiva cuando quieras.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-2 rounded bg-muted/30">
                  <Users className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Ver Usuarios</p>
                    <p className="text-muted-foreground">Lista todos los usuarios de cada tenant con su rol y estado.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-2 rounded bg-muted/30">
                  <BarChart3 className="w-4 h-4 text-cyan-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Estadísticas Globales</p>
                    <p className="text-muted-foreground">KPIs cross-tenant: leads, mensajes, conversaciones, MRR.</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
