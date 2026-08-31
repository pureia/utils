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
  /** 取消事件发布器，用于广播取消事件 */
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
   * @param options - 可选配置
   * @param options.isCompleted - 可选，判断"工作是否已完成"的谓词。工作函数的结果
   *   已产出（如底层回调已触发）但 settle 清理微任务尚未执行时，`cancel(key)` 可能
   *   先于清理到达；提供该谓词（与结果产出同步置真的门闩）可让取消**放弃覆盖**，
   *   最终 resolve 真实结果。默认不提供：该窗口内 cancel 仍以 `CancelError` 拒绝
   *   （结果被丢弃，既有时序契约）。
   * @returns 异步函数的执行结果（取消时 promise 以 `CancelError` 拒绝）
   */
  const cancelable = <T>(
    key: PropertyKey,
    asyncFunc: () => T | Promise<T>,
    onCancel?: () => void,
    options?: { isCompleted?: () => boolean }
  ) =>
    new Promise<T>((resolve, reject) => {
      let cancelled = false;
      const off = eventEmitter.once(key, (error) => {
        // 完成门闩：工作在取消到达前已完成（结果已在手）时放弃取消，
        // 监听已在 once 包装内移除，后续 settle 路径正常 resolve 真实结果。
        if (options?.isCompleted?.()) return;
        cancelled = true;
        reject(error);
        onCancel?.();
      });
      // 启动前取消（同一 tick 内的 cancel）短路：工作函数不再启动，副作用不发生；
      // 已启动的工作不被阻止，继续跑完（结果被丢弃）。
      // 已取消时短路返回即可：外层 Promise 已被监听器拒绝，resolve-after-reject 为 no-op，
      // 无需 never-promise 悬挂链。
      Promise.resolve().then(() => (cancelled ? void 0 : asyncFunc())).then(
        (result) => {
          // 落定即清理：监听在结果落定的同一微任务内移除，此后对旧 key 的
          // cancel 为静默 no-op（不触发 onCancel），isPending 立即为 false
          off();
          // 取消短路分支走到此处时外层 Promise 已被拒绝，resolve 为 no-op（result 为 undefined）；
          // 正常路径 result 恒为 T —— 收窄为 T 的断言在此为真
          resolve(result as T);
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
