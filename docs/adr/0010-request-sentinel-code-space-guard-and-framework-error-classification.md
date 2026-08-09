# 哨兵码取值空间守卫与框架错误归类文档化

Status: accepted

## 背景

对 `createFetch` 的第五次审查发现两处 `code` 语义缺口：

1. **负数状态码透传与哨兵码空间冲突**：`getStatusCode` 以 `if (code) return code` 透传任意 truthy 状态码。部分平台的异常响应会携带负状态码（如 `-1`），透传后与哨兵码 `FetchCode.ABORT`（`-1`）在取值空间上撞码：调用方看到 `code: -1, msg: 'Request Abort'` 无法区分真实中止与平台异常，`code === FetchCode.ABORT` 判定失效。
2. **`uni.request` 同步抛错归类为 `-4` 但未声明**：`dispatchRequest` 的 `responsePromise` 唯一 reject 源是 `uni.request` 同步抛错（请求未发出，如参数非法）。该路径经 `core` 捕获后归一化为 `-4 INTERCEPTOR`，而 `-4` 的名义定义是"拦截器/业务错误"，归类与实际不符，仅靠实现可见。

## 决策

### 1. 仅正数视为有效 HTTP 状态

`getStatusCode` 增加 `code > 0` 守卫：负数与 `0`/`null`/`undefined` 一并视为"无有效 HTTP 状态"，进入哨兵归一路径（abort/timeout 前缀识别，其余 `-3`）。HTTP 状态码恒为正数（100-599），该守卫零行为损失，关闭负数与哨兵码的取值空间冲突。

### 2. `-4` 定义扩展为含框架错误

`FetchCode.INTERCEPTOR` 补注"亦承载请求未发出的框架错误（如 `uni.request` 同步抛错）"，`core` 的传输层 catch 处注明该 reject 源。不引入新哨兵码（`-3` 已定义为"有传输失败现场（errMsg）"，sync throw 无 errMsg 现场，另立 `-5` 属过度设计）。

## 后果

- `code` 取值空间封闭：负数不再可能以 HTTP 码身份出现，`code === FetchCode.ABORT` 判定可靠。
- `-4` 的归类语义在文档层面自洽：拦截器/业务错误 + 请求未发出的框架错误。
- 新增两条回归测试：负数状态码归一、`uni.request` 同步抛错归一。

## 被驳回的替代方案

- **负状态码原样透传、仅文档化**：取值空间冲突仍在，调用方无法安全区分真假 `-1`。
- **新增 `-5` 框架错误码**：`-3`/`-4` 已可覆盖，引入新码增加调用方记忆负担。
