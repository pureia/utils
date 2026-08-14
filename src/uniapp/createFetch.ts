import { CancelError, createAsyncDedupe, createCancelable, createEventEmitter, stableStringify } from '../core';

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
  /** 拦截器/业务错误（拦截器抛出后归一化）；亦承载请求未发出的框架错误（如 uni.request 同步抛错） */
  INTERCEPTOR: -4,
} as const;

/**
 * 统一响应结果
 *
 * 所有请求路径（成功、传输错误、HTTP 错误、业务错误、取消）的公共出口，
 * 调用方无需 try/catch：`ok` 判成败、`code` 区分失败类别。
 *
 * 注：`ok` 为普通 boolean，不再收窄 `data`——成功时业务上 `data` 非空，
 * 但类型上恒为 `D | null`，需要时由调用方按 `ok` 自行断言。
 *
 * @typeParam R - 完整请求配置类型
 * @typeParam D - 响应数据类型
 */
interface ResponseResult<R, D> {
  /** 是否成功：HTTP 状态码在配置的成功状态码数组内时为 true */
  ok: boolean;
  /** 状态码：成功时为配置的成功状态码之一；失败时为 HTTP 错误码或哨兵码（-1/-2/-3/-4） */
  code: number;
  /** 状态码描述 */
  msg: string;
  /** 响应头 */
  header: Record<string, string>;
  /** cookies */
  cookies: string[];
  /** 请求配置信息 */
  requestConfig: R;
  /** 响应数据，失败时可能为空；拦截器错误时保留响应现场。类型恒为 `D | null`，成功时按需按 `ok` 断言 */
  data: D | null;
  /** 原始错误对象：拦截器抛错与主动取消（CancelError 实例）时存在；HTTP 错误与传输失败（超时/网络中止/未知错误）时为 undefined。区分主动取消与传输层中止可对 `error` 做 `instanceof CancelError`（该类由 `@purea/utils/core/createCancelable` 导入，本模块不再转出） */
  error?: unknown;
}

/** 类型守卫：判断值是否为合法的请求配置（请求拦截器返回值运行时校验） */
function isRequestConfigLike(value: unknown): boolean {
  // 校验拼接 URL 的关键字段 url 与 host：缺任一都会产出畸形请求（如 `undefined${url}`）
  return typeof value === 'object' && value !== null
    && typeof (value as { url?: unknown }).url === 'string'
    && typeof (value as { host?: unknown }).host === 'string';
}

/** 类型守卫：判断值是否为合法的统一响应结果（响应拦截器返回值运行时校验） */
function isResponseResultLike(value: unknown): boolean {
  return typeof value === 'object' && value !== null
    && typeof (value as { ok?: unknown }).ok === 'boolean'
    && typeof (value as { code?: unknown }).code === 'number';
}

/**
 * `buildFullConfig` 的请求配置约束：默认配置的部分覆盖 + url/data/key 扩展
 *
 * `method`/`header` 显式放开为可选（而非继承默认配置的窄字面量类型），
 * 避免默认配置字面量（如 `method: 'GET'`）卡死请求配置的类型。
 */
type RequestConfigLike<R extends BaseRequestConfig> = Omit<Partial<R>, 'method' | 'header'> & {
  url: string;
  data?: unknown;
  key?: string;
  method?: FetchMethod;
  header?: Record<string, string>;
};

/**
 * 默认配置与请求配置合并后的完整配置（`buildFullConfig` 的返回类型）
 *
 * 为 Omit 形态：请求配置提供的字段整体替换为请求配置的类型（含 `rawRequestConfig` 原始引用、
 * 深合并后的 `header`）。与请求实例内的 `FullRequestConfig`（交集形态，由 defaults 补齐必填字段）
 * 语义不同——本类型对"必填型请求配置"调用方给出更精确的合并结果。
 */
type MergedRequestConfig<
  R extends BaseRequestConfig,
  RC extends RequestConfigLike<R>
> = Omit<R, keyof RC> & RC & { readonly rawRequestConfig: RC; header: Record<string, string> };

/**
 * 合并默认配置与请求配置为完整请求配置
 *
 * 合并规则：`header` 按字段深合并（叠加）；其余字段请求配置提供即整体替换
 * （数组按引用替换，不做索引合并）；`rawRequestConfig` 保留请求配置原始引用。
 * 本函数为纯同步合并，同步抛错（如属性 getter）由调用方 try/catch 兜底。
 *
 * @typeParam R - 默认配置类型，需继承 `BaseRequestConfig`
 * @typeParam RC - 请求配置类型（默认配置的部分覆盖 + url/data/key 扩展）
 * @param defaults - 默认配置
 * @param requestConfig - 请求配置（url 为必填）
 * @returns 合并后的完整配置（MergedRequestConfig）
 */
export function buildFullConfig<
  R extends BaseRequestConfig,
  RC extends RequestConfigLike<R>
>(defaults: R, requestConfig: RC): MergedRequestConfig<R, RC> {
  // 合并对象在运行时字段齐全（defaults 补齐 RC 缺省的必填字段），
  // 但类型层面 spread 会把重叠字段推断为"可缺省"（如 method: FetchMethod | undefined），
  // 无法静态满足目标类型，故保留此运行时为真的断言。
  return {
    ...defaults,
    ...requestConfig,
    rawRequestConfig: requestConfig,
    header: { ...defaults.header, ...requestConfig.header },
  } as MergedRequestConfig<R, RC>;
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
 * - 负数状态码（部分平台的异常返回值）同样视为「无 HTTP 状态」，不透传以免与负哨兵码
 *   取值空间冲突（如平台 `-1` 撞码 `FetchCode.ABORT`，导致真假中止不可区分）；
 * - 其余无状态码的失败归一到 `-3` 未知错误。
 *
 * @param code - 原始状态码
 * @param defaultMsg - 默认错误消息（uni 的 errMsg）
 * @returns 统一后的状态码：-1=中止，-2=超时，-3=未知错误，正数 HTTP 状态码原样返回
 */
function getStatusCode(code?: number | null, defaultMsg?: string) {
  // 仅正数视为有效 HTTP 状态（HTTP 状态码恒为 100-599）
  if (code && code > 0) return code;
  if (defaultMsg?.startsWith('request:fail abort')) return FetchCode.ABORT;
  if (defaultMsg?.startsWith('request:fail timeout')) return FetchCode.TIMEOUT;
  return FetchCode.UNKNOWN;
}

/**
 * 常用 HTTP 状态码的英文描述
 *
 * 仅收录常见实现，非 RFC 全集；未收录的码（含后端自定义码）由
 * `getStatusCodeMsg` 回退为 `HTTP ${code}`，保证 msg 恒有值。描述仅供调试/兜底展示，
 * 业务语义应由调用方从响应 data 中解析，不应依赖本表。
 */
const HTTP_STATUS_TEXT: Record<number, string> = {
  100: 'Continue',
  101: 'Switching Protocols',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  206: 'Partial Content',
  300: 'Multiple Choices',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  417: 'Expectation Failed',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported',
};

/**
 * 获取状态码对应的描述文本
 *
 * `msg` 的语义约定：
 * - 有 HTTP 状态码时（含 2xx 成功与 4xx/5xx 失败），使用 `HTTP_STATUS_TEXT` 中的描述；
 *   未收录的码（含后端自定义码）回退为 `HTTP ${code}`，保证恒有值——
 *   不透传 uni 的 `errMsg`（其描述传输层结果，HTTP 500 时 errMsg 恒为 "request:ok"，会误导）；
 * - 哨兵码使用固定描述（中止/超时）或原始 `errMsg`（未知错误）；`-4` 的 msg 不经本函数（见下）。
 *
 * 注意：`-4`（拦截器/业务错误）的 msg 由 `normalizeError` 直接取抛出的业务消息，
 * 不经本函数；本函数仅覆盖哨兵码 `-1/-2/-3` 与 HTTP 状态码。
 *
 * @param code - 统一后的状态码
 * @param defaultMsg - 默认消息（uni 的 errMsg）
 * @returns 状态码描述
 */
function getStatusCodeMsg(code: number, defaultMsg?: string) {
  if (code === FetchCode.ABORT) return 'Request Abort';
  if (code === FetchCode.TIMEOUT) return 'Request Timeout';
  if (code < 0) return defaultMsg ?? 'Unknown Msg';
  return HTTP_STATUS_TEXT[code] ?? `HTTP ${code}`;
}

/**
 * 拦截器管理器，用于管理请求/响应拦截器链
 *
 * @typeParam C - 拦截器处理的数据类型
 * @returns 拦截器管理器实例，包含 handlers 数组和 use 注册方法
 */
function createInterceptorManager<C>() {
  /** 拦截器处理函数：接收数据并返回处理后的数据（支持异步）；抛错由错误归一化收口 */
  type InterceptorHandler = (config: C) => C | Promise<C>;

  const handlers: InterceptorHandler[] = [];
  /**
   * 注册拦截器
   * @param fulfilled - 成功处理函数
   * @remarks 注册请走 use；handlers 仅供 core 链快照读取，勿直接改动
   */
  const use = (fulfilled: InterceptorHandler) => {
    handlers.push(fulfilled);
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
 *   // ok 为普通 boolean，不自动收窄 data：成功时业务上非空，按需断言
 *   console.log(result.data!.id); // 1
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
  const { cancelable, cancel, isPending } = createCancelable();
  // 取消意向：只承载「abort 已发生」的标记，不参与执行期注册，避免污染 isPending
  const cancelIntentEmitter = createEventEmitter<Record<string, CancelError>>();

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
    /**
     * 请求数据，POST/PUT 等方法时使用；类型为 unknown：调用方传入任意值，
     * 拦截器读取时需自行收窄/断言（与响应泛型 D 无关）。
     */
    data?: unknown;
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
    response: createInterceptorManager<ResponseResult<FullRequestConfig, unknown>>(),
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
  ): ResponseResult<FullRequestConfig, D> => {
    const isCancel = error instanceof CancelError;
    return {
      ok: false,
      code: isCancel ? FetchCode.ABORT : FetchCode.INTERCEPTOR,
      msg: isCancel ? getStatusCodeMsg(FetchCode.ABORT) : getErrorMessage(error),
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
        // data 类型为 unknown（见 RequestConfig），传平台时按 uni.request 签名收窄
        data: data as UniApp.RequestOptions['data'],
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

          const baseResponse = {
            code: statusCode,
            msg: responseMsg,
            header: respHeader ?? {},
            cookies: cookies ?? [],
            requestConfig: fullRequestConfig,
          };
          // 成功/失败仅 ok 与 data 的取值不同，其余字段共用；统一类型下 data 恒为 D | null
          resolve({ ...baseResponse, ok, data: (respData ?? null) as D | null });
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
    // key 唯一性告警：另一进行中的请求已占用该 key，abort(key) 将同时取消它们
    fullRequestConfig.key && isPending(fullRequestConfig.key) && console.warn(`[createFetch] key "${fullRequestConfig.key}" 已被其他进行中的请求占用，abort(key) 会同时取消所有同 key 请求，请保证并发请求间 key 唯一`);
    // 拦截器链快照：进入 core 时对请求/响应链一次快照（见 ADR 0004 §2），
    // 进行中的请求只执行发起时刻已注册的拦截器，执行期间新注册的只影响后续请求
    const requestInterceptorChain = [...interceptors.request.handlers];
    const responseInterceptorChain = [...interceptors.response.handlers];
    // 请求拦截处理
    for (const onFulfilled of requestInterceptorChain) {
      try {
        const interceptorResult = await runInterceptor(fullRequestConfig.key, () => onFulfilled(fullRequestConfig));
        // 运行时校验：请求拦截器必须返回合法的请求配置，
        // 非法（如漏 return、缺 url/host）则告警并沿用上一配置，避免后续拼出 `undefined${url}`
        // 畸形 URL 或在读取 .key 处抛晦涩 TypeError。
        if (!isRequestConfigLike(interceptorResult)) {
          console.warn('[createFetch] 请求拦截器必须返回请求配置（含 url 与 host 字段），非法返回值已被忽略');
        }
        else {
          fullRequestConfig = interceptorResult;
        }
      }
      catch (error) {
        // 拦截器抛错（含主动取消）统一归一化：CancelError → -1，其余 → -4
        return normalizeError<D>(error, undefined, fullRequestConfig);
      }
    }

    // 发送请求
    let fullResponseResult: ResponseResult<FullRequestConfig, D>;
    try {
      fullResponseResult = await dispatchRequest<D>(fullRequestConfig);
    }
    catch (error) {
      // dispatchRequest 的 reject 仅来自 uni.request 同步抛错（请求未发出的框架错误），归一化为 -4
      return normalizeError<D>(error, undefined, fullRequestConfig);
    }

    // 响应拦截处理
    for (const onFulfilled of responseInterceptorChain) {
      try {
        const interceptorResult = await runInterceptor(fullRequestConfig.key, () => onFulfilled(fullResponseResult));
        // 运行时校验：响应拦截器必须返回合法的统一响应结果，否则告警并沿用上一结果，
        // 避免类型谎言沿拦截器链扩散（如需"解包"，应改写 ResponseResult.data 而非返回裸数据）。
        if (!isResponseResultLike(interceptorResult)) {
          console.warn('[createFetch] 响应拦截器必须返回 ResponseResult（含 ok/code 字段），非法返回值已被忽略');
        }
        else {
          // 边界断言：返回值已通过 isResponseResultLike 运行时形状校验（ok/code），
          // data 类型由拦截器决定（unknown 需自行收窄），收窄到当前请求泛型 D 为边界职责
          fullResponseResult = interceptorResult as ResponseResult<FullRequestConfig, D>;
        }
      }
      catch (error) {
        // 拦截器抛错（含主动取消）统一归一化：CancelError → -1，其余 → -4；保留响应现场
        return normalizeError<D>(error, fullResponseResult, fullRequestConfig);
      }
    }

    return fullResponseResult;
  };

  /**
   * 发送请求，自动合并默认配置和请求配置（合并规则见 `buildFullConfig`）
   *
   * 同步兜底：配置合并与去重 hash 计算可能同步抛错（如 `data` 含循环引用时
   * `stableStringify` 抛 TypeError），统一归一化为 `code: -4` 失败结果，保持"永不 reject 且
   * 永不同步 throw"。
   *
   * 去重取消（整组）：`isDedup` 开启时，共享执行透传用户 key，`abort(key)` 中止整个去重组
   * 的共享执行（拦截器/传输层），执行者与所有等待者统一收到 `code: -1`。
   *
   * @typeParam D - 响应数据类型
   * @param requestConfig - 请求配置（url 为必填）
   * @returns 响应结果 Promise
   */
  const request = <D = unknown>(requestConfig: RequestConfig): Promise<ResponseResult<FullRequestConfig, D>> => {
    let fullRequestConfig: FullRequestConfig;
    try {
      // 请求配置类型为全可选覆盖，类型层面无法静态满足 FullRequestConfig（如 method 可能缺省），
      // 运行时由 defaults 补齐，此处断言为真（buildFullConfig 返回值对"必填型 RC"调用方更精确）
      fullRequestConfig = buildFullConfig(getOriginalRequestConfig(), requestConfig) as FullRequestConfig;
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

    // 去重请求取消 = 整组取消：共享执行透传用户 key，abort(key) 中止整组共享执行
    // （拦截器/传输层），执行者与所有等待者统一收到 -1。
    if (!fullRequestConfig.key) return asyncDedupe(dedupKey, () => core<D>(fullRequestConfig));

    let cancelled = false;
    const offIntent = cancelIntentEmitter.once(fullRequestConfig.key, () => { cancelled = true; });
    const executor = () => cancelled ? Promise.resolve(normalizeError<D>(new CancelError(fullRequestConfig.key!), undefined, fullRequestConfig)) : core<D>(fullRequestConfig);
    return asyncDedupe(dedupKey, executor).finally(offIntent);
  };

  return {
    /**
     * 通过请求 key 取消请求
     *
     * 按 key 广播：同一 key 下所有进行中的注册（拦截器阶段与传输层）
     * 统一归一化为 `code: -1`；并发请求间应保证 key 唯一，否则互为取消组。
     * 取消只丢弃未落定的结果，不打断已进入的拦截器代码执行（其副作用仍会跑完）；
     * 未知 key 的 abort 为静默 no-op（请求完成后对旧 key 的兜底取消是合法用法）。
     */
    abort: (key: string) => {
      cancel(key); // 执行期取消（拦截器/传输层，现有路径）
      cancelIntentEmitter.emit(key, new CancelError(key)); // 起跑前取消（新路径）
    },
    /**
     * 拦截器管理器，包含 request（请求拦截）和 response（响应拦截）
     *
     * - request：处理完整请求配置（FullRequestConfig），返回值经运行时形状校验（url+host）；
     * - response：处理统一响应结果（ResponseResult），返回值经运行时形状校验（ok/code）；
     * - 拦截器抛错由错误归一化收口（CancelError → -1，其余 → -4），无恢复语义。
     * - 改写边界：`header` 为每次请求合并出的新对象可安全改写；`rawRequestConfig` 与 `data`
     *   为调用方原始引用，改写会泄漏到调用方对象，不应修改。
     */
    interceptors,
    /** 发送请求，method 由请求配置决定；配置合并与去重取消规则见 request 定义处 */
    request,
    /**
     * 发送 GET 请求
     * @typeParam D - 响应数据类型
     * @param requestConfig - 快捷请求配置（无需提供 method，自动设为 'GET'）
     * @returns 响应结果 Promise
     */
    get<D = unknown>(requestConfig: ShortcutRequestConfig) {
      // 泛型 R 下 Omit<Partial<R>, 'method'> 无法静态满足 Partial<R>（TS2345），需断言
      return request<D>({ ...requestConfig, method: 'GET' } as RequestConfig);
    },
    /**
     * 发送 POST 请求
     * @typeParam D - 响应数据类型
     * @param requestConfig - 快捷请求配置（无需提供 method，自动设为 'POST'）
     * @returns 响应结果 Promise
     */
    post<D = unknown>(requestConfig: ShortcutRequestConfig) {
      return request<D>({ ...requestConfig, method: 'POST' } as RequestConfig);
    },
    /**
     * 发送 PUT 请求
     * @typeParam D - 响应数据类型
     * @param requestConfig - 快捷请求配置（无需提供 method，自动设为 'PUT'）
     * @returns 响应结果 Promise
     */
    put<D = unknown>(requestConfig: ShortcutRequestConfig) {
      return request<D>({ ...requestConfig, method: 'PUT' } as RequestConfig);
    },
    /**
     * 发送 DELETE 请求
     * @typeParam D - 响应数据类型
     * @param requestConfig - 快捷请求配置（无需提供 method，自动设为 'DELETE'）
     * @returns 响应结果 Promise
     */
    delete<D = unknown>(requestConfig: ShortcutRequestConfig) {
      return request<D>({ ...requestConfig, method: 'DELETE' } as RequestConfig);
    },
  };
}

export {
  type BaseRequestConfig,
  createFetch,
  FetchCode,
  type ResponseResult,
};

export default createFetch;
