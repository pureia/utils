# 类型卫生补强：拦截器 data 与公共方法默认泛型收窄 unknown

Status: accepted

## 背景

第八轮审查发现两处 `any` 泄漏，与 ADR 0012「data 收窄 unknown」的类型卫生立场相悖：

1. **响应拦截器管理器的 data 泛型为 `any`**：`createInterceptorManager<ResponseResult<FullRequestConfig, any>>()` 是全文件唯一无注释的 `any`。拦截器读写的 `data: any` 流回 `fullResponseResult`，绕过外层请求泛型 `<D>`——拦截器返回不同 D 的 data 不会被类型系统察觉，类型谎言沿拦截器链扩散。
2. **公共方法默认泛型 `D = any`**：`request/get/post/put/delete` 省略泛型时 `data` 退化为 `any`，调用方不经任何断言即可拿到任意类型，与 ADR 0012 对调用方边界的约束不对等。

## 决策

### 1. 响应拦截器管理器泛型 `any` → `unknown`

`interceptors.response` 的类型参数改为 `ResponseResult<FullRequestConfig, unknown>`。响应拦截器内 `response.data` 为 `unknown`，读取需自行收窄（与 ADR 0012 对请求拦截器 `data` 的待遇一致）。

拦截器返回值收窄为当前请求泛型 D 时，在 `core` 的校验通过分支做边界断言：

```ts
fullResponseResult = interceptorResult as ResponseResult<FullRequestConfig, D>;
```

断言依据：`isResponseResultLike` 已运行时校验返回值形状（`ok` boolean + `code` number），`data` 的类型由拦截器决定，收窄到 `D` 属边界职责。

### 2. 公共方法默认泛型 `D = any` → `unknown`

`request/get/post/put/delete` 五个方法的默认泛型改为 `unknown`。调用方省略泛型时 `data` 恒为 `unknown`，需要时按 `ok` 自行断言（文档示例已用 `!` 断言，兼容）。

## 后果

- 源码内 `any` 清零：响应拦截器 data 与公共方法默认泛型均不再泄漏 `any`。
- 破坏性（类型层）：省略泛型时 `result.data` 由 `any` 变 `unknown`，需按 `ok` 断言后使用；响应拦截器内 `response.data` 需自行收窄。运行时行为零变化。
- 测试同步：4 处响应拦截器改写 `data` 的用例增加收窄（`response.data ?? {}` 后断言为 `Record<string, unknown>`），177 测试全绿，`tsc --noEmit` 通过。

## 被驳回的替代方案

- **保留 `any` 并仅补注释**：类型泄漏仍在，拦截器返回不同 D 的 data 依旧无法被类型系统察觉。
- **默认泛型维持 `any`**：调用方边界失去类型检查，与 ADR 0012 的立场直接矛盾。
- **引入响应体泛型 `RESP`（拦截器级）**：双泛型穿透整个拦截器链，复杂度与收益不成比例，否决。
