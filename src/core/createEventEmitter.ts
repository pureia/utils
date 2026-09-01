type Handler<T> = (result: T) => void;

/** once 包装标记：区分"once 自动包装"与普通携带 `.listener` 属性的用户函数，避免 off 扫描误匹配 */
const ONCE_WRAPPER_MARKER = Symbol('@purea/utils/once-wrapper');

type EventKey<T> = keyof T;
type EventPayload<T, K extends EventKey<T>> = T[K];
type EventHandler<T, K extends EventKey<T>> = Handler<EventPayload<T, K>>;

/**
 * 创建一个类型安全的事件发射器：`on` 持续订阅、`once` 一次性订阅、`emit` 广播，
 * 所有事件键与载荷均类型安全；处理器抛错被捕获并输出到 `console.error`，
 * 不影响其余处理器；订阅返回取消订阅函数。
 *
 * @typeParam E - 事件定义对象，键为事件名、值为事件载荷类型
 * @returns 事件发射器实例（keys/has/delete/clear/off/on/once/emit）
 *
 * @example
 * ```ts
 * interface Events { message: string; count: number }
 * const emitter = createEventEmitter<Events>();
 * const unsubscribe = emitter.on('message', (msg) => console.log(msg));
 * emitter.emit('message', 'hello'); // 输出: hello
 * unsubscribe(); // 取消订阅（未输出）
 * emitter.once('count', (n) => console.log(n));
 * emitter.emit('count', 1); // 输出: 1（只触发一次）
 * ```
 */
function createEventEmitter<E extends Record<string, any> = Record<string, unknown>>() {
  const store = new Map<EventKey<E>, Set<(result: E[EventKey<E>]) => void>>();

  /** 所有已注册的事件键 */
  const keys = (): IterableIterator<EventKey<E>> => store.keys();

  /** 指定事件是否已注册监听器 */
  const has = <K extends EventKey<E>>(key: K) => store.has(key);

  /** 删除指定事件及其全部处理程序 */
  const remove = <K extends EventKey<E>>(key: K) => store.delete(key);

  /** 清空全部事件与处理程序 */
  function clear() { store.clear(); }

  /**
   * 按引用移除指定处理程序（引用须与注册时一致；`once` 注册的处理器亦支持按原引用
   * 退订——包装内保存原始引用供匹配，对齐 Node EventEmitter 惯例）；一般推荐用
   * `on()`/`once()` 返回的取消订阅函数，无需持有 handler 引用。
   *
   * @param key - 事件键
   * @param handler - 注册时传入的处理程序
   */
  function off<K extends EventKey<E>>(key: K, handler: EventHandler<E, K>) {
    const handlers = store.get(key);
    if (!handlers) return;
    const raw = handler as (result: E[EventKey<E>]) => void;
    if (!handlers.delete(raw)) {
      // 未命中直接引用：按 Node 惯例匹配 once 包装保存的原始引用（wrapper.listener）。
      // 仅匹配带 ONCE_WRAPPER_MARKER 的包装——普通函数即使恰好携带同名 .listener
      // 属性也不会被误删（防御性保守：匹配不上即为 no-op）。
      for (const wrapped of handlers) {
        const w = wrapped as unknown as { listener?: (result: E[EventKey<E>]) => void } & Record<symbol, unknown>;
        if (w[ONCE_WRAPPER_MARKER] === true && w.listener === raw) {
          handlers.delete(wrapped);
          break;
        }
      }
    }
    handlers.size === 0 && remove(key);
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
    const onceHandler = ((result: EventPayload<E, K>) => {
      off(key, onceHandler as EventHandler<E, K>);
      handler(result);
    }) as (result: E[EventKey<E>]) => void;
    // 保存原始监听器引用与 once 标记，供 off(key, 原引用) 解包装（对齐 Node EventEmitter）
    (onceHandler as unknown as { listener: (result: E[EventKey<E>]) => void }).listener =
      handler as (result: E[EventKey<E>]) => void;
    (onceHandler as unknown as Record<symbol, unknown>)[ONCE_WRAPPER_MARKER] = true;
    return on(key, onceHandler as EventHandler<E, K>);
  }

  /**
   * 广播事件给全部订阅者
   *
   * 按快照迭代：本轮触发期间注册/移除的处理器不影响本轮。处理器抛错输出到
   * `console.error` 后继续；`console.error` 自身抛错会中断本轮（剩余处理器不再
   * 执行、异常向调用方传播——评估后接受的已知风险）。
   *
   * @param key - 事件键
   * @param result - 事件载荷
   */
  function emit<K extends EventKey<E>>(key: K, result: EventPayload<E, K>): void {
    const handlers = store.get(key);
    if (!handlers) return;
    // 快照迭代：emit 期间注册/移除的处理器不影响本轮（对齐 Node 惯例）——
    // 杜绝 once 互相重订阅在活迭代下无限增长（Set 按引用去重防不住每次新建的 once 包装）
    [...handlers].forEach(handler => {
      try {
        handler(result);
      }
      catch (error) {
        console.error(`EventEmitter error in "${String(key)}":`, error);
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
