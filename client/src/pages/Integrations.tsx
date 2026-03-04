import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  MessageCircle,
  Mail,
  Bot,
  MapPin,
  Workflow,
  Trash2,
  Send,
  Activity,
  ArrowRight,
  Code2,
  Plus,
  RefreshCw,
  Eye,
  Copy,
  EyeOff
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { PermissionGuard } from "@/components/PermissionGuard";

export default function Integrations() {
  return (
    <PermissionGuard permission="integrations.view">
      <IntegrationsContent />
    </PermissionGuard>
  );
}

function IntegrationsContent() {
  const [, setLocation] = useLocation();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Integraciones</h1>
        <p className="text-muted-foreground">
          Conectá tus herramientas favoritas y configurá los servicios externos.
        </p>
      </div>

      <Tabs defaultValue="messaging" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="messaging">Canales</TabsTrigger>
          <TabsTrigger value="automation">Automatización</TabsTrigger>
          <TabsTrigger value="system">Sistema & IA</TabsTrigger>
        </TabsList>

        {/* CHANNELS TAB — links to Settings > Conexiones */}
        <TabsContent value="messaging" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Canales de comunicación</CardTitle>
              <CardDescription>
                Todos los canales (WhatsApp, Email, Facebook) se administran desde Configuración &gt; Conexiones.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button
                  onClick={() => setLocation("/settings?tab=distribution")}
                  className="flex items-center gap-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                    <MessageCircle className="w-5 h-5 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium text-sm">WhatsApp</h4>
                    <p className="text-xs text-muted-foreground">Cloud API y QR</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                </button>

                <button
                  onClick={() => setLocation("/settings?tab=distribution")}
                  className="flex items-center gap-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <Mail className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium text-sm">Email (SMTP)</h4>
                    <p className="text-xs text-muted-foreground">Invitaciones y alertas</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                </button>

                <button
                  onClick={() => setLocation("/settings?tab=distribution")}
                  className="flex items-center gap-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                    <Activity className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium text-sm">Facebook Pages</h4>
                    <p className="text-xs text-muted-foreground">Messenger y páginas</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AUTOMATION TAB */}
        <TabsContent value="automation" className="space-y-4 mt-4">
          <WebhookIntegrations />
          <DeveloperWebhooks />
        </TabsContent>

        {/* SYSTEM TAB */}
        <TabsContent value="system" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AiSettings />
            <MapsSettings />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- SUB-COMPONENTS ---

function AiSettings() {
  const query = trpc.settings.get.useQuery();
  const updateAi = trpc.settings.updateAiConfig.useMutation({ onSuccess: () => toast.success("AI config guardado") });
  const [form, setForm] = useState({ provider: "openai" as "openai" | "anthropic", apiKey: "", model: "gpt-4-turbo" });
  const [hasExistingKey, setHasExistingKey] = useState(false);

  useEffect(() => {
    if (query.data?.aiConfig) {
      const config = query.data.aiConfig as any;
      setForm({
        provider: config.provider || "openai",
        apiKey: "", // Never hydrate API key
        model: config.model || "gpt-4-turbo"
      });
      setHasExistingKey(!!config.hasApiKey);
    }
  }, [query.data]);

  const handleSave = () => {
    const payload: any = {
      provider: form.provider,
      model: form.model
    };

    // Only send API key if user typed a new one
    if (form.apiKey.trim()) {
      payload.apiKey = form.apiKey;
    }

    updateAi.mutate(payload);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Bot className="w-5 h-5" /> Inteligencia Artificial</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label>Proveedor</Label>
          <Select value={form.provider} onValueChange={(v: any) => setForm(p => ({ ...p, provider: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="anthropic">Anthropic</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>API Key</Label>
          <Input
            type="password"
            value={form.apiKey}
            onChange={e => setForm(p => ({ ...p, apiKey: e.target.value }))}
            placeholder={hasExistingKey ? "Guardado ••••" : "sk-..."}
          />
        </div>
        <div className="grid gap-2">
          <Label>Modelo (Default)</Label>
          <Input value={form.model} onChange={e => setForm(p => ({ ...p, model: e.target.value }))} />
        </div>
        <Button onClick={handleSave} className="w-full" isLoading={updateAi.isPending} disabled={updateAi.isPending}>
          Guardar
        </Button>
      </CardContent>
    </Card>
  );
}

function MapsSettings() {
  const query = trpc.settings.get.useQuery();
  const updateMaps = trpc.settings.updateMapsConfig.useMutation({ onSuccess: () => toast.success("Maps config guardado") });
  const [apiKey, setApiKey] = useState("");
  const [hasExistingKey, setHasExistingKey] = useState(false);

  useEffect(() => {
    if (query.data?.mapsConfig) {
      const config = query.data.mapsConfig as any;
      setApiKey(""); // Never hydrate API key
      setHasExistingKey(!!config.hasApiKey);
    }
  }, [query.data]);

  const handleSave = () => {
    // Only send if user typed a new key
    if (apiKey.trim()) {
      updateMaps.mutate({ apiKey });
    } else {
      updateMaps.mutate({});
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MapPin className="w-5 h-5" /> Google Maps</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label>API Key</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={hasExistingKey ? "Guardado ••••" : "AIza..."}
          />
        </div>
        <Button onClick={handleSave} className="w-full" isLoading={updateMaps.isPending} disabled={updateMaps.isPending}>
          Guardar
        </Button>
      </CardContent>
    </Card>
  );
}

import { ConfirmDialog } from "@/components/ConfirmDialog";

function WebhookIntegrations() {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const integrationsQuery = trpc.integrations.list.useQuery();
  const utils = trpc.useUtils();

  const deleteMutation = trpc.integrations.delete.useMutation({
    onSuccess: () => {
      toast.success("Integración eliminada");
      setConfirmDeleteId(null);
      integrationsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleMutation = trpc.integrations.toggle.useMutation({
    onSuccess: () => {
      toast.success("Estado actualizado");
      integrationsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const testMutation = trpc.integrations.testWebhook.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Webhook probado exitosamente (Status: ${data.status})`);
      } else {
        toast.error(`Error al probar webhook: ${data.error || data.status}`);
      }
      integrationsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleEdit = (id: number) => {
    setEditingId(id);
    setOpen(true);
  };

  const handleDeleteClick = (id: number) => {
    setConfirmDeleteId(id);
  };

  const confirmDelete = () => {
    if (confirmDeleteId) deleteMutation.mutate({ id: confirmDeleteId });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Workflow className="w-5 h-5" />
            n8n, Zapier & Webhooks
          </CardTitle>
          <CardDescription>
            Conectá Chatwoot, n8n o cualquier servicio mediante Webhooks.
          </CardDescription>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditingId(null); }}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Bot className="w-4 h-4 mr-2" />
              Nueva Integración
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Editar Integración" : "Nueva Integración"}</DialogTitle>
              <DialogDescription>
                Configurá el endpoint y los eventos para disparar.
              </DialogDescription>
            </DialogHeader>
            <IntegrationForm
              id={editingId}
              onSuccess={() => {
                setOpen(false);
                setEditingId(null);
                integrationsQuery.refetch();
              }}
            />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-4">
        {integrationsQuery.isLoading && <div className="text-sm text-center py-4">Cargando integraciones...</div>}

        <div className="grid gap-4">
          {integrationsQuery.data?.map((integration) => (
            <div key={integration.id} className="flex flex-col md:flex-row items-center justify-between p-4 border rounded-lg bg-card gap-4">
              <div className="flex items-start gap-3 w-full md:w-auto">
                <div className={`p-2 rounded-lg ${integration.isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  <Workflow className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-sm">{integration.name}</h4>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground uppercase font-mono">
                      {integration.type}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 font-mono break-all line-clamp-1 max-w-[300px]" title={integration.webhookUrl}>
                    {integration.webhookUrl}
                  </p>
                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                    {integration.lastTriggeredAt && (
                      <span className="flex items-center gap-1 text-green-600">
                        <Activity className="w-3 h-3" />
                        Ejecutado: {new Date(integration.lastTriggeredAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                <div className="flex items-center gap-2 mr-2">
                  <Switch
                    checked={integration.isActive}
                    onCheckedChange={(c) => toggleMutation.mutate({ id: integration.id, isActive: c })}
                  />
                </div>

                <Button variant="outline" size="icon" onClick={() => testMutation.mutate({ id: integration.id })} title="Probar Webhook" isLoading={testMutation.isPending} disabled={testMutation.isPending}>
                  <Send className="w-4 h-4" />
                </Button>

                <Button variant="outline" size="sm" onClick={() => handleEdit(integration.id)}>
                  Editar
                </Button>
                <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => handleDeleteClick(integration.id)} isLoading={deleteMutation.isPending && confirmDeleteId === integration.id}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}

          {integrationsQuery.data?.length === 0 && (
            <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
              <Workflow className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p>No hay integraciones configuradas.</p>
              <p className="text-sm">Agregá la primera para conectar con Zapier, n8n o Chatwoot.</p>
            </div>
          )}
        </div>

        <ConfirmDialog
          open={!!confirmDeleteId}
          onOpenChange={(open) => !open && setConfirmDeleteId(null)}
          onConfirm={confirmDelete}
          title="¿Eliminar integración?"
          description="Esta acción no se puede deshacer. Se dejarán de enviar eventos a este webhook."
          confirmText="Eliminar"
          variant="destructive"
          isLoading={deleteMutation.isPending}
        />
      </CardContent>
    </Card>
  );
}

function IntegrationForm({ id, onSuccess }: { id: number | null, onSuccess: () => void }) {
  const isEditing = !!id;
  const numbersQuery = trpc.whatsappNumbers.list.useQuery();
  const integrationsQuery = trpc.integrations.list.useQuery();
  const existing = integrationsQuery.data?.find(i => i.id === id);

  const createMutation = trpc.integrations.create.useMutation({
    onSuccess: () => { toast.success("Integración creada"); onSuccess(); },
    onError: (e) => toast.error(e.message)
  });

  const updateMutation = trpc.integrations.update.useMutation({
    onSuccess: () => { toast.success("Integración actualizada"); onSuccess(); },
    onError: (e) => toast.error(e.message)
  });

  const [form, setForm] = useState({
    name: "",
    type: "webhook" as "webhook" | "n8n" | "zapier" | "chatwoot",
    webhookUrl: "",
    whatsappNumberId: 0,
    events: ["message_received"] // Default
  });

  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name,
        type: existing.type as any,
        webhookUrl: existing.webhookUrl,
        whatsappNumberId: existing.whatsappNumberId,
        events: (existing.events as string[]) || []
      });
    } else if (numbersQuery.data?.[0]) {
      setForm(p => ({ ...p, whatsappNumberId: numbersQuery.data[0].id }));
    }
  }, [existing, numbersQuery.data]);

  const handleSubmit = () => {
    if (!form.name || !form.webhookUrl) return toast.error("Completá los campos requeridos");
    if (isEditing && id) {
      updateMutation.mutate({ id, ...form });
    } else {
      createMutation.mutate(form);
    }
  };

  const EVENT_OPTIONS = [
    { value: "lead_created", label: "Nuevo Lead" },
    { value: "lead_updated", label: "Lead Actualizado" },
    { value: "message_received", label: "Mensaje Recibido (WhatsApp)" },
    { value: "campaign_sent", label: "Campaña Enviada" },
  ];

  const handleEventToggle = (evt: string) => {
    setForm(p => ({
      ...p,
      events: p.events.includes(evt)
        ? p.events.filter(e => e !== evt)
        : [...p.events, evt]
    }));
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4 py-2">
      <div className="grid gap-2">
        <Label>Nombre</Label>
        <Input
          value={form.name}
          onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          placeholder="Ej: Conexión n8n Producción"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Tipo</Label>
          <Select value={form.type} onValueChange={(v: any) => setForm(p => ({ ...p, type: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="webhook">Webhook Genérico</SelectItem>
              <SelectItem value="n8n">n8n</SelectItem>
              <SelectItem value="zapier">Zapier</SelectItem>
              <SelectItem value="chatwoot">Chatwoot</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label>Canal de Origen</Label>
          <Select
            value={form.whatsappNumberId.toString()}
            onValueChange={(v) => setForm(p => ({ ...p, whatsappNumberId: Number(v) }))}
          >
            <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
            <SelectContent>
              {numbersQuery.data?.map(n => (
                <SelectItem key={n.id} value={n.id.toString()}>
                  {n.phoneNumber} ({n.displayName || 'Sin nombre'})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">Disparar solo para este número</p>
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Webhook URL</Label>
        <Input
          value={form.webhookUrl}
          onChange={e => setForm(p => ({ ...p, webhookUrl: e.target.value }))}
          placeholder="https://..."
        />
      </div>

      <div className="grid gap-2">
        <Label>Eventos</Label>
        <div className="grid grid-cols-2 gap-2 border rounded-md p-3">
          {EVENT_OPTIONS.map(opt => (
            <div key={opt.value} className="flex items-center space-x-2">
              <Checkbox
                id={`evt-${opt.value}`}
                checked={form.events.includes(opt.value)}
                onCheckedChange={() => handleEventToggle(opt.value)}
              />
              <Label htmlFor={`evt-${opt.value}`} className="cursor-pointer font-normal text-sm">
                {opt.label}
              </Label>
            </div>
          ))}
        </div>
      </div>

      <DialogFooter className="pt-4">
        <Button onClick={handleSubmit} disabled={isPending}>
          {isPending ? "Guardando..." : "Guardar Integración"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// --- Developer Webhooks (webhooks router with HMAC signing & delivery logs) ---

function DeveloperWebhooks() {
  const { data: webhooks = [], refetch } = trpc.webhooks.list.useQuery();
  const { data: eventTypes = [] } = trpc.webhooks.getEventTypes.useQuery();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<any>(null);
  const [viewingDeliveries, setViewingDeliveries] = useState<number | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<number, string>>({});

  const createWebhook = trpc.webhooks.create.useMutation({
    onSuccess: () => { toast.success("Webhook creado"); refetch(); closeForm(); },
    onError: (e) => toast.error(e.message),
  });
  const updateWebhook = trpc.webhooks.update.useMutation({
    onSuccess: () => { toast.success("Webhook actualizado"); refetch(); closeForm(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteWebhook = trpc.webhooks.delete.useMutation({
    onSuccess: () => { toast.success("Webhook eliminado"); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const testWebhook = trpc.webhooks.test.useMutation({
    onSuccess: (data) => {
      if (data.success) toast.success(`Test exitoso (${data.statusCode})`);
      else toast.error(`Test falló: ${data.statusCode}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const regenerateSecret = trpc.webhooks.regenerateSecret.useMutation({
    onSuccess: (data) => {
      toast.success("Secreto regenerado");
      if (data.secret) setRevealedSecrets(prev => ({ ...prev, [data.id]: data.secret }));
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const [form, setForm] = useState({ name: "", url: "", events: [] as string[], active: true });

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingWebhook(null);
    setForm({ name: "", url: "", events: [], active: true });
  };

  const openEdit = (wh: any) => {
    setEditingWebhook(wh);
    setForm({ name: wh.name, url: wh.url, events: wh.events || [], active: wh.active });
    setIsFormOpen(true);
  };

  const handleSubmit = () => {
    if (!form.name || !form.url || form.events.length === 0) {
      toast.error("Completá nombre, URL y al menos un evento");
      return;
    }
    if (editingWebhook) {
      updateWebhook.mutate({ id: editingWebhook.id, ...form });
    } else {
      createWebhook.mutate(form);
    }
  };

  const toggleEvent = (evt: string) => {
    setForm(p => ({
      ...p,
      events: p.events.includes(evt)
        ? p.events.filter(e => e !== evt)
        : [...p.events, evt],
    }));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Code2 className="w-5 h-5" />
            Webhooks API (Desarrolladores)
          </CardTitle>
          <CardDescription>
            Webhooks con firma HMAC-SHA256 y registro de entregas. Para integraciones personalizadas.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => { setEditingWebhook(null); setForm({ name: "", url: "", events: [], active: true }); setIsFormOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" /> Nuevo Webhook
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {webhooks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
            <Code2 className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>No hay webhooks API configurados.</p>
            <p className="text-sm">Creá uno para recibir eventos con firma HMAC.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {webhooks.map((wh: any) => (
              <div key={wh.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded-md ${wh.active ? 'bg-green-100 text-green-600 dark:bg-green-900/30' : 'bg-muted text-muted-foreground'}`}>
                      <Code2 className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm">{wh.name}</h4>
                      <p className="text-xs text-muted-foreground font-mono truncate max-w-[350px]" title={wh.url}>{wh.url}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={wh.active}
                      onCheckedChange={(active) => updateWebhook.mutate({ id: wh.id, active })}
                    />
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => testWebhook.mutate({ id: wh.id })} title="Test">
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => openEdit(wh)} title="Editar">
                      <Activity className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setViewingDeliveries(viewingDeliveries === wh.id ? null : wh.id)} title="Entregas">
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10"
                      onClick={() => { if (confirm("¿Eliminar este webhook?")) deleteWebhook.mutate({ id: wh.id }); }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1">
                  {(wh.events as string[] || []).map((evt: string) => (
                    <Badge key={evt} variant="secondary" className="text-[10px] font-mono">{evt}</Badge>
                  ))}
                </div>

                {/* Secret display line */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Secret:</span>
                  {revealedSecrets[wh.id] ? (
                    <>
                      <code className="bg-muted px-2 py-0.5 rounded font-mono text-[11px]">{revealedSecrets[wh.id]}</code>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { navigator.clipboard.writeText(revealedSecrets[wh.id]); toast.success("Copiado"); }}>
                        <Copy className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setRevealedSecrets(prev => { const n = { ...prev }; delete n[wh.id]; return n; })}>
                        <EyeOff className="w-3 h-3" />
                      </Button>
                    </>
                  ) : (
                    <span className="font-mono text-muted-foreground">whsec_••••••••</span>
                  )}
                  <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => {
                    if (confirm("¿Regenerar el secreto? Las firmas anteriores dejarán de funcionar.")) {
                      regenerateSecret.mutate({ id: wh.id });
                    }
                  }}>
                    <RefreshCw className="w-3 h-3 mr-1" /> Regenerar
                  </Button>
                </div>

                {/* Delivery history */}
                {viewingDeliveries === wh.id && <WebhookDeliveries webhookId={wh.id} />}
              </div>
            ))}
          </div>
        )}

        {/* Create/Edit Dialog */}
        <Dialog open={isFormOpen} onOpenChange={(v) => { if (!v) closeForm(); else setIsFormOpen(true); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingWebhook ? "Editar Webhook" : "Nuevo Webhook API"}</DialogTitle>
              <DialogDescription>Configurá el endpoint y los eventos. Se firmará con HMAC-SHA256.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid gap-2">
                <Label>Nombre</Label>
                <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Ej: CRM Sync" />
              </div>
              <div className="grid gap-2">
                <Label>URL</Label>
                <Input value={form.url} onChange={e => setForm(p => ({ ...p, url: e.target.value }))} placeholder="https://api.example.com/webhook" />
              </div>
              <div className="grid gap-2">
                <Label>Eventos</Label>
                <div className="grid grid-cols-2 gap-2 border rounded-md p-3 max-h-[200px] overflow-y-auto">
                  {eventTypes.map((et: any) => (
                    <div key={et.event} className="flex items-center space-x-2">
                      <Checkbox
                        id={`dev-evt-${et.event}`}
                        checked={form.events.includes(et.event)}
                        onCheckedChange={() => toggleEvent(et.event)}
                      />
                      <Label htmlFor={`dev-evt-${et.event}`} className="cursor-pointer font-normal text-sm">
                        <span>{et.label}</span>
                        {et.description && <span className="block text-[10px] text-muted-foreground">{et.description}</span>}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.active} onCheckedChange={(v) => setForm(p => ({ ...p, active: v }))} />
                <Label>Activo</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeForm}>Cancelar</Button>
              <Button onClick={handleSubmit} disabled={createWebhook.isPending || updateWebhook.isPending}>
                {createWebhook.isPending || updateWebhook.isPending ? "Guardando..." : "Guardar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function WebhookDeliveries({ webhookId }: { webhookId: number }) {
  const { data: deliveries = [], isLoading } = trpc.webhooks.getDeliveries.useQuery({ webhookId });

  if (isLoading) return <div className="text-xs text-center py-2 text-muted-foreground">Cargando entregas...</div>;
  if (deliveries.length === 0) return <div className="text-xs text-center py-2 text-muted-foreground">Sin entregas registradas.</div>;

  return (
    <ScrollArea className="h-[200px] border rounded-md">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 sticky top-0">
          <tr>
            <th className="p-2 text-left font-medium">Evento</th>
            <th className="p-2 text-left font-medium">Status</th>
            <th className="p-2 text-left font-medium">Fecha</th>
            <th className="p-2 text-left font-medium">Respuesta</th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((d: any) => (
            <tr key={d.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="p-2 font-mono">{d.event || "-"}</td>
              <td className="p-2">
                <Badge variant={d.statusCode >= 200 && d.statusCode < 300 ? "default" : "destructive"} className="text-[10px]">
                  {d.statusCode || "ERR"}
                </Badge>
              </td>
              <td className="p-2 text-muted-foreground">{d.createdAt ? new Date(d.createdAt).toLocaleString() : "-"}</td>
              <td className="p-2 text-muted-foreground truncate max-w-[150px]" title={d.responseBody}>{d.responseBody || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}
