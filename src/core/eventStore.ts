type Handler<T> = (result: T) => void;

type StoreValue<T> = T | Set<Handler<T>>;

/**
 * 可通过 declare module 扩展事件类型：
 * @example
 * declare module '@purea/utils' {
 *   interface EventStore {
 *     'user:login': { userId: string };
 *     'user:logout': void;
 *   }
 * }
 */
declare interface EventStore {
  [key: string]: unknown;
}

type EventKey = keyof EventStore;
type EventPayload<K extends EventKey> = EventStore[K];
type EventHandler<K extends EventKey> = Handler<EventPayload<K>>;

const store = new Map<EventKey, StoreValue<EventPayload<EventKey>>>();

const keys = () => [...store.keys()];
const has = <K extends EventKey>(key: K) => store.has(key);
const get = <K extends EventKey>(key: K) => (store.get(key) ?? null) as StoreValue<EventPayload<K>> | null;
function set<K extends EventKey>(key: K, value: StoreValue<EventPayload<K>>) { store.set(key, value); }
const remove = <K extends EventKey>(key: K) => store.delete(key);
function clear() { store.clear(); }
function off<K extends EventKey>(key: K, handler: EventHandler<K>) {
  const handlers = get(key) as Set<EventHandler<K>> | null;
  handlers?.delete(handler);
  if (handlers?.size === 0) {
    remove(key);
  }
}

function on<K extends EventKey>(key: K, handler: EventHandler<K>): () => void {
  if (!has(key)) {
    set(key, new Set());
  }
  (get(key) as Set<EventHandler<K>>)?.add(handler);
  return () => off(key, handler);
}

function once<K extends EventKey>(key: K, handler: EventHandler<K>): () => void {
  const onceHandler = (result: EventPayload<K>) => {
    off(key, onceHandler as EventHandler<K>);
    handler(result);
  };
  return on(key, onceHandler as EventHandler<K>);
}

function emit<K extends EventKey>(key: K, result: EventPayload<K>): void {
  const handlers = get(key) as Set<EventHandler<K>> | null;
  handlers?.forEach(handler => {
    try {
      handler(result);
    }
    catch (error) {
      console.error(`EventStore error in "${String(key)}":`, error);
    }
  });
}

/**
 * 事件发布/订阅存储。
 * @example
 * // 通过 `declare module '@purea/utils'` 扩展 `EventStore` 接口定义事件类型。
 * declare module '@purea/utils' {
 *   interface EventStore {
 *     'user:login': { userId: string };
 *   }
 * }
 *
 * const unsub = eventStore.on('user:login', data => console.log(data.userId));
 * eventStore.emit('user:login', { userId: '1' });
 * unsub(); // 取消订阅
 */
export const eventStore = {
  keys,
  has,
  get,
  set,
  delete: remove,
  clear,
  on,
  once,
  emit,
};

export type { EventStore };

export default eventStore;
