# Guía de Contribución (CONTRIBUTING)

¡Gracias por tu interés en contribuir a CRM PRO V4! Este documento describe los estándares de código, el proceso para enviar Pull Requests (PRs) y las convenciones de Commits que aplicamos estrictamente.

## 📜 Estándares de Código

La robustez arquitectónica y la mantenibilidad a largo plazo dependen del cumplimiento de las siguientes normativas:

### 1. Multi-Tenant y Seguridad (Aislamiento de Datos)
- **Regla de Hierro:** NINGUNA consulta a la base de datos (SELECT, UPDATE, INSERT, DELETE) puede prescindir del `tenantId`.
- Debes usar SIEMPRE la condición `eq(table.tenantId, ctx.tenantId)` en los routers de tRPC.
- Para jobs asíncronos o webhooks, asegúrate de extraer y propagar el `tenantId` correctamente.

### 2. TypeScript Estricto
- Evita el uso de `any` a menos que sea estrictamente temporal para bypass bugs de librerías externas (como `superjson`).
- Asegúrate de que `npm run check` pase sin emitir errores *antes* de proponer tu código.

### 3. Frontend / React
- Preferir Functional Components y Hooks.
- Centralizar transacciones de UI (mutations y queries) usando `trpc.useMutation` y `trpc.useQuery`.
- La UI se construye apilando componentes de la capeta `src/components/ui/` (Shadcn + Tailwind).

## 🔄 Proceso de Pull Requests (PR)

1. **Haz un Fork** del repositorio y clónalo localmente.
2. **Crea una nueva rama** descriptiva desde `main`: `git checkout -b feature/mi-nueva-caracteristica` o `fix/reparacion-critica`.
3. **Escribe y ejecuta pruebas** verificando que tus cambios no rompen el flujo asíncrono ni transacciones existentes (`npm run test` y `npm run e2e`).
4. **Sube tus cambios** a tu fork (`git push origin feature/mi-nueva-caracteristica`).
5. **Abre un PR** hacia la rama `main` de CRM PRO V4.

**Requisitos para aprobar el PR:**
- Debe pasar el Pipeline de CI de Github Actions (`.github/workflows/ci.yml`).
- No debe emitir warnings de TypeScript (`npm run check` verde).
- Si introduces una API nueva o componente, añade el test unitario / E2E correspondiente.

## 📝 Convenciones de Commits (Conventional Commits)

Seguimos la especificación de [Conventional Commits](https://www.conventionalcommits.org/). La estructura obliga a tipificar el delta de cambio.

**Formato:**
`<tipo>(<scope opcional>): <descripción corta>`

**Tipos Permitidos:**
- `feat`: Añade una nueva característica o módulo (ej: `feat(billing): add paypal payment gateway`).
- `fix`: Resuelve un bug o parchea seguridad (ej: `fix(security): enforce tenant filtering in lead deletion`).
- `docs`: Solo cambios de documentación (ej: `docs: update setup guide in README`).
- `style`: Estilizado de código sin efecto en la lógica (espacios, comas, etc.).
- `refactor`: Cambio de código que no arregla un bug ni añade una feature.
- `perf`: Cambio que mejora el rendimiento de ejecución o memoria.
- `test`: Añadiendo tests faltantes o corrigiendo los existentes.
- `chore`: Mantenimiento, actualización de dependencias o scripts.

¡Valoramos profundamente tu tiempo y dedicación para hacer de CRM PRO una herramienta de nivel empresarial!
