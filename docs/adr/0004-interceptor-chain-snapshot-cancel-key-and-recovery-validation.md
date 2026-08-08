# 拦截器链快照、取消 key 一致性与恢复值校验收紧

Status: accepted

## 背景

对 `createFetch` 的三次审查发现以下语义缺陷：

1. **取消 key 错位**：`core` 中请求/响应拦截器以 `config.key`（发起时的原始配置）注册取消监听，而 `dispatchRequest` 以 `fullRequestConfig.key`（可能已被请求拦截器改写）注册传输层取消监听。请求拦截器修改 `key` 后，拦截器阶段与传输层阶段的取消 key 不一致：`abort(新key)` 在拦截器阶段无效、`abort(旧key)` 在传输层无效，语义错乱。
2. **拦截器链活迭代竞态**：`core` 用 `for...of` 直接遍历 `handlers` 数组引用，数组迭代器每次取实时 `length`。请求 A 的拦截器在 `await` 间隙挂起时，若另一处注册新拦截器，A 会执行到新拦截器——新注册影响进行中的请求，行为不可预期。
3. **请求拦截器恢复值校验过松**：`isRequestConfigLike` 仅校验 `url` 为字符串。`rejected` 恢复值缺 `host` 时，`dispatchRequest` 会拼出 `undefined${url}` 的畸形请求 URL。

## 决策

### 1. 取消 key 统一为拦截器处理后的当前配置

`core` 内所有 `runInterceptor` 调用（请求拦截器 fulfilled/rejected、响应拦截器 fulfilled/rejected）统一改用 `fullRequestConfig.key`，与 `dispatchRequest` 的传输层取消 key 保持一致。每个拦截器以其开始执行时刻的当前配置 key 注册取消监听；拦截器修改 `key` 后，后续环节（其余拦截器、传输层）均使用新 key，`abort` 语义在全链路一致。

### 2. 拦截器链快照

进入 `core` 时对请求/响应拦截器链做快照（`[...handlers]`），进行中的请求只执行发起时刻已注册的拦截器。请求执行期间新注册的拦截器只影响后续请求，不污染进行中的请求。

### 3. 请求拦截器恢复值校验收紧

`isRequestConfigLike` 收紧为校验 `url` 与 `host` 均为字符串（拼接完整 URL 的两个关键字段）。`rejected` 恢复值缺任一即告警并忽略、沿用上一配置，与 ADR 0003 §4 的"非法恢复值不污染链路"一致。

## 后果

- `abort(key)` 在全链路（拦截器阶段与传输层）对同一 key 生效，请求拦截器改写 key 成为受支持的用法（限定：去重共享执行阶段 key 被剥除，改写不生效，见 ADR 0005 §4）。
- 拦截器注册时机语义可预期：进行中的请求不受执行期间注册的新拦截器影响。
- 恢复值缺 `host`/`url` 不再产出畸形请求 URL，非法恢复值被拒并告警。

## 被驳回的替代方案

- **取消 key 维持原始 `config.key`**：拦截器改写 key 的诉求无法表达，`abort` 语义仍错位。
- **不截断链、仅文档化"勿在请求执行期间注册拦截器"**：竞态仍存在，调用方无法防御（进行中的请求可能意外执行新拦截器）。
- **恢复值完整类型校验（穷举必需字段）**：过度约束，`header`/`timeout` 等字段有合并默认值兜底，`url` + `host` 已足以防止畸形 URL。
