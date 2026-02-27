# ImagineCRM — Documentación de API (tRPC)

> **Generado automáticamente** a partir del código fuente de los routers tRPC.
> Fecha: Febrero 2026

## Resumen

ImagineCRM expone su API a través de **tRPC** con transporte HTTP batch. Todos los endpoints están disponibles en `/api/trpc/{router}.{procedure}`.

### Autenticación

La autenticación se realiza mediante **cookies JWT** (`HttpOnly`, `Secure`, `SameSite=Lax`). Los endpoints marcados como "Autenticado" requieren una sesión activa. Los endpoints con "Permiso" requieren además un rol específico asignado al usuario.

### Niveles de acceso

| Nivel | Descripción |
|---|---|
| **Público** | No requiere autenticación |
| **Autenticado** | Requiere sesión JWT válida |
| **Permiso: X** | Requiere sesión + permiso RBAC específico |

---

## Índice de Routers

| Router | Descripción | Endpoints |
|---|---|---|
| `scheduling` | Agendamiento | 8 |
| `analytics` | Analytics | 9 |
| `auth` | Autenticación | 5 |
| `backup` | Backups | 4 |
| `campaigns` | Campañas | 6 |
| `customFields` | Campos Personalizados | 4 |
| `chat` | Chat | 12 |
| `internalChat` | Chat Interno | 4 |
| `whatsappConnections` | Conexiones WhatsApp | 5 |
| `settings` | Configuración | 11 |
| `dashboard` | Dashboard | 5 |
| `team` | Equipo | 7 |
| `tags` | Etiquetas | 13 |
| `facebook` | Facebook | 4 |
| `billing` | Facturación | 3 |
| `gdpr` | GDPR | 5 |
| `helpdesk` | Helpdesk | 13 |
| `integrations` | Integraciones | 7 |
| `leads` | Leads | 12 |
| `licensing` | Licencias | 4 |
| `achievements` | Logros (Gamificación) | 5 |
| `messages` | Mensajes | 2 |
| `goals` | Metas (Gamificación) | 5 |
| `notesTasks` | Notas y Tareas | 9 |
| `whatsappNumbers` | Números WhatsApp | 8 |
| `onboarding` | Onboarding | 5 |
| `pipelines` | Pipelines | 8 |
| `templates` | Plantillas | 5 |
| `leadReminders` | Recordatorios de Leads | 8 |
| `signup` | Registro | 2 |
| `smtp` | SMTP | 6 |
| `security` | Seguridad | 6 |
| `sessions` | Sesiones | 3 |
| `system` | Sistema | 1 |
| `trial` | Trial | 4 |
| `terms` | Términos | 4 |
| `webhooks` | Webhooks | 8 |
| `whatsapp` | WhatsApp | 6 |
| `workflows` | Workflows | 6 |

**Total: 39 routers, 93 queries, 140 mutations**

---

## Detalle de Endpoints

### `scheduling` — Agendamiento

**Archivo:** `server/routers/scheduling.ts`
**Endpoints:** 3 queries, 4 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `scheduling.list` | Permiso: `scheduling.view` | — |
| `scheduling.listReasons` | Permiso: `scheduling.view` | `firstName`: string, `lastName`: string, `phone`: string, `email`: string, `reasonId`: number, `appointmentDate`: string, `appointmentTime`: string, `notes`: string |
| `scheduling.getTemplates` | Autenticado | `id`: number, `name`: string, `content`: string, `daysBefore`: number |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `scheduling.create` | Permiso: `scheduling.manage` | `firstName`: string, `lastName`: string, `phone`: string, `email`: string, `reasonId`: number, `appointmentDate`: string, `appointmentTime`: string, `notes`: string |
| `scheduling.delete` | Permiso: `scheduling.manage` | `id`: number |
| `scheduling.saveTemplate` | Permiso: `scheduling.manage` | `id`: number, `name`: string, `content`: string, `daysBefore`: number |
| `scheduling.deleteTemplate` | Permiso: `scheduling.manage` | `id`: number |

---

### `analytics` — Analytics

**Archivo:** `server/routers/analytics.ts`
**Endpoints:** 9 queries, 0 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `analytics.overview` | Permiso: `reports.view` | — |
| `analytics.leadsOverTime` | Permiso: `reports.view` | — |
| `analytics.conversionFunnel` | Permiso: `reports.view` | `pipelineId`: number |
| `analytics.agentPerformance` | Permiso: `reports.view` | — |
| `analytics.messageVolume` | Permiso: `reports.view` | — |
| `analytics.campaignStats` | Permiso: `reports.view` | — |
| `analytics.leadSources` | Permiso: `reports.view` | — |
| `analytics.responseTime` | Permiso: `reports.view` | — |
| `analytics.activitySummary` | Permiso: `reports.view` | — |

---

### `auth` — Autenticación

**Archivo:** `server/routers/auth.ts`
**Endpoints:** 1 queries, 4 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `auth.me` | Público | — |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `auth.logout` | Público | `email`: string, `password`: string |
| `auth.markTourSeen` | Autenticado | `email`: string, `password`: string |
| `auth.loginWithCredentials` | Público | `email`: string, `password`: string |
| `auth.acceptInvitation` | Público | `token`: string, `password`: string, `termsVersion`: string |

---

### `backup` — Backups

**Archivo:** `server/routers/backup.ts`
**Endpoints:** 1 queries, 3 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `backup.exportLeadsCSV` | Permiso: `leads.view` | `status`: enum, `from`: string, `to`: string |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `backup.createBackup` | Permiso: `settings.manage` | `backupJson`: any, `mode`: enum |
| `backup.restoreBackupJson` | Permiso: `settings.manage` | `backupJson`: any, `mode`: enum |
| `backup.importLeadsCSV` | Permiso: `leads.create` | `csvContent`: string |

---

### `campaigns` — Campañas

**Archivo:** `server/routers/campaigns.ts`
**Endpoints:** 3 queries, 3 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `campaigns.list` | Permiso: `campaigns.view` | `name`: string, `type`: enum, `templateId`: number, `message`: string, `audienceConfig`: any |
| `campaigns.calculateAudience` | Permiso: `campaigns.manage` | `pipelineStageId`: number, `tags`: array |
| `campaigns.getById` | Permiso: `campaigns.view` | `id`: number |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `campaigns.create` | Permiso: `campaigns.manage` | `name`: string, `type`: enum, `templateId`: number, `message`: string, `audienceConfig`: any |
| `campaigns.launch` | Permiso: `campaigns.manage` | `campaignId`: number |
| `campaigns.delete` | Permiso: `campaigns.manage` | `id`: number |

---

### `customFields` — Campos Personalizados

**Archivo:** `server/routers/custom-fields.ts`
**Endpoints:** 1 queries, 3 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `customFields.list` | Permiso: `leads.view` | `name`: string, `type`: enum, `options`: array, `entityType`: enum |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `customFields.create` | Permiso: `settings.manage` | `name`: string, `type`: enum, `options`: array, `entityType`: enum |
| `customFields.update` | Permiso: `settings.manage` | `id`: number, `name`: string, `type`: enum, `options`: array, `entityType`: enum, `isRequired`: boolean |
| `customFields.delete` | Permiso: `settings.manage` | `id`: number |

---

### `chat` — Chat

**Archivo:** `server/routers/chat.ts`
**Endpoints:** 4 queries, 7 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `chat.getById` | Permiso: `chat.view` | `id`: number |
| `chat.listConversations` | Permiso: `chat.view` | — |
| `chat.getMessages` | Permiso: `chat.view` | — |
| `chat.getRecentMessages` | Permiso: `monitoring.view` | — |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `chat.getOrCreateByLeadId` | Permiso: `chat.view` | `leadId`: number |
| `chat.markAsRead` | Permiso: `chat.view` | `conversationId`: number, `whatsappNumberId`: number |
| `chat.updateStatus` | Permiso: `chat.assign` | `conversationId`: number, `status`: enum |
| `chat.delete` | Permiso: `chat.manage` | `conversationId`: number |
| `chat.bulkDelete` | Permiso: `chat.manage` | `conversationIds`: array |
| `chat.assign` | Permiso: `chat.assign` | `conversationId`: number, `assignedToId`: number |
| `chat.createConversation` | Permiso: `chat.send` | `whatsappNumberId`: number, `facebookPageId`: number, `contactPhone`: string, `contactName`: string, `leadId`: number |

---

### `internalChat` — Chat Interno

**Archivo:** `server/routers/internal-chat.ts`
**Endpoints:** 2 queries, 2 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `internalChat.getHistory` | Autenticado | `recipientId`: number |
| `internalChat.getRecentChats` | Autenticado | — |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `internalChat.send` | Autenticado | `content`: string, `recipientId`: number, `attachments`: array, `type`: enum, `url`: string, `name`: string |
| `internalChat.markAsRead` | Autenticado | `senderId`: number |

---

### `whatsappConnections` — Conexiones WhatsApp

**Archivo:** `server/routers/whatsapp-connections.ts`
**Endpoints:** 2 queries, 3 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `whatsappConnections.get` | Permiso: `monitoring.view` | `whatsappNumberId`: number |
| `whatsappConnections.getApiConnections` | Permiso: `monitoring.view` | `whatsappNumberId`: number, `accessToken`: string, `phoneNumberId`: string, `businessAccountId`: string |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `whatsappConnections.setupApi` | Permiso: `monitoring.manage` | `whatsappNumberId`: number, `accessToken`: string, `phoneNumberId`: string, `businessAccountId`: string |
| `whatsappConnections.generateQr` | Permiso: `monitoring.manage` | `whatsappNumberId`: number |
| `whatsappConnections.disconnect` | Permiso: `monitoring.manage` | `whatsappNumberId`: number |

---

### `settings` — Configuración

**Archivo:** `server/routers/settings.ts`
**Endpoints:** 3 queries, 7 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `settings.get` | Permiso: `settings.view` | — |
| `settings.getScheduling` | Permiso: `scheduling.view` | — |
| `settings.myPermissions` | Autenticado | — |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `settings.updateSecurityConfig` | Permiso: `settings.manage` | `securityConfig`: object, `allowedIps`: array, `maxLoginAttempts`: number, `sessionTimeoutMinutes`: number |
| `settings.updateDashboardConfig` | Permiso: `settings.manage` | `layout`: array |
| `settings.updateDashboardLayout` | Permiso: `settings.manage` | `layout`: array |
| `settings.updateSmtpConfig` | Permiso: `settings.manage` | `host`: string, `port`: number, `secure`: boolean, `user`: string, `pass`: string, `from`: string |
| `settings.updateStorageConfig` | Permiso: `settings.manage` | `provider`: enum, `bucket`: string, `region`: string, `accessKey`: string, `secretKey`: string, `endpoint`: string, `publicUrl`: string |
| `settings.updateAiConfig` | Permiso: `settings.manage` | `provider`: enum, `apiKey`: string, `model`: string |
| `settings.updateMapsConfig` | Permiso: `settings.manage` | `apiKey`: string |

---

### `dashboard` — Dashboard

**Archivo:** `server/routers/dashboard.ts`
**Endpoints:** 5 queries, 0 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `dashboard.getStats` | Permiso: `dashboard.view` | — |
| `dashboard.getPipelineFunnel` | Permiso: `dashboard.view` | — |
| `dashboard.getLeaderboard` | Permiso: `dashboard.view` | — |
| `dashboard.getUpcomingAppointments` | Permiso: `dashboard.view` | — |
| `dashboard.getRecentActivity` | Permiso: `dashboard.view` | — |

---

### `team` — Equipo

**Archivo:** `server/routers/team.ts`
**Endpoints:** 1 queries, 6 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `team.listUsers` | Permiso: `users.view` | `userId`: number, `role`: enum |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `team.updateRole` | Permiso: `users.manage` | `userId`: number, `role`: enum |
| `team.updateCustomRole` | Permiso: `users.manage` | `userId`: number, `customRole`: string |
| `team.setActive` | Permiso: `users.manage` | `userId`: number, `isActive`: boolean |
| `team.create` | Permiso: `users.manage` | `name`: string, `email`: string, `password`: string, `role`: enum |
| `team.invite` | Permiso: `users.manage` | `name`: string, `email`: string, `role`: enum |
| `team.delete` | Permiso: `users.manage` | `userId`: number |

---

### `tags` — Etiquetas

**Archivo:** `server/routers/tags.ts`
**Endpoints:** 5 queries, 8 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `tags.list` | Permiso: `leads.view` | — |
| `tags.getLeadTags` | Permiso: `leads.view` | `leadId`: number |
| `tags.getLeadTagsBatch` | Permiso: `leads.view` | `leadIds`: array |
| `tags.getConversationTags` | Permiso: `chat.view` | `conversationId`: number |
| `tags.getStats` | Permiso: `analytics.view` | — |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `tags.create` | Permiso: `settings.manage` | — |
| `tags.update` | Permiso: `settings.manage` | `id`: number |
| `tags.delete` | Permiso: `settings.manage` | `id`: number |
| `tags.addTagToLead` | Permiso: `leads.edit` | `leadId`: number, `tagId`: number |
| `tags.removeTagFromLead` | Permiso: `leads.edit` | `leadId`: number, `tagId`: number |
| `tags.setLeadTags` | Permiso: `leads.edit` | `leadId`: number, `tagIds`: array |
| `tags.addTagToConversation` | Permiso: `chat.edit` | `conversationId`: number, `tagId`: number |
| `tags.removeTagFromConversation` | Permiso: `chat.edit` | `conversationId`: number, `tagId`: number |

---

### `facebook` — Facebook

**Archivo:** `server/routers/facebook.ts`
**Endpoints:** 1 queries, 3 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `facebook.listPages` | Permiso: `settings.view` | `pageId`: string, `name`: string, `accessToken`: string, `pictureUrl`: string |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `facebook.connectPage` | Permiso: `settings.manage` | `pageId`: string, `name`: string, `accessToken`: string, `pictureUrl`: string |
| `facebook.disconnectPage` | Permiso: `settings.manage` | `id`: number |
| `facebook.deletePage` | Permiso: `settings.manage` | `id`: number |

---

### `billing` — Facturación

**Archivo:** `server/routers/billing.ts`
**Endpoints:** 1 queries, 2 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `billing.getCurrentPlan` | Autenticado | `plan`: enum |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `billing.createCheckoutSession` | Autenticado | `plan`: enum |
| `billing.getBillingPortal` | Autenticado | — |

---

### `gdpr` — GDPR

**Archivo:** `server/routers/gdpr.ts`
**Endpoints:** 1 queries, 4 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `gdpr.exportMyData` | Autenticado | `confirmEmail`: string, `reason`: string |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `gdpr.requestDeletion` | Autenticado | `confirmEmail`: string, `reason`: string |
| `gdpr.updateMyData` | Autenticado | `name`: string, `marketingConsent`: boolean |
| `gdpr.restrictProcessing` | Autenticado | `restricted`: boolean |
| `gdpr.objectToMarketing` | Autenticado | — |

---

### `helpdesk` — Helpdesk

**Archivo:** `server/routers/helpdesk.ts`
**Endpoints:** 4 queries, 9 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `helpdesk.listQueues` | Permiso: `helpdesk.view` | `name`: string, `color`: string, `greetingMessage`: string |
| `helpdesk.listQueueMembers` | Permiso: `helpdesk.view` | `queueId`: number |
| `helpdesk.listInbox` | Permiso: `helpdesk.view` | `queueId`: number, `ticketStatus`: enum, `assignedToId`: number, `search`: string, `limit`: number |
| `helpdesk.listQuickAnswers` | Permiso: `helpdesk.view` | `search`: string |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `helpdesk.createQueue` | Permiso: `helpdesk.manage` | `name`: string, `color`: string, `greetingMessage`: string |
| `helpdesk.updateQueue` | Permiso: `helpdesk.manage` | `id`: number, `name`: string, `color`: string, `greetingMessage`: string |
| `helpdesk.deleteQueue` | Permiso: `helpdesk.manage` | `id`: number |
| `helpdesk.setQueueMembers` | Permiso: `helpdesk.manage` | `queueId`: number, `userIds`: array |
| `helpdesk.setTicketStatus` | Permiso: `helpdesk.manage` | `conversationId`: number, `ticketStatus`: enum |
| `helpdesk.assignConversation` | Permiso: `helpdesk.manage` | `conversationId`: number, `assignedToId`: number |
| `helpdesk.setConversationQueue` | Permiso: `helpdesk.manage` | `conversationId`: number, `queueId`: number |
| `helpdesk.upsertQuickAnswer` | Permiso: `helpdesk.manage` | `id`: number, `shortcut`: string, `message`: string, `attachments`: array, `url`: string, `name`: string, `type`: string |
| `helpdesk.deleteQuickAnswer` | Permiso: `helpdesk.manage` | `id`: number |

---

### `integrations` — Integraciones

**Archivo:** `server/routers/integrations.ts`
**Endpoints:** 2 queries, 5 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `integrations.list` | Permiso: `integrations.view` | `id`: number |
| `integrations.getById` | Permiso: `integrations.view` | `id`: number |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `integrations.create` | Permiso: `integrations.manage` | `name`: string, `type`: enum, `webhookUrl`: string, `whatsappNumberId`: number, `events`: array |
| `integrations.update` | Permiso: `integrations.manage` | `id`: number, `name`: string, `webhookUrl`: string, `whatsappNumberId`: number, `isActive`: boolean, `events`: array |
| `integrations.delete` | Permiso: `integrations.manage` | `id`: number |
| `integrations.toggle` | Permiso: `integrations.manage` | `id`: number, `isActive`: boolean |
| `integrations.testWebhook` | Permiso: `integrations.manage` | `id`: number |

---

### `leads` — Leads

**Archivo:** `server/routers/leads.ts`
**Endpoints:** 4 queries, 5 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `leads.search` | Autenticado | `query`: string, `limit`: number |
| `leads.list` | Permiso: `leads.view` | `pipelineStageId`: number, `limit`: number, `offset`: number |
| `leads.getById` | Permiso: `leads.view` | `id`: number |
| `leads.export` | Permiso: `leads.export` | `csvContent`: string |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `leads.import` | Permiso: `leads.import` | `csvContent`: string |
| `leads.updateStatus` | Permiso: `leads.update` | `id`: number, `pipelineStageId`: number |
| `leads.reorderKanban` | Permiso: `kanban.update` | `pipelineStageId`: number, `orderedLeadIds`: array |
| `leads.delete` | Permiso: `leads.delete` | `id`: number |
| `leads.bulkDelete` | Permiso: `leads.delete` | `ids`: array |

---

### `licensing` — Licencias

**Archivo:** `server/routers/licensing.ts`
**Endpoints:** 2 queries, 2 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `licensing.getStatus` | Permiso: `settings.view` | — |
| `licensing.getUsageHistory` | Permiso: `settings.view` | `months`: number |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `licensing.updateLicense` | Permiso: `settings.manage` | `key`: string, `status`: enum, `plan`: string, `expiresAt`: date, `maxUsers`: number, `maxWhatsappNumbers`: number, `maxMessagesPerMonth`: number, `features`: array |
| `licensing.recordUsage` | Público | `tenantId`: number, `messagesSent`: number, `messagesReceived`: number |

---

### `achievements` — Logros (Gamificación)

**Archivo:** `server/routers/gamification.ts`
**Endpoints:** 2 queries, 3 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `achievements.list` | Autenticado | `type`: string, `metadata`: any |
| `achievements.list` | Autenticado | `type`: enum, `targetAmount`: number, `period`: enum, `startDate`: string, `endDate`: string |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `achievements.unlock` | Autenticado | `type`: string, `metadata`: any |
| `achievements.create` | Autenticado | `type`: enum, `targetAmount`: number, `period`: enum, `startDate`: string, `endDate`: string |
| `achievements.updateProgress` | Autenticado | `id`: number, `amount`: number |

---

### `messages` — Mensajes

**Archivo:** `server/routers/messages.ts`
**Endpoints:** 2 queries, 0 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `messages.getActiveStats` | Permiso: `chat.view` | — |
| `messages.getAgentPerformance` | Permiso: `monitoring.view` | `dateRange`: object, `from`: date, `to`: date |

---

### `goals` — Metas (Gamificación)

**Archivo:** `server/routers/gamification.ts`
**Endpoints:** 2 queries, 3 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `goals.list` | Autenticado | `type`: string, `metadata`: any |
| `goals.list` | Autenticado | `type`: enum, `targetAmount`: number, `period`: enum, `startDate`: string, `endDate`: string |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `goals.unlock` | Autenticado | `type`: string, `metadata`: any |
| `goals.create` | Autenticado | `type`: enum, `targetAmount`: number, `period`: enum, `startDate`: string, `endDate`: string |
| `goals.updateProgress` | Autenticado | `id`: number, `amount`: number |

---

### `notesTasks` — Notas y Tareas

**Archivo:** `server/routers/notes-tasks.ts`
**Endpoints:** 3 queries, 6 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `notesTasks.listNotes` | Permiso: `leads.view` | `leadId`: number |
| `notesTasks.listTasks` | Permiso: `leads.view` | `leadId`: number, `status`: enum, `assignedToMe`: boolean |
| `notesTasks.getTaskStats` | Permiso: `dashboard.view` | — |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `notesTasks.createNote` | Permiso: `leads.edit` | `leadId`: number, `content`: string |
| `notesTasks.updateNote` | Permiso: `leads.edit` | `id`: number, `content`: string |
| `notesTasks.deleteNote` | Permiso: `leads.edit` | `id`: number |
| `notesTasks.createTask` | Permiso: `leads.edit` | `leadId`: number, `title`: string, `description`: string, `dueDate`: date, `priority`: enum, `assignedToId`: number |
| `notesTasks.updateTask` | Permiso: `leads.edit` | `id`: number, `title`: string, `description`: string, `dueDate`: date, `priority`: enum, `assignedToId`: number, `status`: enum |
| `notesTasks.deleteTask` | Permiso: `leads.edit` | `id`: number |

---

### `whatsappNumbers` — Números WhatsApp

**Archivo:** `server/routers/whatsapp-numbers.ts`
**Endpoints:** 3 queries, 5 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `whatsappNumbers.list` | Permiso: `monitoring.view` | `id`: number |
| `whatsappNumbers.getById` | Permiso: `monitoring.view` | `id`: number |
| `whatsappNumbers.getStats` | Permiso: `monitoring.view` | — |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `whatsappNumbers.create` | Permiso: `monitoring.manage` | `phoneNumber`: string, `displayName`: string, `country`: string, `countryCode`: string |
| `whatsappNumbers.updateStatus` | Permiso: `monitoring.manage` | `id`: number, `status`: enum |
| `whatsappNumbers.updateConnection` | Permiso: `monitoring.manage` | `id`: number, `isConnected`: boolean |
| `whatsappNumbers.delete` | Permiso: `monitoring.manage` | `id`: number |
| `whatsappNumbers.updateCredentials` | Permiso: `monitoring.manage` | `id`: number, `phoneNumberId`: string, `businessAccountId`: string, `accessToken`: string |

---

### `onboarding` — Onboarding

**Archivo:** `server/routers/onboarding.ts`
**Endpoints:** 1 queries, 4 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `onboarding.getProgress` | Autenticado | `step`: enum, `data`: any, `completed`: boolean |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `onboarding.saveStep` | Autenticado | `step`: enum, `data`: any, `completed`: boolean |
| `onboarding.skipStep` | Autenticado | `step`: enum |
| `onboarding.updateCompany` | Autenticado | `name`: string, `timezone`: string, `language`: string, `currency`: string |
| `onboarding.complete` | Autenticado | — |

---

### `pipelines` — Pipelines

**Archivo:** `server/routers/pipelines.ts`
**Endpoints:** 1 queries, 7 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `pipelines.list` | Permiso: `kanban.view` | — |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `pipelines.create` | Permiso: `kanban.manage` | `name`: string |
| `pipelines.updateStage` | Permiso: `kanban.manage` | `id`: number, `name`: string, `color`: string, `order`: number |
| `pipelines.createStage` | Permiso: `kanban.manage` | `pipelineId`: number, `name`: string, `color`: string, `order`: number, `type`: enum |
| `pipelines.deleteStage` | Permiso: `kanban.manage` | `id`: number |
| `pipelines.deletePipeline` | Permiso: `kanban.manage` | `id`: number |
| `pipelines.renamePipeline` | Permiso: `kanban.manage` | `id`: number, `name`: string |
| `pipelines.reorderStages` | Permiso: `kanban.manage` | `pipelineId`: number, `orderedStageIds`: array |

---

### `templates` — Plantillas

**Archivo:** `server/routers/templates.ts`
**Endpoints:** 2 queries, 3 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `templates.list` | Permiso: `campaigns.view` | `search`: string |
| `templates.quickList` | Permiso: `chat.send` | `search`: string |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `templates.create` | Permiso: `campaigns.manage` | `name`: string, `content`: string, `type`: enum, `variables`: array, `attachments`: array, `url`: string, `name`: string, `type`: string |
| `templates.update` | Permiso: `campaigns.manage` | `id`: number, `name`: string, `content`: string, `variables`: array, `attachments`: array, `url`: string, `name`: string, `type`: string |
| `templates.delete` | Permiso: `campaigns.manage` | `id`: number |

---

### `leadReminders` — Recordatorios de Leads

**Archivo:** `server/routers/lead-reminders.ts`
**Endpoints:** 3 queries, 4 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `leadReminders.listByLead` | Permiso: `leads.view` | `leadId`: number |
| `leadReminders.getById` | Permiso: `leads.view` | `id`: number |
| `leadReminders.getUpcoming` | Permiso: `leads.view` | `hours`: number, `leadId`: number |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `leadReminders.update` | Permiso: `leads.edit` | `id`: number, `scheduledAt`: string, `timezone`: string, `message`: string, `messageType`: enum, `mediaUrl`: string, `mediaName`: string, `buttons`: array |
| `leadReminders.cancel` | Permiso: `leads.edit` | `id`: number |
| `leadReminders.delete` | Permiso: `leads.edit` | `id`: number |
| `leadReminders.recordResponse` | Permiso: `leads.edit` | `reminderId`: number, `buttonId`: string |

---

### `signup` — Registro

**Archivo:** `server/routers/signup.ts`
**Endpoints:** 1 queries, 0 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `signup.checkSlug` | Público | `slug`: string |

---

### `smtp` — SMTP

**Archivo:** `server/routers/smtp.ts`
**Endpoints:** 1 queries, 5 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `smtp.list` | Permiso: `settings.view` | `name`: string, `host`: string, `port`: number, `secure`: boolean, `user`: string, `password`: string, `fromEmail`: string, `fromName`: string |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `smtp.create` | Permiso: `settings.manage` | `name`: string, `host`: string, `port`: number, `secure`: boolean, `user`: string, `password`: string, `fromEmail`: string, `fromName`: string |
| `smtp.delete` | Permiso: `settings.manage` | `id`: number |
| `smtp.test` | Permiso: `settings.manage` | `id`: number |
| `smtp.setDefault` | Permiso: `settings.manage` | `id`: number |
| `smtp.verifySmtpTest` | Permiso: `settings.manage` | `email`: string |

---

### `security` — Seguridad

**Archivo:** `server/routers/security.ts`
**Endpoints:** 3 queries, 3 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `security.listSessions` | Autenticado | `sessionId`: number |
| `security.exportMyData` | Autenticado | — |
| `security.listAccessLogs` | Autenticado | `limit`: number |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `security.revokeSession` | Autenticado | `sessionId`: number |
| `security.revokeAllOtherSessions` | Autenticado | — |
| `security.deleteMyData` | Autenticado | `confirmEmail`: string, `reason`: string |

---

### `sessions` — Sesiones

**Archivo:** `server/routers/sessions.ts`
**Endpoints:** 1 queries, 2 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `sessions.list` | Autenticado | `id`: number |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `sessions.revoke` | Autenticado | `id`: number |
| `sessions.revokeAllOthers` | Autenticado | — |

---

### `system` — Sistema

**Archivo:** `server/routers/_core/systemRouter.ts`
**Endpoints:** 1 queries, 0 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `system.health` | Público | — |

---

### `trial` — Trial

**Archivo:** `server/routers/trial.ts`
**Endpoints:** 1 queries, 3 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `trial.getTrialStatus` | Autenticado | — |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `trial.startFreeTrial` | Autenticado | — |
| `trial.submitChurnSurvey` | Autenticado | `reason`: enum, `feedback`: string, `wouldRecommend`: number |
| `trial.changePlan` | Autenticado | `newPlan`: enum |

---

### `terms` — Términos

**Archivo:** `server/routers/terms.ts`
**Endpoints:** 3 queries, 1 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `terms.getCurrentVersion` | Autenticado | — |
| `terms.checkAcceptance` | Autenticado | `termsVersion`: string, `ipAddress`: string, `userAgent`: string |
| `terms.getHistory` | Autenticado | — |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `terms.accept` | Autenticado | `termsVersion`: string, `ipAddress`: string, `userAgent`: string |

---

### `webhooks` — Webhooks

**Archivo:** `server/routers/webhooks.ts`
**Endpoints:** 3 queries, 4 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `webhooks.list` | Permiso: `settings.manage` | `name`: string, `url`: string, `events`: array, `active`: boolean |
| `webhooks.getDeliveries` | Permiso: `settings.manage` | `webhookId`: number, `limit`: number |
| `webhooks.getEventTypes` | Permiso: `settings.manage` | — |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `webhooks.update` | Permiso: `settings.manage` | `id`: number, `name`: string, `url`: string, `events`: array, `active`: boolean |
| `webhooks.delete` | Permiso: `settings.manage` | `id`: number |
| `webhooks.regenerateSecret` | Permiso: `settings.manage` | `id`: number |
| `webhooks.test` | Permiso: `settings.manage` | `id`: number |

---

### `whatsapp` — WhatsApp

**Archivo:** `server/routers/whatsapp.ts`
**Endpoints:** 3 queries, 3 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `whatsapp.list` | Permiso: `settings.view` | — |
| `whatsapp.getStatus` | Permiso: `settings.view` | — |
| `whatsapp.listTemplates` | Permiso: `campaigns.view` | — |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `whatsapp.connect` | Permiso: `settings.manage` | `displayName`: string, `phoneNumber`: string, `phoneNumberId`: string, `accessToken`: string, `businessAccountId`: string |
| `whatsapp.delete` | Permiso: `settings.manage` | `id`: number |
| `whatsapp.disconnect` | Permiso: `settings.manage` | `phoneNumberId`: string |

---

### `workflows` — Workflows

**Archivo:** `server/routers/workflows.ts`
**Endpoints:** 2 queries, 4 mutations

#### Queries (lectura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `workflows.list` | Permiso: `campaigns.view` | `id`: number |
| `workflows.get` | Permiso: `campaigns.view` | `id`: number |

#### Mutations (escritura)

| Endpoint | Acceso | Parámetros |
|---|---|---|
| `workflows.create` | Permiso: `campaigns.manage` | `name`: string, `description`: string, `triggerType`: enum, `triggerConfig`: any, `actions`: array |
| `workflows.update` | Permiso: `campaigns.manage` | `id`: number, `name`: string, `description`: string, `triggerType`: enum, `triggerConfig`: any, `actions`: array, `isActive`: boolean |
| `workflows.toggle` | Permiso: `campaigns.manage` | `id`: number, `isActive`: boolean |
| `workflows.delete` | Permiso: `campaigns.manage` | `id`: number |

---

## Uso desde el Frontend

```typescript
// Importar el cliente tRPC
import { trpc } from "@/lib/trpc";

// Query (lectura)
const { data } = trpc.leads.list.useQuery();

// Mutation (escritura)
const createLead = trpc.leads.create.useMutation({
  onSuccess: () => toast.success("Lead creado"),
  onError: (err) => toast.error(err.message),
});
await createLead.mutateAsync({ name: 'Juan', phone: '+595...' });
```

## Uso con cURL (HTTP)

```bash
# Query
curl -X GET "https://tudominio.com/api/trpc/dashboard.getStats" \
  -H "Cookie: session=JWT_TOKEN"

# Mutation
curl -X POST "https://tudominio.com/api/trpc/leads.create" \
  -H "Content-Type: application/json" \
  -H "Cookie: session=JWT_TOKEN" \
  -d '{"json":{"name":"Juan","phone":"+595..."}}'
```
