type Handler<T> = (result: T) => void;

type StoreValue<T> = T | Set<Handler<T>>;

type Extensible<T> = T & { [key: string]: any };

/** 事件键类型 */
type EventKey<T> = keyof T;
/** 事件载荷类型 */
type EventPayload<T, K extends EventKey<T>> = T[K];
/** 事件处理程序类型 */
type EventHandler<T, K extends EventKey<T>> = Handler<EventPayload<T, K>>;

/**
 * 创建一个类型安全的事件存储实例，用于事件的发布/订阅管理。
 *
 * 支持 `on` 持续订阅和 `once` 一次性订阅，所有事件键和载荷均为类型安全。
 * 同一事件可注册多个处理程序，处理程序中的错误不会影响其他处理程序的执行。
 * 订阅函数会返回取消订阅函数，方便在组件卸载时清理。
 *
 * @typeParam E - 事件定义对象，键为事件名，值为事件载荷类型
 * @returns 事件存储实例
 *
 * @example
 * ```ts
 * interface Events {
 *   message: string;
 *   count: number;
 * }
 *
 * const store = useEventStore<Events>();
 *
 * // 订阅事件
 * const unsubscribe = store.on('message', (msg) => console.log(msg));
 * store.emit('message', 'hello'); // 输出: hello
 *
 * // 取消订阅
 * unsubscribe();
 *
 * // 一次性订阅
 * store.once('count', (n) => console.log(n));
 * store.emit('count', 1); // 输出: 1
 * store.emit('count', 2); // 无输出（已自动取消）
 * ```
 */
function useEventStore<E extends Record<string, any> = Record<string, any>>() {
  type T = Extensible<E>;

  const store = new Map<EventKey<T>, any>();

  /**
   * 获取所有已注册的事件键
   * @returns 事件键数组
   */
  const keys = () => [...store.keys()];

  /**
   * 检查指定事件是否已注册监听器
   * @param key - 事件键
   * @returns 是否存在监听器
   */
  const has = <K extends EventKey<T>>(key: K) => store.has(key);

  /**
   * 获取指定事件的处理程序集合或已设置的值
   * @param key - 事件键
   * @returns 事件对应的值（通常为处理程序 Set），不存在时返回 null
   */
  const get = <K extends EventKey<T>>(key: K) => (store.get(key) ?? null) as StoreValue<EventPayload<T, K>> | null;

  /**
   * 设置指定事件的值（通常不需要手动调用，由 on/once 自动管理）
   * @param key - 事件键
   * @param value - 要设置的值
   */
  function set<K extends EventKey<T>>(key: K, value: StoreValue<EventPayload<T, K>>) { store.set(key, value); }

  /**
   * 删除指定事件及其所有处理程序
   * @param key - 事件键
   * @returns 是否成功删除
   */
  const remove = <K extends EventKey<T>>(key: K) => store.delete(key);

  /**
   * 清空所有事件及其处理程序
   */
  function clear() { store.clear(); }

  /**
   * 取消指定事件的处理程序
   * @param key - 事件键
   * @param handler - 要取消的处理程序
   */
  function off<K extends EventKey<T>>(key: K, handler: EventHandler<T, K>) {
    const handlers = get(key) as Set<EventHandler<T, K>> | null;
    handlers?.delete(handler);
    if (handlers?.size === 0) {
      remove(key);
    }
  }

  /**
   * 订阅事件，每次触发都会执行处理程序
   * @param key - 事件键
   * @param handler - 事件处理程序
   * @returns 取消订阅函数，调用后移除该处理程序
   */
  function on<K extends EventKey<T>>(key: K, handler: EventHandler<T, K>): () => void {
    if (!has(key)) {
      set(key, new Set());
    }
    (get(key) as Set<EventHandler<T, K>>)?.add(handler);
    return () => off(key, handler);
  }

  /**
   * 订阅事件（仅触发一次），触发后自动取消订阅
   * @param key - 事件键
   * @param handler - 事件处理程序（仅执行一次）
   * @returns 取消订阅函数
   */
  function once<K extends EventKey<T>>(key: K, handler: EventHandler<T, K>): () => void {
    const onceHandler = (result: EventPayload<T, K>) => {
      off(key, onceHandler as EventHandler<T, K>);
      handler(result);
    };
    return on(key, onceHandler as EventHandler<T, K>);
  }

  /**
   * 发布事件，通知所有订阅了该事件的处理程序
   *
   * 处理程序中的错误会被捕获并输出到控制台，不会影响其他处理程序的执行。
   *
   * @param key - 事件键
   * @param result - 事件载荷
   */
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
