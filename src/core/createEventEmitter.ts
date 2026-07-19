type Handler<T> = (result: T) => void;

/** 事件键类型 */
type EventKey<T> = keyof T;
/** 事件载荷类型 */
type EventPayload<T, K extends EventKey<T>> = T[K];
/** 事件处理程序类型 */
type EventHandler<T, K extends EventKey<T>> = Handler<EventPayload<T, K>>;

/**
 * 创建一个类型安全的事件发射器实例，用于事件的发布/订阅管理。
 *
 * 支持 `on` 持续订阅和 `once` 一次性订阅，所有事件键和载荷均为类型安全。
 * 同一事件可注册多个处理程序，处理程序中的错误不会影响其他处理程序的执行。
 * 订阅函数会返回取消订阅函数，方便在组件卸载时清理。
 *
 * @typeParam E - 事件定义对象，键为事件名，值为事件载荷类型
 * @returns 事件发射器实例
 *
 * @example
 * ```ts
 * interface Events {
 *   message: string;
 *   count: number;
 * }
 *
 * const emitter = createEventEmitter<Events>();
 *
 * // 订阅事件
 * const unsubscribe = emitter.on('message', (msg) => console.log(msg));
 * emitter.emit('message', 'hello'); // 输出: hello
 *
 * // 取消订阅
 * unsubscribe();
 *
 * // 一次性订阅
 * emitter.once('count', (n) => console.log(n));
 * emitter.emit('count', 1); // 输出: 1
 * emitter.emit('count', 2); // 无输出（已自动取消）
 * ```
 */
function createEventEmitter<E extends Record<string, any> = Record<string, any>>() {
  const store = new Map<EventKey<E>, Set<(result: E[EventKey<E>]) => void>>();

  /**
   * 获取所有已注册的事件键
   * @returns 事件键迭代器
   */
  const keys = (): IterableIterator<EventKey<E>> => store.keys();

  /**
   * 检查指定事件是否已注册监听器
   * @param key - 事件键
   * @returns 是否存在监听器
   */
  const has = <K extends EventKey<E>>(key: K) => store.has(key);

  /**
   * 删除指定事件及其所有处理程序
   * @param key - 事件键
   * @returns 是否成功删除
   */
  const remove = <K extends EventKey<E>>(key: K) => store.delete(key);

  /**
   * 清空所有事件及其处理程序
   */
  function clear() { store.clear(); }

  /**
   * 取消指定事件的处理程序
   *
   * 推荐使用 `on()` 返回的取消订阅函数来移除处理程序，无需持有原始 handler 引用。
   * 仅在需要外部精确移除特定 handler 时使用此方法（需持有原始 handler 引用）。
   *
   * @param key - 事件键
   * @param handler - 要取消的处理程序（必须与注册时传入的引用相同）
   */
  function off<K extends EventKey<E>>(key: K, handler: EventHandler<E, K>) {
    const handlers = store.get(key);
    handlers?.delete(handler as (result: E[EventKey<E>]) => void);
    handlers?.size === 0 && remove(key);
  }

  /**
   * 订阅事件，每次触发都会执行处理程序
   * @param key - 事件键
   * @param handler - 事件处理程序
   * @returns 取消订阅函数，调用后移除该处理程序
   */
  function on<K extends EventKey<E>>(key: K, handler: EventHandler<E, K>): () => void {
    !store.has(key) && store.set(key, new Set());
    store.get(key)!.add(handler as (result: E[EventKey<E>]) => void);
    return () => off(key, handler);
  }

  /**
   * 订阅事件（仅触发一次），触发后自动取消订阅
   * @param key - 事件键
   * @param handler - 事件处理程序（仅执行一次）
   * @returns 取消订阅函数
   */
  function once<K extends EventKey<E>>(key: K, handler: EventHandler<E, K>): () => void {
    const onceHandler = (result: EventPayload<E, K>) => {
      off(key, onceHandler as EventHandler<E, K>);
      handler(result);
    };
    return on(key, onceHandler as EventHandler<E, K>);
  }

  /**
   * 发布事件，通知所有订阅了该事件的处理程序
   *
   * 处理程序中的错误会被捕获并输出到控制台，不会影响其他处理程序的执行。
   *
   * @param key - 事件键
   * @param result - 事件载荷
   */
  function emit<K extends EventKey<E>>(key: K, result: EventPayload<E, K>): void {
    const handlers = store.get(key);
    handlers?.forEach(handler => {
      try {
        handler(result);
      }
      catch (error) {
        console.error(`createEventEmitter error in "${String(key)}":`, error);
      }
    });
  }

  return {
    keys,
    has,
    delete: remove,
    clear,
    off,
    on,
    once,
    emit,
  };
}

export { createEventEmitter };

export default createEventEmitter;
