import type { RequestEvent } from '@sveltejs/kit';
import type { User, Session } from 'lucia';

export interface Context {
  user: User | null;
  session: Session | null;
  event: RequestEvent;
}

export function createContext(event: RequestEvent): Context {
  return {
    user: event.locals.user,
    session: event.locals.session,
    event,
  };
}
