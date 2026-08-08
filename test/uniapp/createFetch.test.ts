import type { BaseRequestConfig } from '@purea/utils';
import { merge } from '@purea/utils/lodash';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFetch as _createFetch, CancelError, FetchCode } from '@purea/utils';

const mockUniRequest = vi.fn();

vi.stubGlobal('uni', {
  request: mockUniRequest,
});

function getOriginalRequestConfig<C extends Record<string, any>>(otherConfig?: C) {
  const baseConfig: BaseRequestConfig = {
    host: 'https://api.example.com',
    header: { 'Content-Type': 'application/json' },
    timeout: 10000,
    method: 'GET',
    isDedup: false,
  };
  return merge(baseConfig, otherConfig);
}

function createFetch<T extends Record<string, any>>(overrides?: T) {
  return _createFetch(() => getOriginalRequestConfig(overrides));
}

function mockSuccessResponse(data: any, statusCode = 200, errMsg = 'request:ok', extras?: Record<string, any>) {
  mockUniRequest.mockImplementation(({ complete }) => {
    complete({
      data,
      statusCode,
      errMsg,
      cookies: [],
      header: { 'X-Custom': 'value' },
      ...extras,
    });
  });
}

beforeEach(() => {
  mockUniRequest.mockReset();
});

afterEach(() => {
  mockUniRequest.mockReset();
});

describe('createFetch', () => {
  describe('request', () => {
    it('应该发送请求并返回完整的响应结果', async () => {
      mockSuccessResponse({ id: 1, name: 'test' });

      const fetch = createFetch();
      const result = await fetch.request({ url: '/users/1', method: 'GET' });

      expect(result.code).toBe(200);
      expect(result.data).toEqual({ id: 1, name: 'test' });
      expect(result.msg).toBe('OK');
      expect(result.cookies).toEqual([]);
      expect(result.header).toEqual({ 'X-Custom': 'value' });
    });

    it('successStatusCodes 配置为 [200, 201] 时 201 应视为成功', async () => {
      mockSuccessResponse({ id: 1 }, 201);

      const fetch = createFetch({ successStatusCodes: [200, 201] });
      const result = await fetch.request({ url: '/users', method: 'POST' });

      expect(result.ok).toBe(true);
      expect(result.code).toBe(201);
      expect(result.data).toEqual({ id: 1 });
    });

    it('默认 successStatusCodes 为 [200] 时 204 应视为失败', async () => {
      mockSuccessResponse(null, 204);

      const fetch = createFetch();
      const result = await fetch.request({ url: '/users', method: 'GET' });

      expect(result.ok).toBe(false);
      expect(result.code).toBe(204);
      expect(result.msg).toBe('No Content');
    });

    it('应该正确拼接 host 和 url', async () => {
      mockSuccessResponse({});

      const fetch = createFetch();
      await fetch.request({ url: '/users/1', method: 'GET' });

      expect(mockUniRequest).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://api.example.com/users/1' })
      );
    });

    it('应该传递请求参数到 uni.request', async () => {
      mockSuccessResponse({ id: 2 }, 201);

      const fetch = createFetch();
      await fetch.post({ url: '/users', data: { name: 'new user' } });

      expect(mockUniRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          header: { 'Content-Type': 'application/json' },
          timeout: 10000,
          data: { name: 'new user' },
        })
      );
    });
  });

  describe('请求方法简写', () => {
    it('get 方法应该设置 method 为 GET', async () => {
      mockSuccessResponse([]);

      const fetch = createFetch();
      await fetch.get({ url: '/users' });

      expect(mockUniRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('post 方法应该设置 method 为 POST', async () => {
      mockSuccessResponse({ id: 1 });

      const fetch = createFetch();
      await fetch.post({ url: '/users', data: { name: 'test' } });

      expect(mockUniRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('put 方法应该设置 method 为 PUT', async () => {
      mockSuccessResponse({ id: 1 });

      const fetch = createFetch();
      await fetch.put({ url: '/users/1', data: { name: 'updated' } });

      expect(mockUniRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('delete 方法应该设置 method 为 DELETE', async () => {
      mockSuccessResponse(null);

      const fetch = createFetch();
      await fetch.delete({ url: '/users/1' });

      expect(mockUniRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('配置合并', () => {
    it('应该将基础配置和请求配置合并', async () => {
      mockSuccessResponse([]);

      const fetch = createFetch();
      await fetch.get({ url: '/users', header: { 'X-Extra': 'value' } });

      expect(mockUniRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://api.example.com/users',
          method: 'GET',
          header: { 'Content-Type': 'application/json', 'X-Extra': 'value' },
          timeout: 10000,
        })
      );
    });

    it('请求配置应该覆盖基础配置', async () => {
      mockSuccessResponse({});

      const fetch = createFetch();
      await fetch.request({ url: '/users', method: 'GET', timeout: 5000 });

      expect(mockUniRequest).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 5000 })
      );
    });

    it('应该在响应结果中保留 originalRequestConfig', async () => {
      mockSuccessResponse({});

      const fetch = createFetch();
      const requestConfig = { url: '/users', method: 'GET' as const };
      const result = await fetch.request(requestConfig);

      expect(result.requestConfig.rawRequestConfig).toEqual(requestConfig);
    });
  });

  describe('请求拦截器', () => {
    it('应该在发送请求前执行请求拦截器', async () => {
      mockSuccessResponse({});

      const fetch = createFetch();
      fetch.interceptors.request.use((config) => {
        config.header = { ...config.header, Authorization: 'Bearer token' };
        return config;
      });

      await fetch.request({ url: '/users', method: 'GET' });

      expect(mockUniRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          header: { 'Content-Type': 'application/json', 'Authorization': 'Bearer token' },
        })
      );
    });

    it('请求拦截器应该支持多个', async () => {
      mockSuccessResponse({});

      const fetch = createFetch();
      fetch.interceptors.request.use((config) => {
        config.header = { ...config.header, Authorization: 'Bearer token' };
        return config;
      });
      fetch.interceptors.request.use((config) => {
        config.header = { ...config.header, 'X-Custom': 'custom-value' };
        return config;
      });

      await fetch.request({ url: '/users', method: 'GET' });

      expect(mockUniRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          header: expect.objectContaining({
            'Authorization': 'Bearer token',
            'X-Custom': 'custom-value',
          }),
        })
      );
    });

    it('请求拦截器 fulfilled 抛错且无 rejected 时应归一化为拦截器错误', async () => {
      const fetch = createFetch();
      fetch.interceptors.request.use(() => {
        throw new Error('interceptor error');
      });

      const result = await fetch.request({ url: '/users', method: 'GET' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(FetchCode.INTERCEPTOR);
      expect(result.msg).toBe('interceptor error');
      expect(result.data).toBeNull();
      if (!result.ok) expect(result.error).toBeInstanceOf(Error);
    });

    it('请求拦截器 rejected 返回 truthy 恢复值时应继续链路并发出请求', async () => {
      mockSuccessResponse({ recovered: true });

      const fetch = createFetch();
      const fallbackConfig = {
        url: '/fallback',
        method: 'GET' as const,
        host: 'https://api.example.com',
        rawRequestConfig: { url: '/fallback', method: 'GET' as const },
        header: { 'Content-Type': 'application/json' },
        timeout: 10000,
      };

      fetch.interceptors.request.use(
        () => { throw new Error('config error'); },
        (() => fallbackConfig) as any
      );

      const result = await fetch.request({ url: '/users', method: 'GET' });
      expect(mockUniRequest).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://api.example.com/fallback' })
      );
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ recovered: true });
    });

    it('请求拦截器 rejected 返回 falsy 值时错误成立并归一化', async () => {
      const fetch = createFetch();

      fetch.interceptors.request.use(
        () => { throw new Error('original error'); },
        (() => null) as any
      );

      const result = await fetch.request({ url: '/users', method: 'GET' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(FetchCode.INTERCEPTOR);
      expect(result.msg).toBe('original error');
    });

    it('请求拦截器应该支持 async fulfilled', async () => {
      mockSuccessResponse({});

      const fetch = createFetch();
      fetch.interceptors.request.use(async (config) => {
        config.header = { ...config.header, Authorization: 'async-token' };
        return config;
      });

      await fetch.request({ url: '/users', method: 'GET' });

      expect(mockUniRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          header: expect.objectContaining({ Authorization: 'async-token' }),
        })
      );
    });
  });

  describe('响应拦截器', () => {
    it('应该在收到响应后执行响应拦截器', async () => {
      mockSuccessResponse({ id: 1 });

      const fetch = createFetch();
      fetch.interceptors.response.use((response) => {
        response.data = { ...response.data, processed: true };
        return response;
      });

      const result = await fetch.request({ url: '/users/1', method: 'GET' });

      expect(result.data).toEqual({ id: 1, processed: true });
    });

    it('响应拦截器应该支持多个', async () => {
      mockSuccessResponse({ id: 1 });

      const fetch = createFetch();
      fetch.interceptors.response.use((response) => {
        response.data = { ...response.data, step1: true };
        return response;
      });
      fetch.interceptors.response.use((response) => {
        response.data = { ...response.data, step2: true };
        return response;
      });

      const result = await fetch.request({ url: '/users/1', method: 'GET' });

      expect(result.data).toEqual({ id: 1, step1: true, step2: true });
    });

    it('响应拦截器 fulfilled 抛错且无 rejected 时应归一化并保留响应现场', async () => {
      mockSuccessResponse({ error: 'unauthorized' }, 401);

      const fetch = createFetch();
      fetch.interceptors.response.use((response) => {
        if (response.code === 401) throw new Error('Unauthorized');
        return response;
      });

      const result = await fetch.request({ url: '/users', method: 'GET' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(FetchCode.INTERCEPTOR);
      expect(result.msg).toBe('Unauthorized');
      expect(result.data).toEqual({ error: 'unauthorized' });
      if (!result.ok) expect(result.error).toBeInstanceOf(Error);
    });

    it('响应拦截器抛业务对象时 msg 应提取其 message/msg 字段而非 Unknown Error', async () => {
      mockSuccessResponse({ code: 50001, msg: '余额不足' });

      const fetch = createFetch();
      fetch.interceptors.response.use(() => {
        // 业务方常以字面量对象抛错，此处故意验证该路径
        // eslint-disable-next-line no-throw-literal
        throw { code: 50001, msg: '余额不足' };
      });

      const result = await fetch.request({ url: '/users', method: 'GET' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(FetchCode.INTERCEPTOR);
      expect(result.msg).toBe('余额不足');
    });

    it('响应拦截器 rejected 返回 truthy 恢复值时应继续链路', async () => {
      mockSuccessResponse({ id: 1 });

      const fetch = createFetch();
      const fallbackResponse = {
        ok: true,
        msg: 'recovered',
        code: 200,
        data: { fallback: true },
        cookies: [],
        header: {},
        requestConfig: {
          url: '/fallback',
          method: 'GET' as const,
          host: 'https://api.example.com',
          rawRequestConfig: { url: '/fallback', method: 'GET' as const },
        },
      };

      fetch.interceptors.response.use(
        () => { throw new Error('response error'); },
        (() => fallbackResponse) as any
      );

      const result = await fetch.request({ url: '/users', method: 'GET' });
      expect(result).toEqual(fallbackResponse);
    });

    it('响应拦截器 rejected 返回 falsy 值时错误成立并归一化', async () => {
      mockSuccessResponse({ id: 1 });

      const fetch = createFetch();
      fetch.interceptors.response.use(
        () => { throw new Error('response error'); },
        (() => null) as any
      );

      const result = await fetch.request({ url: '/users', method: 'GET' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(FetchCode.INTERCEPTOR);
      expect(result.msg).toBe('response error');
      expect(result.data).toEqual({ id: 1 });
    });

    it('响应拦截器应该支持 async fulfilled', async () => {
      mockSuccessResponse({ id: 1 });

      const fetch = createFetch();
      fetch.interceptors.response.use(async (response) => {
        response.data = { ...response.data, asyncProcessed: true };
        return response;
      });

      const result = await fetch.request({ url: '/users/1', method: 'GET' });

      expect(result.data).toEqual({ id: 1, asyncProcessed: true });
    });
  });

  describe('错误处理', () => {
    it('应该正确处理请求失败的情况', async () => {
      mockUniRequest.mockImplementation(({ complete }) => {
        complete({
          data: null,
          statusCode: 500,
          errMsg: 'request:fail',
          cookies: [],
          header: {},
        });
      });

      const fetch = createFetch();
      const result = await fetch.request({ url: '/error', method: 'GET' });

      expect(result.code).toBe(500);
      expect(result.msg).toBe('Internal Server Error');
    });

    it('未收录的 HTTP 状态码（如 599）应回退为 "HTTP 599" 形式的描述', async () => {
      mockUniRequest.mockImplementation(({ complete }) => {
        complete({
          data: null,
          statusCode: 599,
          errMsg: 'request:fail',
          cookies: [],
          header: {},
        });
      });

      const fetch = createFetch();
      const result = await fetch.request({ url: '/custom-error', method: 'GET' });

      expect(result.code).toBe(599);
      expect(result.msg).toBe('HTTP 599');
    });

    it('statusCode 为 undefined 且 errMsg 为 request:fail abort 时应返回 code=-1, msg=Request Abort', async () => {
      mockUniRequest.mockImplementation(({ complete }) => {
        complete({ data: null, statusCode: undefined as any, errMsg: 'request:fail abort' });
      });

      const fetch = createFetch();
      const result = await fetch.request({ url: '/abort', method: 'GET' });

      expect(result.code).toBe(-1);
      expect(result.msg).toBe('Request Abort');
    });

    it('statusCode 为 undefined 且 errMsg 为 request:fail timeout 时应返回 code=-2, msg=Request Timeout', async () => {
      mockUniRequest.mockImplementation(({ complete }) => {
        complete({ data: null, statusCode: undefined as any, errMsg: 'request:fail timeout' });
      });

      const fetch = createFetch();
      const result = await fetch.request({ url: '/timeout', method: 'GET' });

      expect(result.code).toBe(-2);
      expect(result.msg).toBe('Request Timeout');
    });

    it('statusCode 为 undefined 且 errMsg 非 abort/timeout 时应返回 code=-3', async () => {
      mockUniRequest.mockImplementation(({ complete }) => {
        complete({ data: null, statusCode: undefined as any, errMsg: 'request:fail other' });
      });

      const fetch = createFetch();
      const result = await fetch.request({ url: '/other-error', method: 'GET' });

      expect(result.code).toBe(-3);
      expect(result.msg).toBe('request:fail other');
    });

    it('statusCode 为 null 时应返回 code=-3', async () => {
      mockUniRequest.mockImplementation(({ complete }) => {
        complete({ data: null, statusCode: null as any, errMsg: 'request:fail' });
      });

      const fetch = createFetch();
      const result = await fetch.request({ url: '/error', method: 'GET' });

      expect(result.code).toBe(-3);
    });

    it('errMsg 为 undefined 时 msg 应使用 HTTP 状态码描述', async () => {
      mockUniRequest.mockImplementation(({ complete }) => {
        complete({ data: null, statusCode: 200, errMsg: undefined as any });
      });

      const fetch = createFetch();
      const result = await fetch.request({ url: '/test', method: 'GET' });

      expect(result.msg).toBe('OK');
    });

    it('header 为 undefined 时 header 应为空对象', async () => {
      mockUniRequest.mockImplementation(({ complete }) => {
        complete({ data: null, statusCode: 200, errMsg: 'ok', header: undefined as any, cookies: undefined as any });
      });

      const fetch = createFetch();
      const result = await fetch.request({ url: '/test', method: 'GET' });

      expect(result.header).toEqual({});
      expect(result.cookies).toEqual([]);
    });
  });

  describe('拦截器管理', () => {
    it('interceptors.request.use 应该返回递增的索引', () => {
      const fetch = createFetch();

      expect(fetch.interceptors.request.use((config) => config)).toBe(0);
      expect(fetch.interceptors.request.use((config) => config)).toBe(1);
    });

    it('interceptors.response.use 应该返回递增的索引', () => {
      const fetch = createFetch();

      expect(fetch.interceptors.response.use((response) => response)).toBe(0);
      expect(fetch.interceptors.response.use((response) => response)).toBe(1);
    });
  });

  describe('请求取消 (abort)', () => {
    it('abort(key) 应归一化为中止结果并调用底层 requestTask.abort()', async () => {
      const mockRequestTask = { abort: vi.fn() };
      mockUniRequest.mockReturnValue(mockRequestTask);
      // 不调用 complete，模拟请求进行中

      const fetch = createFetch();
      const requestPromise = fetch.request({ url: '/users', method: 'GET', key: 'cancel-test' });

      fetch.abort('cancel-test');

      const result = await requestPromise;
      expect(result.ok).toBe(false);
      expect(result.code).toBe(FetchCode.ABORT);
      expect(result.msg).toBe('Request Abort');
      expect(mockRequestTask.abort).toHaveBeenCalled();
    });

    it('没有 key 的请求不受 abort 影响', async () => {
      mockSuccessResponse({ id: 1 });

      const fetch = createFetch();
      const result = await fetch.request({ url: '/users', method: 'GET' });

      expect(result.data).toEqual({ id: 1 });
      // abort 无 key 的请求不应抛出或影响已完成请求
      expect(() => fetch.abort('non-existent')).not.toThrow();
    });

    it('abort 无对应 key 的请求不应影响其他请求', async () => {
      const mockRequestTask = { abort: vi.fn() };
      mockUniRequest.mockReturnValue(mockRequestTask);

      const fetch = createFetch();
      const req1 = fetch.request({ url: '/users/1', method: 'GET', key: 'req-1' });
      fetch.request({ url: '/users/2', method: 'GET', key: 'req-2' });

      fetch.abort('req-1');

      const result1 = await req1;
      expect(result1.code).toBe(FetchCode.ABORT);
      // req-2 不应被取消
      expect(mockRequestTask.abort).toHaveBeenCalledTimes(1);
      // 两个请求都已被发起
      expect(mockUniRequest).toHaveBeenCalledTimes(2);
    });

    it('cancelError 应该具有正确的 name 属性', () => {
      const error = new CancelError('test-key');
      expect(error.name).toBe('CancelError');
      expect(error.message).toBe('test-key async call canceled');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('拦截器取消', () => {
    it('请求拦截器期间 abort 应归一化为中止结果', async () => {
      mockUniRequest.mockReturnValue({ abort: vi.fn() });

      const fetch = createFetch();
      fetch.interceptors.request.use(async (config) => {
        // 模拟异步操作，给 abort 留出触发时机
        await new Promise(r => setTimeout(r, 100));
        return config;
      });

      const requestPromise = fetch.request({ url: '/users', method: 'GET', key: 'ix-cancel' });
      // 让出控制权，等待请求拦截器注册 cancelable 的 once 监听器
      await new Promise(r => setTimeout(r, 0));
      fetch.abort('ix-cancel');

      const result = await requestPromise;
      expect(result.ok).toBe(false);
      expect(result.code).toBe(FetchCode.ABORT);
      expect(result.msg).toBe('Request Abort');
      // 拦截器被取消后，不应到达 dispatchRequest
      expect(mockUniRequest).not.toHaveBeenCalled();
    });

    it('响应拦截器期间 abort 应归一化为中止结果', async () => {
      mockUniRequest.mockImplementation(({ complete }) => {
        complete({ data: { id: 1 }, statusCode: 200, errMsg: 'ok' });
      });

      const fetch = createFetch();
      fetch.interceptors.response.use(async (response) => {
        await new Promise(r => setTimeout(r, 100));
        return response;
      });

      const requestPromise = fetch.request({ url: '/users', method: 'GET', key: 'rx-cancel' });
      // 让出控制权，等待响应拦截器注册 cancelable 的 once 监听器
      await new Promise(r => setTimeout(r, 0));
      fetch.abort('rx-cancel');

      const result = await requestPromise;
      expect(result.ok).toBe(false);
      expect(result.code).toBe(FetchCode.ABORT);
      expect(result.msg).toBe('Request Abort');
    });
  });

  describe('请求去重 (isDedup)', () => {
    it('isDedup 为 false 时应该直接发送请求', async () => {
      mockSuccessResponse({});

      const fetch = createFetch({ isDedup: false });
      await fetch.request({ url: '/users', method: 'GET' });

      expect(mockUniRequest).toHaveBeenCalledTimes(1);
    });

    it('isDedup 为 true 时相同请求应该去重', async () => {
      mockSuccessResponse({ result: 'debounced' });

      const fetch = createFetch({ isDedup: true });
      const [r1, r2] = await Promise.all([
        fetch.request({ url: '/users', method: 'GET' }),
        fetch.request({ url: '/users', method: 'GET' }),
      ]);

      expect(mockUniRequest).toHaveBeenCalledTimes(1);
      expect(r1.data).toEqual({ result: 'debounced' });
      expect(r2.data).toEqual({ result: 'debounced' });
    });

    it('isDedup 为 true 时不同请求应独立执行', async () => {
      mockSuccessResponse({});

      const fetch = createFetch({ isDedup: true });
      await Promise.all([
        fetch.request({ url: '/users/1', method: 'GET' }),
        fetch.request({ url: '/users/2', method: 'GET' }),
      ]);

      expect(mockUniRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('aDR 0003 修复回归', () => {
    describe('决策 1 合并语义：header 深合并、其余字段浅覆盖', () => {
      it('请求配置 successStatusCodes 应整体覆盖基础配置（数组按引用替换）', async () => {
        mockSuccessResponse({ id: 1 }, 201);

        // 基础配置声明 200/201 为成功
        const fetch = createFetch({ successStatusCodes: [200, 201] });
        // 请求配置覆盖为仅 200 成功：201 不再视为成功
        const result = await fetch.request({ url: '/users', method: 'GET', successStatusCodes: [200] });

        expect(result.ok).toBe(false);
        expect(result.code).toBe(201);
      });

      it('header 深合并仍按字段叠加', async () => {
        mockSuccessResponse({});

        const fetch = createFetch();
        await fetch.get({ url: '/users', header: { 'X-Extra': 'value' } });

        expect(mockUniRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            header: { 'Content-Type': 'application/json', 'X-Extra': 'value' },
          })
        );
      });

      it('基础配置含 data 时请求配置 data 应整体覆盖而非深合并', async () => {
        mockSuccessResponse({});

        const fetch = _createFetch<BaseRequestConfig & { data: any }>(() => ({
          host: 'https://api.example.com',
          header: {},
          timeout: 10000,
          method: 'GET' as const,
          isDedup: false,
          data: { a: 1, nested: { x: 1 } },
        }));

        await fetch.request({ url: '/users', method: 'GET', data: { a: 2 } });

        expect(mockUniRequest).toHaveBeenCalledWith(
          expect.objectContaining({ data: { a: 2 } })
        );
      });
    });

    describe('决策 2 同步阶段兜底：永不同步 throw', () => {
      it('isDedup 时 data 含循环引用应归一化为 -4 而非同步抛错', async () => {
        const fetch = createFetch({ isDedup: true });

        const circular: any = { a: 1 };
        circular.self = circular;

        const result = await fetch.request({ url: '/users', method: 'GET', data: circular });

        expect(result.ok).toBe(false);
        expect(result.code).toBe(FetchCode.INTERCEPTOR);
        expect(result.msg).toBe('Converting circular structure to JSON');
      });

      it('getOriginalRequestConfig 抛错时应归一化为 -4 而非同步抛错', async () => {
        const fetch = _createFetch<BaseRequestConfig>(() => {
          throw new Error('boom');
        });

        const result = await fetch.request({ url: '/users', method: 'GET' });

        expect(result.ok).toBe(false);
        expect(result.code).toBe(FetchCode.INTERCEPTOR);
        expect(result.msg).toBe('boom');
        expect(mockUniRequest).not.toHaveBeenCalled();
      });
    });

    describe('决策 3 去重取消：abort 按 key 广播、共享执行不中断', () => {
      it('isDedup 时 abort 应让同 key 调用者收到 -1 且共享执行（传输层）不中断', async () => {
        const mockRequestTask = { abort: vi.fn() };
        mockUniRequest.mockReturnValue(mockRequestTask); // 请求挂起，不触发 complete

        const fetch = createFetch({ isDedup: true });
        const p1 = fetch.request({ url: '/users', method: 'GET', key: 'dup' });
        const p2 = fetch.request({ url: '/users', method: 'GET', key: 'dup' });

        fetch.abort('dup');

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1.code).toBe(FetchCode.ABORT);
        expect(r2.code).toBe(FetchCode.ABORT);
        // 共享执行（传输层）不因取消而中断：不调用 requestTask.abort
        expect(mockRequestTask.abort).not.toHaveBeenCalled();
        // 去重仍生效：只发起一次请求
        expect(mockUniRequest).toHaveBeenCalledTimes(1);
      });
    });

    describe('决策 4 rejected 恢复值运行时校验', () => {
      it('请求拦截器 rejected 恢复值非法时应告警并忽略、沿用上一配置继续请求', async () => {
        mockSuccessResponse({});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const fetch = createFetch();
        fetch.interceptors.request.use(
          () => { throw new Error('config error'); },
          (() => 42) as any // truthy 但非请求配置
        );

        const result = await fetch.request({ url: '/users', method: 'GET' });

        expect(warnSpy).toHaveBeenCalled();
        expect(result.ok).toBe(true); // 恢复值被忽略，沿用原配置
        expect(mockUniRequest).toHaveBeenCalledWith(
          expect.objectContaining({ url: 'https://api.example.com/users' })
        );
        warnSpy.mockRestore();
      });

      it('响应拦截器 rejected 恢复值非法时应告警并忽略、沿用上一结果', async () => {
        mockSuccessResponse({ id: 1 });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const fetch = createFetch();
        fetch.interceptors.response.use(
          () => { throw new Error('response error'); },
          (() => ({ notAResponse: true })) as any // truthy 但非 ResponseResult
        );

        const result = await fetch.request({ url: '/users', method: 'GET' });

        expect(warnSpy).toHaveBeenCalled();
        expect(result.ok).toBe(true); // 恢复值被忽略，沿用原响应
        expect(result.data).toEqual({ id: 1 });
        warnSpy.mockRestore();
      });
    });
  });

  describe('ADR 0004 修复回归', () => {
    describe('决策 1 取消 key 统一为拦截器处理后的当前配置', () => {
      it('请求拦截器修改 key 后，abort 应按新 key 取消', async () => {
        mockUniRequest.mockImplementation(({ complete }) => {
          complete({ data: null, statusCode: 200, errMsg: 'request:ok' });
        });

        const fetch = createFetch();
        fetch.interceptors.request.use((config) => {
          config.key = 'rewritten-key';
          return config;
        });
        fetch.interceptors.request.use(async (config) => {
          await new Promise(r => setTimeout(r, 100));
          return config;
        });

        const requestPromise = fetch.request({ url: '/users', method: 'GET', key: 'original-key' });
        // 让出控制权：等待第一个拦截器改写 key、第二个拦截器注册取消监听
        await new Promise(r => setTimeout(r, 0));
        fetch.abort('rewritten-key');

        const result = await requestPromise;
        expect(result.ok).toBe(false);
        expect(result.code).toBe(FetchCode.ABORT);
        // 取消发生在拦截器阶段，未到达传输层
        expect(mockUniRequest).not.toHaveBeenCalled();
      });
    });

    describe('决策 2 拦截器链快照：进行中的请求只执行发起时刻的拦截器', () => {
      it('请求进行中注册的新拦截器不应污染进行中的请求', async () => {
        mockSuccessResponse({ ok: true });

        const fetch = createFetch();
        let resolveGate!: () => void;
        const gate = new Promise<void>(resolve => { resolveGate = resolve; });
        fetch.interceptors.request.use(async (config) => {
          await gate;
          return config;
        });

        const requestPromise = fetch.request({ url: '/users', method: 'GET' });
        // 请求拦截器挂起期间注册新拦截器（若链为活迭代，将污染进行中的请求）
        fetch.interceptors.request.use(() => { throw new Error('late interceptor'); });
        resolveGate();

        const result = await requestPromise;
        expect(result.ok).toBe(true);
      });
    });

    describe('决策 3 请求拦截器恢复值校验收紧（url + host）', () => {
      it('恢复值缺 host 时应告警并忽略、沿用原配置', async () => {
        mockSuccessResponse({ ok: true });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const fetch = createFetch();
        fetch.interceptors.request.use(
          () => { throw new Error('config error'); },
          (() => ({ url: '/fallback' })) as any // truthy 但缺 host
        );

        const result = await fetch.request({ url: '/users', method: 'GET' });

        expect(warnSpy).toHaveBeenCalled();
        expect(result.ok).toBe(true); // 恢复值被忽略，沿用原配置
        expect(mockUniRequest).toHaveBeenCalledWith(
          expect.objectContaining({ url: 'https://api.example.com/users' })
        );
        warnSpy.mockRestore();
      });
    });
  });
});
