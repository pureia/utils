# Glossary

本文档是项目的领域词表（glossary），只记录术语及语义，不包含实现细节。

## 请求域（uni-app fetch）

- **错误归一化（error normalization）**：请求库的核心承诺——任何请求都不会 reject，一切结果（成功或失败）都以统一响应结果返回，调用方通过 `code` 判断成败，无需 try/catch。
- **统一响应结果（unified response result）**：`{ ok, code, msg, data, header, cookies, requestConfig, error? }` 的统一结构，是所有请求路径（成功、传输错误、HTTP 错误、业务错误、取消）的共同出口。
- **code（状态码）**：结果中判断成败的依据。语义约定：成功状态码可配置（`successStatusCodes`，默认 `[200]`）；负数哨兵码表示非 HTTP 的传输/流程错误；其余 HTTP 码（4xx/5xx 等）表示 HTTP 错误。取值空间完整——无有效 HTTP 状态（`statusCode` 为 `0`/`null`/`undefined`）且非中止/超时时归一为 `-3`。
- **msg（状态码描述）**：结果的描述文本。有 HTTP 状态码（含成功与失败）时使用映射表描述（如 `500 → 'Internal Server Error'`），未收录码（含后端自定义码）回退 `HTTP ${code}`；不透传 uni 的 `errMsg`（其描述传输层，HTTP 500 时恒为 `"request:ok"` 会误导）；哨兵码使用固定描述（中止/超时）或原始 `errMsg`（未知错误）。
- **ok（成功判别字段）**：判别联合的判别字段，`true` 为成功响应（code 在配置的成功状态码内，默认 `[200]`），`false` 为失败响应（HTTP 错误或哨兵码）；类型上以 `ok` 收窄 `data` 与 `error`。
- **哨兵码（sentinel code）**：负数状态码，表示无 HTTP 状态可用的传输层/流程失败。已定：`-1`=中止（abort），`-2`=超时（timeout），`-3`=未知（unknown），`-4`=拦截器/业务错误（interceptor/business error）。
- **拦截器/业务错误（interceptor/business error）**：拦截器抛出（通常为使用方在响应拦截器中判断业务 envelope 后抛出）的异常，归一化为 `code: -4`，`msg` 取错误消息，`data` 保留响应现场，原始异常存于 `error` 字段。
- **error（原始错误字段）**：失败响应中承载原始异常，供调试；拦截器抛错与主动取消（CancelError 实例）时存在；HTTP 错误与传输失败（超时/网络中止/未知错误）时为 undefined。
- **传输错误（transport error）**：网络层失败（超时、中止、未知错误），映射为哨兵码。
- **业务错误（business error）**：后端业务 envelope 返回失败（如 `code: 50001`）；由使用方在响应拦截器中判断并抛出，抛出后由错误归一化收口为 `code: -4`。
- **取消（cancellation）**：调用方主动 `abort(key)` 触发，归一化为 `code: -1`，属于正常路径而非异常。`-1` 同时承载传输层中止（网络中断/平台中止，见"传输错误"），两者共用哨兵码不可区分（语义合并，见 ADR 0001）。`abort(key)` 按 key 广播：同一 key 下所有进行中的注册（拦截器阶段与传输层，含非去重并发同 key 请求）统一收到 `-1`，key 应在并发请求间保持唯一，否则同 key 请求互为取消组；去重请求共享执行（传输层）不因取消而中断。
- **去重（deduplication）**：`isDedup` 开启时，相同去重键的并发请求共享一次执行，所有调用者得到同一结果；前一次执行完成后，相同去重键的新请求重新执行。去重键为全量合并配置的稳定序列化 hash，请求携带不同 `key` 不视为相同去重键。共享执行阶段剥除用户 key，请求拦截器在此路径下改写 key 不生效，取消语义由外层每个调用者自身的 key 承担。
- **去重等待者（dedup waiter）**：去重组中第 2+ 个调用者，不参与共享执行，仅等待共享结果；`abort(key)` 按 key 广播，等待者与其他共享该 key 的调用者统一收到 `-1` 中止结果，共享执行不中断。
- **配置合并（config merge）**：请求配置与基础配置的合并规则——`header` 按字段深合并（叠加），其余字段请求配置提供即整体替换（数组按引用替换，不做索引合并）；`rawRequestConfig` 保留请求配置原始引用。
- **拦截器恢复（interceptor recovery）**：拦截器 `rejected` 返回 truthy 值表示恢复成功，该值作为新数据继续链路；返回 falsy 值表示错误成立，由错误归一化收口。请求/响应拦截器的 `fulfilled` 返回值与 `rejected` 恢复值均须通过运行时形状校验（请求配置校验 url+host，响应结果校验 ok/code），非法则告警并忽略、沿用上一值。
