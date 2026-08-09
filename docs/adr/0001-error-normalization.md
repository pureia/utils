# 请求错误统一归一化为正常返回（永不 reject）

Status: accepted

`createFetch` 承诺永不 reject：所有请求错误（传输错误、HTTP 错误、拦截器抛出的业务错误、主动取消）一律归一化为带 `code` 的正常返回，调用方无需 try/catch，通过 `ok` 判断成败、`code` 区分失败类别后按 `code` 处理。

这一决策源于使用方需求："所有错误封装为正常返回，通过 code 错误码处理，避免调用方到处 try/catch"。曾被驳回的替代方案：保持异常抛出模型（拦截器 throw → 调用方 catch，如 axios 风格）——它保留"错误即异常"的直觉，但强制每个调用点写 try/catch；以及 opt-in 配置开关（`normalizeError: true`）——因库处于初期、无外部使用者而放弃，直接作为破坏性变更落地。

代价：拦截器 `rejected` 的语义从"返回 truthy 值替换错误并抛出"变为"返回 truthy 值恢复并继续链路"；`CancelError` 不再向调用方抛出（导出保留，供内部复用）；调用方必须显式判断 `code`/`ok`，错误与取消在类型上不再有异常路径可依赖。主动取消与传输层中止统一为 `code: -1`，业务/拦截器错误统一为 `code: -4`。
