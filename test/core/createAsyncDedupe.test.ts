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

    it('应该正确传递异步函数的参数', async () => {
      const asyncFunc = vi.fn().mockResolvedValue({ id: 1, name: 'test' });

      const result = await dedupe('user-1', asyncFunc);

      expect(result).toEqual({ id: 1, name: 'test' });
    });
  });

  describe('返回值', () => {
    it('应该返回包含 asyncDedupe 和 cancelCall 的对象', () => {
      const { asyncDedupe, cancelCall } = createAsyncDedupe();

      expect(typeof asyncDedupe).toBe('function');
      expect(typeof cancelCall).toBe('function');
    });

    it('请求完成后相同 key 可以重新执行（验证内部状态已清理）', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      let callCount = 0;
      const asyncFunc = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(`result-${callCount}`);
      });

      const r1 = await dedupe('status-key', asyncFunc);
      expect(r1).toBe('result-1');
      expect(callCount).toBe(1);

      // 请求完成后，相同 key 可以重新执行（内部状态已清理）
      const r2 = await dedupe('status-key', asyncFunc);
      expect(r2).toBe('result-2');
      expect(callCount).toBe(2);
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

    it('相同 key 的调用应该共享相同的 Promise 结果', async () => {
      const asyncFunc = vi.fn().mockResolvedValue('shared');

      const [r1, r2, r3] = await Promise.all([
        dedupe('shared-key', asyncFunc),
        dedupe('shared-key', asyncFunc),
        dedupe('shared-key', asyncFunc),
      ]);

      expect(r1).toBe('shared');
      expect(r2).toBe('shared');
      expect(r3).toBe('shared');
      expect(asyncFunc).toHaveBeenCalledTimes(1);
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

    it('去重应该节省总执行时间（单次执行耗时，而非并发叠加）', async () => {
      // 假计时器：毫秒阈值断言在慢 CI 上易抖动，改为确定性推进
      vi.useFakeTimers();
      const asyncFunc = vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100, 'done')));

      const promises = [
        dedupe('timing-key', asyncFunc),
        dedupe('timing-key', asyncFunc),
        dedupe('timing-key', asyncFunc),
      ];
      // 推进恰好一个执行周期（100ms）：整组应同时落定，而非每个调用各等 100ms
      await vi.advanceTimersByTimeAsync(100);

      const results = await Promise.all(promises);
      expect(results).toEqual(['done', 'done', 'done']);
      expect(asyncFunc).toHaveBeenCalledTimes(1);
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

    it('相同 key 失败后重新调用应该重新执行', async () => {
      let callCount = 0;
      const asyncFunc = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error('first fail');
        return Promise.resolve('success');
      });

      await expect(dedupe('retry-after-fail', asyncFunc)).rejects.toThrow('first fail');

      const result = await dedupe('retry-after-fail', asyncFunc);
      expect(result).toBe('success');
      expect(callCount).toBe(2);
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

    it('asyncFunc 返回 rejected promise 时应该正确传播', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      const asyncError = new Error('async rejected');
      const asyncFunc = vi.fn().mockRejectedValue(asyncError);

      await expect(dedupe('async-reject-key', asyncFunc)).rejects.toThrow('async rejected');
    });

    it('asyncFunc 中访问不存在的属性导致的同步错误', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      const asyncFunc = vi.fn().mockImplementation(() => {
        const obj: any = null;
        return Promise.resolve(obj.nonexistentProperty);
      });

      await expect(dedupe('property-access-key', asyncFunc)).rejects.toThrow();
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

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(func).toHaveBeenCalledTimes(1);

      resolvePending!('resolved');

      const [r1, r2] = await Promise.all([promise1, promise2]);
      expect(r1).toBe('resolved');
      expect(r2).toBe('resolved');
    });
  });

  describe('边界情况和极端场景', () => {
    it('asyncFunc 返回 thenable 对象（非 Promise）', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      const thenable = {
        then: (onFulfilled: (v: string) => void) => {
          queueMicrotask(() => onFulfilled('thenable-result'));
        },
      };
      const asyncFunc = vi.fn().mockReturnValue(thenable);

      const result = await dedupe('thenable-key', asyncFunc);
      expect(result).toBe('thenable-result');
    });

    it('并发调用时 asyncFunc 参数被正确忽略（只执行第一个）', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      const func1 = vi.fn().mockResolvedValue('func1-result');
      const func2 = vi.fn().mockResolvedValue('func2-result');
      const func3 = vi.fn().mockResolvedValue('func3-result');

      const [r1, r2, r3] = await Promise.all([
        dedupe('multi-func-key', func1),
        dedupe('multi-func-key', func2),
        dedupe('multi-func-key', func3),
      ]);

      expect(func1).toHaveBeenCalledTimes(1);
      expect(func2).toHaveBeenCalledTimes(0);
      expect(func3).toHaveBeenCalledTimes(0);

      expect(r1).toBe('func1-result');
      expect(r2).toBe('func1-result');
      expect(r3).toBe('func1-result');
    });

    it('不同 key 的失败不应该影响其他 key 的 pending 请求', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      const failFunc = vi.fn().mockRejectedValue(new Error('fail'));
      const successFunc = vi.fn().mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 50, 'success'))
      );

      const promiseFail = dedupe('fail-key', failFunc);
      const promiseSuccess = dedupe('success-key', successFunc);

      await expect(promiseFail).rejects.toThrow('fail');
      const result = await promiseSuccess;
      expect(result).toBe('success');
    });

    it('使用 Symbol 作为 key', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      const symKey = Symbol('test-symbol');
      const func = vi.fn().mockResolvedValue('symbol-result');

      // @ts-expect-error - 测试 Symbol 作为 key 的行为
      const result = await dedupe(symKey, func);
      expect(result).toBe('symbol-result');
    });

    it('使用数字作为 key', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      const func = vi.fn().mockResolvedValue('number-result');

      const result = await dedupe(123 as any, func);
      expect(result).toBe('number-result');
    });

    it('极长的 key 字符串', async () => {
      const { asyncDedupe: dedupe } = createAsyncDedupe();
      const longKey = 'a'.repeat(10000);
      const func = vi.fn().mockResolvedValue('long-key-result');

      const result = await dedupe(longKey, func);
      expect(result).toBe('long-key-result');
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

    it('cancelCall 某个 key 不应影响其他 key', async () => {
      const { asyncDedupe, cancelCall } = createAsyncDedupe();
      let resolveA!: (value: string) => void;
      const pendingA = new Promise<string>(resolve => { resolveA = resolve; });
      const funcA = vi.fn().mockReturnValue(pendingA);
      const funcB = vi.fn().mockResolvedValue('result-b');

      const pA = asyncDedupe('key-a', funcA);
      const pB = asyncDedupe('key-b', funcB);

      await new Promise<void>(r => queueMicrotask(r));
      cancelCall('key-a');
      resolveA('resolved');
      await expect(pA).rejects.toBeInstanceOf(CancelError);
      await expect(pA).rejects.toThrow('key-a async call canceled');

      const resultB = await pB;
      expect(resultB).toBe('result-b');
    });

    it('cancelCall 不存在的 key 不应抛出异常', () => {
      const { cancelCall } = createAsyncDedupe();

      expect(() => cancelCall('nonexistent-key')).not.toThrow();
    });
  });

  describe('cancelError 类', () => {
    it('应该正确导出 CancelError', () => {
      expect(CancelError).toBeDefined();
      expect(typeof CancelError).toBe('function');
    });

    it('应该是 Error 的子类', () => {
      const err = new CancelError('test');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(CancelError);
    });

    it('应该设置正确的 name 和 message', () => {
      const err = new CancelError('my-key');
      expect(err.name).toBe('CancelError');
      expect(err.message).toBe('my-key async call canceled');
    });
  });
});
