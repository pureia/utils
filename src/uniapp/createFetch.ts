import { merge } from '../third-party/lodash';
import { CancelError, createAsyncDedupe, createCancelable, stableStringify } from '../core';

/** 请求方法类型 */
type FetchMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'HEAD' | 'OPTIONS' | 'TRACE';

/**
 * 基本请求配置
 *
 * 定义每次请求的默认参数，通过 `createFetch` 的 `getOriginalRequestConfig` 参数传入。
 */
interface BaseRequestConfig {
  /** 主机地址，会与请求 url 拼接为完整请求地址 */
  host: string;
  /** 请求方法类型 */
  method: FetchMethod;
  /** 请求头 */
  header: Record<string, string>;
  /** 超时时间（单位：毫秒） */
  timeout: number;
  /** 是否开启请求去重，开启后相同配置的并发请求只会执行一次 */
  isDedup: boolean;
}

/**
 * 响应结果
 *
 * @typeParam R - 完整请求配置类型
 * @typeParam D - 响应数据类型
 */
interface ResponseResult<R, D> {
  /** 响应状态码，正常为 HTTP 状态码；-1 表示请求中止；-2 表示请求超时；-3 表示未知错误 */
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

/**
 * 简单哈希函数，基于双哈希算法生成稳定的十六进制字符串
 * @param str - 要哈希的字符串
 * @returns 十六进制哈希值
 */
function simpleHash(str: string): string {
  let h1 = 0xDEADBEEF; let h2 = 0x41C6CE57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/**
 * 获取统一的状态码，将 uni.request 的特殊错误映射为负数状态码
 * @param code - 原始状态码
 * @param defaultMsg - 默认错误消息
 * @returns 统一后的状态码：-1=中止，-2=超时，-3=未知错误，其他为原始值
 */
function getStatusCode(code?: number, defaultMsg?: string) {
  if (code === undefined && defaultMsg === 'request:fail abort') return -1;
  if (code === undefined && defaultMsg === 'request:fail timeout') return -2;
  return code ?? -3;
}

/**
 * 获取状态码对应的描述文本
 * @param code - 统一后的状态码
 * @param defaultMsg - 默认消息
 * @returns 状态码描述
 */
function getStatusCodeMsg(code: number, defaultMsg?: string) {
  if (code === -1) return 'Request Abort';
  if (code === -2) return 'Request Timeout';
  return defaultMsg ?? 'Unknown Msg';
}

/**
 * 拦截器接口
 *
 * @typeParam C - 拦截器处理的数据类型
 */
interface Interceptor<C> {
  /** 成功处理函数，接收数据并返回处理后的数据（支持异步） */
  fulfilled: (config: C) => C | Promise<C>;
  /** 错误处理函数，接收错误并返回错误（非 null/undefined 返回值会替代原始错误） */
  rejected?: <E>(error: E) => E;
}

/**
 * 拦截器管理器，用于管理请求/响应拦截器链
 *
 * @typeParam C - 拦截器处理的数据类型
 * @returns 拦截器管理器实例，包含 handlers 数组和 use 注册方法
 */
function createInterceptorManager<C>() {
  const handlers: Interceptor<C>[] = [];
  /**
   * 注册拦截器
   * @param fulfilled - 成功处理函数
   * @param rejected - 错误处理函数（可选）
   * @returns 拦截器在链中的索引
   */
  const use = (fulfilled: Interceptor<C>['fulfilled'], rejected?: Interceptor<C>['rejected']) => {
    handlers.push({ fulfilled, rejected });
    return handlers.length - 1;
  };
  return { handlers, use };
}

/**
 * 创建一个 UniApp 请求实例，支持拦截器、请求去重和请求取消。
 *
 * 基于 `uni.request` 封装，提供请求/响应拦截器、自动请求去重、请求任务管理等功能。
 * 通过 `getOriginalRequestConfig` 传入默认配置，每次请求时可覆盖部分配置。
 *
 * @typeParam R - 基础请求配置类型，需继承 `BaseRequestConfig`
 * @param getOriginalRequestConfig - 获取默认请求配置的函数，每次请求时调用以获取基础配置
 * @returns 请求实例，包含以下方法：
 *   - `request(config)` - 发送请求
 *   - `get(config)` - 发送 GET 请求
 *   - `post(config)` - 发送 POST 请求
 *   - `put(config)` - 发送 PUT 请求
 *   - `delete(config)` - 发送 DELETE 请求
 *   - `interceptors` - 拦截器管理（request / response）
 *   - `abort(key)` - 通过请求 key 取消请求
 *
 * @example
 * ```ts
 * const fetch = createFetch(() => ({
 *   host: 'https://api.example.com',
 *   method: 'GET',
 *   header: { 'Content-Type': 'application/json' },
 *   timeout: 10000,
 *   isDedup: false,
 * }));
 *
 * // 基本请求
 * const result = await fetch.get<{ id: number }>({ url: '/users/1' });
 * console.log(result.data); // { id: 1 }
 *
 * // 添加请求拦截器（如添加认证头）
 * fetch.interceptors.request.use((config) => {
 *   config.header.Authorization = 'Bearer token';
 *   return config;
 * });
 *
 * // 添加响应拦截器（如统一错误处理）
 * fetch.interceptors.response.use((response) => {
 *   if (response.code === 401) throw new Error('Unauthorized');
 *   return response;
 * });
 *
 * // 取消请求
 * fetch.request({ url: '/users', method: 'GET', key: 'user-list' });
 * fetch.abort('user-list');
 *
 * // 捕获取消错误
 * try {
 *   await fetch.request({ url: '/users', method: 'GET', key: 'user-list' });
 * } catch (error) {
 *   if (error instanceof CancelError) {
 *     // 用户主动取消，忽略
 *     return;
 *   }
 *   // 真正的错误处理
 *   console.error(error);
 * }
 * ```
 */
function createFetch<R extends BaseRequestConfig>(getOriginalRequestConfig: () => R) {
  const { asyncDedupe } = createAsyncDedupe();
  const { cancelable, cancel } = createCancelable();

  /** 原始请求配置类型，由 getOriginalRequestConfig 返回值推断 */
  type OriginalRequestConfig = ReturnType<typeof getOriginalRequestConfig>;

  /**
   * 请求配置，基于原始配置的部分属性并扩展 url、data、key
   *
   * 每次调用 request/get/post/put/delete 时传入。
   */
  type RequestConfig = Partial<OriginalRequestConfig> & {
    /** 请求路径，会与 host 拼接为完整 URL */
    url: string;
    /** 请求数据，POST/PUT 等方法时使用 */
    data?: any;
    /** 请求 key，用于通过 abort(key) 取消请求 */
    key?: string;
  };

  /** 快捷请求配置，排除了 method（由快捷方法自动设置） */
  type ShortcutRequestConfig = Omit<RequestConfig, 'method'>;

  /** 完整请求配置，合并了默认配置、请求配置和原始请求配置引用 */
  type FullRequestConfig = OriginalRequestConfig & RequestConfig & { readonly rawRequestConfig: RequestConfig };

  const interceptors = {
    request: createInterceptorManager<FullRequestConfig>(),
    response: createInterceptorManager<ResponseResult<FullRequestConfig, any>>(),
  };

  /**
   * 以可取消的方式执行拦截器处理函数
   * @param key - 请求 key
   * @param fn - 拦截器处理函数
   * @returns 处理后的结果
   */
  const runInterceptor = <T>(key: string | undefined, fn: () => T | Promise<T>) => key ? cancelable(key, fn) : fn();

  /**
   * 发送实际请求，调用 uni.request 并处理响应
   *
   * @typeParam D - 响应数据类型
   * @param fullRequestConfig - 完整请求配置
   * @returns 响应结果 Promise
   */
  const dispatchRequest = <D>(fullRequestConfig: FullRequestConfig) => {
    const { host, url, method, header, timeout, data, key } = fullRequestConfig;

    let requestTask: UniApp.RequestTask | undefined;

    // responsePromise 只负责将 uni.request 的 complete 回调桥接为 Promise；
    // 取消逻辑完全由外层 cancelable 处理，因此不需要 reject 参数。
    const responsePromise = new Promise<ResponseResult<FullRequestConfig, D>>((resolve) => {
      requestTask = uni.request({
        url: `${host}${url}`,
        method,
        header,
        timeout,
        data,
        complete(result) {
          const {
            data: respData,
            header: respHeader,
            cookies,
            errMsg: msg,
            statusCode: code,
          } = result as UniApp.GeneralCallbackResult & UniApp.RequestSuccessCallbackResult;

          const statusCode = getStatusCode(code, msg);

          resolve({
            code: statusCode,
            msg: getStatusCodeMsg(statusCode, msg),
            data: respData as D,
            header: respHeader ?? {},
            cookies: cookies ?? [],
            requestConfig: fullRequestConfig,
          });
        },
      });
    });

    return key ? cancelable(key, () => responsePromise, () => requestTask?.abort()) : responsePromise;
  };

  /**
   * 核心请求流程：依次执行请求拦截器 → 发送请求 → 依次执行响应拦截器
   *
   * @typeParam D - 响应数据类型
   * @param config - 完整请求配置
   * @returns 经过拦截器处理后的响应结果
   */
  const core = async <D>(config: FullRequestConfig) => {
    let fullRequestConfig = config;
    // 请求拦截处理
    const requestInterceptorChain = interceptors.request.handlers;
    for (const { fulfilled: onFulfilled, rejected: onRejected } of requestInterceptorChain) {
      try {
        fullRequestConfig = await runInterceptor(config.key, () => onFulfilled(fullRequestConfig));
      }
      catch (error) {
        if (error instanceof CancelError) return Promise.reject(error);
        return Promise.reject(onRejected ? await onRejected(error) ?? error : error);
      }
    }

    // 发送请求
    let fullResponseResult = await dispatchRequest<D>(fullRequestConfig);

    // 响应拦截处理
    const responseInterceptorChain = interceptors.response.handlers;
    for (const { fulfilled: onFulfilled, rejected: onRejected } of responseInterceptorChain) {
      try {
        fullResponseResult = await runInterceptor(config.key, () => onFulfilled(fullResponseResult));
      }
      catch (error) {
        if (error instanceof CancelError) return Promise.reject(error);
        return Promise.reject(onRejected ? await onRejected(error) ?? error : error);
      }
    }

    return fullResponseResult;
  };

  /**
   * 发送请求，自动合并默认配置和请求配置
   *
   * 当 isDedup 为 true 时，相同配置的并发请求会自动去重。
   *
   * @typeParam D - 响应数据类型
   * @param requestConfig - 请求配置（url 为必填）
   * @returns 响应结果 Promise
   */
  const request = <D = any>(requestConfig: RequestConfig) => {
    const fullRequestConfig = merge({ rawRequestConfig: requestConfig }, getOriginalRequestConfig(), requestConfig);
    if (!fullRequestConfig.isDedup) return core<D>(fullRequestConfig);
    return asyncDedupe(`Request:${simpleHash(stableStringify(fullRequestConfig)!)}`, () => core<D>(fullRequestConfig));
  };

  return {
    /** 通过请求 key 取消请求 */
    abort: cancel,
    /** 拦截器管理器，包含 request（请求拦截）和 response（响应拦截） */
    interceptors,
    /** 发送请求，method 由请求配置决定 */
    request,
    /** 发送 GET 请求 */
    get<D = any>(requestConfig: ShortcutRequestConfig) {
      return request<D>({ ...requestConfig, method: 'GET' } as RequestConfig);
    },
    /** 发送 POST 请求 */
    post<D = any>(requestConfig: ShortcutRequestConfig) {
      return request<D>({ ...requestConfig, method: 'POST' } as RequestConfig);
    },
    /** 发送 PUT 请求 */
    put<D = any>(requestConfig: ShortcutRequestConfig) {
      return request<D>({ ...requestConfig, method: 'PUT' } as RequestConfig);
    },
    /** 发送 DELETE 请求 */
    delete<D = any>(requestConfig: ShortcutRequestConfig) {
      return request<D>({ ...requestConfig, method: 'DELETE' } as RequestConfig);
    },
  };
}

export { type BaseRequestConfig, CancelError, createFetch };

export default createFetch;
