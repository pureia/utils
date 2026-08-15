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
  constructor(key: string) {
    super(`${key} async call canceled`);
    this.name = 'CancelError';
  }
}

/**
 * 创建一个取消包装器，基于事件发射器实现可取消的异步执行。
 *
 * @returns `{ cancelable, cancel }`
 *   - `cancelable(key, asyncFunc, onCancel?)` — 将异步函数包装为可取消执行
 *   - `cancel(key)` — 取消当前进行中、以该 key 注册的 cancelable 调用
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
  const eventEmitter = createEventEmitter<{ [key: string]: CancelError }>();
  /**
   * 包装异步函数为可取消执行
   *
   * 注册一次性的取消监听器，当同一 key 上触发 `cancel(key)` 时，promise
   * 会被拒绝并抛出 `CancelError`。异步函数完成后（成功或失败）自动清理监听器。
   *
   * @typeParam T - 异步函数返回类型
   * @param key - 取消标识符，与 `cancel(key)` 配对使用
   * @param asyncFunc - 要执行的异步函数
   * @param onCancel - 可选，取消时执行的清理回调（如调用底层 API 的 abort）
   * @returns 返回异步函数的执行结果
   */
  const cancelable = <T>(key: string, asyncFunc: () => T | Promise<T>, onCancel?: () => void) => new Promise<T>((resolve, reject) => {
    let cancelled = false;
    const off = eventEmitter.once(key, (error) => {
      cancelled = true;
      reject(error);
      onCancel?.();
    });
    // 启动前取消（同一 tick 内的 cancel）短路：工作函数不再启动，副作用不发生；
    // 已启动的工作不被阻止，继续跑完（结果被丢弃）
    Promise.resolve().then(() => !cancelled && asyncFunc()).then((result) => resolve(result as T), reject).finally(() => off());
  });

  /**
   * 取消当前进行中、以该 key 注册的 cancelable 调用
   * @param key - 取消标识符
   */
  const cancel = (key: string) => eventEmitter.emit(key, new CancelError(key));

  /**
   * 检查是否有进行中的取消调用
   * @param key - 取消标识符
   * @returns 是否有进行中的取消调用
   */
  const isPending = (key: string) => eventEmitter.has(key);

  return { cancelable, cancel, isPending };
}

export { CancelError, createCancelable };
