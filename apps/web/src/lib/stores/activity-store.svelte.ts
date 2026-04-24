export class ActivityStore {
  annotationCount = $state(0);
  commentCount = $state(0);
  eventCount = $state(0);
  refreshTrigger = $state(0);

  readonly #logFn: (action: string, metadata?: Record<string, unknown>) => void;

  constructor(logFn: (action: string, metadata?: Record<string, unknown>) => void) {
    this.#logFn = logFn;
  }

  log(action: string, metadata?: Record<string, unknown>): void {
    this.#logFn(action, metadata);
    this.refreshTrigger++;
  }

  get badgeCount(): number {
    return this.annotationCount + this.commentCount;
  }
}
