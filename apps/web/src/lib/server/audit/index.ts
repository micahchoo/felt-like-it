/**
 * Tamper-evident audit log utility.
 *
 * Each entry's chain_hash is SHA-256(JSON.stringify(content + prevHash)),
 * where prevHash is the chain_hash of the immediately preceding row (ordered
 * by BIGSERIAL seq). Deleting, inserting, or modifying any row breaks the
 * chain and is detectable by the `auditLog.verify` tRPC query.
 *
 * Inserts are serialized via pg_advisory_xact_lock so the prev_hash lookup
 * and the INSERT happen atomically with respect to all other appenders.
 *
 * Failure handling: errors are logged to stderr but NOT re-thrown — the
 * primary mutation always succeeds. Callers use `void appendAuditLog(...)`.
 */

import { createHash } from 'node:crypto';
import { desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db, auditLog } from '../db/index.js';
import { logger } from '../logger.js';

/** 64-character zero string used as the prev_hash for the very first entry. */
export const GENESIS_HASH = '0'.repeat(64);

/** Canonical action verbs stored in the `action` column. */
export type AuditAction =
  | 'map.create'
  | 'map.update'
  | 'map.delete'
  | 'map.clone'
  | 'map.createFromTemplate'
  | 'share.create'
  | 'share.update'
  | 'share.delete'
  | 'collaborator.invite'
  | 'collaborator.remove'
  | 'collaborator.updateRole'
  | 'apiKey.create'
  | 'apiKey.revoke';

export interface AuditEntry {
  userId: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  mapId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Compute the chain_hash for a given content object and prevHash.
 * Exported so the `auditLog.verify` procedure can recompute without
 * duplicating the algorithm.
 */
export function computeChainHash(
  entry: Omit<AuditEntry, 'metadata'> & { metadata?: unknown; entityId?: string; mapId?: string },
  prevHash: string,
  createdAt: Date
): string {
  const content = JSON.stringify({
    userId: entry.userId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    mapId: entry.mapId ?? null,
    metadata: entry.metadata ?? null,
    prevHash,
    createdAt: createdAt.toISOString(),
  });
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Append a single tamper-evident audit log entry.
 *
 * Uses pg_advisory_xact_lock(12345678) to serialize concurrent appends so
 * the prev_hash read + INSERT happen as one atomic critical section.
 *
 * Errors are caught and logged — the audit log is best-effort and will not
 * fail the calling mutation.
 */
export async function appendAuditLog(entry: AuditEntry): Promise<void> {
  const createdAt = new Date();
  try {
    await db.transaction(async (tx) => {
      // Serialize all audit log appends so the prev_hash lookup is consistent
      await tx.execute(sql`SELECT pg_advisory_xact_lock(12345678)`);

      const [last] = await tx
        .select({ chainHash: auditLog.chainHash })
        .from(auditLog)
        .orderBy(desc(auditLog.seq))
        .limit(1);

      const prevHash = last?.chainHash ?? GENESIS_HASH;
      const chainHash = computeChainHash(entry, prevHash, createdAt);

      await tx.insert(auditLog).values({
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        mapId: entry.mapId,
        metadata: entry.metadata,
        prevHash,
        chainHash,
        createdAt,
      });
    });
  } catch (err) {
    logger.error({ err, entry }, 'audit log write failed');
  }
}
