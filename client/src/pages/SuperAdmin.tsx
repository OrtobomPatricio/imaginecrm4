import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
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

/* ─── Tenant Row (expandable) ─── */
function TenantRow({
  tenant,
  refetch,
}: {
  tenant: any;
  refetch: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
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

      {/* Expanded actions */}
      {expanded && (
        <div className="px-4 py-3 bg-muted/30 border-t space-y-3">
          {/* Mobile stats */}
          <div className="flex md:hidden items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-xs gap-1"><Users className="w-3 h-3" /> {Number(tenant.userCount)} usuarios</Badge>
            <Badge variant="secondary" className="text-xs gap-1"><Target className="w-3 h-3" /> {Number(tenant.leadCount)} leads</Badge>
            <Badge variant="secondary" className="text-xs gap-1"><Phone className="w-3 h-3" /> {Number(tenant.waNumberCount)} WA</Badge>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <ChangePlanDialog
              tenant={{ id: tenant.id, name: tenant.name, plan: tenant.plan }}
              onSuccess={refetch}
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

  if (isError) {
    const errorMsg = stats.error?.message || tenantList.error?.message || "";
    const info = whoami.data;
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldAlert className="w-16 h-16 text-red-400" />
        <h2 className="text-xl font-bold">Acceso Denegado</h2>
        <p className="text-muted-foreground text-sm max-w-md text-center">
          Este panel es exclusivo para el Super Admin de la plataforma (owner del tenant principal).
          Se requiere rol "owner" o "admin" + tenantId=1.
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
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
          </div>

          {/* Plan distribution row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(["free", "starter", "pro", "enterprise"] as const).map((plan) => (
              <Card key={plan} className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase">{plan}</p>
                    <p className="text-2xl font-bold">{planCounts[plan] ?? 0}</p>
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
        </>
      )}
    </div>
  );
}
