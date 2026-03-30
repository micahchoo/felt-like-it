import type { User, Session } from 'lucia';

declare global {
  namespace App {
    interface Locals {
      user: User | null;
      session: Session | null;
      /** Pre-resolved API key auth from hooks.server.ts — avoids duplicate DB lookup in v1 middleware */
      apiAuth?: { userId: string | null; scope: 'read' | 'read-write'; mapScope: string | null } | null;
    }
    interface PageData {
      user?: User | null;
    }
    // interface Error {}
    // interface Platform {}
  }
}

export {};
