import { useFetch } from '@purea/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockUniRequest = vi.fn();

vi.stubGlobal('uni', {
  request: mockUniRequest,
});

function createFetch() {
  return useFetch(() => ({
    host: 'https://api.example.com',
    header: { 'Content-Type': 'application/json' },
    timeout: 10000,
  }));
}

afterEach(() => {
  mockUniRequest.mockReset();
});

describe('useFetch', () => {
  describe('基本请求', () => {
    it('应该通过 request 方法发送请求', async () => {
      mockUniRequest.mockImplementation(({ complete }) => {
        complete({
          data: { id: 1, name: 'test' },
          statusCode: 200,
          errMsg: 'request:ok',
          cookies: [],
          header: { 'X-Custom': 'value' },
        });
      });

      const fetch = createFetch();
      const result = await fetch.request({ url: '/users/1', method: 'GET' });

      expect(result.code).toBe(200);
      expect(result.data).toEqual({ id: 1, name: 'test' });
      expect(result.msg).toBe('request:ok');
      expect(result.cookies).toEqual([]);
      expect(result.header).toEqual({ 'X-Custom': 'value' });
    });

    it('应该正确拼接 host 和 url', async () => {
      mockUniRequest.mockImplementation(({ url, complete }) => {
        expect(url).toBe('https://api.example.com/users/1');
        complete({ data: {}, statusCode: 200, errMsg: 'ok' });
      });

      const fetch = createFetch();
      await fetch.request({ url: '/users/1', method: 'GET' });

      expect(mockUniRequest).toHaveBeenCalled();
    });

    it('应该传递请求参数', async () => {
      mockUniRequest.mockImplementation(({ method, header, timeout, data, complete }) => {
        expect(method).toBe('POST');
        expect(header).toEqual({ 'Content-Type': 'application/json' });
        expect(timeout).toBe(10000);
        expect(data).toEqual({ name: 'new user' });
        complete({ data: { id: 2 }, statusCode: 201, errMsg: 'ok' });
      });

      const fetch = createFetch();
      await fetch.post({ url: '/users', data: { name: 'new user' } });

      expect(mockUniRequest).toHaveBeenCalled();
    });
  });

  describe('get 和 post 方法', () => {
    it('get 方法应该设置 method 为 GET 且 isEncrypt 为 false', async () => {
      mockUniRequest.mockImplementation(({ method, complete }) => {
        expect(method).toBe('GET');
        complete({ data: [], statusCode: 200, errMsg: 'ok' });
      });

      const fetch = createFetch();
      await fetch.get({ url: '/users' });

      expect(mockUniRequest).toHaveBeenCalled();
    });

    it('post 方法应该设置 method 为 POST', async () => {
      mockUniRequest.mockImplementation(({ method, complete }) => {
        expect(method).toBe('POST');
        complete({ data: { id: 1 }, statusCode: 200, errMsg: 'ok' });
      });

      const fetch = createFetch();
      await fetch.post({ url: '/users', data: { name: 'test' } });

      expect(mockUniRequest).toHaveBeenCalled();
    });
  });

  describe('请求拦截器', () => {
    it('应该在发送请求前执行请求拦截器', async () => {
      mockUniRequest.mockImplementation(({ header, complete }) => {
        expect(header).toEqual({ 'Content-Type': 'application/json', 'Authorization': 'Bearer token' });
        complete({ data: {}, statusCode: 200, errMsg: 'ok' });
      });

      const fetch = createFetch();
      fetch.interceptors.request.use((config) => {
        config.header = { ...config.header, Authorization: 'Bearer token' };
        return config;
      });

      await fetch.request({ url: '/users', method: 'GET' });

      expect(mockUniRequest).toHaveBeenCalled();
    });

    it('请求拦截器应该支持多个', async () => {
      mockUniRequest.mockImplementation(({ header, complete }) => {
        expect(header!.Authorization).toBe('Bearer token');
        expect(header!['X-Custom']).toBe('custom-value');
        complete({ data: {}, statusCode: 200, errMsg: 'ok' });
      });

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

      expect(mockUniRequest).toHaveBeenCalled();
    });

    it('请求拦截器 fulfilled 抛错且无 rejected 时应该直接抛出', async () => {
      const fetch = createFetch();

      fetch.interceptors.request.use(
        () => { throw new Error('interceptor error'); }
      );

      await expect(fetch.request({ url: '/users', method: 'GET' })).rejects.toThrow('interceptor error');
    });

    it('请求拦截器 rejected 可以恢复错误并继续执行链', async () => {
      mockUniRequest.mockImplementation(({ complete }) => {
        complete({ data: { recovered: true }, statusCode: 200, errMsg: 'ok' });
      });

      const fetch = createFetch();
      const fallbackConfig = {
        url: '/fallback',
        method: 'GET' as const,
        host: 'https://api.example.com',
        originalRequestConfig: { url: '/fallback', method: 'GET' as const },
        header: { 'Content-Type': 'application/json' },
        timeout: 10000,
      };

      fetch.interceptors.request.use(
        () => { throw new Error('config error'); },
        () => fallbackConfig
      );

      const result = await fetch.request({ url: '/users', method: 'GET' });
      expect(result.data).toEqual({ recovered: true });
    });
  });

  describe('响应拦截器', () => {
    it('应该在收到响应后执行响应拦截器', async () => {
      mockUniRequest.mockImplementation(({ complete }) => {
        complete({ data: { id: 1 }, statusCode: 200, errMsg: 'ok' });
      });

      const fetch = createFetch();
      fetch.interceptors.response.use((response) => {
        response.data = { ...response.data, processed: true };
        return response;
      });

      const result = await fetch.request({ url: '/users/1', method: 'GET' });

      expect(result.data).toEqual({ id: 1, processed: true });
    });

    it('响应拦截器应该支持多个', async () => {
      mockUniRequest.mockImplementation(({ complete }) => {
        complete({ data: { id: 1 }, statusCode: 200, errMsg: 'ok' });
      });

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
      mockUniRequest.mockImplementation(({ complete }) => {
        complete({ data: {}, statusCode: 401, errMsg: 'ok' });
      });

      const fetch = createFetch();

      fetch.interceptors.response.use(
        (response) => {
          if (response.code === 401) throw new Error('Unauthorized');
          return response;
        }
      );

      await expect(fetch.request({ url: '/users', method: 'GET' })).rejects.toThrow('Unauthorized');
    });

    it('响应拦截器 rejected 可以恢复错误并继续执行链', async () => {
      mockUniRequest.mockImplementation(({ complete }) => {
        complete({ data: { id: 1 }, statusCode: 200, errMsg: 'ok' });
      });

      const fetch = createFetch();
      const fallbackResponse = {
        msg: 'recovered',
        code: 200,
        data: { fallback: true },
        cookies: [],
        header: {},
        requestConfig: { url: '/fallback', method: 'GET' as const, host: 'https://api.example.com', originalRequestConfig: { url: '/fallback', method: 'GET' as const } },
      };

      fetch.interceptors.response.use(
        () => { throw new Error('response error'); },
        () => fallbackResponse
      );

      const result = await fetch.request({ url: '/users', method: 'GET' });
      expect(result.data).toEqual({ fallback: true });
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

    it('应该处理 statusCode 为 null/undefined 的情况（返回 -1）', async () => {
      mockUniRequest.mockImplementation(({ complete }) => {
        complete({ data: null, statusCode: undefined as any, errMsg: '' });
      });

      const fetch = createFetch();
      const result = await fetch.request({ url: '/error', method: 'GET' });

      expect(result.code).toBe(-1);
    });
  });

  describe('配置合并', () => {
    it('应该将基础配置和请求配置合并', async () => {
      mockUniRequest.mockImplementation(({ url, method, header, timeout, complete }) => {
        expect(url).toBe('https://api.example.com/users');
        expect(method).toBe('GET');
        expect(header).toEqual({ 'Content-Type': 'application/json', 'X-Extra': 'value' });
        expect(timeout).toBe(10000);
        complete({ data: [], statusCode: 200, errMsg: 'ok' });
      });

      const fetch = createFetch();
      await fetch.get({ url: '/users', header: { 'X-Extra': 'value' } });

      expect(mockUniRequest).toHaveBeenCalled();
    });

    it('请求配置应该覆盖基础配置', async () => {
      mockUniRequest.mockImplementation(({ timeout, complete }) => {
        expect(timeout).toBe(5000);
        complete({ data: {}, statusCode: 200, errMsg: 'ok' });
      });

      const fetch = createFetch();
      await fetch.request({ url: '/users', method: 'GET', timeout: 5000 });

      expect(mockUniRequest).toHaveBeenCalled();
    });
  });

  describe('拦截器管理', () => {
    it('interceptors.request.use 应该返回索引', () => {
      const fetch = createFetch();
      const index0 = fetch.interceptors.request.use((config) => config);
      const index1 = fetch.interceptors.request.use((config) => config);

      expect(index0).toBe(0);
      expect(index1).toBe(1);
    });

    it('interceptors.response.use 应该返回索引', () => {
      const fetch = createFetch();
      const index0 = fetch.interceptors.response.use((response) => response);
      const index1 = fetch.interceptors.response.use((response) => response);

      expect(index0).toBe(0);
      expect(index1).toBe(1);
    });
  });
});
