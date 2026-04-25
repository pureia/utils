import { useAsyncDebounce } from '../core/useAsyncDebounce';

/** 请求方法类型 */
type FetchMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'HEAD' | 'OPTIONS' | 'TRACE';

/** 基本请求配置 */
export interface BaseRequestConfig {
  /** 主机地址 */
  host: string;
  /** 请求方法类型 */
  method: FetchMethod;
  /** 请求头 */
  header: Record<string, string>;
  /** 超时时间（单位：毫秒） */
  timeout: number;
  /** 响应数据路径 */
  responseDataPath: string;
  /** 其他自定义配置 */
  [key: string]: any;
}

export interface ResponseResult<R, D> {
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
    /** 请求 key 用于取消请求 */
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

  return interceptors;
}

export { useFetch };

/** 获取基本请求配置 */
export function getBaseRequestConfig() {
  return {
    /** 主机地址 */
    host: 'https://api.example.com',
    /** 请求方法类型 */
    method: 'GET' as FetchMethod,
    /** 请求头 */
    header: {} as Record<string, string>,
    /** 超时时间（单位：毫秒） */
    timeout: 10000,
    /** 是否加密请求数据 */
    isEncrypt: true,
    isLogin: true,
    isAutoToken: false,
    isDebounce: true,
    isShowErrorHint: true,
    isShowLoading: false,
    loadingText: '加载中...',
    passStatusCodes: [],
    /** 响应数据路径 */
    responseDataPath: 'data',
  };
}

const interceptors = useFetch(getBaseRequestConfig);

interceptors.request.use((config) => {
  console.log(config.host);

  return config;
});

interceptors.response.use((response) => {
  console.log(response.requestConfig.host);

  return response;
});
