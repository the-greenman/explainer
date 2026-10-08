// Tiny observable variable store, one per <explainer-scope> (default: document).
export type Store = {
  get(k: string): string | undefined;
  set(k: string, v: string): void;
  all(): Record<string, string>;
  subscribe(fn: (k: string, v: string) => void): () => void;
};

export function createStore(persistKey?: string): Store {
  let vars: Record<string, string> = {};
  // storage can throw (private mode, blocked site data): the store then just doesn't persist
  if (persistKey) try { vars = JSON.parse(sessionStorage.getItem(persistKey) ?? '{}'); } catch {}
  const subs = new Set<(k: string, v: string) => void>();
  return {
    get: (k) => vars[k],
    set(k, v) {
      vars[k] = v;
      if (persistKey) try { sessionStorage.setItem(persistKey, JSON.stringify(vars)); } catch {}
      subs.forEach((f) => f(k, v));
    },
    all: () => ({ ...vars }),
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

const scopes = new WeakMap<Node, Store>();
/** Store of the nearest <explainer-scope> ancestor, else the document's. */
export function scopeFor(el: Element): Store {
  const scope = el.closest('explainer-scope') ?? document;
  let s = scopes.get(scope);
  if (!s) {
    const persist = scope instanceof Element && scope.hasAttribute('persist');
    scopes.set(scope, (s = createStore(persist ? 'explainer:' + (scope.id || 'scope') : undefined)));
  }
  return s;
}

/** Bind [data-explainer-var] inputs/selects to their scope's store. */
export function bindInputs() {
  const write = (e: Event) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset?.explainerVar) scopeFor(el).set(el.dataset.explainerVar, el.value);
  };
  document.addEventListener('input', write);
  document.addEventListener('change', write);
  document.querySelectorAll<HTMLInputElement>('[data-explainer-var]').forEach((el) => {
    const s = scopeFor(el);
    const k = el.dataset.explainerVar!;
    if (s.get(k) !== undefined) el.value = s.get(k)!;
    else if (el.value) s.set(k, el.value);
  });
}

/** Fill {name} from vars. Returns plain text: callers must assign via textContent, never innerHTML. */
export const interpolate = (text: string, vars: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

/** when_var/when_value gating: no when_var = always shown. */
export const gate = (c: { when_var?: string; when_value?: string }, vars: Record<string, string>) =>
  !c.when_var || vars[c.when_var] === c.when_value;
