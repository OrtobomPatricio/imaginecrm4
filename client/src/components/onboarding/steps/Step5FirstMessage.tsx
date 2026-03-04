import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOnboarding } from "@/hooks/useOnboarding";
import {
    Send,
    Sparkles,
    CheckCircle2,
    Users,
    Rocket,
    Loader2,
    AlertTriangle,
    Phone
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc";

/**
 * Step 5: First Message & Launch
 *
 * Sends a real WhatsApp message via Cloud API if a connection is active.
 * Falls back to demo mode if no WhatsApp is connected.
 */

export default function Step5FirstMessage() {
    const { nextStep, prevStep } = useOnboarding();
    const { toast } = useToast();
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [message, setMessage] = useState("Hola! Gracias por contactarnos. ¿En qué podemos ayudarte hoy?");
    const [phone, setPhone] = useState("");
    const [sendError, setSendError] = useState("");

    const sendTestMutation = trpc.onboarding.sendTestMessage.useMutation();

    const handleSendTest = async () => {
        setSending(true);
        setSendError("");

        if (!phone.trim()) {
            setSending(false);
            setSendError("Ingresa un número de teléfono para enviar un mensaje real por WhatsApp.");
            return;
        }

        try {
            const result = await sendTestMutation.mutateAsync({
                phone: phone.trim(),
                message: message.trim(),
            });

            if (result.success) {
                setSent(true);
                toast({ title: "¡Mensaje Enviado!", description: "Tu mensaje de prueba fue enviado por WhatsApp." });
            } else {
                setSendError(result.message || "No se pudo enviar el mensaje.");
                toast({ title: "No se pudo enviar", description: result.message, variant: "destructive" });
            }
        } catch (err: any) {
            setSendError(err.message || "Error al enviar el mensaje.");
            toast({ title: "Error", description: err.message, variant: "destructive" });
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="text-center mb-8">
                <h2 className="text-2xl font-bold">¡Casi Listos! 🚀</h2>
                <p className="text-slate-500 text-sm">Envía un mensaje de prueba real a un número de WhatsApp.</p>
            </div>

            {/* Phone number input */}
            <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                    <Phone className="w-4 h-4 text-slate-400" />
                    Número de destino (con código de país)
                </Label>
                <Input
                    placeholder="Ej: +595981234567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="h-10 font-mono"
                />
                <p className="text-[10px] text-slate-400">Ingresa tu número para recibir el mensaje de prueba por WhatsApp.</p>
            </div>

            <div className="bg-slate-50 dark:bg-slate-900 border rounded-2xl overflow-hidden shadow-sm">
                <div className="p-4 bg-white dark:bg-slate-800 border-b flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold">
                            {phone ? phone.slice(-2) : "JP"}
                        </div>
                        <div>
                            <p className="text-sm font-bold">{phone || "Vista previa"}</p>
                            <Badge variant="outline" className="text-[10px] text-green-600 border-green-200">
                                {phone ? "Número real" : "Demo"}
                            </Badge>
                        </div>
                    </div>
                    <Users className="w-5 h-5 text-slate-400" />
                </div>

                <div className="h-48 p-4 overflow-y-auto space-y-4 bg-slate-50 dark:bg-black/20">
                    <div className="bg-slate-200 dark:bg-slate-800 p-3 rounded-2xl rounded-bl-none max-w-[80%] text-sm">
                        Hola, vi tus servicios en internet y me interesa una cotización.
                    </div>
                    {sent && (
                        <div className="ml-auto bg-blue-600 text-white p-3 rounded-2xl rounded-br-none max-w-[80%] text-sm animate-in slide-in-from-bottom-2">
                            {message}
                            <div className="text-[10px] text-blue-200 text-right mt-1">19:45 PM ✓✓</div>
                        </div>
                    )}
                </div>

                <div className="p-4 bg-white dark:bg-slate-800 border-t space-y-3">
                    <div className="relative">
                        <Textarea
                            placeholder="Escribe tu mensaje..."
                            className="min-h-[80px] resize-none pr-10"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                        />
                        <Sparkles className="absolute right-3 top-3 w-4 h-4 text-amber-500 cursor-pointer hover:scale-110 transition-transform" />
                    </div>
                    <Button
                        className="w-full bg-blue-600 hover:bg-blue-700"
                        onClick={handleSendTest}
                        disabled={sending || sent || !message.trim()}
                    >
                        {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                        {sending ? "Enviando..." : sent ? "Mensaje Enviado" : "Enviar por WhatsApp"}
                        {!sending && !sent && <Send className="w-4 h-4 ml-2" />}
                        {sent && <CheckCircle2 className="w-4 h-4 ml-2" />}
                    </Button>
                    {sendError && (
                        <div className="flex items-start gap-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                            <span>{sendError}</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="pt-6 space-y-3">
                <Button
                    className="w-full bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-800 hover:to-indigo-800 h-14 text-lg font-bold shadow-lg group"
                    onClick={() => nextStep()}
                >
                    ¡Lanzar mi CRM!
                    <Rocket className="w-5 h-5 ml-2 group-hover:animate-bounce" />
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
