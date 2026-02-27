import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell, FunnelChart, Funnel, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, TrendingDown, Users, MessageCircle,
  CheckCircle, Target, Clock, BarChart3, Zap,
  Trophy, Medal, Award, Phone,
} from "lucide-react";
import Reports from "./Reports";

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Period = "7d" | "30d" | "90d" | "this_month" | "last_month";

const PERIOD_LABELS: Record<Period, string> = {
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  "90d": "Últimos 90 días",
  "this_month": "Este mes",
  "last_month": "Mes anterior",
};

const CHART_COLORS = {
  primary: "#6366f1",
  secondary: "#22c55e",
  accent: "#f59e0b",
  danger: "#ef4444",
  muted: "#94a3b8",
  inbound: "#6366f1",
  outbound: "#22c55e",
};

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  change,
  icon: Icon,
  suffix = "",
  loading = false,
}: {
  title: string;
  value: number;
  change: number;
  icon: React.ElementType;
  suffix?: string;
  loading?: boolean;
}) {
  const isPositive = change >= 0;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <>
            <Skeleton className="h-8 w-24 mb-2" />
            <Skeleton className="h-4 w-16" />
          </>
        ) : (
          <>
            <div className="text-2xl font-bold">
              {value.toLocaleString()}{suffix}
            </div>
            <div className={`flex flex-wrap items-center gap-1 text-xs mt-1 ${isPositive ? "text-success" : "text-destructive"}`}>
              {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              <span>{isPositive ? "+" : ""}{change}% vs período anterior</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Selector de período ─────────────────────────────────────────────────────

function PeriodSelector({ value, onChange }: { value: Period; onChange: (v: Period) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Period)}>
      <SelectTrigger className="w-[180px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(PERIOD_LABELS).map(([k, label]) => (
          <SelectItem key={k} value={k}>{label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Tab: Overview ───────────────────────────────────────────────────────────

function OverviewTab({ period }: { period: Period }) {
  const { data: overview, isLoading: loadingOverview } = trpc.analytics.overview.useQuery({ period });
  const { data: leadsOverTime, isLoading: loadingLeads } = trpc.analytics.leadsOverTime.useQuery({ period });
  const { data: messageVolume, isLoading: loadingMsgs } = trpc.analytics.messageVolume.useQuery({ period });
  const { data: leadSources, isLoading: loadingSources } = trpc.analytics.leadSources.useQuery({ period });
  const { data: funnel, isLoading: loadingFunnel } = trpc.analytics.conversionFunnel.useQuery({ period });

  const kpis = overview?.kpis;

  const SOURCE_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          title="Leads Nuevos"
          value={kpis?.newLeads.value ?? 0}
          change={kpis?.newLeads.change ?? 0}
          icon={Users}
          loading={loadingOverview}
        />
        <KpiCard
          title="Conversaciones"
          value={kpis?.newConversations.value ?? 0}
          change={kpis?.newConversations.change ?? 0}
          icon={MessageCircle}
          loading={loadingOverview}
        />
        <KpiCard
          title="Mensajes Totales"
          value={kpis?.totalMessages.value ?? 0}
          change={kpis?.totalMessages.change ?? 0}
          icon={BarChart3}
          loading={loadingOverview}
        />
        <KpiCard
          title="Resueltas"
          value={kpis?.resolvedConversations.value ?? 0}
          change={kpis?.resolvedConversations.change ?? 0}
          icon={CheckCircle}
          loading={loadingOverview}
        />
        <KpiCard
          title="Tasa de Resolución"
          value={kpis?.resolutionRate.value ?? 0}
          change={kpis?.resolutionRate.change ?? 0}
          icon={Target}
          suffix="%"
          loading={loadingOverview}
        />
        <KpiCard
          title="Leads Ganados"
          value={kpis?.wonLeads.value ?? 0}
          change={kpis?.wonLeads.change ?? 0}
          icon={Trophy}
          loading={loadingOverview}
        />
      </div>

      {/* Gráficos principales */}
      <div className="grid gap-6 md:grid-cols-2">

        {/* Leads por día */}
        <Card className="col-span-1 md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Nuevos Leads por Día
            </CardTitle>
            <CardDescription>Evolución de captación en el período</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingLeads ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={leadsOverTime ?? []}>
                  <defs>
                    <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }}
                    labelFormatter={(l) => `Fecha: ${l}`}
                    formatter={(v: number) => [v, "Leads"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke={CHART_COLORS.primary}
                    fill="url(#colorLeads)"
                    strokeWidth={2}
                    dot={false}
                    name="Leads"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Volumen de mensajes */}
        <Card className="col-span-1 md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5" />
              Volumen de Mensajes
            </CardTitle>
            <CardDescription>Mensajes entrantes y salientes por día</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingMsgs ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={messageVolume ?? []}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }}
                    labelFormatter={(l) => `Fecha: ${l}`}
                  />
                  <Legend />
                  <Bar dataKey="inbound" name="Entrantes" fill={CHART_COLORS.inbound} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="outbound" name="Salientes" fill={CHART_COLORS.outbound} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Fuentes de leads */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Fuentes de Leads
            </CardTitle>
            <CardDescription>De dónde vienen tus leads</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingSources ? (
              <Skeleton className="h-48 w-full" />
            ) : (leadSources ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Sin datos en el período</p>
            ) : (
              <div className="flex flex-col md:flex-row gap-4 items-center">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={leadSources ?? []}
                      dataKey="count"
                      nameKey="source"
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      innerRadius={40}
                    >
                      {(leadSources ?? []).map((_, i) => (
                        <Cell key={i} fill={SOURCE_COLORS[i % SOURCE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }}
                      formatter={(v: number, n: string) => [v, n]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 w-full space-y-2">
                  {(leadSources ?? []).map((s, i) => (
                    <div key={s.source} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
                        <span className="capitalize">{s.source}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{s.count}</span>
                        <Badge variant="secondary" className="text-xs">{s.percentage}%</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Embudo de conversión */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Embudo de Conversión
            </CardTitle>
            <CardDescription>Leads por etapa del pipeline</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingFunnel ? (
              <Skeleton className="h-48 w-full" />
            ) : (funnel?.stages ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Sin datos en el período</p>
            ) : (
              <div className="space-y-3">
                {(funnel?.stages ?? []).map((stage, i) => (
                  <div key={stage.stageId} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium flex-1 truncate pr-2">{stage.stageName}</span>
                      <span className="text-muted-foreground shrink-0">{stage.count} ({stage.percentage}%)</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${stage.percentage}%`,
                          background: `hsl(${240 - i * 30}, 70%, 60%)`,
                        }}
                      />
                    </div>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground text-right pt-1">
                  Total: {funnel?.totalLeads ?? 0} leads
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Tab: Agentes ────────────────────────────────────────────────────────────

function AgentsTab({ period }: { period: Period }) {
  const { data: agents, isLoading } = trpc.analytics.agentPerformance.useQuery({ period });
  const { data: responseTime, isLoading: loadingRT } = trpc.analytics.responseTime.useQuery({ period });

  return (
    <div className="space-y-6">
      {/* Tabla de rendimiento */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Rendimiento por Agente
          </CardTitle>
          <CardDescription>Conversaciones atendidas, resueltas y mensajes enviados</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (agents ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sin datos en el período</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Agente</th>
                    <th className="text-right py-2 px-4 font-medium">Conversaciones</th>
                    <th className="text-right py-2 px-4 font-medium hidden sm:table-cell">Resueltas</th>
                    <th className="text-right py-2 px-4 font-medium hidden sm:table-cell">Pendientes</th>
                    <th className="text-right py-2 px-4 font-medium">Tasa</th>
                    <th className="text-right py-2 pl-4 font-medium">Mensajes</th>
                  </tr>
                </thead>
                <tbody>
                  {(agents ?? []).map((agent) => (
                    <tr key={agent.agentId} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-3 pr-4 font-medium min-w-[120px]">{agent.agentName}</td>
                      <td className="text-right py-3 px-4">{agent.totalConversations}</td>
                      <td className="text-right py-3 px-4 text-success hidden sm:table-cell">{agent.resolvedConversations}</td>
                      <td className="text-right py-3 px-4 text-warning hidden sm:table-cell">{agent.pendingConversations}</td>
                      <td className="text-right py-3 px-4 min-w-[120px]">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden hidden sm:block">
                            <div
                              className="h-full bg-primary rounded-full"
                              style={{ width: `${agent.resolutionRate}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium">{agent.resolutionRate}%</span>
                        </div>
                      </td>
                      <td className="text-right py-3 pl-4">{agent.messagesSent.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tiempo de primera respuesta */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Tiempo Promedio de Primera Respuesta
          </CardTitle>
          <CardDescription>Tiempo desde la llegada del mensaje hasta la primera respuesta del agente</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingRT ? (
            <Skeleton className="h-48 w-full" />
          ) : (responseTime ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sin datos en el período</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={responseTime ?? []}
                layout="vertical"
                margin={{ left: 0, right: 30 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-muted" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${v}m`}
                />
                <YAxis
                  type="category"
                  dataKey="agentName"
                  tick={{ fontSize: 11 }}
                  width={100}
                />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }}
                  formatter={(v: number, _: string, props: any) => [
                    props.payload?.avgFirstResponseFormatted ?? `${v} min`,
                    "Tiempo de respuesta"
                  ]}
                />
                <Bar
                  dataKey="avgFirstResponseMinutes"
                  name="Tiempo (min)"
                  fill={CHART_COLORS.primary}
                  radius={[0, 4, 4, 0]}
                  barSize={20}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tab: Campañas ───────────────────────────────────────────────────────────

function CampaignsTab({ period }: { period: Period }) {
  const { data: campaigns, isLoading } = trpc.analytics.campaignStats.useQuery({ period });

  const STATUS_LABELS: Record<string, string> = {
    draft: "Borrador",
    scheduled: "Programada",
    running: "Ejecutando",
    paused: "Pausada",
    completed: "Completada",
    cancelled: "Cancelada",
  };

  const STATUS_COLORS: Record<string, string> = {
    draft: "secondary",
    scheduled: "outline",
    running: "default",
    paused: "secondary",
    completed: "default",
    cancelled: "destructive",
  };

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : (campaigns ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No hay campañas en el período seleccionado.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Resumen de campañas */}
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            {[
              { label: "Total Enviados", value: (campaigns ?? []).reduce((s, c) => s + c.total, 0), color: "text-foreground" },
              { label: "Entregados", value: (campaigns ?? []).reduce((s, c) => s + c.delivered, 0), color: "text-success" },
              { label: "Leídos", value: (campaigns ?? []).reduce((s, c) => s + c.read, 0), color: "text-info" },
              { label: "Fallidos", value: (campaigns ?? []).reduce((s, c) => s + c.failed, 0), color: "text-destructive" },
            ].map(stat => (
              <Card key={stat.label}>
                <CardContent className="pt-6">
                  <div className={`text-xl md:text-2xl font-bold ${stat.color}`}>{stat.value.toLocaleString()}</div>
                  <p className="text-xs md:text-sm text-muted-foreground mt-1">{stat.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Tabla de campañas */}
          <Card>
            <CardHeader>
              <CardTitle>Detalle por Campaña</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2 pr-4 font-medium min-w-[150px]">Campaña</th>
                      <th className="text-center py-2 px-2 font-medium">Estado</th>
                      <th className="text-right py-2 px-2 font-medium">Total</th>
                      <th className="text-right py-2 px-2 font-medium">Entregados</th>
                      <th className="text-right py-2 px-2 font-medium">Leídos</th>
                      <th className="text-right py-2 px-2 font-medium">Fallidos</th>
                      <th className="text-right py-2 px-2 font-medium">% Entrega</th>
                      <th className="text-right py-2 pl-2 font-medium">% Lectura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(campaigns ?? []).map((c) => (
                      <tr key={c.campaignId} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-3 pr-4 font-medium max-w-[200px] truncate">{c.campaignName}</td>
                        <td className="py-3 px-2 text-center">
                          <Badge variant={(STATUS_COLORS[c.status] ?? "secondary") as any} className="text-xs">
                            {STATUS_LABELS[c.status] ?? c.status}
                          </Badge>
                        </td>
                        <td className="text-right py-3 px-2">{c.total.toLocaleString()}</td>
                        <td className="text-right py-3 px-2 text-success">{c.delivered.toLocaleString()}</td>
                        <td className="text-right py-3 px-2 text-info">{c.read.toLocaleString()}</td>
                        <td className="text-right py-3 px-2 text-destructive">{c.failed.toLocaleString()}</td>
                        <td className="text-right py-3 px-2">
                          <span className={c.deliveryRate >= 90 ? "text-success" : c.deliveryRate >= 70 ? "text-warning" : "text-destructive"}>
                            {c.deliveryRate}%
                          </span>
                        </td>
                        <td className="text-right py-3 pl-2">
                          <span className={c.readRate >= 50 ? "text-success" : c.readRate >= 25 ? "text-warning" : "text-muted-foreground"}>
                            {c.readRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function Analytics() {
  const [period, setPeriod] = useState<Period>("30d");
  const searchParams = new URLSearchParams(window.location.search);
  const defaultTab = searchParams.get("tab") || "overview";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-baseline sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">
            Métricas y estadísticas de rendimiento de tu equipo
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 lg:grid-cols-7 md:w-auto h-auto mb-4 p-1">
          <TabsTrigger value="overview">General</TabsTrigger>
          <TabsTrigger value="agents">Agentes</TabsTrigger>
          <TabsTrigger value="campaigns">Campañas</TabsTrigger>
          <TabsTrigger value="goals">Metas</TabsTrigger>
          <TabsTrigger value="commissions">Comisiones</TabsTrigger>
          <TabsTrigger value="achievements">Logros</TabsTrigger>
          <TabsTrigger value="reports" className="col-span-3 lg:col-span-1">Reportes</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0">
          <OverviewTab period={period} />
        </TabsContent>

        <TabsContent value="agents" className="mt-0">
          <AgentsTab period={period} />
        </TabsContent>

        <TabsContent value="campaigns" className="mt-0">
          <CampaignsTab period={period} />
        </TabsContent>

        <TabsContent value="goals" className="mt-0">
          <GoalsTab />
        </TabsContent>

        <TabsContent value="commissions" className="mt-0">
          <CommissionsTab />
        </TabsContent>

        <TabsContent value="achievements" className="mt-0">
          <AchievementsTab />
        </TabsContent>

        <TabsContent value="reports" className="space-y-4 mt-0">
          <Reports />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Tab: Metas (sin cambios, usa datos reales de gamification) ──────────────

function GoalsTab() {
  const { data: goals } = trpc.goals.list.useQuery();
  const { data: leaderboard } = trpc.dashboard.getLeaderboard.useQuery();
  const { data: achievements } = trpc.achievements.list.useQuery();

  const displayGoals = goals ?? [];
  const unlockedIds = achievements?.map(a => a.type) ?? [];

  const BADGES = [
    { id: "first_sale", name: "Primera Venta", icon: Trophy, desc: "Cerraste tu primera venta", color: "text-warning bg-warning/10" },
    { id: "shark", name: "Tiburón", icon: Medal, desc: "Más de 50M G$ en un mes", color: "text-info bg-info/10" },
    { id: "speed", name: "Rayo Veloz", icon: Clock, desc: "Respuesta promedio < 5 min", color: "text-primary bg-primary/10" },
    { id: "closer", name: "Closer", icon: Award, desc: "10 cierres en una semana", color: "text-success bg-success/10" },
    { id: "social", name: "Sociable", icon: MessageCircle, desc: "1000 mensajes enviados", color: "text-primary bg-primary/20" },
  ];

  return (
    <div className="space-y-6">
      {/* Metas activas */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayGoals.length === 0 ? (
          <div className="col-span-full text-center py-8 text-muted-foreground">
            No hay metas activas. ¡Crea una nueva meta para empezar!
          </div>
        ) : (
          displayGoals.map((goal) => {
            const progress = Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100));
            return (
              <Card key={goal.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {goal.type === "sales_amount" ? "Ventas Totales" : goal.type === "deals_closed" ? "Cierres" : "Nuevos Leads"}
                    {" "}({goal.period === "monthly" ? "Mensual" : "Semanal"})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-end mb-2">
                    <div className="text-2xl font-bold">{goal.currentAmount.toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">/ {goal.targetAmount.toLocaleString()}</div>
                  </div>
                  <Progress value={progress} className="h-2" />
                  <p className="text-xs text-muted-foreground mt-2 text-right">{progress}% completado</p>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Ranking */}
      <Card>
        <CardHeader>
          <CardTitle>Ranking del Equipo</CardTitle>
          <CardDescription>Top performers este mes</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {!leaderboard || leaderboard.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Sin datos de ranking</p>
            ) : (
              leaderboard.map((agent) => (
                <div key={agent.rank} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 font-bold text-primary text-sm">
                      #{agent.rank}
                    </div>
                    <div>
                      <div className="font-medium">{agent.name}</div>
                      <div className="text-xs text-muted-foreground">{agent.dealsWon} cierres</div>
                    </div>
                  </div>
                  <div className="font-bold">{agent.commission.toLocaleString()} G$</div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Logros */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Logros</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {BADGES.map((badge) => {
            const isUnlocked = unlockedIds.includes(badge.id);
            const Icon = badge.icon;
            return (
              <Card key={badge.id} className={`text-center ${isUnlocked ? "border-primary/50" : "opacity-50 grayscale"}`}>
                <CardContent className="pt-6 flex flex-col items-center">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${isUnlocked ? badge.color : "bg-muted"}`}>
                    <Icon className="w-8 h-8" />
                  </div>
                  <h3 className="font-bold mb-1">{badge.name}</h3>
                  <p className="text-xs text-muted-foreground">{badge.desc}</p>
                  {isUnlocked && (
                    <div className="mt-3 px-2 py-1 bg-primary/10 rounded-full text-[10px] font-medium text-primary">
                      Desbloqueado
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Comisiones ─────────────────────────────────────────────────────────
function CommissionsTab() {
  const { data: leaderboard } = trpc.dashboard.getLeaderboard.useQuery();
  const { data: agentPerf } = trpc.analytics.agentPerformance.useQuery({ period: "30d" });

  const totalCommissions = (leaderboard ?? []).reduce((sum, a) => sum + a.commission, 0);
  const totalDeals = (leaderboard ?? []).reduce((sum, a) => sum + a.dealsWon, 0);

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Comisiones (mes)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCommissions.toLocaleString()} G$</div>
            <p className="text-xs text-muted-foreground mt-1">Suma de todos los agentes</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cierres Totales</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalDeals}</div>
            <p className="text-xs text-muted-foreground mt-1">Leads ganados este mes</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Agentes Activos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(leaderboard ?? []).length}</div>
            <p className="text-xs text-muted-foreground mt-1">Con al menos un cierre</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabla de comisiones por agente */}
      <Card>
        <CardHeader>
          <CardTitle>Comisiones por Agente</CardTitle>
          <CardDescription>Ranking de comisiones generadas este mes</CardDescription>
        </CardHeader>
        <CardContent>
          {!leaderboard || leaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No hay datos de comisiones aún. Los datos aparecerán cuando se registren cierres de ventas.
            </p>
          ) : (
            <div className="space-y-3">
              {leaderboard.map((agent) => {
                const pct = totalCommissions > 0 ? Math.round((agent.commission / totalCommissions) * 100) : 0;
                return (
                  <div key={agent.rank} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 font-bold text-primary text-xs">
                          #{agent.rank}
                        </div>
                        <div>
                          <div className="font-medium text-sm">{agent.name}</div>
                          <div className="text-xs text-muted-foreground">{agent.dealsWon} cierres</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-sm">{agent.commission.toLocaleString()} G$</div>
                        <div className="text-xs text-muted-foreground">{pct}% del total</div>
                      </div>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rendimiento de agentes */}
      {agentPerf && agentPerf.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Rendimiento de Conversaciones (últimos 30 días)</CardTitle>
            <CardDescription>Conversaciones atendidas y tasa de resolución por agente</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {agentPerf.map((agent) => (
                <div key={agent.agentId} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-sm">{agent.agentName}</div>
                    <div className="text-xs text-muted-foreground">
                      {agent.totalConversations} conversaciones · {agent.messagesSent} mensajes enviados
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-sm text-success">{agent.resolutionRate}%</div>
                    <div className="text-xs text-muted-foreground">resolución</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Tab: Logros ──────────────────────────────────────────────────────────────
function AchievementsTab() {
  const { data: achievements } = trpc.achievements.list.useQuery();
  const { data: leaderboard } = trpc.dashboard.getLeaderboard.useQuery();

  const unlockedIds = achievements?.map(a => a.type) ?? [];

  const BADGES = [
    { id: "first_sale", name: "Primera Venta", icon: Trophy, desc: "Cerraste tu primera venta", color: "text-warning bg-warning/10" },
    { id: "shark", name: "Tiburón", icon: Medal, desc: "Más de 50M G$ en un mes", color: "text-info bg-info/10" },
    { id: "speed", name: "Rayo Veloz", icon: Clock, desc: "Respuesta promedio < 5 min", color: "text-primary bg-primary/10" },
    { id: "closer", name: "Closer", icon: Award, desc: "10 cierres en una semana", color: "text-success bg-success/10" },
    { id: "social", name: "Sociable", icon: MessageCircle, desc: "1000 mensajes enviados", color: "text-primary bg-primary/20" },
  ];

  const unlockedCount = BADGES.filter(b => unlockedIds.includes(b.id)).length;

  return (
    <div className="space-y-6">
      {/* Resumen */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Logros Desbloqueados</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{unlockedCount} / {BADGES.length}</div>
            <Progress value={(unlockedCount / BADGES.length) * 100} className="h-2 mt-2" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Mejor Vendedor del Mes</CardTitle>
          </CardHeader>
          <CardContent>
            {leaderboard && leaderboard.length > 0 ? (
              <div>
                <div className="text-2xl font-bold">{leaderboard[0].name}</div>
                <p className="text-xs text-muted-foreground mt-1">{leaderboard[0].dealsWon} cierres · {leaderboard[0].commission.toLocaleString()} G$</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sin datos aún</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Badges */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Insignias del Equipo</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {BADGES.map((badge) => {
            const isUnlocked = unlockedIds.includes(badge.id);
            const Icon = badge.icon;
            return (
              <Card key={badge.id} className={`text-center transition-all ${isUnlocked ? "border-primary/50 shadow-md" : "opacity-50 grayscale"}`}>
                <CardContent className="pt-6 flex flex-col items-center">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${isUnlocked ? badge.color : "bg-muted"}`}>
                    <Icon className="w-8 h-8" />
                  </div>
                  <h3 className="font-bold mb-1 text-sm">{badge.name}</h3>
                  <p className="text-xs text-muted-foreground">{badge.desc}</p>
                  {isUnlocked && (
                    <div className="mt-3 px-2 py-1 bg-primary/10 rounded-full text-[10px] font-medium text-primary">
                      Desbloqueado
                    </div>
                  )}
                  {!isUnlocked && (
                    <div className="mt-3 px-2 py-1 bg-muted rounded-full text-[10px] font-medium text-muted-foreground">
                      Bloqueado
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Ranking */}
      <Card>
        <CardHeader>
          <CardTitle>Ranking del Equipo</CardTitle>
          <CardDescription>Top performers este mes</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {!leaderboard || leaderboard.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Sin datos de ranking aún</p>
            ) : (
              leaderboard.map((agent) => (
                <div key={agent.rank} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 font-bold text-primary text-sm">
                      #{agent.rank}
                    </div>
                    <div>
                      <div className="font-medium">{agent.name}</div>
                      <div className="text-xs text-muted-foreground">{agent.dealsWon} cierres</div>
                    </div>
                  </div>
                  <div className="font-bold">{agent.commission.toLocaleString()} G$</div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
