import { describe, expect, it, vi } from 'vitest';
import { CancelError, createCancelable } from '@purea/utils';

describe('createCancelable', () => {
  const { cancelable } = createCancelable();

  describe('cancelable 基本执行', () => {
    it('应该正常执行异步函数并返回结果', async () => {
      const result = await cancelable('key1', () => Promise.resolve(42));
      expect(result).toBe(42);
    });

    it('应该正常执行同步函数并返回结果', async () => {
      const result = await cancelable('key1', () => 42);
      expect(result).toBe(42);
    });

    it('应该传播异步函数的拒绝', async () => {
      const error = new Error('test error');
      await expect(cancelable('key1', () => Promise.reject(error))).rejects.toBe(error);
    });
  });

  describe('cancel 取消执行', () => {
    it('cancel 应该拒绝进行中的 cancelable 并抛出 CancelError', async () => {
      const { cancelable: c, cancel } = createCancelable();
      // 创建一个永不 resolve 的 Promise，确保 pending 状态
      const neverResolving = new Promise(() => {});
      const promise = c('key', () => neverResolving);

      cancel('key');

      await expect(promise).rejects.toBeInstanceOf(CancelError);
      await expect(promise).rejects.toThrow('key async call canceled');
    });

    it('cancel 已完成的操作不应产生副作用', async () => {
      const { cancelable: c, cancel } = createCancelable();
      const promise = c('key', () => Promise.resolve('done'));
      const result = await promise;

      // 完成后 cancel 应该不抛错
      expect(() => cancel('key')).not.toThrow();
      expect(result).toBe('done');
    });

    it('多次 cancel 同一个 key 不应抛错', async () => {
      const { cancelable: c, cancel } = createCancelable();
      const neverResolving = new Promise(() => {});
      const promise = c('key', () => neverResolving);

      cancel('key');
      // 第二次 cancel 不应抛错（once 监听器已被移除）
      expect(() => cancel('key')).not.toThrow();

      await expect(promise).rejects.toBeInstanceOf(CancelError);
    });

    it('cancel 已注册 key 应拒绝其 pending 调用', async () => {
      const { cancelable: c, cancel } = createCancelable();
      const neverResolving = new Promise(() => {});
      const p1 = c('key-a', () => neverResolving);

      cancel('key-a');

      await expect(p1).rejects.toBeInstanceOf(CancelError);
    });
  });

  describe('onCancel 回调', () => {
    it('cancel 时应触发 onCancel 回调', async () => {
      const { cancelable: c, cancel } = createCancelable();
      const onCancel = vi.fn();
      const neverResolving = new Promise(() => {});

      const promise = c('key', () => neverResolving, onCancel);
      cancel('key');

      await expect(promise).rejects.toBeInstanceOf(CancelError);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('正常完成时不应触发 onCancel', async () => {
      const { cancelable: c } = createCancelable();
      const onCancel = vi.fn();

      await c('key', () => Promise.resolve('ok'), onCancel);

      expect(onCancel).not.toHaveBeenCalled();
    });

    it('异步函数失败时不应触发 onCancel', async () => {
      const { cancelable: c } = createCancelable();
      const onCancel = vi.fn();
      const error = new Error('fail');

      await expect(c('key', () => Promise.reject(error), onCancel)).rejects.toBe(error);
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe('cancelError', () => {
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

  describe('isPending 状态查询', () => {
    it('执行期间应为 true', () => {
      const { cancelable: c, isPending } = createCancelable();
      expect(isPending('key')).toBe(false);

      c('key', () => new Promise<void>(() => {}));
      expect(isPending('key')).toBe(true);
    });

    it('执行完成后应为 false', async () => {
      const { cancelable: c, isPending } = createCancelable();
      const promise = c('key', () => Promise.resolve('done'));

      await promise;
      // finally(off) 在结果落定后的链上执行，冲刷一次微任务后断言
      await Promise.resolve();
      expect(isPending('key')).toBe(false);
    });

    it('取消后应为 false', async () => {
      const { cancelable: c, cancel, isPending } = createCancelable();
      const promise = c('key', () => new Promise<void>(() => {}));

      cancel('key');
      // once 监听触发即自清理
      expect(isPending('key')).toBe(false);
      await expect(promise).rejects.toBeInstanceOf(CancelError);
    });

    it('未注册的 key 应为 false', () => {
      const { isPending } = createCancelable();
      expect(isPending('nope')).toBe(false);
    });
  });
});
