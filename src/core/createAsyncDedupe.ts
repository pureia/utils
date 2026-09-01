import { createCancelable } from './createCancelable';

/**
 * 创建一个异步去重实例：相同 key 的并发调用共享一次执行——首个调用者为执行者，
 * 其余为等待者，所有人获得同一结果（含失败）；共享执行落定后，同 key 的新调用
 * 重新执行。`cancelCall(key)` 取消进行中的调用，等待者以 `CancelError` 拒绝
 * （调用方以 `instanceof` 区分主动取消与真实失败）。
 *
 * @returns `{ asyncDedupe, cancelCall, isPending }`——去重执行、取消进行中调用、在途查询
 *
 * @example
 * ```ts
 * const { asyncDedupe, cancelCall } = createAsyncDedupe();
 * // 同键并发只执行一次，共享同一结果
 * const [r1, r2] = await Promise.all([
 *   asyncDedupe('user-1', () => fetchUser(1)),
 *   asyncDedupe('user-1', () => fetchUser(1)),
 * ]);
 * cancelCall('user-1'); // 取消进行中的调用（等待者收到 CancelError）
 * ```
 */
function createAsyncDedupe() {
  const { cancelable, cancel } = createCancelable();
  /** 在途注册表：key -> 共享执行 promise，落定（成功/失败/取消）即删 */
  const inflight = new Map<PropertyKey, Promise<unknown>>();

  /**
   * 去重执行：同 key 并发共享一次执行（执行者与等待者拿到同一个 promise），
   * 失败原因同样共享；落定后同 key 的新调用重新执行。
   *
   * @typeParam V - 异步函数返回值类型
   * @param key - 唯一标识符，相同 key 的调用会被合并
   * @param asyncFunc - 要执行的异步函数，须返回原生 Promise（契约同「取消执行」）
   * @returns 异步函数的结果（取消时以 `CancelError` 拒绝）
   */
  function asyncDedupe<V>(key: PropertyKey, asyncFunc: () => Promise<V>): Promise<V> {
    const shared = inflight.get(key);
    if (shared) return shared as Promise<V>;

    // 首个调用者：注册共享执行
    const started = cancelable(key, asyncFunc);
    inflight.set(key, started);
    // 落定即清理（成功/失败/取消都会走到这里）；挂接拒绝分支同时标记了 rejection
    // 已处理——没有任何调用者 await/catch 时不会触发 unhandledrejection。
    // 注意不能用 `.finally`：其派生 promise 会以原 reason 拒绝且无处理者 →
    // unhandledrejection（测试 L353-378 反证）；then(cleanup, cleanup) 两侧都返回
    // undefined，派生 promise 以 undefined 完成，不产生未处理拒绝。
    const cleanup = () => { inflight.delete(key); };
    started.then(cleanup, cleanup);
    return started;
  }

  /**
   * 查询某 key 当前是否存在未落定的去重组
   * @param key - 去重键标识符（string | number | symbol）
   * @returns 是否存在未落定的去重组
   */
  const isPending = (key: PropertyKey) => inflight.has(key);

  return { asyncDedupe, cancelCall: cancel, isPending };
}

export { createAsyncDedupe };

export default createAsyncDedupe;
