import createEventEmitter from './createEventEmitter';

interface AsyncDedupeEvents {
  [key: string]: { fulfilled: unknown } | { rejected: unknown };
}

/**
 * 创建一个异步去重实例，确保同一 key 的异步操作只执行一次，所有调用共享同一结果。
 *
 * 当多个调用同时使用相同的 key 时，只有第一个调用会真正执行异步函数，
 * 其余调用会等待并共享第一次调用的结果（无论是成功还是失败）。
 * 前一次请求完成后，相同 key 的新请求会重新执行。
 *
 * 内部基于 `createEventEmitter` 实现事件的发布/订阅，利用微任务调度异步函数的执行。
 *
 * @returns 返回 `{ asyncDedupe, cancel }`，其中 `asyncDedupe` 是去重执行函数，`cancel` 是取消函数
 *
 * @example
 * ```ts
 * const { asyncDedupe, cancel } = createAsyncDedupe();
 *
 * // 多次调用只会执行一次 fetch
 * const [r1, r2] = await Promise.all([
 *   asyncDedupe('user-1', () => fetchUser(1)),
 *   asyncDedupe('user-1', () => fetchUser(1)),
 * ]);
 * // r1 和 r2 得到相同的结果，fetchUser 只被调用一次
 *
 * // 取消进行中的请求
 * cancel('user-1');
 *
 * // 请求完成后，相同 key 的新请求会重新执行
 * const r3 = await asyncDedupe('user-1', () => fetchUser(1)); // 重新执行
 * ```
 */
function createAsyncDedupe() {
  const eventEmitter = createEventEmitter<AsyncDedupeEvents>();

  const getCancelKey = (key: string) => `${String(key)}-cancel`;

  /**
   * 执行异步函数，处理取消事件
   *
   * @typeParam V - 异步函数的返回值类型
   * @param key - 唯一标识符，相同 key 的请求会被合并
   * @param asyncFunc - 要执行的异步函数
   * @returns 返回一个 Promise，解析为异步函数的结果
   */
  const execute = <V>(key: string, asyncFunc: () => Promise<V>) => new Promise<V>((resolve, reject) => {
    // 监听取消事件，拒绝 Promise
    eventEmitter.once(getCancelKey(key), result => reject((result as { rejected: Error }).rejected));

    Promise.resolve().then(() => asyncFunc()).then(resolve, reject).finally(() => eventEmitter.delete(getCancelKey(key)));
  });

  const cancel = (key: string) => eventEmitter.emit(getCancelKey(key), { rejected: new Error(`${key} async dedupe function canceled`) });

  /**
   * 去重执行异步函数
   *
   * 相同 key 的并发调用只会执行一次异步函数，所有调用共享同一个 Promise 结果。
   * 如果异步函数失败，所有等待该 key 的调用都会收到相同的拒绝原因。
   * 当请求完成后（无论成功或失败），相同 key 的后续调用会重新执行。
   *
   * @typeParam V - 异步函数的返回值类型
   * @param key - 唯一标识符，相同 key 的请求会被合并
   * @param asyncFunc - 要执行的异步函数
   * @returns 返回一个 Promise，解析为异步函数的结果
   */
  function asyncDedupe<V>(key: string, asyncFunc: () => Promise<V>): Promise<V> {
    // 如果事件已存在，说明已有相同 key 的请求在进行中，不再重复执行
    !eventEmitter.has(key) && execute(key, asyncFunc).then(result => {
      eventEmitter.emit(key, { fulfilled: result });
    }).catch(error => {
      eventEmitter.emit(key, { rejected: error });
    });

    // 返回一个 Promise，等待事件触发后 resolve 或 reject
    return new Promise<V>((resolve, reject) => {
      eventEmitter.once(key, result => 'rejected' in result ? reject(result.rejected) : resolve(result.fulfilled as V));
    });
  };

  return { asyncDedupe, cancel };
}

export { createAsyncDedupe };

export default createAsyncDedupe;
