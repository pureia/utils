import { describe, expect, it, vi } from 'vitest';
import { CancelError, createCancelable } from '@purea/utils';
import createCancelableDefault from '../../src/core/createCancelable';

describe('createCancelable', () => {
  describe('cancelable 基本执行', () => {
    // 每测试新建实例，避免 describe 层共享实例的隐藏耦合（同 key 监听器叠加/泄漏）
    it('应该正常执行异步函数并返回结果', async () => {
      const { cancelable } = createCancelable();
      const result = await cancelable('key1', () => Promise.resolve(42));
      expect(result).toBe(42);
    });

    it('同步返回非 Promise 值应拒绝 TypeError（仅支持异步函数）', async () => {
      const { cancelable } = createCancelable();
      // 类型层 lie：模拟非法调用方（JS 调用方或强转）
      const promise = cancelable('key1', () => 42 as unknown as Promise<number>);
      await expect(promise).rejects.toBeInstanceOf(TypeError);
      await expect(promise).rejects.toThrow('must return a Promise');
    });

    it('契约违规拒绝（非取消）不应触发 onCancel', async () => {
      const { cancelable } = createCancelable();
      const onCancel = vi.fn();
      const promise = cancelable('key1', () => undefined as unknown as Promise<number>, { onCancel });
      await expect(promise).rejects.toBeInstanceOf(TypeError);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('应该传播异步函数的拒绝', async () => {
      const { cancelable } = createCancelable();
      const error = new Error('test error');
      await expect(cancelable('key1', () => Promise.reject(error))).rejects.toBe(error);
    });

    it('工作函数同步抛错应传播原始错误', async () => {
      const { cancelable } = createCancelable();
      const error = new Error('sync-fail');
      await expect(cancelable('sync-throw', () => { throw error; })).rejects.toBe(error);
    });

    it('thenable（非原生 Promise）应拒绝 TypeError（仅支持原生 Promise）', async () => {
      const { cancelable } = createCancelable();
      // 契约只认原生 Promise：thenable 无论 then 是否可抛错，一律以 TypeError 拒绝
      const badGetter = Object.defineProperty({}, 'then', {
        get() { throw new Error('broken then getter'); },
      });
      await expect(cancelable('bad-getter', () => badGetter as any)).rejects.toBeInstanceOf(TypeError);
      await expect(cancelable('bad-getter', () => badGetter as any)).rejects.toThrow('must return a Promise');
      const badCall: any = { then: () => { throw new Error('broken then call'); } };
      await expect(cancelable('bad-call', () => badCall)).rejects.toBeInstanceOf(TypeError);
      await expect(cancelable('bad-call', () => badCall)).rejects.toThrow('must return a Promise');
    });

    it('异常 then（Proxy 包装的原生 Promise）应按落定失败拒绝原异常', async () => {
      const { cancelable } = createCancelable();
      const evil = new Proxy(Promise.resolve(1), {
        get(target, prop, receiver) {
          if (prop === 'then') throw new Error('broken then getter');
          return Reflect.get(target, prop, receiver);
        },
      });
      // instanceof Promise 通过（前缀），异常 then 在 result.then 处抛出 → settleReject 原异常
      await expect(cancelable('proxy-key', () => evil as any)).rejects.toThrow('broken then getter');
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

    it('取消与落定的微任务竞态窗：工作已产出值 → 取消作废、返回真实结果', async () => {
      const { cancelable: c, cancel } = createCancelable();
      let onCancelCalls = 0;
      const promise = c('race-key', () => Promise.resolve('ok'), { onCancel: () => { onCancelCalls++; } });
      // 同一 tick 内先发起工作，再排队 cancel 微任务（E1 窗口形态：cancel 在结算前到达）
      const racer = Promise.resolve().then(() => cancel('race-key'));

      const [r1, r2] = await Promise.allSettled([promise, racer]);
      expect(r1.status).toBe('fulfilled');
      expect((r1 as PromiseFulfilledResult<unknown>).value).toBe('ok');
      expect(r2.status).toBe('fulfilled');
      // 作废的取消不触发 onCancel（不再对已完成工作重复清理）
      expect(onCancelCalls).toBe(0);
      // 事后 cancel 为 no-op
      expect(cancel('race-key')).toBe(false);
    });

    it('同一 key 两次并发注册，cancel(key) 广播给全部（均为 CancelError）', async () => {
      const { cancelable: c, cancel } = createCancelable();
      const p1 = c('broadcast-key', () => new Promise(() => {}));
      const p2 = c('broadcast-key', () => new Promise(() => {}));

      expect(cancel('broadcast-key')).toBe(true);

      await expect(p1).rejects.toBeInstanceOf(CancelError);
      await expect(p2).rejects.toBeInstanceOf(CancelError);
    });

    it('default 导出应与命名导出指向同一实现', () => {
      expect(createCancelableDefault).toBe(createCancelable);
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

    it('同一 tick 内 cancel 后工作函数不应启动（副作用不发生）', async () => {
      const { cancelable: c, cancel } = createCancelable();
      const fn = vi.fn(() => Promise.resolve('result'));

      const promise = c('pre-cancel', fn);
      cancel('pre-cancel');

      await expect(promise).rejects.toBeInstanceOf(CancelError);
      expect(fn).not.toHaveBeenCalled();
    });

    it('工作函数启动后 cancel 不阻止其继续执行（副作用仍跑完）', async () => {
      const { cancelable: c, cancel } = createCancelable();
      let resolveLater!: (v: string) => void;
      const fn = vi.fn(() => new Promise<string>((resolve) => { resolveLater = resolve; }));

      const promise = c('mid-cancel', fn);
      await new Promise<void>((resolve) => { queueMicrotask(resolve); }); // 冲刷微任务：工作函数已启动
      expect(fn).toHaveBeenCalledTimes(1);

      cancel('mid-cancel');
      resolveLater('done');

      await expect(promise).rejects.toBeInstanceOf(CancelError);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('onCancel 回调', () => {
    it('cancel 时应触发 onCancel 回调', async () => {
      const { cancelable: c, cancel } = createCancelable();
      const onCancel = vi.fn();
      const neverResolving = new Promise(() => {});

      const promise = c('key', () => neverResolving, { onCancel });
      cancel('key');

      await expect(promise).rejects.toBeInstanceOf(CancelError);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('正常完成时不应触发 onCancel', async () => {
      const { cancelable: c } = createCancelable();
      const onCancel = vi.fn();

      await c('key', () => Promise.resolve('ok'), { onCancel });

      expect(onCancel).not.toHaveBeenCalled();
    });

    it('异步函数失败时不应触发 onCancel', async () => {
      const { cancelable: c } = createCancelable();
      const onCancel = vi.fn();
      const error = new Error('fail');

      await expect(c('key', () => Promise.reject(error), { onCancel })).rejects.toBe(error);
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

    it('同 key 多并发 + cancel + 工作晚 reject：settle 卫语句生效（取消已胜出，拒绝被短路）', async () => {
      const { cancelable: c, cancel } = createCancelable();
      const rejecters: Array<(e: unknown) => void> = [];
      const work = () => new Promise<string>((_resolve, reject) => { rejecters.push(reject); });
      const p1 = c('multi-key', work);
      const p2 = c('multi-key', work); // 同 key 并发注册：cancel 广播到两个执行
      // 冲刷微任务：让两个启动微任务 M1 运行（工作函数启动、result.then 已注册）
      await Promise.resolve();
      cancel('multi-key');
      // 两个调用均应收到 CancelError
      await expect(p1).rejects.toBeInstanceOf(CancelError);
      await expect(p2).rejects.toBeInstanceOf(CancelError);
      // 工作晚 reject：取消裁决微任务先落位（state='settled'），随后 settleReject 被卫语句短路
      rejecters.forEach((reject) => reject(new Error('late failure')));
      // 冲刷微任务链：确认无未处理拒绝/无异常
      await Promise.resolve();
      await Promise.resolve();
    });

    it('未注册的 key 应为 false', () => {
      const { isPending } = createCancelable();
      expect(isPending('nope')).toBe(false);
    });
  });
});
