
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    CardFooter,
} from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
    Plus,
    Trash2,
    CheckCircle,
    XCircle,
    Clock,
    RefreshCw,
    Globe,
    Pencil
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

export default function Templates() {
    const [isOpen, setIsOpen] = useState(false);
    const [formData, setFormData] = useState({
        name: "",
        content: "",
        type: "whatsapp",
    });
    const [editingTemplate, setEditingTemplate] = useState<{ id: number; name: string; content: string } | null>(null);

    // Meta template creation state
    const [metaCreateOpen, setMetaCreateOpen] = useState(false);
    const [metaForm, setMetaForm] = useState({
        name: "",
        language: "en_US",
        category: "MARKETING" as "MARKETING" | "UTILITY" | "AUTHENTICATION",
        bodyText: "",
    });

    const utils = trpc.useUtils();

    // Local Templates
    const { data: localTemplates, isLoading: isLoadingLocal } = trpc.templates.list.useQuery();

    // Meta Templates
    const {
        data: metaTemplates,
        isLoading: isLoadingMeta,
        refetch: refetchMeta,
        isRefetching: isRefetchingMeta,
        error: metaError
    } = trpc.whatsapp.listTemplates.useQuery(undefined, {
        refetchOnWindowFocus: false,
        retry: false
    });

    const createTemplate = trpc.templates.create.useMutation({
        onSuccess: () => {
            utils.templates.list.invalidate();
            setIsOpen(false);
            setFormData({ name: "", content: "", type: "whatsapp" });
            toast.success("Plantilla creada");
        },
        onError: (err) => toast.error(err.message),
    });

    const updateTemplate = trpc.templates.update.useMutation({
        onSuccess: () => {
            utils.templates.list.invalidate();
            setEditingTemplate(null);
            toast.success("Plantilla actualizada");
        },
        onError: (err) => toast.error(err.message),
    });

    const deleteTemplate = trpc.templates.delete.useMutation({
        onSuccess: () => {
            utils.templates.list.invalidate();
            toast.success("Plantilla eliminada");
        },
    });

    // Meta template mutations
    const createMetaTemplate = trpc.whatsapp.createTemplate.useMutation({
        onSuccess: () => {
            utils.whatsapp.listTemplates.invalidate();
            setMetaCreateOpen(false);
            setMetaForm({ name: "", language: "en_US", category: "MARKETING", bodyText: "" });
            toast.success("Template submitted to Meta for review");
        },
        onError: (err) => toast.error(err.message),
    });

    const deleteMetaTemplate = trpc.whatsapp.deleteTemplate.useMutation({
        onSuccess: () => {
            utils.whatsapp.listTemplates.invalidate();
            toast.success("Template deleted from Meta");
        },
        onError: (err) => toast.error(err.message),
    });

    const handleCreateMeta = () => {
        if (!metaForm.name || !metaForm.bodyText) return;
        createMetaTemplate.mutate({
            name: metaForm.name,
            language: metaForm.language,
            category: metaForm.category,
            components: [{ type: "BODY", text: metaForm.bodyText }],
        });
    };

    const handleCreate = () => {
        if (!formData.name || !formData.content) return;
        createTemplate.mutate({
            name: formData.name,
            content: formData.content,
            type: formData.type as "whatsapp" | "email",
            variables: []
        });
    };

    const insertVariable = (variable: string) => {
        setFormData(prev => ({
            ...prev,
            content: prev.content + ` {{${variable}}} `
        }));
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "APPROVED":
                return <Badge variant="default" className="bg-green-500 hover:bg-green-600"><CheckCircle className="w-3 h-3 mr-1" /> Approved</Badge>;
            case "REJECTED":
                return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" /> Rejected</Badge>;
            case "PENDING":
                return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
            default:
                return <Badge variant="outline">{status}</Badge>;
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Message Templates</h1>
                    <p className="text-muted-foreground">
                        Manage your local and official WhatsApp templates
                    </p>
                </div>
                <div className="flex gap-2">
                    {/* Actions based on Tab? For now keeping Create separated */}
                </div>
            </div>

            <Tabs defaultValue="local" className="w-full">
                <div className="flex justify-between items-center mb-4">
                    <TabsList>
                        <TabsTrigger value="local">My Templates (Local)</TabsTrigger>
                        <TabsTrigger value="meta">Official (Meta)</TabsTrigger>
                    </TabsList>

                    <Dialog open={isOpen} onOpenChange={setIsOpen}>
                        <DialogTrigger asChild>
                            <Button>
                                <Plus className="mr-2 h-4 w-4" />
                                New Local Template
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[600px]">
                            <DialogHeader>
                                <DialogTitle>Create Local Template</DialogTitle>
                                <DialogDescription>
                                    Define a reusable message for internal use.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="name">Name</Label>
                                    <Input
                                        id="name"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="Ej: Bienvenida Cliente Nuevo"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="content">Content</Label>
                                    <div className="flex gap-2 mb-2">
                                        <Button variant="outline" size="sm" onClick={() => insertVariable("name")}>+ Name</Button>
                                        <Button variant="outline" size="sm" onClick={() => insertVariable("company")}>+ Company</Button>
                                    </div>
                                    <Textarea
                                        id="content"
                                        value={formData.content}
                                        onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                        placeholder="Hola {{name}}, gracias por contactarnos..."
                                        rows={6}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
                                <Button onClick={handleCreate}>Save Template</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>

                <TabsContent value="local" className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {isLoadingLocal ? (
                            [1, 2, 3].map(i => <div key={i} className="h-40 bg-muted animate-pulse rounded-lg" />)
                        ) : localTemplates?.length === 0 ? (
                            <div className="col-span-full text-center py-12 text-muted-foreground border rounded-lg border-dashed">
                                No local templates created yet.
                            </div>
                        ) : (
                            localTemplates?.map((tpl) => (
                                <Card key={tpl.id} className="relative group hover:border-primary/50 transition-colors">
                                    <CardHeader className="pb-2">
                                        <div className="flex justify-between items-start">
                                            <CardTitle className="text-base truncate pr-12" title={tpl.name}>{tpl.name}</CardTitle>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity absolute top-4 right-4">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6"
                                                    onClick={() => setEditingTemplate({ id: tpl.id, name: tpl.name, content: tpl.content })}
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-destructive"
                                                    onClick={() => deleteTemplate.mutate({ id: tpl.id })}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                        <CardDescription className="text-xs uppercase font-semibold text-primary">{tpl.type}</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4 bg-muted/40 p-3 rounded-md text-xs font-mono">
                                            {tpl.content}
                                        </div>
                                    </CardContent>
                                </Card>
                            ))
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="meta" className="space-y-4">
                    <div className="flex justify-end mb-4 gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => refetchMeta()}
                            disabled={isRefetchingMeta}
                            className="gap-2"
                        >
                            <RefreshCw className={`w-4 h-4 ${isRefetchingMeta ? 'animate-spin' : ''}`} />
                            Sync with Meta
                        </Button>
                        <Button size="sm" onClick={() => setMetaCreateOpen(true)} className="gap-2">
                            <Plus className="w-4 h-4" />
                            Create Meta Template
                        </Button>
                    </div>

                    {metaError && (
                        <div className="p-4 rounded-md bg-destructive/10 text-destructive mb-4 text-sm flex items-center gap-2">
                            <XCircle className="w-4 h-4" />
                            Could not load Meta templates. Check your WhatsApp connection in Settings.
                        </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {isLoadingMeta ? (
                            [1, 2, 3].map(i => <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />)
                        ) : metaTemplates?.length === 0 ? (
                            <div className="col-span-full text-center py-12 text-muted-foreground border rounded-lg border-dashed">
                                No Meta templates found, or WhatsApp is not connected.
                            </div>
                        ) : (
                            metaTemplates?.map((tpl: any) => (
                                <Card key={tpl.id} className="overflow-hidden border-l-4 border-l-transparent hover:border-l-primary transition-all group relative">
                                    <CardHeader className="pb-3 bg-muted/5">
                                        <div className="flex justify-between items-start gap-2">
                                            <div>
                                                <CardTitle className="text-base font-semibold">{tpl.name}</CardTitle>
                                                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                                    <Globe className="w-3 h-3" />
                                                    {tpl.language}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {getStatusBadge(tpl.status)}
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                                    onClick={() => {
                                                        if (confirm(`Delete template "${tpl.name}" from Meta?`)) {
                                                            deleteMetaTemplate.mutate({ templateName: tpl.name });
                                                        }
                                                    }}
                                                    disabled={deleteMetaTemplate.isPending}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="pt-4 text-sm">
                                        <div className="bg-muted/30 p-3 rounded-md text-xs space-y-2">
                                            {tpl.components?.find((c: any) => c.type === 'HEADER') && (
                                                <p className="font-bold text-foreground/80">
                                                    {tpl.components.find((c: any) => c.type === 'HEADER').text || '[Media Header]'}
                                                </p>
                                            )}
                                            <p className="whitespace-pre-wrap text-muted-foreground">
                                                {tpl.components?.find((c: any) => c.type === 'BODY')?.text}
                                            </p>
                                            {tpl.components?.find((c: any) => c.type === 'FOOTER') && (
                                                <p className="text-[10px] text-muted-foreground/60 pt-1 border-t mt-1">
                                                    {tpl.components.find((c: any) => c.type === 'FOOTER').text}
                                                </p>
                                            )}
                                        </div>
                                    </CardContent>
                                    <CardFooter className="bg-muted/5 py-2 px-4 text-xs text-muted-foreground flex justify-between">
                                        <span className="capitalize">{tpl.category}</span>
                                        <span className="font-mono opacity-50">ID: {tpl.id}</span>
                                    </CardFooter>
                                </Card>
                            ))
                        )}
                    </div>
                </TabsContent>
            </Tabs>

            {/* Edit Template Dialog */}
            <Dialog open={!!editingTemplate} onOpenChange={(open) => { if (!open) setEditingTemplate(null); }}>
                <DialogContent className="sm:max-w-[600px]">
                    <DialogHeader>
                        <DialogTitle>Edit Template</DialogTitle>
                        <DialogDescription>Update the name or content of the template.</DialogDescription>
                    </DialogHeader>
                    {editingTemplate && (
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                                <Label>Name</Label>
                                <Input
                                    value={editingTemplate.name}
                                    onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Content</Label>
                                <Textarea
                                    value={editingTemplate.content}
                                    onChange={(e) => setEditingTemplate({ ...editingTemplate, content: e.target.value })}
                                    rows={6}
                                />
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingTemplate(null)}>Cancel</Button>
                        <Button
                            onClick={() => {
                                if (!editingTemplate) return;
                                updateTemplate.mutate({
                                    id: editingTemplate.id,
                                    name: editingTemplate.name,
                                    content: editingTemplate.content,
                                });
                            }}
                            disabled={updateTemplate.isPending}
                        >
                            {updateTemplate.isPending ? "Saving..." : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Create Meta Template Dialog */}
            <Dialog open={metaCreateOpen} onOpenChange={setMetaCreateOpen}>
                <DialogContent className="sm:max-w-[600px]">
                    <DialogHeader>
                        <DialogTitle>Create Meta Template</DialogTitle>
                        <DialogDescription>
                            Submit a new message template to Meta for review. Once approved, you can use it to send messages.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="meta-name">Template Name</Label>
                            <Input
                                id="meta-name"
                                value={metaForm.name}
                                onChange={(e) => setMetaForm({ ...metaForm, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                                placeholder="e.g. welcome_new_customer"
                            />
                            <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and underscores only.</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Language</Label>
                                <Select value={metaForm.language} onValueChange={(v) => setMetaForm({ ...metaForm, language: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="en_US">English (US)</SelectItem>
                                        <SelectItem value="en">English</SelectItem>
                                        <SelectItem value="es">Spanish</SelectItem>
                                        <SelectItem value="pt_BR">Portuguese (BR)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label>Category</Label>
                                <Select value={metaForm.category} onValueChange={(v: any) => setMetaForm({ ...metaForm, category: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="MARKETING">Marketing</SelectItem>
                                        <SelectItem value="UTILITY">Utility</SelectItem>
                                        <SelectItem value="AUTHENTICATION">Authentication</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="meta-body">Body Text</Label>
                            <Textarea
                                id="meta-body"
                                value={metaForm.bodyText}
                                onChange={(e) => setMetaForm({ ...metaForm, bodyText: e.target.value })}
                                placeholder="Hello {{1}}, thank you for reaching out! We'll get back to you shortly."
                                rows={5}
                            />
                            <p className="text-xs text-muted-foreground">Use {"{{1}}"}, {"{{2}}"}, etc. for variables.</p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setMetaCreateOpen(false)}>Cancel</Button>
                        <Button
                            onClick={handleCreateMeta}
                            disabled={createMetaTemplate.isPending || !metaForm.name || !metaForm.bodyText}
                        >
                            {createMetaTemplate.isPending ? "Submitting..." : "Submit to Meta"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
