type Handler<T> = (result: T) => void;

type StoreValue<T> = T | Set<Handler<T>>;

/** 事件键类型 */
type EventKey<T> = keyof T;
/** 事件载荷类型 */
type EventPayload<T, K extends EventKey<T>> = T[K];
/** 事件处理程序类型 */
type EventHandler<T, K extends EventKey<T>> = Handler<EventPayload<T, K>>;

/**
 * 创建一个类型安全的事件存储实例，用于事件的发布/订阅管理。
 *
 * @typeParam E - 事件定义对象，键为事件名，值为事件载荷类型
 * @returns 事件存储实例，包含以下方法：
 *   - `keys()` - 获取所有已注册的事件键
 *   - `has(key)` - 检查指定事件是否存在监听器
 *   - `get(key)` - 获取指定事件的处理程序集合或值
 *   - `set(key, value)` - 设置指定事件的值
 *   - `delete(key)` - 删除指定事件
 *   - `clear()` - 清空所有事件
 *   - `on(key, handler)` - 订阅事件，返回取消订阅函数
 *   - `once(key, handler)` - 订阅事件（仅触发一次）
 *   - `emit(key, payload)` - 发布事件
 *
 * @example
 * ```ts
 * interface Events {
 *   message: string;
 *   count: number;
 * }
 *
 * const store = useEventStore<Events>();
 * const unsubscribe = store.on('message', (msg) => console.log(msg));
 * store.emit('message', 'hello'); // 输出: hello
 * unsubscribe(); // 取消订阅
 * ```
 */
function useEventStore<E extends Record<string, any> = Record<string, any>>() {
  type T = E & { [key: string | number]: any };

  const store = new Map<EventKey<T>, any>();

  const keys = () => [...store.keys()];

  const has = <K extends EventKey<T>>(key: K) => store.has(key);

  const get = <K extends EventKey<T>>(key: K) => (store.get(key) ?? null) as StoreValue<EventPayload<T, K>> | null;

  function set<K extends EventKey<T>>(key: K, value: StoreValue<EventPayload<T, K>>) { store.set(key, value); }

  const remove = <K extends EventKey<T>>(key: K) => store.delete(key);

  function clear() { store.clear(); }

  function off<K extends EventKey<T>>(key: K, handler: EventHandler<T, K>) {
    const handlers = get(key) as Set<EventHandler<T, K>> | null;
    handlers?.delete(handler);
    if (handlers?.size === 0) {
      remove(key);
    }
  }

  function on<K extends EventKey<T>>(key: K, handler: EventHandler<T, K>): () => void {
    if (!has(key)) {
      set(key, new Set());
    }
    (get(key) as Set<EventHandler<T, K>>)?.add(handler);
    return () => off(key, handler);
  }

  function once<K extends EventKey<T>>(key: K, handler: EventHandler<T, K>): () => void {
    const onceHandler = (result: EventPayload<T, K>) => {
      off(key, onceHandler as EventHandler<T, K>);
      handler(result);
    };
    return on(key, onceHandler as EventHandler<T, K>);
  }

  function emit<K extends EventKey<T>>(key: K, result: EventPayload<T, K>): void {
    const handlers = get(key) as Set<EventHandler<T, K>> | null;
    handlers?.forEach(handler => {
      try {
        handler(result);
      }
      catch (error) {
        console.error(`useEventStore error in "${String(key)}":`, error);
      }
    });
  }

  return {
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
}

export { useEventStore };

export default useEventStore;
