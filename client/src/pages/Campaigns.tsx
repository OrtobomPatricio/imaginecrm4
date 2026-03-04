import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Plus,
  MoreHorizontal,
  Play,
  Trash2,
  Users,
  FileText,
  MessageSquare,
  Pencil
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export default function Campaigns() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { data: campaigns, isLoading } = trpc.campaigns.list.useQuery();
  const [campaignToDelete, setCampaignToDelete] = React.useState<number | null>(null);
  const [campaignToLaunch, setCampaignToLaunch] = React.useState<number | null>(null);
  const [editingCampaign, setEditingCampaign] = React.useState<{ id: number; name: string; message: string } | null>(null);

  const deleteCampaign = trpc.campaigns.delete.useMutation({
    onSuccess: () => {
      toast.success("Campaña eliminada");
      setCampaignToDelete(null);
      utils.campaigns.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const launchCampaign = trpc.campaigns.launch.useMutation({
    onSuccess: (data) => {
      toast.success(`Campaña lanzada a ${data.recipientsCount} destinatarios`);
      setCampaignToLaunch(null);
      utils.campaigns.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateCampaign = trpc.campaigns.update.useMutation({
    onSuccess: () => {
      toast.success("Campaña actualizada");
      setEditingCampaign(null);
      utils.campaigns.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const formatDate = (date: string | Date | null | undefined) => {
    if (!date) return "-";
    try {
      return format(new Date(date), "PP p", { locale: es });
    } catch (e) {
      return "-";
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft":
        return <Badge variant="outline">Borrador</Badge>;
      case "scheduled":
        return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200">Programada</Badge>;
      case "running":
        return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200">En curso</Badge>;
      case "completed":
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-200">Completada</Badge>;
      case "cancelled":
        return <Badge variant="destructive">Cancelada</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  // Stats
  const total = campaigns?.length || 0;
  const running = campaigns?.filter(c => c.status === 'running').length || 0;
  const completed = campaigns?.filter(c => c.status === 'completed').length || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campañas</h1>
          <p className="text-muted-foreground">
            Gestiona campañas multicanal y automatizaciones
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setLocation("/templates")}>
            <FileText className="mr-2 h-4 w-4" />
            Plantillas
          </Button>
          <Button onClick={() => setLocation("/campaigns/new")}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva Campaña
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Campañas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">En Curso</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{running}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Completadas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{completed}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Historial</CardTitle>
          <CardDescription>
            Tus campañas recientes
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : campaigns?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>No tienes campañas creadas.</p>
              <Button variant="link" onClick={() => setLocation("/campaigns/new")}>Crear la primera</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Audiencia</TableHead>
                  <TableHead>Creada</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns?.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell className="font-medium">{campaign.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="uppercase text-[10px] tracking-wider">
                        {(campaign as any).type || 'whatsapp'}
                      </Badge>
                    </TableCell>
                    <TableCell>{getStatusBadge(campaign.status)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Users className="h-3 w-3" />
                        {campaign.totalRecipients || '-'}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(campaign.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {campaign.status === "draft" && (
                            <DropdownMenuItem onClick={() => setEditingCampaign({
                              id: campaign.id,
                              name: campaign.name,
                              message: (campaign as any).message || "",
                            })}>
                              <Pencil className="mr-2 h-4 w-4" /> Editar
                            </DropdownMenuItem>
                          )}
                          {campaign.status === "draft" && (
                            <DropdownMenuItem onClick={() => setCampaignToLaunch(campaign.id)}>
                              <Play className="mr-2 h-4 w-4" /> Lanzar
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem className="text-red-600" onClick={() => setCampaignToDelete(campaign.id)}>
                            <Trash2 className="mr-2 h-4 w-4" /> Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Campaign Dialog */}
      <Dialog open={!!editingCampaign} onOpenChange={(open) => { if (!open) setEditingCampaign(null); }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Editar Campaña</DialogTitle>
            <DialogDescription>Modifica los datos de la campaña (solo borradores).</DialogDescription>
          </DialogHeader>
          {editingCampaign && (
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Nombre</Label>
                <Input
                  value={editingCampaign.name}
                  onChange={(e) => setEditingCampaign({ ...editingCampaign, name: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Mensaje</Label>
                <Textarea
                  value={editingCampaign.message}
                  onChange={(e) => setEditingCampaign({ ...editingCampaign, message: e.target.value })}
                  rows={4}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCampaign(null)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!editingCampaign) return;
                updateCampaign.mutate({
                  id: editingCampaign.id,
                  name: editingCampaign.name,
                  message: editingCampaign.message,
                });
              }}
              disabled={updateCampaign.isPending}
            >
              {updateCampaign.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete */}
      <ConfirmDialog
        open={campaignToDelete !== null}
        onOpenChange={(open) => { if (!open) setCampaignToDelete(null); }}
        title="Eliminar Campaña"
        description="¿Estás seguro de eliminar esta campaña? Esta acción no se puede deshacer."
        onConfirm={() => { if (campaignToDelete) deleteCampaign.mutate({ id: campaignToDelete }); }}
        confirmText="Eliminar"
        variant="destructive"
      />

      {/* Confirm Launch */}
      <ConfirmDialog
        open={campaignToLaunch !== null}
        onOpenChange={(open) => { if (!open) setCampaignToLaunch(null); }}
        title="Lanzar Campaña"
        description="¿Estás seguro de lanzar esta campaña? Se enviará a todos los destinatarios configurados."
        onConfirm={() => { if (campaignToLaunch) launchCampaign.mutate({ campaignId: campaignToLaunch }); }}
        confirmText="Lanzar"
      />
    </div>
  );
}
