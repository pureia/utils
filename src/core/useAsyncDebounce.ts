import useEventStore from './useEventStore';

/**
 * 创建一个异步防抖函数，确保同一 key 的异步操作只执行一次，所有调用共享同一结果。
 *
 * 当多个调用同时使用相同的 key 时，只有第一个调用会真正执行异步函数，
 * 其余调用会等待并共享第一次调用的结果（无论是成功还是失败）。
 * 前一次请求完成后，相同 key 的新请求会重新执行。
 *
 * 内部基于 `useEventStore` 实现事件的发布/订阅，利用微任务调度异步函数的执行。
 *
 * @returns 返回一个对象，包含：
 *   - `asyncDebounce(key, asyncFunc)` - 防抖执行异步函数
 *   - `eventStore` - 内部事件存储实例
 *
 * @example
 * ```ts
 * const { asyncDebounce } = useAsyncDebounce();
 *
 * // 多次调用只会执行一次 fetch
 * const [r1, r2] = await Promise.all([
 *   asyncDebounce('user-1', () => fetchUser(1)),
 *   asyncDebounce('user-1', () => fetchUser(1)),
 * ]);
 * // r1 和 r2 得到相同的结果，fetchUser 只被调用一次
 *
 * // 请求完成后，相同 key 的新请求会重新执行
 * const r3 = await asyncDebounce('user-1', () => fetchUser(1)); // 重新执行
 * ```
 */
function useAsyncDebounce() {
  const eventStore = useEventStore();

  /**
   * 防抖执行异步函数
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
  function asyncDebounce<V>(key: string, asyncFunc: () => Promise<V>): Promise<V> {
    // 如果事件已存在，说明已有相同 key 的请求在进行中，不再重复执行
    !eventStore.has(key) && Promise.resolve().then(() => asyncFunc()).then(result => {
      eventStore.emit(key, { fulfilled: result });
    }).catch(error => {
      eventStore.emit(key, { rejected: error });
    });

    // 返回一个 Promise，等待事件触发后 resolve 或 reject
    return new Promise<V>((resolve, reject) => {
      eventStore.once(key, result => 'rejected' in result ? reject(result.rejected) : resolve(result.fulfilled!));
    });
  };
  return { asyncDebounce, eventStore };
}

export { useAsyncDebounce };

export default useAsyncDebounce;
