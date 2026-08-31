/** 防抖后的可调用函数：与原签名一致（受约束为 void，见 debounce 的 fire-and-forget 设计），并携带 `cancel`/`flush` 治理 pending */
export interface DebouncedFunction<T extends (...args: any[]) => unknown> {
  (this: ThisParameterType<T>, ...args: Parameters<T>): void;
  /** 取消 pending：丢弃待执行/待补发的调用，窗口重置 */
  cancel: () => void;
  /** 立即执行最后一次被合并/待执行的调用；无 pending 时 no-op */
  flush: () => void;
}

/**
 * 创建防抖函数：同一时间窗内的连续调用合并为一次执行。
 *
 * 语义（默认与主流防抖不同，务必注意）：
 * - `immediate: true`（默认）为 leading 防抖——首次调用立即执行，等待期内的
 *   后续调用被合并（不执行 trailing 补发）；被合并的调用保留为 pending，
 *   可由 `flush()` 在任意时刻（含窗口过期后）补发最后一次参数；
 *   下一次调用会开启新窗口并覆盖（丢弃）旧 pending。
 * - `immediate: false` 为 trailing 防抖——等待期结束后执行最后一次调用。
 * - `cancel()` 丢弃 pending（含被合并的调用）并重置窗口，后续调用开启新窗口；
 *   `flush()` 立即执行 pending（无 pending 时 no-op，但会中止当前窗口）。
 * - 防抖函数为 fire-and-forget 设计：返回值恒为 void（即便被包装函数有返回值，
 *   仅 leading 的首次调用可拿到，语义不确定故不暴露）；`wait` 必须为有限数字，
 *   非法值抛 `RangeError`（避免交给引擎做平台差异化的钳制）。
 *
 * @typeParam T - 被包装函数类型（返回值被忽略，恒为 void）
 * @param func - 要防抖的函数
 * @param wait - 等待窗口时长（毫秒，必须为有限数字）
 * @param options - 可选配置
 * @param options.immediate - 为 true 时首次调用立即执行（默认），为 false 时等待期结束后执行最后一次
 * @returns 防抖后的函数（携带 `cancel`/`flush`）
 *
 * @example
 * ```ts
 * const debounced = debounce((query: string) => search(query), 300);
 * input.addEventListener('input', (e) => debounced(e.target.value));
 * input.addEventListener('blur', () => debounced.flush()); // 提交最后一次输入
 * debounced.cancel(); // 卸载时取消 pending
 * ```
 */
export function debounce<T extends (...args: any[]) => unknown>(
  func: T,
  wait: number,
  options?: { immediate?: boolean }
): DebouncedFunction<T> {
  if (!Number.isFinite(wait)) {
    throw new RangeError(`debounce: wait 必须是有限数字，收到 ${wait}`);
  }
  const { immediate = true } = options ?? {};
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let pending: { this: ThisParameterType<T>; args: Parameters<T> } | null = null;

  const debounced = function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    if (timeout !== null) clearTimeout(timeout);

    if (immediate) {
      // leading：首次立即执行，等待期内后续调用被合并丢弃（留待 flush 补发）
      const callNow = timeout === null;
      timeout = setTimeout(() => { timeout = null; }, wait);
      if (callNow) {
        pending = null;
        func.apply(this, args);
      }
      else {
        pending = { this: this, args };
      }
    }
    else {
      // trailing：等待期结束后执行最后一次
      pending = { this: this, args };
      timeout = setTimeout(() => {
        timeout = null;
        const call = pending;
        pending = null;
        call && func.apply(call.this, call.args);
      }, wait);
    }
  } as DebouncedFunction<T>;

  debounced.cancel = () => {
    if (timeout !== null) clearTimeout(timeout);
    timeout = null;
    pending = null;
  };

  debounced.flush = () => {
    if (timeout === null && pending === null) return;
    if (timeout !== null) clearTimeout(timeout);
    const call = pending;
    timeout = null;
    pending = null;
    call && func.apply(call.this, call.args);
  };

  return debounced;
}

export default debounce;
