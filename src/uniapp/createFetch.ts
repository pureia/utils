import { CancelError, createAsyncDedupe, createCancelable, stableStringify } from '../core';

type FetchMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'HEAD' | 'OPTIONS' | 'TRACE';

/**
 * 基本请求配置：每次请求的默认参数，经 `createFetch` 的 `getOriginalRequestConfig` 传入。
 */
interface BaseRequestConfig {
  /** 主机地址，与请求 url 拼接为完整地址 */
  host: string;
  method: FetchMethod;
  header: Record<string, string>;
  /** 超时时间（单位：毫秒） */
  timeout: number;
  /** 是否开启请求去重，开启后相同配置的并发请求只会执行一次 */
  isDedup: boolean;
  /** 视为成功的 HTTP 状态码数组，默认 [200]；不在数组内的码（含哨兵码）视为失败 */
  successStatusCodes?: number[];
}

/**
 * 非 HTTP 的传输/流程错误码（哨兵码），与 HTTP 状态码共同构成 `code` 的取值空间。
 */
const FetchCode = {
  /** 中止（主动取消或传输层中止；二者共用哨兵码，用 `error instanceof CancelError` 区分） */
  ABORT: -1,
  /** 超时 */
  TIMEOUT: -2,
  /** 未知错误 */
  UNKNOWN: -3,
  /** 拦截器/业务错误（拦截器抛出后归一化）；亦承载请求未发出的框架错误（如 uni.request 同步抛错） */
  INTERCEPTOR: -4,
} as const;

/** 去重键前缀：区分去重键取值空间（普通前缀字符串即可，语义稳定即可） */
const DEDUP_KEY_PREFIX = 'Request:';
/** 视为有效的 HTTP 状态码范围（含边界）：仅 100-599 透传，其余走哨兵归一路径 */
const MIN_HTTP_STATUS = 100;
const MAX_HTTP_STATUS = 599;
/** 默认视为成功的 HTTP 状态码（successStatusCodes 缺省时）；只读数组，作为共享默认值不可被外部修改 */
const DEFAULT_SUCCESS_CODES: readonly number[] = [200];
/** simpleHash 双哈希参数（种子/乘数取自常见双哈希实现，保证 32 位 x 2 的混合分布） */
const HASH_SEED_H1 = 0xDEADBEEF;
const HASH_SEED_H2 = 0x41C6CE57;
const HASH_MULT_H1 = 2654435761;
const HASH_MULT_H2 = 1597334677;

/**
 * 统一响应结果：所有路径（成功/传输错误/HTTP 错误/业务错误/取消）的公共出口，
 * 调用方无需 try/catch——`ok` 判成败、`code` 区分失败类别；`ok` 为普通 boolean
 * 不收窄 `data`（恒为 `D | null`），需要时自行断言。
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
  header: Record<string, string>;
  cookies: string[];
  requestConfig: R;
  /** 响应数据，失败时可能为空；拦截器错误时保留响应现场。类型恒为 `D | null`，成功时按需按 `ok` 断言 */
  data: D | null;
  /** 原始错误：拦截器抛错与主动取消时存在（CancelError 实例）；HTTP 错误与传输失败时为 undefined。用 `instanceof CancelError` 区分主动取消与传输层中止 */
  error?: unknown;
}

/** 类型守卫：判断值是否为合法的完整请求配置（请求拦截器返回值运行时校验） */
function isRequestConfigLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  // 请求拦截器返回的是完整合并配置（整体替换语义），核心字段必须齐全；
  // 缺 url/host 会产出畸形 URL，缺 method/header/timeout/isDedup 会被平台按默认值
  // 静默处理而破坏调用方语义。key 为可选字段，不做强校验（可信使用方契约）。
  return typeof v.url === 'string'
    && typeof v.host === 'string'
    && typeof v.method === 'string'
    && typeof v.header === 'object' && v.header !== null
    && typeof v.timeout === 'number'
    && typeof v.isDedup === 'boolean';
  // data 任意；successStatusCodes 可选数组（非必填不做强校验）；key 可选（可信使用方）
}

/** 类型守卫：判断值是否为合法的统一响应结果（响应拦截器返回值运行时校验） */
function isResponseResultLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  // 响应拦截器返回的是完整 ResponseResult（整体替换语义）：校验核心形状
  // ok/code/msg/data（缺任一会让调用方读到运行时 undefined 的半成品结果）
  return typeof v.ok === 'boolean'
    && typeof v.code === 'number'
    && typeof v.msg === 'string'
    && 'data' in v;
  // header/cookies/requestConfig 存在性与 code 有限性不做强校验（可信使用方契约）
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
 * 默认配置与请求配置合并后的完整配置（`buildFullConfig` 的返回类型）。
 * 请求配置提供的字段整体替换（含 `rawRequestConfig` 原始引用与深合并后的 `header`）。
 */
type MergedRequestConfig<
  R extends BaseRequestConfig,
  RC extends RequestConfigLike<R>
> = Omit<R, keyof RC> & RC & { readonly rawRequestConfig: RC; header: Record<string, string> };

/**
 * 合并默认配置与请求配置为完整配置：除 `header` 按字段深合并（叠加）外，
 * 其余字段请求配置提供即整体替换（数组按引用替换）；`rawRequestConfig` 保留原始引用。
 *
 * @typeParam R - 默认配置类型（需继承 `BaseRequestConfig`）
 * @typeParam RC - 请求配置类型（默认配置的部分覆盖 + url/data/key 扩展）
 * @param defaults - 默认配置
 * @param requestConfig - 请求配置（url 必填）
 * @returns 合并后的完整配置
 * @throws 合并可能同步抛错（如属性 getter），由调用方 try/catch 兜底
 *
 * @example
 * ```ts
 * const config = buildFullConfig(defaults, { url: '/users', header: { Authorization: 'Bearer t' } });
 * // header 深合并 => 与 defaults.header 叠加；rawRequestConfig => 请求配置原引用
 * ```
 */
export function buildFullConfig<
  R extends BaseRequestConfig,
  RC extends RequestConfigLike<R>
>(defaults: R, requestConfig: RC): MergedRequestConfig<R, RC> {
  // 显式 undefined 视为"未提供"：可选展开（如 `{ successStatusCodes } = maybeOptional` 后再传参）
  // 是常见来源，undefined 覆盖默认值会静默改变语义（如 successStatusCodes 回落全局默 [200]）。
  // header 深合并为独立路径，其 spread 天然忽略 undefined，不受过滤影响。
  const defined = Object.fromEntries(
    Object.entries(requestConfig).filter(([, value]) => value !== undefined)
  ) as Record<string, unknown>;
  // 合并对象在运行时字段齐全（defaults 补齐 RC 缺省的必填字段），
  // 但类型层面 spread 会把重叠字段推断为"可缺省"（如 method: FetchMethod | undefined），
  // 无法静态满足目标类型，故保留此运行时为真的断言。
  return {
    ...defaults,
    ...defined,
    rawRequestConfig: requestConfig,
    header: { ...defaults.header, ...requestConfig.header },
    // Object.fromEntries 擦除了整对象键的精确类型，此处经 unknown 中转断言
  } as unknown as MergedRequestConfig<R, RC>;
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
    // message/msg 分别校验为非空字符串：空 message 不得遮蔽有效的 msg
    const { message, msg } = error as { message?: unknown; msg?: unknown };
    if (typeof message === 'string' && message) return message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return 'Unknown Error';
}

/**
 * 简单哈希函数，基于双哈希算法生成稳定的十六进制字符串
 * @param str - 要哈希的字符串
 * @returns 十六进制哈希值
 */
function simpleHash(str: string): string {
  let h1 = HASH_SEED_H1; let h2 = HASH_SEED_H2;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, HASH_MULT_H1);
    h2 = Math.imul(h2 ^ ch, HASH_MULT_H2);
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
 * @returns 统一后的状态码：-1=中止，-2=超时，-3=未知错误，100-599 的 HTTP 状态码原样返回
 */
function getStatusCode(code?: number | null, defaultMsg?: string) {
  // 仅 number 且 100-599 视为有效 HTTP 状态；字符串状态码（平台异常数据，
  // 如 '200'）不归一为数字——透传会违约 code: number 声明且 includes 误判失败，
  // 按无 HTTP 状态进入哨兵路径（1-99 的异常正数同样归一，不透传）
  if (typeof code === 'number' && code >= MIN_HTTP_STATUS && code <= MAX_HTTP_STATUS) return code;
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
  // 仅 -3（未知）回退原始 errMsg：-4 的 msg 由 normalizeError 直接取抛出的业务消息，不经本函数
  if (code === FetchCode.UNKNOWN) return defaultMsg ?? 'Unknown Msg';
  return HTTP_STATUS_TEXT[code] ?? `HTTP ${code}`;
}

/**
 * 拦截器管理器，用于管理请求/响应拦截器链
 *
 * 拦截器数组为私有状态：公共面仅暴露 `use` 注册方法，`snapshot()` 仅供 core
 * 入口读取快照——调用方无法绕过 `use` 直接修改拦截器链。
 *
 * @typeParam C - 拦截器处理的数据类型
 * @returns 拦截器管理器实例（use 注册 + snapshot 快照）
 */
function createInterceptorManager<C>() {
  /** 拦截器处理函数：接收数据并返回处理后的数据（支持异步）；抛错由错误归一化收口 */
  type InterceptorHandler = (config: C) => C | Promise<C>;

  const handlers: InterceptorHandler[] = [];
  /**
   * 注册拦截器
   * @param fulfilled - 成功处理函数
   */
  const use = (fulfilled: InterceptorHandler) => {
    handlers.push(fulfilled);
  };

  /**
   * 当前已注册拦截器链的快照（数组副本），core 入口一次性读取
   * @returns 按注册顺序排列的拦截器数组
   */
  const snapshot = () => [...handlers];

  return { use, snapshot };
}

/**
 * 创建请求实例：基于 `uni.request`，所有路径（传输错误、HTTP 错误、拦截器抛出、
 * 主动取消）都归一化为带 `code` 的失败结果，调用方无需 try/catch。
 * 通过 `getOriginalRequestConfig` 提供默认配置，每次请求可部分覆盖。
 *
 * @typeParam R - 基础请求配置类型（需继承 `BaseRequestConfig`）
 * @param getOriginalRequestConfig - 获取默认配置的函数，每次请求时调用
 * @returns 请求实例：`request`/`get`/`post`/`put`/`delete`（发送请求，后四者自动设置 method）、
 *   `interceptors`（request/response 拦截器，返回值经形状校验、抛错归一化收口）、`abort(key)`（按 key 取消）
 *
 * @example
 * ```ts
 * const fetch = createFetch(() => ({ host: 'https://api.example.com', method: 'GET', header: {}, timeout: 10000, isDedup: false }));
 * // 永不 reject，判断 ok 即可；ok 不收窄 data，按需断言
 * const result = await fetch.get<{ id: number }>({ url: '/users/1' });
 * if (result.ok) console.log(result.data!.id);
 * else console.log(result.code, result.msg);
 * fetch.request({ url: '/users', key: 'user-list' }); // 取消时归一化为 code: -1
 * fetch.abort('user-list');
 * ```
 */
function createFetch<R extends BaseRequestConfig>(
  getOriginalRequestConfig: () => R
) {
  const { asyncDedupe } = createAsyncDedupe();
  const { cancelable, cancel, isPending } = createCancelable();

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

  const requestManager = createInterceptorManager<FullRequestConfig>();
  const responseManager = createInterceptorManager<ResponseResult<FullRequestConfig, unknown>>();
  // 公共面仅暴露 use：snapshot 与拦截器数组为内部实现（core 入口快照读取），
  // 调用方无法绕过 use 修改拦截器链
  const interceptors = {
    request: { use: requestManager.use },
    response: { use: responseManager.use },
  };

  /**
   * 以可取消的方式执行拦截器处理函数
   * @param key - 请求 key
   * @param fn - 拦截器处理函数（可为同步；非 key 路径原样返回）
   * @returns 处理后的结果
   */
  // 拦截器处理函数类型为 C | Promise<C>（同步合法），故统一以 Promise.resolve 包装，
  // 满足 cancelable 的"异步函数"契约（同步值/同步抛错行为与直接透传等价）
  const runInterceptor = <T>(key: string | undefined, fn: () => T | Promise<T>) => key ? cancelable(key, () => Promise.resolve(fn())) : fn();

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
    // （取消/完成竞态由核心域仲裁：complete 已触发、结果已在手时，窗口内到达的
    // abort 自动作废，返回真实响应——见 createCancelable 的时序契约。）
    const responsePromise = new Promise<ResponseResult<FullRequestConfig, D>>((resolve) => {
      requestTask = uni.request({
        // host 去尾斜杠、url 去首斜杠后用单斜杠连接：避免相邻斜杠产出 `//`，
        // 或 url 缺首斜杠产出缺失分隔符的畸形 URL。
        url: `${host.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`,
        method,
        header,
        timeout,
        // data 类型为 unknown（见 RequestConfig），传平台时按 uni.request 签名收窄
        data: data as UniApp.RequestOptions['data'],
        complete(result) {
          try {
            const {
              data: respData,
              header: respHeader,
              cookies,
              errMsg: msg,
              statusCode: code,
            } = result as UniApp.GeneralCallbackResult & UniApp.RequestSuccessCallbackResult;

            const statusCode = getStatusCode(code, msg);
            const ok = (fullRequestConfig.successStatusCodes ?? DEFAULT_SUCCESS_CODES).includes(statusCode);
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
          }
          catch (error) {
            // 平台回调异常数据（errMsg 非字符串、result 为 null 等）：归一化为 -4 而非让
            // responsePromise 永不落定——无 key 请求此前无 abort 脱身路径，会永久挂起
            resolve(normalizeError<D>(error, undefined, fullRequestConfig));
          }
        },
      });
    });

    return key ? cancelable(key, () => responsePromise, { onCancel: () => requestTask?.abort() }) : responsePromise;
  };

  /**
   * 核心请求流程：依次执行请求拦截器 → 发送请求 → 依次执行响应拦截器
   *
   * 任何阶段的异常（拦截器抛错、主动取消、传输错误）都被归一化为失败结果，
   * 本函数永不 reject。
   *
   * @typeParam D - 响应数据类型
   * @param config - 完整请求配置
   * @param requestInterceptorChain - 请求拦截器链快照（request() 同步栈拍取，见其注记）
   * @param responseInterceptorChain - 响应拦截器链快照（同上）
   * @returns 经过拦截器处理后的响应结果
   */
  const core = async <D>(
    config: FullRequestConfig,
    requestInterceptorChain: ReturnType<typeof requestManager.snapshot>,
    responseInterceptorChain: ReturnType<typeof responseManager.snapshot>
  ) => {
    let fullRequestConfig = config;
    // key 唯一性告警：另一进行中的请求已占用该 key，abort(key) 将同时取消它们
    fullRequestConfig.key && isPending(fullRequestConfig.key) && console.warn(`[createFetch] key "${fullRequestConfig.key}" 已被其他进行中的请求占用，abort(key) 会同时取消所有同 key 请求，请保证并发请求间 key 唯一`);
    for (const onFulfilled of requestInterceptorChain) {
      try {
        const interceptorResult = await runInterceptor(fullRequestConfig.key, () => onFulfilled(fullRequestConfig));
        // 运行时校验：请求拦截器必须返回合法的完整请求配置（url/host/method/header/
        // timeout/isDedup），非法（如漏 return、缺字段）则告警并沿用上一配置，
        // 避免拼出畸形 URL 或在读取 .key 处抛晦涩 TypeError
        if (!isRequestConfigLike(interceptorResult)) {
          console.warn('[createFetch] 请求拦截器必须返回完整请求配置（url/host/method/header/timeout/isDedup），非法返回值已被忽略并沿用上一配置');
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

    let fullResponseResult: ResponseResult<FullRequestConfig, D>;
    try {
      fullResponseResult = await dispatchRequest<D>(fullRequestConfig);
    }
    catch (error) {
      // dispatchRequest 的 reject 两个来源：uni.request 同步抛错（请求未发出的框架错误，
      // 归一化为 -4）与取消（cancelable 以 CancelError 拒绝，归一化为 -1）；二者由 normalizeError 区分
      return normalizeError<D>(error, undefined, fullRequestConfig);
    }

    for (const onFulfilled of responseInterceptorChain) {
      try {
        const interceptorResult = await runInterceptor(fullRequestConfig.key, () => onFulfilled(fullResponseResult));
        // 运行时校验：响应拦截器必须返回完整的统一响应结果（ok/code/msg/data），
        // 否则告警并沿用上一结果，避免类型谎言沿拦截器链扩散
        // （如需"解包"，应改写 ResponseResult.data 而非返回裸数据）。
        if (!isResponseResultLike(interceptorResult)) {
          console.warn('[createFetch] 响应拦截器必须返回完整 ResponseResult（ok/code/msg/data），非法返回值已被忽略并沿用上一结果');
        }
        else {
          // 边界断言：返回值已通过 isResponseResultLike 核心形状校验（ok/code/msg/data），
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
   * 发送请求：自动合并默认配置与请求配置（规则见 `buildFullConfig`）
   *
   * 永不 reject、永不同步抛错——合并与去重键 hash 阶段的同步异常（如 `data` 含循环引用）
   * 同样归一化为 `code: -4`。`isDedup` 开启时 `abort(key)` 中止整组
   * （执行者与所有等待者统一收到 `-1`）。
   *
   * @typeParam D - 响应数据类型
   * @param requestConfig - 请求配置（url 必填）
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

    // 拦截器链快照：以 request() 同步栈为准一次拍取，去重/非去重两条路径共用同一时机——
    // 进行中的请求（含去重 executor 微任务启动的窗口）只执行发起时刻已注册的拦截器，
    // 执行期间新注册的只影响后续请求（若在 core 内拍取，去重路径会晚一拍，同 tick 注册的
    // 拦截器将污染进行中的去重请求，与非去重路径不一致）
    const requestInterceptorChain = requestManager.snapshot();
    const responseInterceptorChain = responseManager.snapshot();

    if (!fullRequestConfig.isDedup) return core<D>(fullRequestConfig, requestInterceptorChain, responseInterceptorChain);

    let dedupKey: string;
    try {
      dedupKey = `${DEDUP_KEY_PREFIX}${simpleHash(stableStringify(fullRequestConfig)!)}`;
    }
    catch (error) {
      // hash 阶段同步异常（如 data 含循环引用）：归一化为失败结果
      return Promise.resolve(normalizeError<D>(error, undefined, fullRequestConfig));
    }

    // 去重请求取消 = 整组取消：共享执行透传用户 key，abort(key) 中止整组共享执行
    // （拦截器/传输层），执行者与所有等待者统一收到 -1。共享执行经核心域取消语义
    // 短路：起跑前（同一 tick）的 abort 对去重 keyed 请求不生效（此时实例级取消注册
    // 尚未建立，abort 为静默 no-op），请求照常发出并返回真实结果。
    return asyncDedupe(dedupKey, () => core<D>(fullRequestConfig, requestInterceptorChain, responseInterceptorChain));
  };

  /**
   * 快捷方法工厂：生成固定 method 的短版请求函数（get/post/put/delete
   * 仅 method 字面量不同，其余逻辑一致——以此消除四份重复）。
   *
   * @typeParam M - 请求方法
   * @param method - 固定请求方法
   * @returns 快捷请求函数：`(requestConfig) => Promise<ResponseResult>`，method 自动设置
   */
  const shortcut = <M extends FetchMethod>(method: M) =>
    <D = unknown>(requestConfig: ShortcutRequestConfig) =>
      // 泛型 R 下 Omit<Partial<R>, 'method'> 无法静态满足 Partial<R>（TS2345），需断言
      request<D>({ ...requestConfig, method } as RequestConfig);

  return {
    /**
     * 按 key 取消请求：key 下所有进行中的注册（拦截器阶段与传输层）统一归一化为
     * `code: -1`；未知 key 为静默 no-op。取消只丢弃未落定的结果，不打断已进入的
     * 拦截器代码执行；并发请求间应保证 key 唯一，否则互为取消组。
     *
     * 取消机制（实现注记）：执行期取消由实例级 `createCancelable` 广播（拦截器/
     * 传输层，同 tick abort 时非去重请求在同步栈内已注册、去重请求的共享执行在
     * 微任务内才注册——起跑前窗口的 abort 为 no-op）；去重请求的 `abort(key)` 为
     * 整组取消（执行者与等待者同收 -1）。网络层请求已完成（complete 已触发、
     * 结果已在手）时，竞态窗口内到达的取消自动作废、返回真实响应（由核心域
     * 取消/完成竞态仲裁，无需额外门闩）。
     */
    abort(key: string) {
      cancel(key); // 执行期取消（拦截器/传输层）
    },
    /**
     * 拦截器管理器：`request` 处理完整请求配置、`response` 处理统一响应结果；
     * 返回值经运行时形状校验，非法时告警并沿用上一值；抛错被归一化收口
     * （`CancelError` → `-1`，其余 → `-4`）。`header` 为合并副本可安全改写，
     * `rawRequestConfig` 与 `data` 为调用方原始引用，不应修改。
     */
    interceptors,
    /** 发送请求，method 由请求配置决定；配置合并与去重取消规则见 request 定义处 */
    request,
    /** 发送 GET 请求（method 自动设为 'GET'）；签名见 `shortcut` 工厂 */
    get: shortcut('GET'),
    /** 发送 POST 请求（method 自动设为 'POST'）；签名见 `shortcut` 工厂 */
    post: shortcut('POST'),
    /** 发送 PUT 请求（method 自动设为 'PUT'）；签名见 `shortcut` 工厂 */
    put: shortcut('PUT'),
    /** 发送 DELETE 请求（method 自动设为 'DELETE'）；签名见 `shortcut` 工厂 */
    delete: shortcut('DELETE'),
  };
}

export {
  type BaseRequestConfig,
  createFetch,
  FetchCode,
  type MergedRequestConfig,
  type ResponseResult,
};

export default createFetch;
