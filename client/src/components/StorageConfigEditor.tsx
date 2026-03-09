import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { HardDrive, Info } from "lucide-react";

interface StorageConfigEditorProps {
    query: any;
    updateMutation: any;
}

export function StorageConfigEditor({ query, updateMutation }: StorageConfigEditorProps) {
    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <HardDrive className="w-5 h-5" />
                        Almacenamiento
                    </CardTitle>
                    <CardDescription>
                        Estado actual del almacenamiento de archivos
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Alert>
                        <HardDrive className="h-4 w-4" />
                        <AlertDescription>
                            Los archivos se almacenan en el directorio local del servidor (<code>storage/uploads</code>).
                            Asegurate de tener espacio en disco suficiente y backups configurados.
                        </AlertDescription>
                    </Alert>
                    <Alert variant="default">
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                            El soporte para almacenamiento remoto (Amazon S3 / DigitalOcean Spaces) estará disponible
                            en una próxima versión. Actualmente todos los archivos se guardan localmente.
                        </AlertDescription>
                    </Alert>
                </CardContent>
            </Card>
        </div>
    );
}
