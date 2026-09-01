import { CancelError, createAsyncDedupe } from '@purea/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('createAsyncDedupe', () => {
  let dedupe: ReturnType<typeof createAsyncDedupe>['asyncDedupe'];

  // 每测试新建实例，避免 describe 层共享实例造成的隐藏耦合（监听器泄漏/键复用）
  beforeEach(() => {
    ({ asyncDedupe: dedupe } = createAsyncDedupe());
  });

  afterEach(() => {
    vi.useRealTimers(); // 兜底：假计时器测试自行恢复
  });

  describe('基本功能', () => {
    it('应该成功执行异步函数并返回结果', async () => {
      const asyncFunc = vi.fn().mockResolvedValue('success');

      const result = await dedupe('test-key', asyncFunc);

      expect(result).toBe('success');
      expect(asyncFunc).toHaveBeenCalledTimes(1);
    });
  });

  describe('返回值', () => {
    it('应该返回包含 asyncDedupe 和 cancelCall 的对象', () => {
      const { asyncDedupe, cancelCall } = createAsyncDedupe();

      expect(typeof asyncDedupe).toBe('function');
      expect(typeof cancelCall).toBe('function');
    });
  });

  describe('错误处理', () => {
    it('应该正确传递异步函数的拒绝原因', async () => {
      const error = new Error('async error');
      const asyncFunc = vi.fn().mockRejectedValue(error);

      await expect(dedupe('error-key', asyncFunc)).rejects.toThrow('async error');
      expect(asyncFunc).toHaveBeenCalledTimes(1);
    });

    it('应该保持错误的原始类型', async () => {
      class CustomError extends Error {
        constructor(public code: number, message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }
      const asyncFunc = vi.fn().mockRejectedValue(new CustomError(500, 'server error'));

      try {
        await dedupe('typed-error', asyncFunc);
        expect.fail('should have thrown');
      }
      catch (e) {
        expect(e).toBeInstanceOf(CustomError);
        expect((e as CustomError).code).toBe(500);
      }
    });

    it('应该允许不同 key 的失败不影响其他调用', async () => {
      const successFunc = vi.fn().mockResolvedValue('ok');
      const failFunc = vi.fn().mockRejectedValue(new Error('failed'));

      const result1 = await dedupe('success-key', successFunc);
      await expect(dedupe('fail-key', failFunc)).rejects.toThrow('failed');

      expect(result1).toBe('ok');
    });
  });

  describe('去重功能', () => {
    it('相同 key 的并发调用应该只执行一次异步函数', async () => {
      const asyncFunc = vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 50, 'result')));

      const promises = await Promise.all([
        dedupe('same-key', asyncFunc),
        dedupe('same-key', asyncFunc),
        dedupe('same-key', asyncFunc),
      ]);

      expect(asyncFunc).toHaveBeenCalledTimes(1);
      expect(promises).toEqual(['result', 'result', 'result']);
    });

    it('不同 key 的调用应该独立执行', async () => {
      const asyncFunc1 = vi.fn().mockResolvedValue('result1');
      const asyncFunc2 = vi.fn().mockResolvedValue('result2');

      const [r1, r2] = await Promise.all([
        dedupe('key-1', asyncFunc1),
        dedupe('key-2', asyncFunc2),
      ]);

      expect(r1).toBe('result1');
      expect(r2).toBe('result2');
      expect(asyncFunc1).toHaveBeenCalledTimes(1);
      expect(asyncFunc2).toHaveBeenCalledTimes(1);
    });

    it('前一个请求完成后，相同 key 的新请求应该重新执行', async () => {
      const asyncFunc = vi.fn().mockResolvedValue('first');

      const result1 = await dedupe('sequential-key', asyncFunc);
      expect(result1).toBe('first');
      expect(asyncFunc).toHaveBeenCalledTimes(1);

      asyncFunc.mockResolvedValue('second');
      const result2 = await dedupe('sequential-key', asyncFunc);
      expect(result2).toBe('second');
      expect(asyncFunc).toHaveBeenCalledTimes(2);
    });
  });

  describe('类型安全', () => {
    it('应该正确推断返回类型', async () => {
      const asyncFunc = vi.fn<() => Promise<{ id: number; name: string }>>().mockResolvedValue({ id: 1, name: 'test' });

      const result = await dedupe('typed-key', asyncFunc);

      expect(result.id).toBe(1);
      expect(result.name).toBe('test');
    });

    it('应该支持不同的返回类型', async () => {
      const stringFunc = vi.fn<() => Promise<string>>().mockResolvedValue('string');
      const numberFunc = vi.fn<() => Promise<number>>().mockResolvedValue(42);
      const arrayFunc = vi.fn<() => Promise<number[]>>().mockResolvedValue([1, 2, 3]);

      const [s, n, a] = await Promise.all([
        dedupe('string-key', stringFunc),
        dedupe('number-key', numberFunc),
        dedupe('array-key', arrayFunc),
      ]);

      expect(s).toBe('string');
      expect(n).toBe(42);
      expect(a).toEqual([1, 2, 3]);
    });
  });

  describe('边界情况', () => {
    it('应该处理返回值为 undefined 的异步函数', async () => {
      const asyncFunc = vi.fn().mockResolvedValue(undefined);

      const result = await dedupe('undefined-key', asyncFunc);

      expect(result).toBeUndefined();
    });

    it('应该处理返回值为 null 的异步函数', async () => {
      const asyncFunc = vi.fn().mockResolvedValue(null);

      const result = await dedupe('null-key', asyncFunc);

      expect(result).toBeNull();
    });

    it('应该处理返回值为 0 或空字符串的异步函数', async () => {
      const zeroFunc = vi.fn().mockResolvedValue(0);
      const emptyFunc = vi.fn().mockResolvedValue('');

      const [zero, empty] = await Promise.all([
        dedupe('zero-key', zeroFunc),
        dedupe('empty-key', emptyFunc),
      ]);

      expect(zero).toBe(0);
      expect(empty).toBe('');
    });

    it('应该在异步函数抛出同步错误时正确处理', async () => {
      const asyncFunc = vi.fn().mockImplementation(() => {
        throw new Error('sync error');
      });

      await expect(dedupe('sync-error-key', asyncFunc)).rejects.toThrow('sync error');
    });

    it('应该处理空字符串作为 key', async () => {
      const asyncFunc = vi.fn().mockResolvedValue('empty-key-result');

      const result = await dedupe('', asyncFunc);

      expect(result).toBe('empty-key-result');
      expect(asyncFunc).toHaveBeenCalledTimes(1);
    });
  });

  describe('并发场景', () => {
    it('应该正确处理成功和失败的混合并发请求', async () => {
      const successFunc = vi.fn().mockResolvedValue('ok');
      const failFunc = vi.fn().mockRejectedValue(new Error('fail'));

      const results = await Promise.allSettled([
        dedupe('mix-success-1', successFunc),
        dedupe('mix-fail', failFunc),
        dedupe('mix-success-2', successFunc),
      ]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[2].status).toBe('fulfilled');
    });

    it('应该在大量并发调用时只执行一次', async () => {
      const asyncFunc = vi.fn().mockResolvedValue('concurrent');

      const promises = Array.from({ length: 100 }).fill(null).map(() => dedupe('massive-key', asyncFunc));
      const results = await Promise.all(promises);

      expect(asyncFunc).toHaveBeenCalledTimes(1);
      expect(results.every(r => r === 'concurrent')).toBe(true);
    });
  });

  describe('多个实例独立性', () => {
    it('多个 dedupe 实例应该相互独立', async () => {
      const { asyncDedupe: dedupe1 } = createAsyncDedupe();
      const { asyncDedupe: dedupe2 } = createAsyncDedupe();

      const func1 = vi.fn().mockResolvedValue('result1');
      const func2 = vi.fn().mockResolvedValue('result2');

      const [r1, r2] = await Promise.all([
        dedupe1('same-key', func1),
        dedupe2('same-key', func2),
      ]);

      expect(r1).toBe('result1');
      expect(r2).toBe('result2');
      expect(func1).toHaveBeenCalledTimes(1);
      expect(func2).toHaveBeenCalledTimes(1);
    });

    it('同一实例顺序调用相同 key 应该重新执行', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();

      const func = vi.fn().mockResolvedValue('first');

      const r1 = await dedupe('seq-key', func);
      expect(r1).toBe('first');
      expect(func).toHaveBeenCalledTimes(1);

      func.mockClear();
      func.mockResolvedValue('second');

      const r2 = await dedupe('seq-key', func);
      expect(r2).toBe('second');
      expect(func).toHaveBeenCalledTimes(1);
    });
  });

  describe('共享执行落定保护', () => {
    it('执行者与等待者收到同一个 promise 对象，落定后新调用拿到新 promise', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      let resolveFn!: (value: string) => void;
      const func1 = vi.fn().mockReturnValue(new Promise<string>(resolve => { resolveFn = resolve; }));
      const func2 = vi.fn().mockResolvedValue('second-run');

      const p1 = dedupe('identity-key', func1);
      const p2 = dedupe('identity-key', func1);
      expect(p1).toBe(p2); // 共享同一 promise 对象（CHANGELOG 记录的可观察行为）

      // 冲刷微任务，让共享执行启动（cancelable 经微任务起跑后 resolveFn 才就绪）
      await new Promise<void>(resolve => queueMicrotask(resolve));
      resolveFn('first-run');
      await expect(p2).resolves.toBe('first-run');

      // 前一次执行落定后，相同 key 的新调用是一个新的共享 promise
      const p3 = dedupe('identity-key', func2);
      expect(p3).not.toBe(p2);
      await expect(p3).resolves.toBe('second-run');
    });

    it.runIf(typeof (globalThis as unknown as { process?: unknown }).process !== 'undefined')('没有任何调用者 await 的失败不触发 unhandledrejection（内部处理器已挂接共享 promise）', async () => {
      const { asyncDedupe: dedupe, isPending } = createAsyncDedupe();
      // 项目未装 @types/node，经 globalThis 访问 Node 的进程事件（非 Node 环境跳过）
      const nodeProcess = (globalThis as unknown as {
        process?: { on: (event: string, listener: () => void) => unknown; off: (event: string, listener: () => void) => unknown };
      }).process;
      if (!nodeProcess) return;
      const onUnhandled = vi.fn();
      const listener = () => { onUnhandled(); };
      nodeProcess.on('unhandledRejection', listener);
      try {
        dedupe('silent-fail-key', () => Promise.reject(new Error('nobody awaits me')));
        // 冲刷微任务：内部处理器在 dedupe() 同步期已挂接，拒绝在同一微任务批内被消费（确定性，无需宏任务窗口）
        await new Promise<void>(resolve => queueMicrotask(resolve));
      }
      finally {
        nodeProcess.off('unhandledRejection', listener);
      }
      expect(onUnhandled).not.toHaveBeenCalled();
      // 共享执行确实失败：失败已被内部处理器消费。等待在途注册表清理——落定链路需数个微任务跳，
      // 未落定前同 key 仍属同一在途执行，此时重执行会共享到旧失败结果
      await vi.waitFor(() => expect(isPending('silent-fail-key')).toBe(false));
      // 落定后同 key 可重新执行
      const result = await dedupe('silent-fail-key', vi.fn().mockResolvedValue('recovered'));
      expect(result).toBe('recovered');
    });
  });

  describe('竞争条件', () => {
    it('真正的微任务竞争：多个同步调用应该只执行一次 asyncFunc', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      let executionCount = 0;
      const asyncFunc = vi.fn().mockImplementation(() => {
        executionCount++;
        return new Promise(resolve => setTimeout(resolve, 10, `result-${executionCount}`));
      });

      const promise1 = dedupe('race-key', asyncFunc);
      const promise2 = dedupe('race-key', asyncFunc);
      const promise3 = dedupe('race-key', asyncFunc);

      const results = await Promise.all([promise1, promise2, promise3]);

      expect(results).toEqual(['result-1', 'result-1', 'result-1']);
    });

    it('事件循环交错竞争：在不同微任务时机发起的调用', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      const executionOrder: number[] = [];
      let resolveFirst: () => void;
      let callCount = 0;

      const asyncFunc = vi.fn().mockImplementation(() => {
        const id = ++callCount;
        executionOrder.push(id);
        return new Promise<string>(resolve => {
          if (id === 1) {
            resolveFirst = () => resolve(`first-${id}`);
          }
          else {
            resolve(`later-${id}`);
          }
        });
      });

      const promise1 = dedupe('interleave-key', asyncFunc);

      await new Promise<void>(resolve => { queueMicrotask(resolve); });
      const promise2 = dedupe('interleave-key', asyncFunc);

      resolveFirst!();

      const [r1, r2] = await Promise.all([promise1, promise2]);

      expect(r1).toBe('first-1');
      expect(r2).toBe('first-1');
      expect(asyncFunc).toHaveBeenCalledTimes(1);
    });
  });

  describe('同步异常处理', () => {
    it('asyncFunc 同步抛出异常时应该正确传播', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      const syncError = new Error('sync thrown error');
      const asyncFunc = vi.fn().mockImplementation(() => {
        throw syncError;
      });

      await expect(dedupe('sync-throw-key', asyncFunc)).rejects.toThrow('sync thrown error');
    });
  });

  describe('状态清理和内存管理', () => {
    it('请求成功后应该允许相同 key 的新请求', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      const func = vi.fn()
        .mockResolvedValueOnce('first-result')
        .mockResolvedValueOnce('second-result');

      const r1 = await dedupe('cleanup-key', func);
      expect(r1).toBe('first-result');
      expect(func).toHaveBeenCalledTimes(1);

      const r2 = await dedupe('cleanup-key', func);
      expect(r2).toBe('second-result');
      expect(func).toHaveBeenCalledTimes(2);
    });

    it('请求失败后应该允许相同 key 的新请求', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      const func = vi.fn()
        .mockRejectedValueOnce(new Error('first error'))
        .mockResolvedValueOnce('success');

      await expect(dedupe('retry-key', func)).rejects.toThrow('first error');
      expect(func).toHaveBeenCalledTimes(1);

      const result = await dedupe('retry-key', func);
      expect(result).toBe('success');
      expect(func).toHaveBeenCalledTimes(2);
    });

    it('pending 请求被取消引用后不应该阻止新请求', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      let resolvePending: (value: string) => void;
      const pendingPromise = new Promise<string>(resolve => {
        resolvePending = resolve;
      });

      const func = vi.fn().mockReturnValue(pendingPromise);

      const promise1 = dedupe('pending-key', func);

      const promise2 = dedupe('pending-key', func);

      await new Promise<void>(resolve => queueMicrotask(resolve));
      expect(func).toHaveBeenCalledTimes(1);

      resolvePending!('resolved');

      const [r1, r2] = await Promise.all([promise1, promise2]);
      expect(r1).toBe('resolved');
      expect(r2).toBe('resolved');
    });
  });

  describe('边界情况和极端场景', () => {
    it('asyncFunc 返回 thenable 对象（非 Promise）时按其 then 语义落定', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      const thenable = {
        then: (onFulfilled: (v: string) => void) => {
          queueMicrotask(() => onFulfilled('thenable-result'));
        },
      };
      const asyncFunc = vi.fn().mockReturnValue(thenable);

      await expect(dedupe('thenable-key', asyncFunc)).resolves.toBe('thenable-result');
    });

    it('使用 Symbol 作为 key', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      const symKey = Symbol('test-symbol');
      const func = vi.fn().mockResolvedValue('symbol-result');

      const result = await dedupe(symKey, func);
      expect(result).toBe('symbol-result');
    });

    it('使用数字作为 key', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      const func = vi.fn().mockResolvedValue('number-result');

      const result = await dedupe(123, func);
      expect(result).toBe('number-result');
    });

    it('包含特殊字符的 key', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      const specialKey = 'key-with-特殊字符-emoji-🔧-null-\0-tab-\t';
      const func = vi.fn().mockResolvedValue('special-result');

      const result = await dedupe(specialKey, func);
      expect(result).toBe('special-result');
    });
  });

  describe('性能测试', () => {
    it('大量并发等待者应共享一次执行并全部正确落定', async () => {
      // 假计时器：墙钟阈值断言在慢 CI 上易抖动，改为功能断言（1000 等待者单次执行）
      vi.useFakeTimers();
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      const func = vi.fn().mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 10, 'perf-result'))
      );

      const promises = Array.from({ length: 1000 }, () => dedupe('perf-key', func));
      await vi.advanceTimersByTimeAsync(10);

      const results = await Promise.all(promises);
      expect(func).toHaveBeenCalledTimes(1);
      expect(results.every(r => r === 'perf-result')).toBe(true);
    });

    it('大量不同 key 的调用应该各自执行', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      let callCount = 0;
      const func = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(`result-${callCount}`);
      });

      const promises = Array.from({ length: 100 }, (_, i) => dedupe(`unique-key-${i}`, func));
      const results = await Promise.all(promises);

      expect(func).toHaveBeenCalledTimes(100);
      expect(results.length).toBe(100);
    });
  });

  describe('isPending 功能', () => {
    it('进行中的 key 返回 true，落定后返回 false', async () => {
      const { asyncDedupe: dedupe, isPending } = createAsyncDedupe();
      let resolveFn!: (value: string) => void;
      const func = vi.fn().mockReturnValue(new Promise<string>(resolve => { resolveFn = resolve; }));

      const promise = dedupe('pending-key', func);
      expect(isPending('pending-key')).toBe(true);

      // 冲刷微任务，让共享执行启动（cancelable 经微任务起跑后 resolveFn 才就绪）
      await new Promise<void>(resolve => queueMicrotask(resolve));
      resolveFn('done');
      await promise;
      expect(isPending('pending-key')).toBe(false);
    });

    it('cancelCall 后：落定前仍在途，落定后恢复 false', async () => {
      const { asyncDedupe: dedupe, cancelCall, isPending } = createAsyncDedupe();
      let resolveFn!: (value: string) => void;
      const func = vi.fn().mockReturnValue(new Promise<string>(resolve => { resolveFn = resolve; }));

      const promise = dedupe('cancel-pending-key', func);
      expect(isPending('cancel-pending-key')).toBe(true);

      await new Promise<void>(resolve => queueMicrotask(resolve)); // 等待 cancelable 注册取消监听
      cancelCall('cancel-pending-key');
      expect(isPending('cancel-pending-key')).toBe(true); // 落定前仍在途
      resolveFn('late');
      await expect(promise).rejects.toBeInstanceOf(CancelError);
      expect(isPending('cancel-pending-key')).toBe(false);
    });

    it('未知 key 返回 false', () => {
      const { isPending } = createAsyncDedupe();
      expect(isPending('nonexistent-key')).toBe(false);
    });
  });

  describe('cancelCall 功能', () => {
    it('cancelCall 应该拒绝进行中的去重调用（使用 CancelError）', async () => {
      const { asyncDedupe, cancelCall } = createAsyncDedupe();
      let resolveLater!: (value: string) => void;
      const pendingPromise = new Promise<string>(resolve => { resolveLater = resolve; });
      const func = vi.fn().mockReturnValue(pendingPromise);

      const promise = asyncDedupe('cancel-key', func);
      // 等待微任务，确保 execute 已注册 cancelCall 监听器
      await new Promise<void>(r => queueMicrotask(r));
      cancelCall('cancel-key');
      resolveLater('resolved');

      await expect(promise).rejects.toThrow('cancel-key async call canceled');
      await expect(promise).rejects.toBeInstanceOf(CancelError);
      expect(func).toHaveBeenCalledTimes(1);
    });

    it('cancelCall 应让同一 tick 加入的等待者同样收到 CancelError（无需等待监听器注册）', async () => {
      const { asyncDedupe, cancelCall } = createAsyncDedupe();
      const func = vi.fn();

      const p1 = asyncDedupe('waiter-key', func);
      // 不冲刷微任务：cancelCall 与执行者/等待者注册处于同一 tick（取消短路，func 不应启动）
      cancelCall('waiter-key');
      const p2 = asyncDedupe('waiter-key', func);

      await expect(p1).rejects.toBeInstanceOf(CancelError);
      await expect(p2).rejects.toBeInstanceOf(CancelError);
      expect(func).not.toHaveBeenCalled();
    });

    it('cancelCall 后相同 key 可以重新请求', async () => {
      const { asyncDedupe, cancelCall } = createAsyncDedupe();
      let resolveLater!: (value: string) => void;
      const pendingPromise = new Promise<string>(resolve => { resolveLater = resolve; });
      const func1 = vi.fn().mockReturnValue(pendingPromise);
      const func2 = vi.fn().mockResolvedValue('retry-ok');

      const p1 = asyncDedupe('retry-key', func1);
      await new Promise<void>(r => queueMicrotask(r));
      cancelCall('retry-key');
      resolveLater('resolved');
      await expect(p1).rejects.toBeInstanceOf(CancelError);
      await expect(p1).rejects.toThrow('retry-key async call canceled');
      expect(func1).toHaveBeenCalledTimes(1);

      const p2 = await asyncDedupe('retry-key', func2);
      expect(p2).toBe('retry-ok');
      expect(func2).toHaveBeenCalledTimes(1);
    });

    it('cancelCall 不存在 key 不应抛出异常', () => {
      const { cancelCall } = createAsyncDedupe();

      expect(() => cancelCall('nonexistent-key')).not.toThrow();
    });
  });
});
