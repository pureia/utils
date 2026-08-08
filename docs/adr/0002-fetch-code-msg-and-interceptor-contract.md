# 请求结果 code/msg 语义、哨兵判定与拦截器契约修正

Status: accepted

## 背景

对 `createFetch` 的审查发现以下语义缺陷：

1. **HTTP 错误时 `msg` 误导**：`msg` 直接透传 uni 的 `errMsg`，而 `errMsg` 描述的是传输层结果（HTTP 500 时 errMsg 恒为 `"request:ok"`），调用方看到 `{ code: 500, msg: 'request:ok' }` 无法解释。
2. **哨兵判定脆弱**：abort/timeout 依赖 `errMsg` 精确字符串匹配（`=== 'request:fail abort'`），部分平台文案带后缀即误判为未知错误；且部分平台传输失败时 `statusCode` 为 `0` 而非 `undefined`，`code: 0` 落进取值空间空洞（非 2xx/4xx/5xx，也非负哨兵码）。
3. **`rejected` 类型签名与语义矛盾**：声明为 `<E>(error: E) => E`（"返回错误本身"），语义却是"返回 truthy 恢复为新数据"，调用处必须强转。
4. **取消时数据丢失**：`CancelError` 分支硬编码 `data: null`，与拦截器错误分支保留 `fallback.data` 的行为不一致。
5. **响应拦截器返回值无校验**：可返回任意形状（如解包后的裸 data），类型承诺 `ResponseResult` 但运行时无校验，类型谎言沿拦截器链扩散。

## 决策

### 1. `msg` 语义：有 HTTP 状态码时用标准 HTTP 描述

- 成功 2xx 与失败 4xx/5xx：`msg` 使用 `HTTP_STATUS_TEXT` 中的描述，未知码回退 `HTTP ${code}`。
- `HTTP_STATUS_TEXT` 仅收录常用码（非 RFC 全集），未收录码与后端自定义码（如 599、460）统一回退 `HTTP ${code}`，保证 `msg` 恒有值。
- 哨兵码：中止/超时用固定描述；未知错误保留原始 `errMsg`。
- `errMsg` 不再直接暴露给 HTTP 错误路径。

### 2. 哨兵判定：前缀匹配 + 无状态码归一

- abort/timeout 通过 `errMsg.startsWith('request:fail abort' / 'request:fail timeout')` 识别，容忍平台文案后缀。
- `statusCode` 为 `0`/`null`/`undefined`（无有效 HTTP 状态）且非 abort/timeout 时，统一归一为 `-3 UNKNOWN`，保证 `code` 恒在取值空间内（2xx / 4xx / 5xx / 负哨兵码）。

### 3. `Interceptor.rejected` 签名改为返回新数据

`rejected?: (error: unknown) => C | Promise<C>`，与"返回 truthy 即恢复链路"的语义一致，调用处不再强转。

### 4. 取消时保留响应现场

`CancelError` 分支的 `data` 改为 `fallback?.data ?? null`，与拦截器错误分支行为一致。

### 5. 响应拦截器返回值运行时校验

每次响应拦截器 `fulfilled` 执行后校验返回值是否为合法 `ResponseResult`（`ok` 为 boolean 且 `code` 为 number）：

- 合法：沿用返回值继续链路；
- 非法：`console.warn` 提示并**忽略该返回值**、沿用上一结果，避免类型谎言沿拦截器链扩散。

如需"解包"业务 envelope，应改写 `ResponseResult.data` 字段，而非返回裸数据。

### 6. 去重与取消的两套 key 空间（已被 ADR 0003 §3 取代）

去重使用 `Request:${hash}`，取消使用用户 key。`abort(userKey)` 只会取消第一个调用者的拦截器/传输层执行，但共享执行的 `core` 被取消后产出 `code: -1` 结果，所有等待者共享同一中止结果。

> 注：ADR 0003 §3 将其取代——去重请求的共享执行不再绑定用户 key，`abort(key)` 按 key 广播，同 key 所有调用者统一收到 `-1`，共享执行（传输层）不中断。

### 7. 拦截器/业务错误的 `msg`：从抛出对象提取 `message`/`msg`

拦截器抛出业务对象（如 `{ code: 50001, msg: '余额不足' }`）时，`getErrorMessage` 优先提取 `message`/`msg` 字段（须为字符串且非空），避免 `msg` 退化为 `'Unknown Error'` 而与 `-3 UNKNOWN` 哨兵在文本上撞车；提取失败才回退 `'Unknown Error'`，原始异常仍存于 `error` 字段。

### 8. 成功状态码可配置（默认 `[200]`）

`ok` 判定从硬编码 `2xx`（200-299）改为 `successStatusCodes` 数组成员判定，默认 `[200]`。理由：多数后端仅在 HTTP 层用 `200` 表示"可解析响应"，业务成败在 body envelope 中；将全部 2xx 视为成功会掩盖 HTTP 层的意外响应（如 201/202 的副作用语义）。显式声明成功码使判定可预期，非成功码一律进入失败分支（`msg` 仍按状态码描述，`data` 保留响应现场）。

## 后果

- `msg` 不再暴露平台细节、行为可预期；`errMsg` 仅在未知错误时作为描述保留。
- 前缀匹配降低 abort/timeout 误判概率；`code: 0` 空洞被消除。
- `rejected` 的类型更准确；解包型响应拦截器必须改写 `data` 而非返回裸数据，否则运行时告警并被忽略（行为破坏，需调用方遵循契约）。
- 取消与拦截器错误在 `data` 保留上行为一致。

## 被驳回的替代方案

- **`statusCode === 0` 保持原样**：破坏 `code` 取值空间约定，调用方无法解释。
- **`rejected` 维持 `<E>(error: E) => E`**：类型与语义继续错位。
- **取消时 `data` 保持 `null`**：与拦截器错误路径不一致，丢失可调试现场。
- **响应拦截器非法返回值照用**：类型谎言继续扩散，违背校验目的。
