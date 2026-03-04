import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useOnboarding } from "@/hooks/useOnboarding";
import { UploadCloud, FileSpreadsheet, Check, AlertCircle, Trash2, Database, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";

/**
 * Step 4: Import Contacts (CSV)
 *
 * Parses CSV client-side to show preview stats,
 * then sends to backend via trpc.backup.importLeadsCSV for actual import.
 */

/** Simple CSV parser — splits lines and detects rows with phone-like data */
function parseCSVPreview(text: string): { valid: number; invalid: number; totalRows: number } {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { valid: 0, invalid: 0, totalRows: 0 }; // header + at least 1 row

    const header = lines[0].toLowerCase();
    const hasPhoneCol = /phone|telefono|teléfono|celular|whatsapp|número|numero|tel/.test(header);
    const hasNameCol = /name|nombre|first|last|contacto/.test(header);

    let valid = 0;
    let invalid = 0;

    for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(/[,;\t]/);
        // A row is "valid" if it has at least 2 non-empty cells and one looks like a phone number
        const hasPhone = cells.some(c => /\+?\d[\d\s\-()]{6,}/.test(c.trim()));
        const hasNonEmpty = cells.filter(c => c.trim()).length >= 2;
        if (hasPhone && hasNonEmpty) {
            valid++;
        } else if (lines[i].trim()) {
            invalid++;
        }
    }

    return { valid, invalid, totalRows: lines.length - 1 };
}

export default function Step4ImportContacts() {
    const { nextStep, skipStep, prevStep } = useOnboarding();
    const { toast } = useToast();
    const [file, setFile] = useState<File | null>(null);
    const [csvContent, setCsvContent] = useState<string>("");
    const [stats, setStats] = useState({ valid: 0, invalid: 0 });
    const [isImporting, setIsImporting] = useState(false);
    const [imported, setImported] = useState(false);

    const importMutation = trpc.backup.importLeadsCSV.useMutation({
        onSuccess: (result) => {
            setImported(true);
            setIsImporting(false);
            toast({ title: "¡Contactos importados!", description: `${(result as any).created ?? stats.valid} leads creados correctamente.` });
        },
        onError: (err) => {
            setIsImporting(false);
            toast({ title: "Error al importar", description: err.message, variant: "destructive" });
        }
    });

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;

        setFile(f);
        setImported(false);

        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target?.result as string;
            setCsvContent(text);
            const preview = parseCSVPreview(text);
            setStats({ valid: preview.valid, invalid: preview.invalid });
        };
        reader.readAsText(f);
    };

    const handleImport = async () => {
        if (!csvContent) return;
        setIsImporting(true);
        importMutation.mutate({ csvContent });
    };

    const handleImportAndContinue = async () => {
        if (imported) {
            nextStep({ fileName: file?.name, imported: true });
        } else if (csvContent) {
            setIsImporting(true);
            try {
                await importMutation.mutateAsync({ csvContent });
                nextStep({ fileName: file?.name, imported: true });
            } catch {
                // Error handled by onError above
            }
        }
    };

    return (
        <div className="space-y-6">
            <div className="text-center mb-8">
                <h2 className="text-2xl font-bold">Importa tus Prospectos</h2>
                <p className="text-slate-500 text-sm">No empieces de cero. Carga un archivo CSV con tus contactos.</p>
            </div>

            {!file ? (
                <div
                    className="border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center hover:border-blue-500 hover:bg-blue-50/10 transition-all cursor-pointer group"
                    onClick={() => document.getElementById('csv-upload')?.click()}
                >
                    <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-full inline-block mb-4 group-hover:bg-blue-100 transition-colors">
                        <UploadCloud className="w-10 h-10 text-slate-400 group-hover:text-blue-600" />
                    </div>
                    <h3 className="font-bold text-lg mb-1">Click para subir CSV</h3>
                    <p className="text-xs text-slate-400 max-w-xs mx-auto">
                        Asegúrate de que el archivo tenga columnas de nombre y teléfono.
                        Separadores aceptados: coma, punto y coma, o tabulación.
                    </p>
                    <input
                        id="csv-upload"
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={handleFile}
                    />
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border flex items-center gap-4">
                        <div className="p-3 bg-green-100 dark:bg-green-900/20 rounded-lg">
                            <FileSpreadsheet className="w-6 h-6 text-green-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="font-bold truncate">{file.name}</p>
                            <p className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB — {stats.valid + stats.invalid} filas detectadas</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => { setFile(null); setCsvContent(""); setStats({ valid: 0, invalid: 0 }); setImported(false); }}>
                            <Trash2 className="w-4 h-4 text-slate-400" />
                        </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-green-50 dark:bg-green-900/10 rounded-xl border border-green-100 dark:border-green-800">
                            <div className="flex items-center gap-2 text-green-700 dark:text-green-400 mb-1">
                                <Check className="w-4 h-4" />
                                <span className="text-xs font-bold uppercase">Válidos</span>
                            </div>
                            <span className="text-2xl font-bold">{stats.valid}</span>
                        </div>
                        <div className="p-4 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-100 dark:border-red-800">
                            <div className="flex items-center gap-2 text-red-700 dark:text-red-400 mb-1">
                                <AlertCircle className="w-4 h-4" />
                                <span className="text-xs font-bold uppercase">Con errores</span>
                            </div>
                            <span className="text-2xl font-bold">{stats.invalid}</span>
                        </div>
                    </div>

                    {imported && (
                        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-center">
                            <p className="text-sm font-semibold text-green-700 dark:text-green-300">✓ Contactos importados correctamente</p>
                        </div>
                    )}
                </div>
            )}

            <div className="bg-slate-900 text-white p-6 rounded-xl flex items-center justify-between gap-6">
                <div className="space-y-1">
                    <h4 className="font-bold flex items-center gap-2">
                        <Database className="w-4 h-4 text-blue-400" />
                        ¿Sin archivos?
                    </h4>
                    <p className="text-xs text-slate-400">Podemos cargar 5 contactos de ejemplo para que explores el CRM.</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => nextStep({ demo: true })}>
                    Usar Demo
                </Button>
            </div>

            <div className="flex flex-col gap-3 pt-6">
                <Button
                    className="w-full bg-blue-600 hover:bg-blue-700 h-12 text-lg"
                    disabled={!file || isImporting || stats.valid === 0}
                    onClick={handleImportAndContinue}
                >
                    {isImporting ? (
                        <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Importando...</>
                    ) : imported ? (
                        "Continuar"
                    ) : file && stats.valid > 0 ? (
                        `Importar ${stats.valid} Contactos`
                    ) : (
                        "Seleccionar Archivo"
                    )}
                </Button>
                <Button
                    variant="ghost"
                    className="w-full text-slate-500"
                    onClick={() => skipStep('import')}
                >
                    Agregar manualmente después
                </Button>
                <Button
                    variant="ghost"
                    className="w-full text-slate-400"
                    onClick={prevStep}
                >
                    ← Volver al paso anterior
                </Button>
            </div>
        </div>
    );
}
