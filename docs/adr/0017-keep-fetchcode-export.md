# FetchCode 常量导出保留论证

Status: accepted

## 背景

ADR 0009 §3「导出表与内部调用同步」收敛了响应结果相关导出面（删除 `SuccessResponseResult`/`ErrorResponseResult`/`isSuccessResult`，移除 `CancelError` 再导出）。第八轮审查将 `FetchCode` 的导出（`createFetch.ts` 导出表保留 `FetchCode` 常量）视为「超出收敛要求的多余 API 面」。

核查事实：

- 全仓唯一消费方是 `test/uniapp/createFetch.test.ts`（使用 `ABORT`/`INTERCEPTOR`）；`TIMEOUT`/`UNKNOWN` 对外零消费；
- 仓库处于 0.0.x 早期版本，导出面收敛的破坏性代价可接受（ADR 0009 同前提）。

## 决策

**保留 `FetchCode` 导出**，不将其纳入 ADR 0009 §3 的收敛范围。

理由：

1. ADR 0009 的收敛对象是**响应结果类型族**与 `CancelError` 再导出，未涉及哨兵码常量；`FetchCode` 不属该决策的覆盖面。
2. 哨兵码是对外契约的组成部分（ADR 0010 后果段「`code === FetchCode.ABORT` 判定可靠」）。导出常量给调用方提供类型化的判定方式；移除后调用方只能硬编码 `-1/-2/-3/-4` 魔法数字，判定可靠性反而下降。
3. 「当前无外部消费」不足以构成删除理由：`code` 判定是所有失败路径的公共语义，常量是库 API 的合理组成部分，与响应结果类型族（仅库内部形态）性质不同。

## 后果

- 导出面维持 `FetchCode` 常量，调用方可继续以 `code === FetchCode.ABORT` 等类型化方式判定哨兵码，无需迁移。
- ADR 0009 §3 的收敛决策范围不变（响应结果类型 + CancelError），本文档明确其边界不含哨兵码常量。

## 被驳回的替代方案

- **移除 `FetchCode` 导出**：调用方哨兵码判定退化为硬编码负数，`code === -1` 的自文档性与可维护性下降；违背 ADR 0010 对判定可靠性的承诺。
- **仅导出 `code` 判定辅助函数（如 `isAbort(code)`）**：改变调用方使用形态，收益不明确，破坏现有 `code === FetchCode.ABORT` 用法，过度设计。
