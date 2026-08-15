# logger 告警容错：注入 logger 抛错不破坏请求契约

Status: superseded by ADR-0022

## 背景

0.1.0 引入自定义 logger（`createFetch` 第二参数 `{ logger }`）。core 入口的 key 占用告警（判定基于 `isPending`，见 ADR 0008）位于任何 try 之外：调用方注入的 `logger.warn` 抛错会使 `core` 直接 reject——非去重路径下 `request()` 返回 rejected promise；去重路径下执行者 reject 经 `createAsyncDedupe` 的事件通道广播，整组等待者统一 reject——两者均违背 ADR 0001「永不 reject」。拦截器非法返回值告警虽位于 try 内，但 logger 抛错会被误归一化为 `-4`，把「告警并沿用上一值」的正常请求污染为失败。

## 决策

1. 新增安全告警包装 `warn(...args)`：`try { logger.warn(...args) } catch {}`，静默吞掉 logger 抛错。
2. 全部三处告警调用点（key 占用、请求拦截器非法返回值、响应拦截器非法返回值）统一走该包装。
3. 告警语义定为尽力而为（best-effort）：logger 故障时告警静默丢失，不提供 console 回退。

## 后果

- logger 抛错不再影响任何请求结果，「永不 reject、永不同步抛错」对注入代码同样成立。
- 告警在 logger 故障时静默丢失（logger 抛错属于注入方缺陷，诊断输出丢失可接受）。
- 新增回归测试：非去重 key 占用告警抛错不 reject；去重整组不 reject；拦截器校验告警抛错不产生 `-4`。

## 被驳回的替代方案

- **console.warn 回退**：与「注入 logger 以接管输出」的意图冲突（调用方可能刻意静默），且 console 本身可能被环境改写，仍需 try 包裹，无收益。
- **告警移入归一化路径**：key 占用告警发生在任何执行注册之前，无现有 catch 可依赖；且告警不应具备 `-4` 语义。
