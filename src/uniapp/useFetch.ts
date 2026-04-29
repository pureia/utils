import { merge } from 'lodash-es';
import { useAsyncDebounce } from '../core/useAsyncDebounce';

/** 请求方法类型 */
type FetchMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'HEAD' | 'OPTIONS' | 'TRACE';

/** 基本请求配置 */
interface BaseRequestConfig {
  /** 主机地址 */
  host: string;
  /** 请求方法类型 */
  method: FetchMethod;
  /** 请求头 */
  header: Record<string, string>;
  /** 超时时间（单位：毫秒） */
  timeout: number;
  /** 是否开启防抖处理 */
  isDebounce: boolean;
  /** 响应数据路径 */
  responseDataPath: string;
}

interface ResponseResult<R, D> {
  /** 响应状态码 */
  code: number;
  /** 响应状态码描述 */
  msg: string;
  /** 响应数据 */
  data: D;
  /** 响应头 */
  header: Record<string, string>;
  /** cookies */
  cookies: string[];
  /** 请求配置信息 */
  requestConfig: R;
}

/** 稳定字符串化函数 */
function stableStringify(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(stableStringify).join(',')}]`;
  }
  // 对象：按键排序后处理
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(key => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
  return `{${pairs.join(',')}}`;
}

/** 简单哈希函数 */
function simpleHash(str: string): string {
  let h1 = 0xDEADBEEF; let h2 = 0x41C6CE57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}

interface Interceptor<C> {
  fulfilled: (config: C) => C | Promise<C>;
  rejected?: <E>(error: E) => E;
}

function useInterceptorManager<C>() {
  const handlers: Interceptor<C>[] = [];
  const use = (fulfilled: Interceptor<C>['fulfilled'], rejected?: Interceptor<C>['rejected']) => {
    handlers.push({ fulfilled, rejected });
    return handlers.length - 1;
  };
  return { handlers, use };
}

function useFetch<R extends BaseRequestConfig>(getBaseRequestConfig: () => R) {
  const { asyncDebounce, eventStore } = useAsyncDebounce();

  const baseRequestConfig = getBaseRequestConfig();

  /** 请求路径 */
  type RequestConfig = Partial<typeof baseRequestConfig> & {
    url: string;
    /** 请求数据 */
    data?: any;
    /** 请求 key 用于获取请求任务 */
    key?: string;
  };

  type FullRequestConfig = (typeof baseRequestConfig) & RequestConfig;

  const interceptors = {
    request: useInterceptorManager<FullRequestConfig>(),
    response: useInterceptorManager<ResponseResult<R, any>>(),
  };

  const dispatchRequest = <D>(fullRequestConfig: FullRequestConfig) => new Promise<ResponseResult<R, D>>((resolve) => {
    const { host, url, method, header, timeout, data, key } = fullRequestConfig;
    const requestTask = uni.request({
      url: `${host}${url}`,
      method,
      header,
      timeout,
      data,
      complete(result) {
        const {
          data,
          header,
          cookies,
          errMsg: msg,
          statusCode: code,
        } = result as UniApp.GeneralCallbackResult & UniApp.RequestSuccessCallbackResult;
        resolve({
          code: code ?? 0,
          msg: msg ?? '',
          data: data as D,
          header: header ?? {},
          cookies: cookies ?? [],
          requestConfig: fullRequestConfig,
        });
      },
    });
    // 存储请求任务，用于取消请求
    key && eventStore.set(key, requestTask);
  });

  const core = async <D>(config: FullRequestConfig) => {
    let fullRequestConfig = config;
    // 请求拦截处理
    const requestInterceptorChain = interceptors.request.handlers;
    for (const { fulfilled: onFulfilled, rejected: onRejected } of requestInterceptorChain) {
      try {
        fullRequestConfig = await onFulfilled(fullRequestConfig);
      }
      catch (error) {
        return Promise.reject(onRejected ? await onRejected(error) || error : error);
      }
    }

    // 发送请求
    let fullResponseResult = await dispatchRequest<D>(fullRequestConfig);

    // 响应拦截处理
    const responseInterceptorChain = interceptors.response.handlers;
    for (const { fulfilled: onFulfilled, rejected: onRejected } of responseInterceptorChain) {
      try {
        fullResponseResult = await onFulfilled(fullResponseResult);
      }
      catch (error) {
        return Promise.reject(onRejected ? await onRejected(error) || error : error);
      }
    }

    return fullResponseResult;
  };

  const request = <D = any>(requestConfig: RequestConfig) => {
    const fullRequestConfig = merge({ originalRequestConfig: requestConfig }, baseRequestConfig, requestConfig);
    if (!fullRequestConfig.isDebounce) return core<D>(fullRequestConfig);
    return asyncDebounce(`Request:${simpleHash(stableStringify(requestConfig))}`, () => core<D>(fullRequestConfig));
  };

  const get = <D = any>(requestConfig: RequestConfig) => request<D>({ ...requestConfig, method: 'GET' });

  const post = <D = any>(requestConfig: RequestConfig) => request<D>({ ...requestConfig, method: 'POST' });

  return {
    /** 通过请求 key 获取请求任务 */
    getRequestTask: eventStore.get,
    /** 拦截器 */
    interceptors,
    /** 发送请求 */
    request,
    /** 发送 GET 请求 */
    get,
    /** 发送 POST 请求 */
    post,
  };
}

export { type BaseRequestConfig, useFetch };

export default useFetch;
