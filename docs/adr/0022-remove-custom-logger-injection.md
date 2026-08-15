# 移除外部自定义 logger 注入（0.1.0 发布前移除）

Status: accepted

## 背景

0.1.0 发布准备阶段为 `createFetch` 引入第二参数 `{ logger }`，允许调用方接管库内告警输出（0.1.0 尚未发布，该能力从未对外暴露）。审查发现：`logger` 为调用方注入的可执行代码，core 入口的 key 占用告警（判定基于 `isPending`，见 ADR 0008）位于任何 try 之外——注入的 `logger.warn` 抛错会使 `core` 直接 reject，非去重路径下 `request()` 返回 rejected promise，违背 ADR 0001「永不 reject」；去重路径下执行者 reject 经 `createAsyncDedupe` 事件通道广播，整组等待者统一 reject；拦截器非法返回值告警虽在 try 内，也会被误归一化为 `-4`。ADR 0021 曾提出容错包装（try/catch 静默吞掉）方案，进一步权衡后决定：不保留注入面，直接移除该能力——注入代码破坏契约的向量从根上消除。

## 决策

1. 移除 `createFetch` 第二参数 `options`（`{ logger }`）与 `FetchLogger` 类型导出，签名恢复单参数。
2. 三处告警调用点（key 占用、请求/响应拦截器非法返回值）统一直接 `console.warn`。
3. 0.1.0 尚未发布：logger 能力在首个正式版本发布前移除，不构成对外破坏；CHANGELOG 0.1.0 条目同步修订（不保留 logger 记录）。

## 后果

- 注入代码破坏「永不 reject」的向量从根上消除；`console` 为平台可信依赖，与 `createEventEmitter` 默认 `onError` 的 console 依赖一致。
- 告警不可接管、不可静默；需要静默输出时由调用方环境处理 console。
- API 面收窄：`FetchLogger` 类型移除；0.1.0 未发布，无既有使用方受影响。
- ADR 0021（容错方案）整体失效，标记为已取代。
- **决策边界**：本决策仅收窄 fetch 结果路径的注入面——`createFetch` 的返回值（`request`/快捷方法）不得被任何调用方代码的抛错污染。核心域 `createEventEmitter` 的 `onError` 注入（处理器抛错上报回调）保留：其抛错只影响 `emit` 调用方自身，不进入 fetch 结果路径，不构成「返回值报错」风险（拦截器抛错由错误归一化收口为 `-4`，属契约内行为，非注入面问题）。

## 被驳回的替代方案

- **容错包装保留 logger（ADR 0021）**：注入面仍在；告警在注入方故障时静默丢失，「接管 vs 静默」语义复杂化；对尽力而为的诊断输出而言注入能力价值有限。
- **保留空 `options` 参数**：为未知未来扩展预留的空壳参数属猜测性设计（YAGNI）。
