# createCancelable 新增 isPending 状态查询 API

Status: accepted

## 背景

`createFetch` 的 key 唯一性告警（ADR 0005 §3 的运行时检测）需要"某 key 是否已有进行中的取消调用"的查询能力，`createCancelable` 此前未提供。

命名约束：该 API 查询的是"进行中/未完成"状态——监听器在 `cancelable(key, ...)` 调用开始时注册、异步函数结束后（成功或失败）在 `finally` 中移除，因此返回值表达"该 key 是否已有进行中的调用"。候选名 `hasCanceled` 为过去式，读作"是否已被取消"，暗示的是结束态；而进行中的调用恰恰是"尚未结束、仍可取消"的状态，二者相反，故弃用。`hasCanceled` 仅为评审中的候选名，从未进入代码。

## 决策

### 1. 新增 `isPending(key)`

`createCancelable` 返回新增 `isPending(key)`：查询某 key 是否存在进行中的取消调用（`eventEmitter.has(key)`），语义与实现一致。属新增 API，无既有行为变更。

### 2. 同步接入调用处

`createFetch.ts` 中的解构由 `{ cancelable, cancel }` 扩为 `{ cancelable, cancel, isPending }`，key 唯一性告警处改用 `isPending`。该函数保持公共导出，是对取消包装器合法的状态查询 API。

### 3. 术语表同步

CONTEXT.md「取消」词条同步 key 占用检测语义：进行中的 key 判定基于 `isPending(key)`。

## 后果

- 名称 ↔ 语义一致：`isPending(key)` 直观表达"进行中/未完成"，与 `cancel(key)`（将进行中的调用转为结束态）形成清晰对照。
- 新增查询 API，`createFetch` 的 key 唯一性告警（ADR 0005 §3 的文档化约束）获得运行时检测能力。
- 无既有 API 变更，无需测试改动（该函数无既有测试覆盖）。

## 被驳回的替代方案

- **`isInFlight`**：同样表达"未完成"，但在请求领域更贴近"请求已在路上"，而 cancelable 也包裹拦截器等非传输阶段，`isPending` 覆盖面更全。
- **`hasPending`**：has 动词需隐含"有进行中的调用"作宾语，读感不如 is 系直接。
- **维护独立的"已取消"状态并命名 `hasCanceled`**：需维护额外的取消状态，引入不必要复杂度，且取消本身是可观察的结束态（`CancelError` 已表达），无需独立查询 API。
