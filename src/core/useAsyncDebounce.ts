import useEventStore from './useEventStore';

/**
 * 创建一个异步防抖函数，确保同一 key 的异步操作只执行一次，所有调用共享同一结果。
 *
 * @returns 返回一个防抖函数，接收 key 和异步函数作为参数
 *
 * @example
 * ```ts
 * const debounce = useAsyncDebounce();
 *
 * // 多次调用只会执行一次 fetch
 * const result1 = debounce('user-1', () => fetchUser(1));
 * const result2 = debounce('user-1', () => fetchUser(1));
 * // result1 和 result2 会得到相同的结果
 * ```
 */
function useAsyncDebounce(): <V>(key: string, asyncFunc: () => Promise<V>) => Promise<V> {
  const eventStore = useEventStore();

  /**
   * 防抖执行异步函数
   * @param key - 唯一标识符，相同 key 的请求会被合并
   * @param asyncFunc - 要执行的异步函数
   * @returns 返回一个 Promise，解析为异步函数的结果
   */
  return <V>(key: string, asyncFunc: () => Promise<V>): Promise<V> => {
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
}

export { useAsyncDebounce };

export default useAsyncDebounce;
