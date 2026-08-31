import { createCancelable } from './createCancelable';

/**
 * 创建一个异步去重实例，确保同一 key 的异步操作只执行一次，所有调用共享同一结果。
 *
 * 当多个调用同时使用相同的 key 时，只有第一个调用会真正执行异步函数，
 * 其余调用会等待并共享第一次调用的结果（无论是成功还是失败）。
 * 前一次请求完成后，相同 key 的新请求会重新执行。
 *
 * 执行者与等待者共享同一个 promise 对象（可观察：`p1 === p2`）；共享执行落定
 * （成功/失败/取消）后，相同 key 的新调用重新执行。取消语义：`cancelCall(key)`
 * 取消进行中的调用时，等待者以 `CancelError` 拒绝（核心域契约），调用方以
 * `instanceof CancelError` 区分主动取消与真实失败。
 *
 * @returns 返回 `{ asyncDedupe, cancelCall, isPending }`，分别表示去重执行函数、
 *   取消进行中调用的函数、在途查询函数
 *
 * @example
 * ```ts
 * const { asyncDedupe, cancelCall, isPending } = createAsyncDedupe();
 *
 * // 多次调用只会执行一次 fetch
 * const [r1, r2] = await Promise.all([
 *   asyncDedupe('user-1', () => fetchUser(1)),
 *   asyncDedupe('user-1', () => fetchUser(1)),
 * ]);
 * // r1 和 r2 得到相同的结果，fetchUser 只被调用一次
 *
 * // 查询某 key 是否在途
 * isPending('user-1');
 *
 * // 取消进行中的调用
 * cancelCall('user-1');
 *
 * // 捕获取消错误
 * try {
 *   await asyncDedupe('user-1', () => fetchUser(1));
 * } catch (error) {
 *   if (error instanceof CancelError) {
 *     // 用户主动取消，忽略
 *     return;
 *   }
 *   throw error;
 * }
 *
 * // 请求完成后，相同 key 的新请求会重新执行
 * const r3 = await asyncDedupe('user-1', () => fetchUser(1)); // 重新执行
 * ```
 */
function createAsyncDedupe() {
  const { cancelable, cancel } = createCancelable();
  /**
   * 在途注册表：key -> 共享执行 promise，落定（成功/失败/取消）即删。
   *
   * 早期版本基于 createEventEmitter 的结果通道实现去重：每个调用者（含执行者）
   * 各自注册一次 once 监听并新建包装 promise，等待者数量 = 包装数量；
   * 改为在途注册表后，执行者与所有等待者直接共享同一个 promise 对象，
   * 等待者零分配，且不再依赖 emit 时序推断"是否在途"。
   */
  const inflight = new Map<PropertyKey, Promise<unknown>>();

  /**
   * 去重执行异步函数
   *
   * 相同 key 的并发调用只会执行一次异步函数，所有调用共享同一个 Promise 结果
   * （执行者与等待者拿到的是同一个 promise 对象）。如果异步函数失败，
   * 所有等待该 key 的调用都会收到相同的拒绝原因。
   * 当请求完成后（无论成功或失败），相同 key 的后续调用会重新执行。
   *
   * @typeParam V - 异步函数的返回值类型
   * @param key - 唯一标识符（string | number | symbol），相同 key 的请求会被合并
   * @param asyncFunc - 要执行的异步函数
   * @returns 返回一个 Promise，解析为异步函数的结果
   */
  function asyncDedupe<V>(key: PropertyKey, asyncFunc: () => V | Promise<V>): Promise<V> {
    // 已在途：直接共享现有执行的结果
    const shared = inflight.get(key);
    // 断言为真：注册表值即本次 asyncFunc 的 cancelable 结果，运行时解析为 V
    if (shared) return shared as Promise<V>;

    // 首个调用者：注册共享执行
    const started = cancelable(key, asyncFunc);
    inflight.set(key, started);
    // 落定即清理；该处理器同时挂接了拒绝分支——没有任何调用者 await/catch 时，
    // 失败也不会触发 unhandledrejection（内部处理器保证 promise 已被处理）。
    started.then(
      () => { inflight.delete(key); },
      () => { inflight.delete(key); }
    );
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
