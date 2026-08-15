# createCancelable 启动前取消短路：工作函数不启动

Status: accepted

## 背景

`createCancelable.cancelable` 将工作函数经 `Promise.resolve().then` 推迟到微任务启动，使同一 tick 内的 `cancel(key)` 有机会先于启动触发——但启动器从未检查「启动前已被取消」：`cancelable(key, fn); cancel(key);` 会以 `CancelError` 拒绝结果，`fn` 却仍会启动，其副作用照样发生。这与请求域 ADR 0018「去重起跑前 abort 短路」是同一类问题——当时 fetch 层因核心原语不支持而在 `createFetch` 内用独立取消意向发射器补（ADR 0018），核心域自身反而缺失该语义。

## 决策

1. `cancelable` 的取消监听置 `cancelled` 标记；微任务启动器先检查标记，命中则直接返回、不调用 `asyncFunc`。
2. 语义：启动前（同一 tick）的 `cancel` 使工作函数不启动、副作用不发生；已启动的工作不被阻止，继续跑完（结果被丢弃）。既有「取消只丢弃未落定的结果」契约不变，仅收窄「未启动也照跑」的窗口。
3. 时序契约不变：工作函数仍经微任务启动（未改动 ADR 0018 否决过的同步启动方案）。

## 后果

- 核心原语与请求域（ADR 0018）语义对齐：启动前取消 = 不启动。
- `createFetch` 的 `cancelIntentEmitter` 保留：去重执行者注册在内部去重键上，用户 key 的 `abort` 无法触达其内部 `cancelable` 注册，意向通道仍为必需（另见 ADR 0018/0007）。
- 新增回归测试：同一 tick 取消后工作函数不启动；启动后取消不阻止已开始的工作。

## 被驳回的替代方案

- **工作函数恒执行（维持 fire-and-forget）**：结果虽被丢弃，副作用仍发生——与「取消 = 丢弃」的直觉相悖，且请求域 ADR 0018 已确立启动前短路的先例。
- **`asyncFunc` 改为同步启动**：改动公共原语时序契约，波及 `createFetch`/`createAsyncDedupe`/`createCancelable` 三模块与既有拦截器起始时序（见 ADR 0018 已否决的同名方案）。
