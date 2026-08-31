# @purea/utils

一组小而美的 TypeScript 异步工具：可取消执行、并发去重、类型安全事件、稳定序列化，以及开箱即用的 uni-app 请求封装。

## 安装

```bash
pnpm add @purea/utils
```

## 核心工具（平台无关）

| 模块 | 导入路径 | 用途 |
|------|----------|------|
| `createCancelable` | `@purea/utils/core/createCancelable` | 可取消的异步执行（`cancel`/`isPending`/`onCancel`/`CancelError`） |
| `createAsyncDedupe` | `@purea/utils/core/createAsyncDedupe` | 同键并发调用共享一次执行（`asyncDedupe`/`cancelCall`/`isPending`） |
| `createEventEmitter` | `@purea/utils/core/createEventEmitter` | 类型安全的事件发布/订阅 |
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

- 请求/响应拦截器：`fetch.interceptors.request.use(config => ...)` / `fetch.interceptors.response.use(result => ...)`，返回值经运行时形状校验，抛错被归一化收口。

## 开发

```bash
pnpm install
pnpm dev          # 构建 watch
pnpm test:watch   # 测试 watch
pnpm typecheck    # 类型检查
pnpm lint:check   # lint 检查
```

> 本地运行 lint 需要 Node 22+（ESLint 工具链依赖 `Object.groupBy`）；`engines` 声明的 `node >=18` 为运行时契约。

## License

[MIT](./LICENSE) © Pure Anin
