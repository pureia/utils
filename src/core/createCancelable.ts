import createEventEmitter from './createEventEmitter';

/**
 * 取消执行错误类
 *
 * 当通过 `cancel(key)` 取消一个进行中的 `cancelable` 调用时，该调用会用此错误 reject。
 *
 * 调用方通过 `instanceof CancelError` 区分"用户主动取消"和"真正的错误"：
 *
 * @example
 * ```ts
 * try {
 *   await cancelable('my-key', () => fetch('/api'));
 * } catch (error) {
 *   if (error instanceof CancelError) {
 *     // 用户主动取消，忽略
 *     return;
 *   }
 *   // 真正的错误处理
 *   console.error(error);
 * }
 * ```
 */
class CancelError extends Error {
  constructor(key: PropertyKey) {
    super(`${String(key)} async call canceled`);
    this.name = 'CancelError';
  }
}

/**
 * 创建一个取消包装器，基于事件发射器实现可取消的异步执行。
 *
 * @returns `{ cancelable, cancel, isPending }`
 *   - `cancelable(key, asyncFunc, onCancel?)` — 将异步函数包装为可取消执行
 *   - `cancel(key)` — 取消当前进行中、以该 key 注册的 cancelable 调用，
 *     返回是否实际取消了进行中的注册
 *   - `isPending(key)` — 查询该 key 是否有进行中的取消注册
 *
 * @example
 * ```ts
 * const { cancelable, cancel } = createCancelable();
 *
 * // 包装异步操作为可取消
 * const result = await cancelable('my-key', () => fetch('/api'));
 *
 * // 取消进行中的调用
 * cancel('my-key');
 *
 * // 错误处理：使用 instanceof 区分取消 vs 真正错误
 * try {
 *   await cancelable('my-key', () => fetch('/api'));
 * } catch (error) {
 *   if (error instanceof CancelError) return; // 取消，忽略
 *   throw error;
 * }
 * ```
 */
function createCancelable() {
  // 已知风险（评估后接受，不做结构防护）：onCancel 抛错经 emit 的逐 handler 兜底到
  // console.error；若 console.error 自身抛错（被 patch、stderr 关闭等），emit 的快照
  // 迭代将中断——同 key 广播下剩余注册收不到取消事件、promise 悬挂。触发需 onCancel
  // 抛错与 console.error 抛错同时叠加，概率极低；createEventEmitter 对处理器抛错统一输出到 console.error。
  const eventEmitter = createEventEmitter<Record<PropertyKey, CancelError>>();
  /**
   * 包装异步函数为可取消执行
   *
   * 注册一次性的取消监听器，当同一 key 上触发 `cancel(key)` 时，promise
   * 会被拒绝并抛出 `CancelError`。异步函数完成后（成功或失败）自动清理监听器。
   *
   * 时序：工作函数经微任务启动，启动前（同一 tick 内）的 `cancel(key)` 使其不再
   * 启动、副作用不发生；已启动的工作不被阻止，继续跑完（结果被丢弃）。取消仅在
   * 调用仍处进行中时生效：执行已落定（成功/失败/取消）后对旧 key 的 `cancel`
   * 为静默 no-op，不再触发 `onCancel`。
   *
   * @typeParam T - 异步函数返回类型
   * @param key - 取消标识符（string | number | symbol），与 `cancel(key)` 配对使用
   * @param asyncFunc - 要执行的异步函数
   * @param onCancel - 可选，取消时执行的清理回调（如调用底层 API 的 abort）；
   *   任何一次真实取消（含启动前取消）都会触发；其抛错由事件发射器兜底输出到
   *   `console.error`，不影响取消结果
   * @returns 返回异步函数的执行结果
   */
  const cancelable = <T>(key: PropertyKey, asyncFunc: () => T | Promise<T>, onCancel?: () => void) =>
    new Promise<T>((resolve, reject) => {
      let cancelled = false;
      const off = eventEmitter.once(key, (error) => {
        cancelled = true;
        reject(error);
        onCancel?.();
      });
      // 启动前取消（同一 tick 内的 cancel）短路：工作函数不再启动，副作用不发生；
      // 已启动的工作不被阻止，继续跑完（结果被丢弃）。
      // 已取消时返回 never-promise：外层 Promise 已被监听器拒绝（监听器亦已自清理），
      // 链悬挂即可，无需再启动工作或清理。
      Promise.resolve().then(() => (cancelled ? new Promise<T>(() => {}) : asyncFunc())).then(
        (result) => {
          // 落定即清理：监听在结果落定的同一微任务内移除，此后对旧 key 的
          // cancel 为静默 no-op（不触发 onCancel），isPending 立即为 false
          off();
          resolve(result);
        },
        (error) => {
          off();
          reject(error);
        }
      );
    });

  /**
   * 取消当前进行中、以该 key 注册的 cancelable 调用
   *
   * 无进行中注册（key 未知或调用已落定）时为静默 no-op：返回 false 且不分配错误对象。
   * 同一 key 下多个并发注册会被广播取消（各自收到 `CancelError`）。
   *
   * @param key - 取消标识符（string | number | symbol）
   * @returns 是否实际取消了进行中的注册
   */
  const cancel = (key: PropertyKey) => {
    if (!eventEmitter.has(key)) return false;
    eventEmitter.emit(key, new CancelError(key));
    return true;
  };

  /**
   * 检查是否有进行中的取消调用
   *
   * 取消注册在结果落定（成功/失败/取消）的同一微任务内清理，故执行落定后立即为 false。
   *
   * @param key - 取消标识符（string | number | symbol）
   * @returns 是否有进行中的取消调用
   */
  const isPending = (key: PropertyKey) => eventEmitter.has(key);

  return { cancelable, cancel, isPending };
}

export { CancelError, createCancelable };

export default createCancelable;
