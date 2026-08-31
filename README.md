# @purea/utils

一组小而美的 TypeScript 异步工具：可取消执行、并发去重、类型安全事件、稳定序列化，以及开箱即用的 uni-app 请求封装。

## 安装

```bash
pnpm add @purea/utils
```

> 包为 **ESM-only**（`"type": "module"`，无 CommonJS 产物）：需 ESM 环境或经构建工具（Vite/Webpack 5+/Rolldown）消费；`require()` 直接加载不可用，建议改用动态 `import()`。

## 核心工具（平台无关）

| 模块 | 导入路径 | 用途 |
|------|----------|------|
| `createCancelable` | `@purea/utils/core/createCancelable` | 可取消的异步执行（`cancelable`/`cancel`/`isPending`，支持 `onCancel` 清理回调） |
| `createAsyncDedupe` | `@purea/utils/core/createAsyncDedupe` | 同键并发调用共享一次执行（`asyncDedupe`/`cancelCall`/`isPending`） |
| `createEventEmitter` | `@purea/utils/core/createEventEmitter` | 类型安全的事件发布/订阅 |
| `debounce` | `@purea/utils/core/debounce` | 时间窗防抖（`immediate` 可选 leading/trailing，携带 `cancel`/`flush`） |
| `stableStringify` | `@purea/utils/core/stableStringify` | 确定性 JSON 序列化（键排序，供去重键哈希等场景） |

```ts
import { CancelError, createCancelable } from '@purea/utils/core/createCancelable';

const { cancelable, cancel } = createCancelable();
const promise = cancelable('my-key', () => fetchSomething());
cancel('my-key');

// promise 以 CancelError 拒绝；用 instanceof 与真实错误区分
await promise.catch((error) => {
  if (error instanceof CancelError) return;
  throw error;
});
```

### 其他公共导出

- `buildFullConfig(defaults, requestConfig)`：与 createFetch 内部同源的配置合并函数（公共 API）。合并规则：`header` 按字段深合并（叠加），其余字段请求配置提供即整体替换（数组按引用替换），`rawRequestConfig` 保留请求配置原始引用。

```ts
import { buildFullConfig } from '@purea/utils/uniapp/createFetch';

const defaults = { host: 'https://api.example.com', method: 'GET' as const, header: {}, timeout: 10000, isDedup: false };
const config = buildFullConfig(defaults, { url: '/users', header: { 'X-Extra': '1' } });
void config; // header 深合并 => { 'X-Extra': '1' }；rawRequestConfig => 请求配置原引用
```

- `FetchCode`：请求域哨兵码常量集（`-1` 中止 / `-2` 超时 / `-3` 未知 / `-4` 拦截器/业务错误,亦承载请求未发出的框架错误）。

```ts
import { FetchCode } from '@purea/utils/uniapp/createFetch';

if (!result.ok && result.code === FetchCode.ABORT) { /* 主动取消或传输层中止 */ }
```

- 类型：`BaseRequestConfig`、`ResponseResult`、`MergedRequestConfig`、`CmpFunc`、`ReplacerFunc`、`StableStringifyOptions`。

## uni-app 请求工具：createFetch

uni-app 专属，基于全局 `uni.request` 封装。

> ⚠️ `createFetch` 依赖运行时全局 `uni`，仅适用于 uni-app 环境；非 uni 项目请从核心工具子路径导入（如 `@purea/utils/core/createCancelable`），不要从根入口 `@purea/utils` 引入。

### 快速上手

```ts
import { createFetch } from '@purea/utils';

const fetch = createFetch(() => ({
  host: 'https://api.example.com',
  method: 'GET',
  header: { 'Content-Type': 'application/json' },
  timeout: 10000,
  isDedup: false,
  successStatusCodes: [200],
}));

// 基本请求：永不 reject，判断 ok 即可
const result = await fetch.get<{ id: number }>({ url: '/users/1' });
if (result.ok) {
  // 成功：ok 为普通 boolean，data 按需断言
  const { id } = result.data!;
  void id;
}
else {
  // 失败：按 code/msg 处理
  void result.code;
}

// 取消请求：按 key 广播，归一化为 code: -1
fetch.request({ url: '/users', method: 'GET', key: 'user-list' });
fetch.abort('user-list');

// 请求去重：相同配置的并发请求共享一次执行，只发出一次网络请求
const fetchDedup = createFetch(() => ({
  host: 'https://api.example.com',
  method: 'GET',
  header: {},
  timeout: 10000,
  isDedup: true,
}));
await Promise.all([
  fetchDedup.get({ url: '/users/1' }),
  fetchDedup.get({ url: '/users/1' }),
]);
```

### 请求去重的语义边界

`isDedup: true` 时，去重键 = **请求拦截器执行之前**的全量合并配置的稳定序列化哈希（包含 `key`、`data`、`header` 等全部字段）。

- **不同 `key` 不视为相同去重键**：相同 url/data 但 `key` 不同的并发请求会各自发起。
- **等待者不执行拦截器链**：去重组中只有执行者（首个调用者）运行请求/响应拦截器，等待者直接复用执行者的最终结果——若拦截器带副作用（埋点/计数/token 刷新），等待者的调用在拦截器层面不可见。
- **去重判定基于拦截器前配置**：拦截器改写请求（如补 token、改 url）不改变去重归组。

### 统一响应结果

所有请求路径（成功、传输错误、HTTP 错误、业务错误、取消）都归一化为同一结构，**永不 reject、永不同步抛错**：

```ts
export interface ResponseResult<R, D> {
  ok: boolean; // code 在 successStatusCodes 内为 true
  code: number; // HTTP 状态码或哨兵码（-1 中止 / -2 超时 / -3 未知 / -4 拦截器/业务错误,亦承载请求未发出的框架错误）
  msg: string; // 状态码描述
  header: Record<string, string>;
  cookies: string[];
  requestConfig: R;
  data: D | null;
  error?: unknown; // 拦截器抛错与主动取消时存在（CancelError）
}
```

- 请求/响应拦截器：`fetch.interceptors.request.use(config => ...)` / `fetch.interceptors.response.use(result => ...)`，返回值经运行时形状校验，抛错被归一化收口。校验要求**完整形状**：请求拦截器须返回完整请求配置（url/host/method/header/timeout/isDedup，key 可选；原配置含 key 而返回值丢 key 视为非法，保证 `abort(key)` 不失效），响应拦截器须返回完整 `ResponseResult`（缺 `data`/`header`/`cookies` 等字段视为非法）；非法返回值告警并沿用上一值。

### 失败类别速查表

| code | 含义 | 是否进响应链 | `error` 字段 |
|------|------|--------------|--------------|
| `successStatusCodes` 内 | 成功响应 | 是 | undefined |
| 4xx/5xx 等 HTTP 码 | HTTP 错误 | 是 | undefined |
| `FetchCode.ABORT` (-1) | 主动取消或传输层中止 | 用户主动取消：否；传输层中止：是 | 主动取消时为 `CancelError` 实例；中止时 undefined（`instanceof CancelError` 可区分） |
| `FetchCode.TIMEOUT` (-2) | 超时 | 是 | undefined |
| `FetchCode.UNKNOWN` (-3) | 未知/无有效 HTTP 状态 | 是 | undefined |
| `FetchCode.INTERCEPTOR` (-4) | 拦截器/业务错误、请求未发出的框架错误 | 否 | 原始异常（业务对象或 Error） |

## 开发

```bash
pnpm install
pnpm dev          # 构建 watch
pnpm test:watch   # 测试 watch
pnpm typecheck    # 类型检查
pnpm lint         # lint 检查（lint:fix 自动修复）
```

> 本地运行 lint 需要 Node 22+（ESLint 工具链依赖 `Object.groupBy`）；`engines` 声明的 `node >=18` 为运行时契约。

## License

[MIT](./LICENSE) © Pure Anin
