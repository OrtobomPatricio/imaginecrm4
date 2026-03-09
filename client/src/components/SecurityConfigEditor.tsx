import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ActiveSessionsWidget } from "./ActiveSessionsWidget";

interface SecurityConfigEditorProps {
    query: any;
    updateMutation?: any;
}

export function SecurityConfigEditor({ query }: SecurityConfigEditorProps) {
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Shield className="w-5 h-5" />
                        Configuración de Seguridad Avanzada
                    </CardTitle>
                    <CardDescription>
                        Control de acceso y restricciones de seguridad
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Alert>
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                            Las funciones avanzadas de seguridad (restricción por IP, límite de intentos de login,
                            timeout de sesión configurable) estarán disponibles en una próxima versión.
                            Actualmente la plataforma cuenta con rate limiting global, cookies HttpOnly/SameSite
                            y protección CSRF activos por defecto.
                        </AlertDescription>
                    </Alert>
                </CardContent>
            </Card>

            <ActiveSessionsWidget />
        </div>
    );
}
