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
  /** 视为成功的 HTTP 状态码数组，默认 [200]；不在数组内的码（含哨兵码）视为失败 */
  successStatusCodes?: number[];
}

/**
 * 非 HTTP 的传输/流程错误码（哨兵码）
 *
 * 与 HTTP 状态码共同构成 `code` 的取值空间：
 * 成功 = 配置的成功状态码（默认 200）；失败 = 其余 HTTP 码或哨兵码。
 */
const FetchCode = {
  /** 请求被中止（主动 abort 或传输层中止） */
  ABORT: -1,
  /** 请求超时 */
  TIMEOUT: -2,
  /** 未知错误 */
  UNKNOWN: -3,
  /** 拦截器/业务错误（拦截器抛出后归一化） */
  INTERCEPTOR: -4,
} as const;

/** 统一响应结果的公共字段 */
interface BaseResponseResult<R> {
  /** 状态码描述 */
  msg: string;
  /** 响应头 */
  header: Record<string, string>;
  /** cookies */
  cookies: string[];
  /** 请求配置信息 */
  requestConfig: R;
}

/** 成功响应：HTTP 状态码在配置的成功码数组内 */
interface SuccessResponseResult<R, D> extends BaseResponseResult<R> {
  /** 是否成功，成功时恒为 true（code 在配置的成功状态码内） */
  ok: true;
  /** 响应状态码，成功时为配置的成功状态码之一 */
  code: number;
  /** 响应数据 */
  data: D;
}

/** 失败响应：HTTP 非成功码或哨兵码 */
interface ErrorResponseResult<R, D> extends BaseResponseResult<R> {
  /** 是否成功，失败时恒为 false */
  ok: false;
  /** 失败状态码：HTTP 错误码或哨兵码（-1/-2/-3/-4） */
  code: number;
  /** 响应数据，失败时可能为空；拦截器错误时保留响应现场 */
  data: D | null;
  /** 原始错误对象：拦截器抛错与主动取消（CancelError 实例）时存在；HTTP 错误与传输失败（超时/网络中止/未知错误）时为 undefined */
  error?: unknown;
}

/**
 * 统一响应结果
 *
 * 所有请求路径（成功、传输错误、HTTP 错误、业务错误、取消）的公共出口，
 * 以 `ok` 为判别字段的判别联合；调用方无需 try/catch，判断 `ok` 即可收窄类型。
 *
 * @typeParam R - 完整请求配置类型
 * @typeParam D - 响应数据类型
 */
type ResponseResult<R, D> = SuccessResponseResult<R, D> | ErrorResponseResult<R, D>;

/** 类型守卫：判断结果是否为成功响应（等价于 result.ok） */
function isSuccessResult<R, D>(result: ResponseResult<R, D>): result is SuccessResponseResult<R, D> {
  return result.ok;
}

/** 类型守卫：判断值是否为合法的统一响应结果（响应拦截器返回值运行时校验） */
function isResponseResultLike(value: unknown): boolean {
  return typeof value === 'object' && value !== null
    && typeof (value as { ok?: unknown }).ok === 'boolean'
    && typeof (value as { code?: unknown }).code === 'number';
}

/** 类型守卫：判断值是否为合法的请求配置（请求拦截器恢复值运行时校验） */
function isRequestConfigLike(value: unknown): boolean {
  // 校验拼接 URL 的关键字段 url 与 host：缺任一都会产出畸形请求（如 `undefined${url}`）
  return typeof value === 'object' && value !== null
    && typeof (value as { url?: unknown }).url === 'string'
    && typeof (value as { host?: unknown }).host === 'string';
}

/**
 * 获取错误的描述文本
 *
 * 优先取 `Error.message` / 字符串本身；抛出对象时提取 `message`/`msg` 字段
 * （须为字符串且非空），避免业务对象抛错时 msg 退化为 'Unknown Error'；
 * 其余情况回退 'Unknown Error'。
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const maybeMessage = (error as { message?: unknown }).message ?? (error as { msg?: unknown }).msg;
    if (typeof maybeMessage === 'string' && maybeMessage) return maybeMessage;
  }
  return 'Unknown Error';
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
 *
 * uni 的传输层失败（网络错误/中止/超时）通常不提供有效 HTTP 状态码：
 * - 部分平台 statusCode 为 `undefined`，部分为 `0`/`null`，统一按「无 HTTP 状态」处理；
 * - 中止/超时通过 `errMsg` 前缀识别（平台文案可能带后缀，故用前缀而非精确匹配）；
 * - 其余无状态码的失败归一到 `-3` 未知错误。
 *
 * @param code - 原始状态码
 * @param defaultMsg - 默认错误消息（uni 的 errMsg）
 * @returns 统一后的状态码：-1=中止，-2=超时，-3=未知错误，其他为原始值
 */
function getStatusCode(code?: number | null, defaultMsg?: string) {
  if (!code) {
    if (defaultMsg?.startsWith('request:fail abort')) return FetchCode.ABORT;
    if (defaultMsg?.startsWith('request:fail timeout')) return FetchCode.TIMEOUT;
    return FetchCode.UNKNOWN;
  }
  return code;
}

/**
 * 常用 HTTP 状态码的英文描述
 *
 * 仅收录常见实现，非 RFC 全集；未收录的码（含后端自定义码）由调用方
 * 回退为 `HTTP ${code}`，保证 msg 恒有值。描述仅供调试/兜底展示，
 * 业务语义应由调用方从响应 data 中解析，不应依赖本表。
 */
const HTTP_STATUS_TEXT: Record<number, string> = {
  100: 'Continue',
  101: 'Switching Protocols',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  203: 'Non-Authoritative Information',
  204: 'No Content',
  205: 'Reset Content',
  206: 'Partial Content',
  300: 'Multiple Choices',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  305: 'Use Proxy',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Payload Too Large',
  414: 'URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  417: 'Expectation Failed',
  418: 'I\'m a Teapot',
  422: 'Unprocessable Entity',
  426: 'Upgrade Required',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported',
  507: 'Insufficient Storage',
  511: 'Network Authentication Required',
};

/**
 * 获取状态码对应的描述文本
 *
 * `msg` 的语义约定：
 * - 有 HTTP 状态码时（含 2xx 成功与 4xx/5xx 失败），使用 `HTTP_STATUS_TEXT` 中的描述；
 *   未收录的码（含后端自定义码）回退为 `HTTP ${code}`，保证恒有值——
 *   不透传 uni 的 `errMsg`（其描述传输层结果，HTTP 500 时 errMsg 恒为 "request:ok"，会误导）；
 * - 哨兵码使用固定描述（中止/超时/拦截器错误）或原始 `errMsg`（未知错误）。
 *
 * 注意：`-4`（拦截器/业务错误）的 msg 在 `normalizeError` 中直接取抛出的业务消息，
 * 本分支仅作为哨兵码描述的防御性完备映射，供直接调用时兜底。
 *
 * @param code - 统一后的状态码
 * @param defaultMsg - 默认消息（uni 的 errMsg）
 * @returns 状态码描述
 */
function getStatusCodeMsg(code: number, defaultMsg?: string) {
  if (code === FetchCode.ABORT) return 'Request Abort';
  if (code === FetchCode.TIMEOUT) return 'Request Timeout';
  if (code === FetchCode.INTERCEPTOR) return 'Request Interceptor Error';
  if (code < 0) return defaultMsg ?? 'Unknown Msg';
  return HTTP_STATUS_TEXT[code] ?? `HTTP ${code}`;
}

/**
 * 拦截器接口
 *
 * @typeParam C - 拦截器处理的数据类型
 */
interface Interceptor<C> {
  /** 成功处理函数，接收数据并返回处理后的数据（支持异步） */
  fulfilled: (config: C) => C | Promise<C>;
  /**
   * 错误处理函数：返回 truthy 值表示恢复成功，该值作为新数据（类型为 C）继续链路；
   * 返回 falsy 值表示错误成立，由错误归一化产出失败结果。
   */
  rejected?: (error: unknown) => C | Promise<C>;
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
 * 所有请求错误（传输错误、HTTP 错误、拦截器抛出的业务错误、主动取消）都会被
 * 归一化为带 `code` 的正常返回，调用方无需 try/catch。
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
 *   successStatusCodes: [200],
 * }));
 *
 * // 基本请求：永不 reject，判断 ok 即可
 * const result = await fetch.get<{ id: number }>({ url: '/users/1' });
 * if (result.ok) {
 *   console.log(result.data); // { id: 1 }
 * } else {
 *   console.log(result.code, result.msg); // 失败码与描述
 * }
 *
 * // 添加请求拦截器（如添加认证头）
 * fetch.interceptors.request.use((config) => {
 *   config.header.Authorization = 'Bearer token';
 *   return config;
 * });
 *
 * // 添加响应拦截器（如统一业务错误处理：抛出后会被归一化）
 * fetch.interceptors.response.use((response) => {
 *   if (!response.ok) throw new Error(response.msg);
 *   return response;
 * });
 *
 * // 取消请求：归一化为 code: -1，无需捕获
 * fetch.request({ url: '/users', method: 'GET', key: 'user-list' });
 * fetch.abort('user-list');
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
    /**
     * 请求 key，用于通过 abort(key) 取消请求。
     * abort(key) 按 key 广播：并发请求间应保持 key 唯一，否则同 key 请求互为取消组，
     * 一次 abort 会同时取消所有以该 key 注册的进行中阶段（拦截器与传输层）。
     */
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
   * 将异常归一化为失败结果（永不 reject 的收口点）
   *
   * @typeParam D - 响应数据类型
   * @param error - 捕获的异常
   * @param fallback - 已有的响应结果（响应拦截器抛错时保留现场）
   * @param requestConfig - 完整请求配置
   * @returns 失败响应结果
   */
  const normalizeError = <D>(
    error: unknown,
    fallback: ResponseResult<FullRequestConfig, D> | undefined,
    requestConfig: FullRequestConfig
  ): ErrorResponseResult<FullRequestConfig, D> => {
    if (error instanceof CancelError) {
      return {
        ok: false,
        code: FetchCode.ABORT,
        msg: 'Request Abort',
        data: fallback?.data ?? null,
        header: fallback?.header ?? {},
        cookies: fallback?.cookies ?? [],
        requestConfig,
        error,
      };
    }
    return {
      ok: false,
      code: FetchCode.INTERCEPTOR,
      msg: getErrorMessage(error),
      data: fallback?.data ?? null,
      header: fallback?.header ?? {},
      cookies: fallback?.cookies ?? [],
      requestConfig,
      error,
    };
  };

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
          const ok = (fullRequestConfig.successStatusCodes ?? [200]).includes(statusCode);
          const responseMsg = getStatusCodeMsg(statusCode, msg);

          // 成功/失败仅 ok 与 data 的取值不同，其余字段共用；
          // 判别联合要求 ok 为字面量 true/false，故按分支展开
          const baseResponse = {
            code: statusCode,
            msg: responseMsg,
            header: respHeader ?? {},
            cookies: cookies ?? [],
            requestConfig: fullRequestConfig,
          };
          resolve(ok
            ? { ...baseResponse, ok: true, data: respData as D }
            : { ...baseResponse, ok: false, data: (respData ?? null) as D | null });
        },
      });
    });

    return key ? cancelable(key, () => responsePromise, () => requestTask?.abort()) : responsePromise;
  };

  /**
   * 核心请求流程：依次执行请求拦截器 → 发送请求 → 依次执行响应拦截器
   *
   * 任何阶段的异常（拦截器抛错、主动取消、传输错误）都被归一化为失败结果，
   * 本函数永不 reject。
   *
   * @typeParam D - 响应数据类型
   * @param config - 完整请求配置
   * @returns 经过拦截器处理后的响应结果
   */
  const core = async <D>(config: FullRequestConfig) => {
    let fullRequestConfig = config;
    // 请求拦截处理
    // 链快照：进行中的请求只执行发起时刻已注册的拦截器，避免执行期间新增的拦截器污染本次请求
    const requestInterceptorChain = [...interceptors.request.handlers];
    for (const { fulfilled: onFulfilled, rejected: onRejected } of requestInterceptorChain) {
      try {
        const interceptorResult = await runInterceptor(fullRequestConfig.key, () => onFulfilled(fullRequestConfig));
        // 运行时校验：请求拦截器 fulfilled 必须返回合法的请求配置（与 rejected 恢复值同守卫），
        // 非法（如漏 return、缺 url/host）则告警并沿用上一配置，避免后续拼出 `undefined${url}`
        // 畸形 URL 或在读取 .key 处抛晦涩 TypeError。
        if (!isRequestConfigLike(interceptorResult)) {
          console.warn('[createFetch] 请求拦截器 fulfilled 必须返回请求配置（含 url 与 host 字段），非法返回值已被忽略');
        }
        else {
          fullRequestConfig = interceptorResult;
        }
      }
      catch (error) {
        // 用户取消：归一化为中止结果
        if (error instanceof CancelError) return normalizeError<D>(error, undefined, fullRequestConfig);
        // rejected 返回 truthy 表示恢复成功，用恢复后的配置继续链路；
        // 恢复值须为合法请求配置，非法则告警并忽略、沿用上一配置
        if (onRejected) {
          try {
            const recovered = await runInterceptor(fullRequestConfig.key, () => onRejected(error));
            // 返回 falsy：错误成立，归一化为拦截器/业务错误结果
            if (!recovered) return normalizeError<D>(error, undefined, fullRequestConfig);

            if (!isRequestConfigLike(recovered)) {
              console.warn('[createFetch] 请求拦截器 rejected 恢复值必须返回请求配置（含 url 与 host 字段），非法恢复值已被忽略');
            }
            else {
              fullRequestConfig = recovered;
            }

            continue;
          }
          catch (recoveredError) {
            return normalizeError<D>(recoveredError, undefined, fullRequestConfig);
          }
        }
        // 错误成立：归一化为拦截器/业务错误结果
        return normalizeError<D>(error, undefined, fullRequestConfig);
      }
    }

    // 发送请求
    let fullResponseResult: ResponseResult<FullRequestConfig, D>;
    try {
      fullResponseResult = await dispatchRequest<D>(fullRequestConfig);
    }
    catch (error) {
      return normalizeError<D>(error, undefined, fullRequestConfig);
    }

    // 响应拦截处理（链快照与取消 key 理由同请求拦截）
    const responseInterceptorChain = [...interceptors.response.handlers];
    for (const { fulfilled: onFulfilled, rejected: onRejected } of responseInterceptorChain) {
      try {
        const interceptorResult = await runInterceptor(fullRequestConfig.key, () => onFulfilled(fullResponseResult));
        // 运行时校验：响应拦截器必须返回合法的统一响应结果，否则告警并沿用上一结果，
        // 避免类型谎言沿拦截器链扩散（如需"解包"，应改写 ResponseResult.data 而非返回裸数据）。
        if (!isResponseResultLike(interceptorResult)) {
          console.warn('[createFetch] 响应拦截器 fulfilled 必须返回 ResponseResult（含 ok/code 字段），非法返回值已被忽略');
        }
        else {
          fullResponseResult = interceptorResult;
        }
      }
      catch (error) {
        // 用户取消：归一化为中止结果
        if (error instanceof CancelError) return normalizeError<D>(error, fullResponseResult, fullRequestConfig);
        // rejected 返回 truthy 表示恢复成功，用恢复后的结果继续链路；
        // 恢复值须为合法响应结果，非法则告警并忽略、沿用上一结果
        if (onRejected) {
          try {
            const recovered = await runInterceptor(fullRequestConfig.key, () => onRejected(error));
            // 返回 falsy：错误成立，归一化为拦截器/业务错误结果，保留响应现场
            if (!recovered) return normalizeError<D>(error, fullResponseResult, fullRequestConfig);

            if (!isResponseResultLike(recovered)) {
              console.warn('[createFetch] 响应拦截器 rejected 恢复值必须返回 ResponseResult（含 ok/code 字段），非法恢复值已被忽略');
            }
            else {
              fullResponseResult = recovered;
            }

            continue;
          }
          catch (recoveredError) {
            return normalizeError<D>(recoveredError, fullResponseResult, fullRequestConfig);
          }
        }
        // 错误成立：归一化为拦截器/业务错误结果，保留响应现场
        return normalizeError<D>(error, fullResponseResult, fullRequestConfig);
      }
    }

    return fullResponseResult;
  };

  /**
   * 发送请求，自动合并默认配置和请求配置
   *
   * 合并规则：`header` 按字段深合并（叠加）；其余字段请求配置提供即整体替换
   * （数组按引用替换，不做 lodash 的索引合并），`rawRequestConfig` 保留请求配置原始引用。
   *
   * 同步兜底：配置合并与去重 hash 计算可能同步抛错（如 `data` 含循环引用时
   * `stableStringify` 抛 TypeError），统一归一化为 `code: -4` 失败结果，保持"永不 reject 且
   * 永不同步 throw"。
   *
   * 去重取消：`isDedup` 开启时，每个调用者（含去重等待者）都注册自己的可取消
   * 等待；`abort(key)` 使该调用者自身收到 `code: -1` 中止结果，共享执行（传输层）不因取消而
   * 中断、继续完成。注意 `abort(key)` 按 key 广播，同一去重组（共享相同 key）的调用者均收到
   * 中止结果。
   *
   * @typeParam D - 响应数据类型
   * @param requestConfig - 请求配置（url 为必填）
   * @returns 响应结果 Promise
   */
  const request = <D = any>(requestConfig: RequestConfig): Promise<ResponseResult<FullRequestConfig, D>> => {
    let fullRequestConfig: FullRequestConfig & RequestConfig;
    try {
      const defaults = getOriginalRequestConfig();
      fullRequestConfig = {
        ...defaults,
        ...requestConfig,
        rawRequestConfig: requestConfig,
        header: { ...defaults.header, ...requestConfig.header },
      } as FullRequestConfig;
    }
    catch (error) {
      // 合并阶段同步异常：归一化为失败结果（请求配置字段尽力保留）。
      // 若 requestConfig 属性含抛错 getter，首次展开已触发；catch 内不再二次展开，
      // 改用一个永不读取其属性的最小兜底对象，避免重复 throw。
      return Promise.resolve(normalizeError<D>(error, undefined, { rawRequestConfig: requestConfig } as FullRequestConfig));
    }

    if (!fullRequestConfig.isDedup) return core<D>(fullRequestConfig);

    let dedupKey: string;
    try {
      dedupKey = `Request:${simpleHash(stableStringify(fullRequestConfig)!)}`;
    }
    catch (error) {
      // hash 阶段同步异常（如 data 含循环引用）：归一化为失败结果
      return Promise.resolve(normalizeError<D>(error, undefined, fullRequestConfig));
    }

    // 去重时共享执行不绑定用户 key（key 置空），传输层不注册用户取消监听，
    // 因此任一调用者（含等待者）取消都不会中断共享执行；
    // 每个调用者用自身 key 包裹等待，abort(key) 使该调用者自身收到 -1。
    // 注意：共享执行阶段 key 已剥除，请求拦截器在此路径下改写 key 不生效（见 ADR 0005 §4）。
    const wait = () => asyncDedupe(dedupKey, () => core<D>({ ...fullRequestConfig, key: undefined }));
    return fullRequestConfig.key
      ? cancelable(fullRequestConfig.key, wait)
          .catch(error => Promise.resolve(normalizeError<D>(error, undefined, fullRequestConfig)))
      : wait();
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
      // 泛型 R 下 Partial<R> 无法由具体对象类型静态满足，需断言到 RequestConfig
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

export {
  type BaseRequestConfig,
  CancelError,
  createFetch,
  type ErrorResponseResult,
  FetchCode,
  isSuccessResult,
  type ResponseResult,
  type SuccessResponseResult,
};

export default createFetch;
