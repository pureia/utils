# Glossary

本文档是项目的领域词表（glossary），只记录术语及语义，不包含实现细节。

## 请求域（uni-app fetch）

- **错误归一化（error normalization）**：请求库的核心承诺——任何请求都不会 reject，一切结果（成功或失败）都以统一响应结果返回，调用方通过 `code` 判断成败，无需 try/catch。
- **统一响应结果（unified response result）**：`{ ok, code, msg, data, header, cookies, requestConfig, error? }` 的统一结构（类型 `ResponseResult`），是所有请求路径（成功、传输错误、HTTP 错误、业务错误、取消）的共同出口；`data` 类型恒为 `D | null`，`ok` 不自动收窄，需要时由调用方按 `ok` 自行断言。省略请求泛型时 `D` 默认 `unknown`；响应拦截器内读取到的 `data` 恒为 `unknown`，同样需自行收窄（见 ADR 0016）。
- **code（状态码）**：结果中判断成败的依据。语义约定：成功状态码可配置（`successStatusCodes`，默认 `[200]`）；负数哨兵码表示非 HTTP 的传输/流程错误；其余 HTTP 码（4xx/5xx 等）表示 HTTP 错误。取值空间完整——无有效 HTTP 状态（`statusCode` 为 `0`/`null`/`undefined`）且非中止/超时时归一为 `-3`。
- **msg（状态码描述）**：结果的描述文本。有 HTTP 状态码（含成功与失败）时使用映射表描述（如 `500 → 'Internal Server Error'`），未收录码（含后端自定义码）回退 `HTTP ${code}`；不透传 uni 的 `errMsg`（其描述传输层，HTTP 500 时恒为 `"request:ok"` 会误导）；哨兵码使用固定描述（中止/超时）或原始 `errMsg`（未知错误）。
- **ok（成败字段）**：统一响应结果的成败依据，`true` 为成功响应（code 在配置的成功状态码内，默认 `[200]`），`false` 为失败响应（HTTP 错误或哨兵码）；为普通 boolean，类型上不自动收窄 `data`/`error`，需要时由调用方按 `ok` 自行断言。
- **哨兵码（sentinel code）**：负数状态码，表示无 HTTP 状态可用的传输层/流程失败。已定：`-1`=中止（abort），`-2`=超时（timeout），`-3`=未知（unknown），`-4`=拦截器/业务错误（interceptor/business error）。平台异常负状态码（如 `-1`）不透传，仅正数视为有效 HTTP 状态，负数统一走哨兵归一路径（见 ADR 0010）。
- **拦截器/业务错误（interceptor/business error）**：拦截器抛出（通常为使用方在响应拦截器中判断业务 envelope 后抛出）的异常，归一化为 `code: -4`，`msg` 取错误消息，`data` 保留响应现场，原始异常存于 `error` 字段。`-4` 亦承载请求未发出的框架错误（如 `uni.request` 同步抛错，见 ADR 0010）。
- **error（原始错误字段）**：失败响应中承载原始异常，供调试；拦截器抛错与主动取消（CancelError 实例）时存在；HTTP 错误与传输失败（超时/网络中止/未知错误）时为 undefined。用户主动取消与传输层中止的 `code` 均为 `-1`，对 `error` 做 `instanceof CancelError` 可区分二者（主动取消时存在实例，传输层中止时为 undefined）。
- **传输错误（transport error）**：网络层失败（超时、中止、未知错误），映射为哨兵码。
- **业务错误（business error）**：后端业务 envelope 返回失败（如 `code: 50001`）；由使用方在响应拦截器中判断并抛出，抛出后由错误归一化收口为 `code: -4`。
- **取消（cancellation）**：调用方主动 `abort(key)` 触发，归一化为 `code: -1`，属于正常路径而非异常。`-1` 同时承载传输层中止（网络中断/平台中止，见"传输错误"），两者共用哨兵码不可区分（语义合并，见 ADR 0001）。`abort(key)` 按 key 广播：同一 key 下所有进行中的注册（拦截器阶段与传输层）统一收到 `-1`，key 应在并发请求间保持唯一（库通过 `isPending(key)` 检测某 key 是否已有进行中的注册，占用时告警），否则同 key 请求互为取消组；去重请求的取消为整组取消：`abort(key)` 中止整组共享执行（拦截器/传输层），执行者与所有等待者统一收到 `-1`（见 ADR 0007）；共享执行起跑前（`request()` 返回后的同一 tick 内）的 `abort` 同样生效：执行者短路为归一化中止结果，整组统一收到 `-1` 且请求不发出（见 ADR 0018）。取消只丢弃未落定的结果，不打断已进入的拦截器代码执行（其副作用仍会跑完）；未知 key 的 `abort` 为静默 no-op（请求完成后对旧 key 的兜底取消是合法用法，见 ADR 0011）。
- **去重（deduplication）**：`isDedup` 开启时，相同去重键的并发请求共享一次执行，所有调用者得到同一结果；前一次执行完成后，相同去重键的新请求重新执行。去重键为全量合并配置的稳定序列化 hash，请求携带不同 `key` 不视为相同去重键。共享执行透传用户 key，请求拦截器改写 key 在此路径同样生效；`abort(key)` 为整组取消，执行者与等待者同收 `-1`（见 ADR 0007；起跑前窗口见 ADR 0018）。
- **去重等待者（dedup waiter）**：去重组中第 2+ 个调用者，不参与共享执行，仅等待共享结果；`abort(key)` 为整组取消，等待者与执行者统一收到 `-1` 中止结果。
- **配置合并（config merge）**：请求配置与基础配置的合并规则——`header` 按字段深合并（叠加），其余字段请求配置提供即整体替换（数组按引用替换，不做索引合并）；`rawRequestConfig` 保留请求配置原始引用。拦截器改写边界：`header` 为合并副本可安全改写，`rawRequestConfig` 与 `data` 为调用方原始引用不应修改（见 ADR 0011）。
- **拦截器返回值校验（interceptor return validation）**：请求/响应拦截器的 `fulfilled` 返回值均须通过运行时形状校验（请求配置校验 url+host，响应结果校验 ok/code），非法则告警并忽略、沿用上一值；拦截器抛错由错误归一化收口（`CancelError` → `-1`，其余 → `-4`），无恢复语义。
