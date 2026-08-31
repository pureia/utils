import createEventEmitter from './createEventEmitter';

/**
 * 取消执行的标识错误：`cancel(key)` 触发时，进行中的 `cancelable` 调用以本错误 reject。
 * 调用方用 `instanceof CancelError` 区分主动取消与真实失败。
 *
 * @example
 * ```ts
 * try {
 *   await cancelable('my-key', () => fetch('/api'));
 * } catch (error) {
 *   if (error instanceof CancelError) return; // 主动取消，忽略
 *   throw error;
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
 * 创建可取消执行所需的最小组合：`cancelable` 包装异步函数、`cancel` 按 key 取消、
 * `isPending` 查询在途注册。
 *
 * @returns `{ cancelable, cancel, isPending }`——执行并支持取消、广播取消、在途查询
 *
 * @example
 * ```ts
 * const { cancelable, cancel } = createCancelable();
 * const result = await cancelable('my-key', () => fetch('/api')); // 包装异步操作
 * cancel('my-key'); // 取消进行中的调用
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
   * 时序契约：工作函数经微任务启动——同一 tick 内的 `cancel(key)` 使其不再启动
   * （副作用不发生）；已启动的工作不被阻止、继续跑完（结果被丢弃）；调用落定后
   * 对旧 key 的 `cancel` 为静默 no-op，不再触发 `onCancel`。
   *
   * @typeParam T - 异步函数返回类型
   * @param key - 取消标识符，与 `cancel(key)` 配对使用
   * @param asyncFunc - 要执行的异步函数
   * @param onCancel - 可选，取消时执行的清理回调（如底层 API 的 abort）；
   *   任何一次真实取消都会触发；其抛错不影响取消结果
   * @returns 异步函数的执行结果（取消时 promise 以 `CancelError` 拒绝）
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
   * 取消当前进行中、以该 key 注册的调用；无进行中注册（key 未知或调用已落定）
   * 时为静默 no-op（返回 false）。
   *
   * @param key - 取消标识符
   * @returns 是否实际取消了进行中的注册
   */
  const cancel = (key: PropertyKey) => {
    if (!eventEmitter.has(key)) return false;
    eventEmitter.emit(key, new CancelError(key));
    return true;
  };

  /**
   * 是否有进行中的取消调用（落定的同一微任务内即清理，执行落定后立即为 false）
   * @param key - 取消标识符
   * @returns 是否有进行中的取消调用
   */
  const isPending = (key: PropertyKey) => eventEmitter.has(key);

  return { cancelable, cancel, isPending };
}

export { CancelError, createCancelable };

export default createCancelable;
