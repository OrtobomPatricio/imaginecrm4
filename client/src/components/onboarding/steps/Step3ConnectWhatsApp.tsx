import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOnboarding } from "@/hooks/useOnboarding";
import {
    QrCode,
    MessageCircle,
    CheckCircle2,
    Info,
} from "lucide-react";
import { EmbeddedSignupButton } from "@/components/EmbeddedSignupButton";
import { WhatsAppConnectionsList } from "@/components/WhatsAppConnectionsList";

/**
 * Step 3: Connect WhatsApp
 * - Tab 1: Embedded Signup (Cloud API — recommended)
 * - Tab 2: QR (Baileys — existing flow)
 */

export default function Step3ConnectWhatsApp() {
    const { nextStep, skipStep } = useOnboarding();
    const [connected, setConnected] = useState(false);

    return (
        <div className="space-y-6">
            <div className="text-center mb-8">
                <h2 className="text-2xl font-bold">Conecta WhatsApp</h2>
                <p className="text-slate-500 text-sm">Vital para recibir mensajes y leads automáticamente.</p>
            </div>

            <Tabs defaultValue="cloud" className="w-full">
                <TabsList className="grid w-full grid-cols-2 h-12 mb-8 bg-slate-100 dark:bg-slate-800 p-1">
                    <TabsTrigger value="cloud" className="flex items-center gap-2">
                        <MessageCircle className="w-4 h-4" />
                        Cloud API (Recomendado)
                    </TabsTrigger>
                    <TabsTrigger value="qr" className="flex items-center gap-2">
                        <QrCode className="w-4 h-4" />
                        Escaneo QR
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="cloud" className="space-y-4">
                    {connected ? (
                        <div className="flex flex-col items-center justify-center border-2 border-green-200 dark:border-green-800 rounded-xl p-8 bg-green-50/50 dark:bg-green-900/10">
                            <div className="p-4 bg-green-100 dark:bg-green-900/20 rounded-full inline-block mb-4">
                                <CheckCircle2 className="w-12 h-12 text-green-600" />
                            </div>
                            <h3 className="font-bold text-lg">¡WhatsApp Conectado!</h3>
                            <p className="text-slate-500 text-sm mt-1">Tu número está listo para operar con la Cloud API oficial de Meta.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="bg-blue-50 dark:bg-blue-900/10 p-4 rounded-xl border border-blue-100 dark:border-blue-800">
                                <div className="flex items-start gap-3">
                                    <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <h3 className="font-semibold text-sm text-blue-800 dark:text-blue-400">Integración Oficial de Meta</h3>
                                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                                            Conecta en segundos con la integración oficial. Compatible con empresas que ya usan la app de WhatsApp Business (modo coexistencia).
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <EmbeddedSignupButton
                                onSuccess={() => setConnected(true)}
                                onError={(msg) => console.warn("[EmbeddedSignup] Error:", msg)}
                            />
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="qr" className="space-y-4">
                    <div className="bg-amber-50 dark:bg-amber-900/10 p-4 rounded-xl border border-amber-100 dark:border-amber-800 mb-4">
                        <div className="flex items-start gap-3">
                            <Info className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                            <div>
                                <h3 className="font-semibold text-sm text-amber-800 dark:text-amber-400">Conexión por QR (No Oficial)</h3>
                                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                                    Usa WhatsApp Web para conectarte rápidamente. No requiere cuenta de Meta Business pero tiene limitaciones.
                                </p>
                            </div>
                        </div>
                    </div>
                    <WhatsAppConnectionsList />
                </TabsContent>
            </Tabs>

            <div className="flex flex-col gap-3 pt-6">
                <Button
                    className="w-full bg-blue-600 hover:bg-blue-700 h-12 text-lg"
                    disabled={!connected}
                    onClick={() => nextStep()}
                >
                    {connected ? "Continuar" : "Vincular para continuar"}
                </Button>
                <Button
                    variant="ghost"
                    className="w-full text-slate-500"
                    onClick={() => skipStep('whatsapp')}
                >
                    Configurar más tarde (No recomendado)
                </Button>
            </div>
        </div>
    );
}
