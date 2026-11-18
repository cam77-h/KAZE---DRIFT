/** Tiny typed event bus. */
export type Handler<T> = (payload: T) => void;

export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) (fn as Handler<Events[K]>)(payload);
  }
}

export interface GameEvents extends Record<string, unknown> {
  impact: { speed: number; material: string; x: number; y: number; z: number };
  settingsChanged: { section: string };
  stateChanged: { from: string; to: string };
  toast: { text: string };
  saved: { at: number };
}
