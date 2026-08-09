# 请求拦截器返回值校验、error 字段契约与 key 语义澄清

Status: accepted

## 背景

对 `createFetch` 的第四次审查发现以下语义缺陷/澄清点：

1. **请求拦截器 `fulfilled` 返回值零校验**：ADR 0004 仅收紧 `rejected` 恢复值（`isRequestConfigLike` 校验 url+host），`fulfilled` 返回值直接透传。拦截器漏 `return config` 或返回缺 `host`/`url` 的配置时，后续要么拼出 `undefined${url}` 畸形请求 URL，要么在读取 `.key` 处抛晦涩 TypeError（无任何 `console.warn`），与响应拦截器 `fulfilled` 的校验行为（ADR 0002 §5）不对称。
2. **`error` 字段契约与实现矛盾**：`ResponseResult.error` 类型注释与 CONTEXT.md 均称"取消时 error 为 undefined"，但 `normalizeError` 的 `CancelError` 分支实际返回 `error: CancelError` 实例。
3. **非去重同 key 并发的广播误杀未声明**：`abort(key)` 按 key 广播（`createCancelable` 语义），并发请求复用同一 key 时一次 abort 全部取消；ADR 0003 §3 仅描述了去重场景的广播，非去重场景未文档化。
4. **dedup 路径下请求拦截器改写 key 失效**：去重共享执行剥除用户 key（`key: undefined`），ADR 0004 承诺的"请求拦截器改写 key 成为受支持的用法"在该路径下不成立，未澄清。

## 决策

### 1. 请求拦截器 `fulfilled` 返回值运行时校验

复用 `isRequestConfigLike`（url 与 host 均为字符串），`fulfilled` 返回值非法则 `console.warn` 并忽略、沿用上一配置，与响应拦截器 `fulfilled` 校验（ADR 0002 §5）行为对称。

### 2. `error` 字段契约以代码为准

取消（`code: -1` 且源自用户 `abort(key)`）时 `error` 保留 `CancelError` 实例，供调试；传输层失败（HTTP 错误、超时、网络中止、未知错误）时 `error` 为 `undefined`。同步修正 `ResponseResult.error` 类型注释与 CONTEXT.md 词条，消除文档与实现矛盾。

### 3. key 广播语义文档化

`abort(key)` 按 key 广播：同一 key 下所有进行中的注册（拦截器阶段与传输层）统一收到 `code: -1`；去重请求的共享执行透传 key，abort 对该组为整组取消（见 ADR 0007）。文档化约束：key 应在并发请求间保持唯一，否则同 key 请求互为取消组。不引入按请求 token 的精确取消。

### 4. dedup 路径取消语义（已被 ADR 0007 更新）

去重路径不再剥除用户 key：共享执行透传 key，请求拦截器改写 key 在去重路径同样生效（与 ADR 0004 §1 的"取消 key 统一为当前配置"一致）；`abort(key)` 对去重请求为整组取消（执行者与等待者同收 `-1`，见 ADR 0007）。

## 后果

- 请求拦截器 `fulfilled` 非法返回值不再静默污染链路，漏 `return config` 的 bug 有告警可循。
- `error` 字段语义明确：取消时携带 `CancelError`，传输失败时为 `undefined`，文档与代码一致。
- key 广播语义（含非去重误杀风险）有文档约束，调用方需保证并发请求间 key 唯一。
- 去重请求的拦截器 key 改写行为可预期（不生效），与 ADR 0004 的承诺范围一致。

## 被驳回的替代方案

- **请求拦截器 `fulfilled` 仅文档化不校验**：与响应拦截器路径继续不对称，漏 `return` 的 bug 仍无提示。
- **`error` 字段以文档为准、取消时置 undefined**：丢失 CancelError 调试信息，归一化路径需特判。
- **引入 per-request 取消 token 精确取消**：与现有"key 即组"模型冲突，需破坏性改造，收益不成比例。
- **dedup 路径保留 key 供拦截器改写**：等待者各自的 key 会渗入共享执行，取消监听交叉、语义更混乱；剥除 key 是既有 ADR 0003 §3 决策，仅需澄清而非修改。
