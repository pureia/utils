import type { BaseRequestConfig } from '@purea/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFetch as _createFetch, CancelError, merge } from '@purea/utils';

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
      expect(result.msg).toBe('request:ok');
      expect(result.cookies).toEqual([]);
      expect(result.header).toEqual({ 'X-Custom': 'value' });
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

    it('请求拦截器 fulfilled 抛错且无 rejected 时应该直接抛出', async () => {
      const fetch = createFetch();
      fetch.interceptors.request.use(() => {
        throw new Error('interceptor error');
      });

      await expect(fetch.request({ url: '/users', method: 'GET' })).rejects.toThrow('interceptor error');
    });

    it('请求拦截器 rejected 可以处理错误但 truthy 返回值会成为新的错误', async () => {
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

      await expect(fetch.request({ url: '/users', method: 'GET' })).rejects.toEqual(fallbackConfig);
    });

    it('请求拦截器 rejected 返回 falsy 值时应该使用原始错误', async () => {
      const fetch = createFetch();

      fetch.interceptors.request.use(
        () => { throw new Error('original error'); },
        (() => null) as any
      );

      await expect(fetch.request({ url: '/users', method: 'GET' })).rejects.toThrow('original error');
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

    it('响应拦截器 fulfilled 抛错且无 rejected 时应该直接抛出', async () => {
      mockSuccessResponse({}, 401);

      const fetch = createFetch();
      fetch.interceptors.response.use((response) => {
        if (response.code === 401) throw new Error('Unauthorized');
        return response;
      });

      await expect(fetch.request({ url: '/users', method: 'GET' })).rejects.toThrow('Unauthorized');
    });

    it('响应拦截器 rejected truthy 返回值会成为新的错误', async () => {
      mockSuccessResponse({ id: 1 });

      const fetch = createFetch();
      const fallbackResponse = {
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

      await expect(fetch.request({ url: '/users', method: 'GET' })).rejects.toEqual(fallbackResponse);
    });

    it('响应拦截器 rejected 返回 falsy 值时应该使用原始错误', async () => {
      mockSuccessResponse({ id: 1 });

      const fetch = createFetch();
      fetch.interceptors.response.use(
        () => { throw new Error('response error'); },
        (() => null) as any
      );

      await expect(fetch.request({ url: '/users', method: 'GET' })).rejects.toThrow('response error');
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
      expect(result.msg).toBe('request:fail');
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

    it('errMsg 为 undefined 时 msg 应为 Unknown Msg', async () => {
      mockUniRequest.mockImplementation(({ complete }) => {
        complete({ data: null, statusCode: 200, errMsg: undefined as any });
      });

      const fetch = createFetch();
      const result = await fetch.request({ url: '/test', method: 'GET' });

      expect(result.msg).toBe('Unknown Msg');
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
    it('abort(key) 应该拒绝请求并抛出 CancelError，并调用底层 requestTask.abort()', async () => {
      const mockRequestTask = { abort: vi.fn() };
      mockUniRequest.mockReturnValue(mockRequestTask);
      // 不调用 complete，模拟请求进行中

      const fetch = createFetch();
      const requestPromise = fetch.request({ url: '/users', method: 'GET', key: 'cancel-test' });

      fetch.abort('cancel-test');

      await expect(requestPromise).rejects.toBeInstanceOf(CancelError);
      await expect(requestPromise).rejects.toThrow('Request "cancel-test" was cancelled');
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
      const req2 = fetch.request({ url: '/users/2', method: 'GET', key: 'req-2' });

      fetch.abort('req-1');

      await expect(req1).rejects.toBeInstanceOf(CancelError);
      // req-2 不应被取消
      expect(mockRequestTask.abort).toHaveBeenCalledTimes(1);
    });

    it('cancelError 应该具有正确的 name 属性', () => {
      const error = new CancelError('test-key');
      expect(error.name).toBe('CancelError');
      expect(error.message).toBe('Request "test-key" was cancelled');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('拦截器取消', () => {
    it('请求拦截器期间 abort 应抛出 CancelError', async () => {
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

      await expect(requestPromise).rejects.toBeInstanceOf(CancelError);
      // 拦截器被取消后，不应到达 dispatchRequest
      expect(mockUniRequest).not.toHaveBeenCalled();
    });

    it('响应拦截器期间 abort 应抛出 CancelError', async () => {
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

      await expect(requestPromise).rejects.toBeInstanceOf(CancelError);
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
});
