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
   * 取消/完成竞态仲裁：取消裁决经微任务延后，与结算门闩（`settled`）仲裁——
   * 若取消到达时工作函数结果已产出但结算微任务尚未执行（同一微任务序列），
   * 结算先落位、取消自动作废，最终 resolve 真实结果（不会出现"已完成却报取消"）；
   * 反之取消先落位则正常以 `CancelError` 拒绝（此时工作确实未完成）。
   *
   * @typeParam T - 异步函数返回类型
   * @param key - 取消标识符，与 `cancel(key)` 配对使用
   * @param asyncFunc - 要执行的异步函数
   * @param options - 可选配置
   * @param options.onCancel - 取消时执行的清理回调（如底层 API 的 abort）；
   *   任何一次**生效的**取消都会触发（完成竞态中作废的取消不触发）；其抛错不影响取消结果。
   *   回调在取消裁决的同一微任务内执行，晚于 `cancel()` 调用一帧。
   * @returns 异步函数的执行结果（取消时 promise 以 `CancelError` 拒绝）
   */
  const cancelable = <T>(
    key: PropertyKey,
    asyncFunc: () => T | Promise<T>,
    options?: { onCancel?: () => void }
  ) => new Promise<T>((resolve, reject) => {
    let cancelRequested = false;
    let settled = false;

    const off = eventEmitter.once(key, (error) => {
      // 同步标记：启动前取消（同一 tick 内）须跳过工作函数
      cancelRequested = true;
      // 取消裁决推迟一个微任务：结算（settled）先落位则视为"取消到达时工作已完成",
      // 放弃取消——最终由结算路径 resolve 真实结果
      queueMicrotask(() => {
        if (settled) return;
        reject(error);
        options?.onCancel?.();
      });
    });

    // 工作函数经微任务启动，启动前 cancel 短路（副作用不发生）
    Promise.resolve().then(() => {
      if (cancelRequested) return;
      let ret: T | Promise<T>;
      try {
        ret = asyncFunc();
      }
      catch (error) {
        // 同步抛错：视为立即落定，拒绝原始错误
        settled = true;
        off();
        reject(error);
        return;
      }
      try {
        if (ret && typeof (ret as PromiseLike<T>).then === 'function') {
          // 结算回调直接挂在工作函数返回值上（不经过中间层微任务），
          // 落定即清理：监听在结果落定的同一微任务内移除，此后对旧 key 的
          // cancel 为静默 no-op（不触发 onCancel），isPending 立即为 false
          (ret as PromiseLike<T>).then(
            (result) => {
              settled = true;
              off();
              resolve(result);
            },
            (error) => {
              settled = true;
              off();
              reject(error);
            }
          );
        }
        else {
          settled = true;
          off();
          resolve(ret as T);
        }
      }
      catch (error) {
        // thenable 的 then 访问/调用抛错：按落定失败处理
        settled = true;
        off();
        reject(error);
      }
    });
  });

  /**
   * 是否有进行中的取消调用（落定的同一微任务内即清理，执行落定后立即为 false）
   * @param key - 取消标识符
   * @returns 是否有进行中的取消调用
   */
  const isPending = (key: PropertyKey) => eventEmitter.has(key);

  /**
   * 取消当前进行中、以该 key 注册的调用；无进行中注册（key 未知或调用已落定）
   * 时为静默 no-op（返回 false）。
   *
   * @param key - 取消标识符
   * @returns 是否存在进行中的注册并已发起取消；若取消到达时工作恰于同一微任务
   *   序列内落定，该取消会作废（返回 true 但结果不被覆盖，见 cancelable 竞态仲裁）
   */
  const cancel = (key: PropertyKey) => {
    if (!isPending(key)) return false;
    eventEmitter.emit(key, new CancelError(key));
    return true;
  };

  return { cancelable, cancel, isPending };
}

export { CancelError, createCancelable };

export default createCancelable;
