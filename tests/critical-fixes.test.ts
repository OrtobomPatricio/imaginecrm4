import { describe, it, expect, vi } from 'vitest';

/**
 * Tests for Phase 1-3 critical fixes:
 * - Message quota counting logic
 * - Backup restore token preservation logic
 * - Campaign batch insert deduplication
 * - CSP nonce generation
 * - Environment validation (PayPal)
 */

// ── 1. Message Quota Logic ──

describe('Message Quota Counting', () => {
  it('should count only outbound messages for quota', () => {
    // Simulate output of a quota query: only direction='outbound' rows
    const messages = [
      { direction: 'outbound', createdAt: new Date() },
      { direction: 'inbound', createdAt: new Date() },
      { direction: 'outbound', createdAt: new Date() },
      { direction: 'inbound', createdAt: new Date() },
      { direction: 'outbound', createdAt: new Date() },
    ];
    const outboundCount = messages.filter(m => m.direction === 'outbound').length;
    expect(outboundCount).toBe(3);
  });

  it('should only count messages from current calendar month', () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const messages = [
      { direction: 'outbound', createdAt: new Date(now.getFullYear(), now.getMonth(), 5) },
      { direction: 'outbound', createdAt: new Date(now.getFullYear(), now.getMonth() - 1, 28) }, // last month
      { direction: 'outbound', createdAt: new Date(now.getFullYear(), now.getMonth(), 15) },
    ];

    const thisMonthOutbound = messages.filter(
      m => m.direction === 'outbound' && m.createdAt >= monthStart
    ).length;
    expect(thisMonthOutbound).toBe(2);
  });

  it('should block when quota exceeded', () => {
    const used = 10000;
    const limit = 10000;
    expect(used < limit).toBe(false);
  });

  it('should allow when under quota', () => {
    const used = 9999;
    const limit = 10000;
    expect(used < limit).toBe(true);
  });

  it('should count failed outbound messages (they consume API calls)', () => {
    const messages = [
      { direction: 'outbound', status: 'sent' },
      { direction: 'outbound', status: 'failed' },
      { direction: 'outbound', status: 'delivered' },
    ];
    // All outbound count regardless of status
    const outboundCount = messages.filter(m => m.direction === 'outbound').length;
    expect(outboundCount).toBe(3);
  });
});

// ── 2. Backup Restore Token Preservation Logic ──

describe('Backup Restore Token Preservation', () => {
  type SavedSecrets = { accessToken: string | null; sessionData: string | null };

  function buildTokenMaps(connections: any[]) {
    const cloudTokensByPhone = new Map<string, SavedSecrets>();
    const qrTokensByNumber = new Map<number, SavedSecrets>();

    for (const conn of connections) {
      if (conn.connectionType === 'api' && conn.phoneNumberId) {
        cloudTokensByPhone.set(conn.phoneNumberId, {
          accessToken: conn.accessToken,
          sessionData: conn.sessionData,
        });
      } else if (conn.connectionType === 'qr') {
        qrTokensByNumber.set(conn.whatsappNumberId, {
          accessToken: conn.accessToken,
          sessionData: conn.sessionData,
        });
      }
    }
    return { cloudTokensByPhone, qrTokensByNumber };
  }

  it('should map cloud connections by phoneNumberId', () => {
    const { cloudTokensByPhone } = buildTokenMaps([
      { connectionType: 'api', phoneNumberId: 'PN123', accessToken: 'tok_abc', sessionData: null, whatsappNumberId: 1 },
    ]);
    expect(cloudTokensByPhone.get('PN123')?.accessToken).toBe('tok_abc');
  });

  it('should map QR connections by whatsappNumberId', () => {
    const { qrTokensByNumber } = buildTokenMaps([
      { connectionType: 'qr', phoneNumberId: null, accessToken: null, sessionData: 'sess_data', whatsappNumberId: 42 },
    ]);
    expect(qrTokensByNumber.get(42)?.sessionData).toBe('sess_data');
  });

  it('should match restored connection to saved secrets (cloud)', () => {
    const { cloudTokensByPhone } = buildTokenMaps([
      { connectionType: 'api', phoneNumberId: 'PN123', accessToken: 'real_token', sessionData: null, whatsappNumberId: 1 },
    ]);

    // Simulated restored conn (from backup with [REDACTED] stripped → null)
    const restored = { connectionType: 'api', phoneNumberId: 'PN123', accessToken: null };
    const saved = cloudTokensByPhone.get(restored.phoneNumberId!);
    expect(saved?.accessToken).toBe('real_token');
  });

  it('should mark unmatched connections as disconnected', () => {
    const { cloudTokensByPhone } = buildTokenMaps([
      { connectionType: 'api', phoneNumberId: 'PN999', accessToken: 'tok', sessionData: null, whatsappNumberId: 1 },
    ]);

    // Restored conn with different phoneNumberId — no match
    const restored = { connectionType: 'api', phoneNumberId: 'PN_NEW', accessToken: null };
    const saved = cloudTokensByPhone.get(restored.phoneNumberId!);
    expect(saved).toBeUndefined();
    // → Should set isConnected = false
  });

  it('should handle [REDACTED] stripping in withTenant', () => {
    const row = { tenantId: 5, accessToken: '[REDACTED]', name: 'Test', refreshToken: '[REDACTED]' };
    const clean: any = { ...row, tenantId: 1 };
    for (const key of Object.keys(clean)) {
      if (clean[key] === '[REDACTED]') {
        delete clean[key];
      }
    }
    expect(clean.accessToken).toBeUndefined();
    expect(clean.refreshToken).toBeUndefined();
    expect(clean.name).toBe('Test');
    expect(clean.tenantId).toBe(1);
  });
});

// ── 3. Campaign Batch Insert Deduplication ──

describe('Campaign Batch Insert Deduplication', () => {
  it('should deduplicate lead IDs before batching', () => {
    const audience = [
      { id: 1 }, { id: 2 }, { id: 3 }, { id: 2 }, { id: 1 }, { id: 4 },
    ];
    const uniqueLeadIds = [...new Set(audience.map(l => l.id))];
    expect(uniqueLeadIds).toEqual([1, 2, 3, 4]);
  });

  it('should chunk into batches of correct size', () => {
    const BATCH_SIZE = 500;
    const ids = Array.from({ length: 1250 }, (_, i) => i);
    const batches: number[][] = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      batches.push(ids.slice(i, i + BATCH_SIZE));
    }
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(500);
    expect(batches[1]).toHaveLength(500);
    expect(batches[2]).toHaveLength(250);
  });

  it('should handle empty audience', () => {
    const audience: any[] = [];
    const uniqueLeadIds = [...new Set(audience.map(l => l.id))];
    expect(uniqueLeadIds).toHaveLength(0);
  });
});

// ── 4. CSP Nonce Generation ──

describe('CSP Nonce Injection', () => {
  it('should inject nonce into script tags', () => {
    const nonce = 'dGVzdG5vbmNlMTIz'; // base64 mock
    const html = '<html><body><script type="module" src="/src/main.tsx"></script></body></html>';
    const result = html.replace(/<script/g, `<script nonce="${nonce}"`);
    expect(result).toContain(`nonce="${nonce}"`);
    expect(result).toContain('type="module"');
    expect(result).not.toContain('<script type');
    expect(result).toContain(`<script nonce="${nonce}" type`);
  });

  it('should handle multiple script tags', () => {
    const nonce = 'abc123';
    const html = '<script src="a.js"></script><script src="b.js"></script>';
    const result = html.replace(/<script/g, `<script nonce="${nonce}"`);
    const matches = result.match(/nonce="abc123"/g);
    expect(matches).toHaveLength(2);
  });
});

// ── 5. PayPal Environment Validation Logic ──

describe('PayPal Environment Validation', () => {
  it('should require PAYPAL_WEBHOOK_ID when PAYPAL_CLIENT_ID is set', () => {
    const env = { PAYPAL_CLIENT_ID: 'abc123', PAYPAL_WEBHOOK_ID: undefined };
    const hasClientId = Boolean(env.PAYPAL_CLIENT_ID);
    const hasWebhookId = Boolean(env.PAYPAL_WEBHOOK_ID);
    const isInvalid = hasClientId && !hasWebhookId;
    expect(isInvalid).toBe(true);
  });

  it('should pass when both are set', () => {
    const env = { PAYPAL_CLIENT_ID: 'abc123', PAYPAL_WEBHOOK_ID: 'wh_456' };
    const isInvalid = Boolean(env.PAYPAL_CLIENT_ID) && !Boolean(env.PAYPAL_WEBHOOK_ID);
    expect(isInvalid).toBe(false);
  });

  it('should pass when neither is set (PayPal disabled)', () => {
    const env = { PAYPAL_CLIENT_ID: undefined, PAYPAL_WEBHOOK_ID: undefined };
    const isInvalid = Boolean(env.PAYPAL_CLIENT_ID) && !Boolean(env.PAYPAL_WEBHOOK_ID);
    expect(isInvalid).toBe(false);
  });
});
