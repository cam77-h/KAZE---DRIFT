/** Minimal finite state machine with enter/exit hooks. */
export interface StateHooks {
  enter?(from: string | null): void;
  exit?(to: string): void;
}

export class StateMachine<S extends string> {
  current: S | null = null;
  private states = new Map<S, StateHooks>();
  private listeners: ((from: S | null, to: S) => void)[] = [];

  add(name: S, hooks: StateHooks = {}): this {
    this.states.set(name, hooks);
    return this;
  }

  onChange(fn: (from: S | null, to: S) => void): void {
    this.listeners.push(fn);
  }

  go(to: S): void {
    if (to === this.current) return;
    if (!this.states.has(to)) throw new Error(`Unknown state ${to}`);
    const from = this.current;
    if (from) this.states.get(from)?.exit?.(to);
    this.current = to;
    this.states.get(to)?.enter?.(from);
    for (const l of this.listeners) l(from, to);
  }

  is(...names: S[]): boolean {
    return this.current !== null && names.includes(this.current);
  }
}
