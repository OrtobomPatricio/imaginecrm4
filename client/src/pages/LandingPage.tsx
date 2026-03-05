import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare, Users, BarChart3, Zap, ArrowRight, Star, Shield,
  Phone, CalendarDays, Megaphone, Bot, Headset, Kanban, Settings,
  FileDown, PieChart, Plug, CheckCircle2, ChevronRight,
} from "lucide-react";
import { useLocation } from "wouter";

/**
 * Landing Page Component
 * Modern hero + Features showcase + Pricing preview + CTA
 */

const HERO_FEATURES = [
  "WhatsApp & Messenger integrados",
  "Pipelines y Kanban visual",
  "Campañas masivas automatizadas",
  "Analytics y reportes en tiempo real",
];

const FEATURES = [
  {
    icon: MessageSquare,
    title: "Chat en Tiempo Real",
    description: "Gestiona todas tus conversaciones de WhatsApp y Facebook Messenger desde una bandeja unificada con búsqueda, filtros y respuestas rápidas.",
    color: "from-blue-500 to-cyan-400",
  },
  {
    icon: Kanban,
    title: "CRM con Pipelines",
    description: "Organiza tus leads en vista lista o tablero Kanban. Arrastra y suelta entre etapas personalizables para tu proceso de venta.",
    color: "from-violet-500 to-purple-400",
  },
  {
    icon: Megaphone,
    title: "Campañas Masivas",
    description: "Crea campañas de WhatsApp, SMS y email con segmentación, plantillas con variables y programación automática.",
    color: "from-orange-500 to-amber-400",
  },
  {
    icon: Bot,
    title: "Automatizaciones",
    description: "Diseña flujos de trabajo visuales que se ejecutan al recibir un mensaje, crear un lead o cambiar una etapa. Sin código.",
    color: "from-green-500 to-emerald-400",
  },
  {
    icon: Headset,
    title: "Helpdesk & Tickets",
    description: "Sistema de tickets con colas de atención, estados (pendiente/abierto/cerrado), asignación a agentes y respuestas predefinidas.",
    color: "from-pink-500 to-rose-400",
  },
  {
    icon: CalendarDays,
    title: "Agendamiento",
    description: "Calendario integrado para agendar citas con tus clientes. Recordatorios automáticos por WhatsApp y gestión de horarios.",
    color: "from-teal-500 to-cyan-400",
  },
  {
    icon: BarChart3,
    title: "Analytics Avanzado",
    description: "Dashboard con KPIs, embudos de conversión, rendimiento de agentes, métricas de campañas y tendencias de 7/30/90 días.",
    color: "from-indigo-500 to-blue-400",
  },
  {
    icon: Phone,
    title: "Monitoreo WhatsApp",
    description: "Panel de salud de tus números: estado de conexión, progreso de warmup, cuotas diarias y troubleshooting en tiempo real.",
    color: "from-emerald-500 to-green-400",
  },
  {
    icon: Plug,
    title: "Integraciones",
    description: "Conecta WhatsApp Cloud API, Facebook Pages, email SMTP y webhooks. Integra con n8n, Zapier o cualquier servicio externo.",
    color: "from-sky-500 to-blue-400",
  },
  {
    icon: Settings,
    title: "Pipelines Personalizables",
    description: "Configura etapas de venta, campos personalizados, reglas SLA y flujos de trabajo específicos para tu negocio.",
    color: "from-amber-500 to-yellow-400",
  },
  {
    icon: Shield,
    title: "Seguridad Empresarial",
    description: "Roles y permisos granulares, log de auditoría completo, encriptación PII, aislamiento multi-tenant y backup automático.",
    color: "from-red-500 to-orange-400",
  },
  {
    icon: FileDown,
    title: "Backup y Exportación",
    description: "Exporta leads a CSV, genera backups completos en JSON y restaura tu información cuando lo necesites. Tus datos, tu control.",
    color: "from-purple-500 to-violet-400",
  },
];

const STATS = [
  { value: "10K+", label: "Mensajes/día" },
  { value: "99.9%", label: "Uptime" },
  { value: "<200ms", label: "Respuesta API" },
  { value: "∞", label: "Escalabilidad" },
];

const PLANS = [
  {
    name: "Starter",
    price: 29,
    features: ["10 usuarios", "5 números WhatsApp", "25K mensajes/mes", "2,000 leads", "Campañas básicas"],
  },
  {
    name: "Pro",
    price: 99,
    popular: true,
    features: ["25 usuarios", "10 números WhatsApp", "100K mensajes/mes", "Leads ilimitados", "Automatizaciones", "Analytics avanzado", "Soporte prioritario"],
  },
  {
    name: "Enterprise",
    price: 299,
    features: ["Usuarios ilimitados", "WhatsApp ilimitados", "10M mensajes/mes", "Leads ilimitados", "API completa", "SLA dedicado", "Onboarding guiado"],
  },
];

export default function LandingPage() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white overflow-x-hidden">

      {/* ─── NAV ─── */}
      <nav className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold text-sm">C</div>
          <span className="text-lg font-bold tracking-tight">ImagineCRM</span>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" className="text-slate-300 hover:text-white" onClick={() => setLocation("/login")}>
            Iniciar Sesión
          </Button>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setLocation("/signup")}>
            Empezar Gratis
          </Button>
        </div>
      </nav>

      {/* ─── HERO ─── */}
      <section className="max-w-7xl mx-auto px-6 pt-16 pb-24 text-center relative">
        {/* Glow effects */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-20 right-1/4 w-[300px] h-[300px] bg-purple-600/10 rounded-full blur-[100px] pointer-events-none" />

        <Badge className="mb-8 bg-blue-500/10 text-blue-400 border-blue-500/20 text-sm px-4 py-1.5 font-medium">
          🚀 Plataforma CRM #1 para WhatsApp Business
        </Badge>

        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold mb-6 leading-[1.1] tracking-tight">
          Tu equipo de ventas,
          <br />
          <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            potenciado con IA
          </span>
        </h1>

        <p className="text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Unifica WhatsApp, Messenger, helpdesk y automatizaciones en una sola plataforma.
          Cierra más ventas con menos esfuerzo.
        </p>

        {/* Hero feature pills */}
        <div className="flex flex-wrap justify-center gap-3 mb-10">
          {HERO_FEATURES.map((f) => (
            <span key={f} className="flex items-center gap-1.5 text-sm text-slate-300 bg-slate-800/60 border border-slate-700/50 rounded-full px-4 py-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> {f}
            </span>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-20">
          <Button size="lg" className="bg-blue-600 hover:bg-blue-500 text-base px-8 py-6 h-auto shadow-lg shadow-blue-600/20" onClick={() => setLocation("/signup")}>
            Comenzar Gratis <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
          <Button size="lg" variant="outline" className="border-slate-700 text-base px-8 py-6 h-auto text-white hover:bg-slate-800/80" onClick={() => setLocation("/login")}>
            Iniciar Sesión <ChevronRight className="ml-1 w-4 h-4" />
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-3xl mx-auto">
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">{stat.value}</div>
              <div className="text-xs text-slate-500 mt-1.5 uppercase tracking-wider">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── FEATURES ─── */}
      <section className="max-w-7xl mx-auto px-6 py-24 relative">
        <div className="text-center mb-16">
          <Badge className="mb-4 bg-purple-500/10 text-purple-400 border-purple-500/20 text-xs px-3 py-1">
            FUNCIONALIDADES
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Todo lo que tu equipo necesita
          </h2>
          <p className="text-slate-400 max-w-2xl mx-auto">
            Desde la primera conversación hasta el cierre de la venta. Una plataforma completa para gestionar clientes, comunicaciones y resultados.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="group p-6 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-slate-600 transition-all duration-300 hover:-translate-y-0.5"
              >
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-4 shadow-lg opacity-90`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-base font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{feature.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── HOW IT WORKS ─── */}
      <section className="max-w-5xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <Badge className="mb-4 bg-green-500/10 text-green-400 border-green-500/20 text-xs px-3 py-1">
            FÁCIL DE USAR
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">Empieza en 3 pasos</h2>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {[
            { step: "01", title: "Crea tu cuenta", desc: "Regístrate gratis. Tu workspace se configura automáticamente en segundos." },
            { step: "02", title: "Conecta WhatsApp", desc: "Escanea un QR o conecta la API Cloud de Meta. Tus conversaciones aparecen al instante." },
            { step: "03", title: "Vende más", desc: "Gestiona leads, automatiza seguimiento y escala tu equipo con analytics en tiempo real." },
          ].map((item) => (
            <div key={item.step} className="text-center">
              <div className="text-5xl font-black text-slate-800 mb-4">{item.step}</div>
              <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
              <p className="text-sm text-slate-400">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── PRICING PREVIEW ─── */}
      <section className="max-w-5xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <Badge className="mb-4 bg-amber-500/10 text-amber-400 border-amber-500/20 text-xs px-3 py-1">
            PRECIOS
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">Planes simples, sin sorpresas</h2>
          <p className="text-slate-400">14 días gratis en todos los planes. Sin tarjeta de crédito.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`relative p-6 rounded-2xl border transition-all ${
                plan.popular
                  ? "bg-blue-600/10 border-blue-500/40 shadow-lg shadow-blue-600/5"
                  : "bg-slate-900/60 border-slate-800 hover:border-slate-600"
              }`}
            >
              {plan.popular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[10px] px-3 py-0.5">
                  MÁS POPULAR
                </Badge>
              )}
              <h3 className="text-lg font-bold mb-1">{plan.name}</h3>
              <div className="flex items-baseline gap-1 mb-5">
                <span className="text-4xl font-extrabold">${plan.price}</span>
                <span className="text-sm text-slate-400">/mes</span>
              </div>
              <ul className="space-y-2.5 mb-6">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" /> {f}
                  </li>
                ))}
              </ul>
              <Button
                className={`w-full ${plan.popular ? "bg-blue-600 hover:bg-blue-500" : "bg-slate-800 hover:bg-slate-700"}`}
                onClick={() => setLocation("/signup")}
              >
                Empezar Gratis
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section className="max-w-4xl mx-auto px-6 py-24 text-center">
        <div className="p-12 sm:p-16 rounded-3xl bg-gradient-to-br from-blue-600/15 via-purple-600/10 to-pink-600/5 border border-blue-500/15 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600/5 to-purple-600/5 pointer-events-none" />
          <div className="relative">
            <div className="flex justify-center mb-4">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-5 h-5 text-yellow-400 fill-yellow-400" />
              ))}
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Empieza tu prueba gratuita de 14 días
            </h2>
            <p className="text-slate-400 mb-8 max-w-xl mx-auto">
              Sin tarjeta de crédito. Acceso completo a todas las funciones Pro.
              Cancela cuando quieras.
            </p>
            <Button size="lg" className="bg-blue-600 hover:bg-blue-500 text-base px-10 py-6 h-auto shadow-lg shadow-blue-600/25" onClick={() => setLocation("/signup")}>
              Comenzar Ahora <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-slate-800 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold text-[8px]">C</div>
            ImagineCRM © {new Date().getFullYear()}
          </div>
          <div className="flex gap-6">
            <button className="hover:text-slate-300 transition-colors" onClick={() => setLocation("/privacy")}>Privacidad</button>
            <button className="hover:text-slate-300 transition-colors" onClick={() => setLocation("/terms")}>Términos</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
