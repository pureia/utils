# 去重路径起跑前 abort：取消意向短路

Status: accepted

## 背景

ADR 0007 将去重请求的取消语义定为整组取消：`abort(key)` 中止整组共享执行，执行者与所有等待者统一收到 `code: -1`。该承诺依赖用户 key 在执行期发射器上的取消监听（core 内拦截器与传输层注册，见 ADR 0004 §1）。

时序核查发现一处未覆盖窗口：去重路径中，共享执行经 `createAsyncDedupe` → `createCancelable.cancelable` 的 `Promise.resolve().then` 推迟到微任务起跑，用户 key 的取消监听在 `request()` 返回后的同一 tick 内尚未注册。此时调用 `abort(key)` 会静默落空（无监听可触发），执行者照常起跑并发起真实网络请求，调用方收到成功结果而非 `-1`——与 ADR 0007 的承诺相悖。非去重路径无此窗口（core 同步前缀在 `request()` 返回前完成注册），两路径行为不对称。

此前一次尝试的修复（在执行者外层包一层 `cancelable(key, ...)`）被否决：abort 命中时 `CancelError` 沿 Promise 拒绝通道逃逸到去重等待者，破坏 ADR 0001「永不 reject」；且包层监听使 core 入口的 `isPending(key)` 恒真，每次去重 key 请求误告警 key 占用。

## 决策

### 1. 独立取消意向发射器

createFetch 内新增独立的 `createEventEmitter` 作为取消意向通道，与执行期发射器分离。意向监听不参与执行期注册，`isPending` 语义不受影响。

### 2. 请求发起时同步武装意向

`request()` 去重分支（有 key 时）在返回前同步注册一次性意向监听，闭包内置 `cancelled` 标记；共享执行者起跑时先检查标记，命中则短路为归一化中止结果（`normalizeError(CancelError)`，`code: -1`），不进入 core、不发起传输层。短路结果经去重事件整组共享。

### 3. abort 双广播

`abort(key)` 依次执行：执行期取消（现有 `cancel(key)`，覆盖拦截器/传输层）+ 意向广播（`emit(key, CancelError)`，覆盖起跑前）。两通道互不干扰：执行期已起跑走前者，未起跑走后者。

### 4. 监听清理

`asyncDedupe(...).finally(offIntent)`：结果落定后摘除未触发的意向监听；已触发的一次性监听自行移除。同 key 串行复用无残留标记，旧 key 的兜底 abort 仍为静默 no-op。

## 后果

- ADR 0007「abort 整组取消」补齐起跑前窗口：任意时序的 `abort(key)` 均使整组统一收到 `-1`；起跑前命中时传输层不会发出。
- 去重/非去重两路径的同步 abort 行为对称（均归一化为 `-1`）。
- 永不 reject 契约保持：意向短路产出的是 resolved 的失败结果，`CancelError` 存于 `error` 字段，无异常逃逸。
- `isPending` 告警语义不变：意向通道与执行期通道分离，去重 key 请求正常完成不误告警。
- 新增回归测试：同一 tick 同步 abort 整组收到 `-1` 且不发请求；去重 key 正常完成无误告警；同步 abort 后同 key 复用正常。

## 被驳回的替代方案

- **执行者外层 `cancelable` 包装**（本文档记录前已实际尝试）：abort 经拒绝通道逃逸破坏永不 reject；包层监听污染 `isPending` 导致误告警；且未堵住起跑前窗口（包装同样被推迟到微任务）。
- **`createCancelable.cancelable` 改为同步执行 asyncFunc**：改动公共原语时序契约，波及 `createFetch`/`createAsyncDedupe`/`createCancelable` 三模块与既有拦截器起始时序；且核查发现 `dispatchRequest` 中 `requestTask = uni.request(...)` 在取消监听注册前已同步赋值，「取消落在请求发出前窗口」并不存在，失去必要性。
- **给 `createAsyncDedupe` 增加执行者注册钩子**：将 fetch 专用取消需求塞进公共原语，扩大公共 API 面，过度设计。
