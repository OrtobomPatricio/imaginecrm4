/**
 * Mock database for development without MySQL
 * Stores data in memory for demo purposes
 */

import { InsertUser, users, sessions, tenants, leads, conversations } from "../drizzle/schema";

import { logger } from "./_core/logger";

function resolveTableName(table: any): string {
  if (typeof table === "string") return table;
  if (table?._?.name) return table._.name;
  if (table?.$name) return table.$name;
  const symbols = Object.getOwnPropertySymbols(table || {});
  for (const sym of symbols) {
    const desc = String(sym);
    if (desc.includes("BaseName")) {
      const value = table[sym];
      if (typeof value === "string") return value;
    }
  }
  if (typeof table?.name === "string") return table.name;
  return "unknown_table";
}


// In-memory storage
const memoryDb: any = {
  users: new Map(),
  sessions: new Map(),
  sessions_auth: new Map(),
  tenants: new Map([[
    1, 
    { id: 1, name: "Demo Company", slug: "demo", plan: "pro", isActive: true, 
      settings: JSON.stringify({ timezone: "America/Asuncion", language: "es" }),
      createdAt: new Date(), updatedAt: new Date() }
  ]]),
  leads: new Map(),
  conversations: new Map(),
  messages: new Map(),
  pipelines: new Map(),
  pipelineStages: new Map(),
  leadTasks: new Map(),
  templates: new Map(),
  campaigns: new Map(),
  quickReplies: new Map(),
  tags: new Map(),
  leadTags: new Map(),
  chatMessages: new Map(),
  reminders: new Map(),
  onboarding: new Map([[1, { tenantId: 1, companyCompleted: true, teamCompleted: false, whatsappCompleted: false, importCompleted: false, firstMessageCompleted: false, lastStep: 'company' }]]),
  terms: new Map(),
};

// Create dev user
const devUser = {
  id: 1,
  tenantId: 1,
  openId: "dev@localhost",
  name: "Developer",
  email: "dev@localhost",
  role: "owner",
  loginMethod: "dev",
  isActive: true,
  hasSeenTour: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};
memoryDb.users.set("dev@localhost", devUser);
memoryDb.users.set(1, devUser);
logger.info("[MockDB] Dev user created:", devUser.openId);

// Create demo leads
for (let i = 1; i <= 5; i++) {
  memoryDb.leads.set(i, {
    id: i,
    tenantId: 1,
    name: `Cliente Demo ${i}`,
    email: `cliente${i}@demo.com`,
    phone: `+595991${100000 + i}`,
    status: i % 2 === 0 ? "active" : "new",
    source: "website",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function getDb() {
  const toRows = (tableName: string) => Array.from(memoryDb[tableName]?.values() || []);

  const withChain = (rows: any[]) => {
    const chain: any = {
      where: (_condition: any) => withChain(rows),
      orderBy: (..._args: any[]) => withChain(rows),
      limit: (n: number) => Promise.resolve(rows.slice(0, n)),
      groupBy: (..._args: any[]) => Promise.resolve(rows),
      then: (resolve: any, reject?: any) => Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  };

  const aggregateByField = (rows: any[], field: string) => {
    const map = new Map<any, number>();
    for (const row of rows) {
      const key = row?.[field] ?? null;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([key, count]) => ({ [field]: key, count }));
  };

  return {
    select: (fields?: any) => ({
      from: (table: any) => {
        const tableName = resolveTableName(table);
        const rows = toRows(tableName);

        const nonCountField = fields
          ? Object.keys(fields).find((k) => k !== "count" && k !== "total")
          : undefined;

        const countOnlyRows = fields && Object.keys(fields).length === 1 && fields.count
          ? [{ count: rows.length }]
          : rows;

        return {
          where: (_condition: any) => {
            const filteredRows = countOnlyRows;
            return {
              ...withChain(filteredRows),
              groupBy: (..._args: any[]) => {
                if (nonCountField) {
                  return Promise.resolve(aggregateByField(rows, nonCountField));
                }
                return Promise.resolve(filteredRows);
              },
            };
          },
          orderBy: (..._args: any[]) => withChain(countOnlyRows),
          limit: (n: number) => Promise.resolve(countOnlyRows.slice(0, n)),
          groupBy: (..._args: any[]) => {
            if (nonCountField) {
              return Promise.resolve(aggregateByField(rows, nonCountField));
            }
            return Promise.resolve(countOnlyRows);
          },
          then: (resolve: any, reject?: any) => Promise.resolve(countOnlyRows).then(resolve, reject),
        };
      },
    }),
    insert: (table: any) => ({
      values: (data: any) => {
        const tableName = resolveTableName(table);
        if (!memoryDb[tableName]) memoryDb[tableName] = new Map();

        const insertOne = (row: any) => {
          const id = row?.id || Date.now() + Math.floor(Math.random() * 1000);
          memoryDb[tableName].set(id, { ...row, id, createdAt: new Date(), updatedAt: new Date() });
          return { insertId: id };
        };

        const inserted = Array.isArray(data) ? data.map(insertOne) : [insertOne(data)];

        const thenable: any = {
          onDuplicateKeyUpdate: (_update: any) => Promise.resolve(inserted),
          execute: async () => inserted,
          then: (resolve: any, reject?: any) => Promise.resolve(inserted).then(resolve, reject),
        };

        logger.info("[MockDB] Insert into", tableName, "count:", inserted.length);
        return thenable;
      },
      execute: async () => Promise.resolve(),
    }),
    update: (table: any) => ({
      set: (data: any) => ({
        where: (condition: any) => {
          const tableName = resolveTableName(table);
          logger.info("[MockDB] Update", tableName);
          return Promise.resolve();
        },
      }),
    }),
    delete: (table: any) => ({
      where: (condition: any) => Promise.resolve(),
    }),
    execute: async (sql: string | any, params?: any[]) => {
      const sqlStr = typeof sql === 'string' ? sql : JSON.stringify(sql).substring(0, 100);
      logger.info("[MockDB] Execute:", sqlStr.substring(0, 50));
      return [];
    },
    transaction: async (fn: any) => {
      const tx = {
        execute: async (sql: string | any, params?: any[]) => {
          const sqlStr = typeof sql === 'string' ? sql : JSON.stringify(sql);
          logger.info("[MockDB] Transaction execute:", sqlStr.substring(0, 50));
          return [];
        },
        insert: (table: any) => ({
          values: (data: any) => ({
            execute: async () => Promise.resolve(),
          }),
        }),
        update: (table: any) => ({
          set: (data: any) => ({
            where: (condition: any) => Promise.resolve(),
          }),
        }),
        delete: (table: any) => ({
          where: (condition: any) => Promise.resolve(),
        }),
      };
      return await fn(tx);
    },
    query: {},
  } as any;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  logger.info("[MockDB] Upsert user:", user.openId);
  memoryDb.users.set(user.openId, {
    ...user,
    id: user.id || Date.now(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function getUserByOpenId(openId: string) {
  logger.info("[MockDB] Get user by openId:", openId);
  const user = memoryDb.users.get(openId);
  logger.info("[MockDB] Found user:", user ? "YES" : "NO");
  return user || null;
}

export function getMemoryDb() {
  return memoryDb;
}

logger.info("[Database] MOCK MODE - Using in-memory storage");
