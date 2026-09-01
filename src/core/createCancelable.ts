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

/** 执行生命周期：scheduled（已注册、工作函数未启动）→ running（已启动）→ settled（已落定） */
type ExecutionState = 'scheduled' | 'running' | 'settled';

/**
 * 一次 `cancelable` 调用的执行状态。
 *
 * `state` 描述执行生命周期；`cancelSignaled` 是取消信号（同步标记）——只在
 * `scheduled` 阶段起作用（短路启工）。取消裁决经微任务延后、与 `settled` 门闩
 * 仲裁（可作废），因此取消不是终止状态。
 */
interface Execution {
  state: ExecutionState;
  cancelSignaled: boolean;
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
   * @param asyncFunc - 要执行的异步函数，须返回原生 Promise；thenable、跨 realm
   *   或 polyfill Promise（如 Bluebird）为契约违规，调用以 `TypeError` 拒绝；
   *   同步抛错仍以原始错误拒绝
   * @param options - 可选配置
   * @param options.onCancel - 取消时执行的清理回调（如底层 API 的 abort）；
   *   任何一次**生效的**取消都会触发（完成竞态中作废的取消不触发）。
   *   回调在取消裁决的同一微任务内执行，晚于 `cancel()` 调用一帧且晚于 reject——
   *   回调抛错不影响取消结果（异常自微任务内逃逸为全局未捕获，不做结构防护，
   *   需要时由调用方自行兜底）。
   * @returns 异步函数的执行结果（取消时 promise 以 `CancelError` 拒绝）
   */
  const cancelable = <T>(
    key: PropertyKey,
    asyncFunc: () => Promise<T>,
    options?: { onCancel?: () => void }
  ) => new Promise<T>((resolve, reject) => {
    const execution: Execution = { state: 'scheduled', cancelSignaled: false };
    // 取消信号：同步标记 + 延后裁决（与结算门闩仲裁，见上方时序契约）。
    // once 触发即自清理——此后对该 key 的 cancel 为静默 no-op
    const off = eventEmitter.once(key, (error) => {
      execution.cancelSignaled = true;
      Promise.resolve().then(() => {
        if (execution.state === 'settled') return; // 结算先落位 → 取消作废
        execution.state = 'settled';
        reject(error);
        options?.onCancel?.();
      });
    });

    // 落定的统一出口：成功、失败、契约违规、取消仲裁均经此处转移状态并清理注册
    const settleResolve = (value: T) => {
      execution.state = 'settled';
      off();
      resolve(value);
    };
    const settleReject = (error: unknown) => {
      execution.state = 'settled';
      off();
      reject(error);
    };

    // 工作函数经微任务启动——启动前的取消（同一 tick）短路，副作用不发生
    Promise.resolve().then(() => {
      if (execution.cancelSignaled) return;
      execution.state = 'running';
      let result: Promise<T>;
      try { result = asyncFunc(); }
      // 同步抛错：视为立即落定，拒绝原始错误
      catch (error) { return settleReject(error); }
      // 契约校验：仅支持原生 Promise——thenable、跨 realm/polyfill Promise
      // （如 Bluebird 实例）均为契约违规，以 TypeError 拒绝
      if (!(result instanceof Promise)) return settleReject(new TypeError(`${String(key)} async call must return a Promise`));
      try { result.then(settleResolve, settleReject); }
      // 异常 then（如 Proxy 包装的 Promise）按落定失败拒绝
      catch (error) { settleReject(error); }
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
