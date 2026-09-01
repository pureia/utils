import { debounce } from '@purea/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('debounce', () => {
  afterEach(() => {
    vi.useRealTimers(); // 兜底：假计时器测试自行恢复
  });

  it('默认（edge: trailing）应为 trailing：窗口结束后执行最后一次调用', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 1000);
    d('a');
    d('b');
    d('c');
    expect(fn).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith('c');
  });

  it('默认（edge: trailing）等待期内调用被合并，只执行最后一次', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 1000);
    d('a');
    d('b');
    vi.advanceTimersByTime(2000); // 越过窗口：无中间补发
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith('b');
  });

  it('leading 冷却期内 flush 应补发最后一次被合并的调用', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 1000, { edge: 'leading' });
    d('a');
    d('b');
    d('c');
    d.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('c'); // 补发最后一次参数
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(2); // flush 后 timer 不再触发
  });

  it('leading 首次调用后无被合并调用时 flush 应为 no-op（不重复执行）', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 1000, { edge: 'leading' });
    d('a');
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1); // 只执行了首次，flush 不重复
  });

  it('wait 为非有限数字时应抛 RangeError（不交给引擎钳制）', () => {
    expect(() => debounce(() => {}, Number.NaN)).toThrow(RangeError);
    expect(() => debounce(() => {}, Infinity)).toThrow(RangeError);
    expect(() => debounce(() => {}, -Infinity)).toThrow(RangeError);
  });

  it('wait 为负数时应抛 RangeError（平台差异化钳制与设计原则冲突）', () => {
    expect(() => debounce(() => {}, -1)).toThrow(RangeError);
    expect(() => debounce(() => {}, -0.5)).toThrow(RangeError);
    // wait=0 是合法窗口，保留
    expect(() => debounce(() => {}, 0)).not.toThrow();
  });

  it('leading 窗口过期后新调用覆盖并丢弃旧 pending（不补发）', async () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const d = debounce((n: number) => calls.push(n), 100, { edge: 'leading' });
    d(1);
    d(2);
    await vi.advanceTimersByTimeAsync(100);
    d(3); // 新窗口：立即执行，覆盖（丢弃）旧 pending
    expect(calls).toEqual([1, 3]);
    d.flush(); // 旧 pending 已被覆盖 → no-op
    expect(calls).toEqual([1, 3]);
    vi.useRealTimers();
  });

  it('显式 trailing（edge: trailing）：窗口结束后执行最后一次调用', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 1000, { edge: 'trailing' });
    d('a');
    d('b');
    d('c');
    expect(fn).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith('c');
  });

  it('trailing：调用后 flush 应立即执行一次且 timer 不再触发', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 1000, { edge: 'trailing' });
    d('a');
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith('a');
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancel 应丢弃 pending 并重置窗口，之后新调用开启新窗口', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 1000, { edge: 'trailing' });
    d('a');
    d.cancel();
    vi.advanceTimersByTime(2000);
    expect(fn).not.toHaveBeenCalled(); // pending 已丢弃

    d('b');
    vi.advanceTimersByTime(1100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith('b'); // 新窗口正常生效
  });

  it('窗口过期后 cancel 应为静默 no-op（timer 已结束，无 pending）', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 1000);
    d('a'); // 窗口激活
    vi.advanceTimersByTime(1100); // 窗口过期：已执行（trailing）
    expect(fn).toHaveBeenCalledTimes(1);
    expect(() => d.cancel()).not.toThrow();
    expect(() => d.cancel()).not.toThrow(); // 重复 cancel 幂等
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1); // cancel 无副作用
  });

  it('leading 窗口过期后 flush 应补发冷却期内被合并的最后一次调用', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 1000, { edge: 'leading' });
    d('a');
    d('b'); // 冷却期内被合并
    d('c');
    vi.advanceTimersByTime(1100); // 窗口过期：pending 保留（未被补发）
    expect(fn).toHaveBeenCalledTimes(1); // 仅首次
    d.flush(); // timeout 为 null、pending 非 null 的补发路径
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('c');
    d.flush(); // 补发后再 flush：无 pending，no-op
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('leading 模式下 cancel 后等待期内调用不再触发（合并调用被丢弃）', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 1000, { edge: 'leading' });
    d('a');
    d('b'); // 冷却期内：被合并
    d.cancel();
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(1); // 仅首次，后续被 cancel 丢弃
  });

  it('窗口到期后重新调用应开启新窗口（trailing 再次延迟执行）', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 1000);
    d('a');
    vi.advanceTimersByTime(1100);
    d('b');
    vi.advanceTimersByTime(1100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls.map(c => c[0])).toEqual(['a', 'b']);
  });

  it('应保留 this 绑定与最后参数（trailing 路径）', () => {
    vi.useFakeTimers();
    const ctx = { name: 'ctx' };
    const fn = vi.fn(function (this: any, x: string) { return this.name + x; });
    const d = debounce(fn, 1000, { edge: 'trailing' });
    d.call(ctx, '!');
    vi.advanceTimersByTime(1100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.instances[0]).toBe(ctx);
  });

  it('多个防抖实例互不影响（不同 edge 混用）', () => {
    vi.useFakeTimers();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const d1 = debounce(fn1, 1000, { edge: 'leading' });
    const d2 = debounce(fn2, 1000, { edge: 'trailing' });
    d1('x');
    d2('y');
    expect(fn1).toHaveBeenCalledTimes(1); // leading：立即执行
    expect(fn2).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1100);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenLastCalledWith('y');
  });

  it('wait 为 0 时仍按窗口语义工作（trailing）', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 0, { edge: 'trailing' });
    d('a');
    vi.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith('a');
  });
});
