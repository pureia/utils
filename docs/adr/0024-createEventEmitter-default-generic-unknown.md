# createEventEmitter 默认泛型收紧 unknown（约束保留 any）

Status: accepted

## 背景

ADR 0012/0016 之后，源码内仅剩一处未注释的 `any` 泄漏：`createEventEmitter<E extends Record<string, any> = Record<string, any>>` 的**默认**泛型。调用方省略事件类型时，事件载荷恒为 `any`，与 0012/0016 的 unknown 立场不一致。

## 决策

### 1. 默认泛型：`Record<string, any>` → `Record<string, unknown>`

`createEventEmitter<E extends Record<string, any> = Record<string, unknown>>(...)`。无类型参数用法（裸发射器）的事件载荷由 `any` 变为 `unknown`，读取需自行收窄。

### 2. 约束保持 `Record<string, any>`，不收紧

TS 仅类型别名/对象字面量具隐式索引签名；**`interface` 声明的类型不可赋给 `Record<string, unknown>`**（接口可被扩展，编译器不给隐式索引签名）。若同时收紧约束，`interface TestEvents { ... }` 式的事件表用法将编译失败。约束保留 `any` 是「接纳接口型事件表」的开销，默认值收紧已达成类型卫生目标。

## 后果

- 类型层：省略泛型时载荷 `any` → `unknown`（仅默认用法；所有显式类型用法零影响）。
- 运行时零变化；`createFetch`/批量去重等内部用法均显式传类型，不受影响。
- 测试：无类型参数用法不存在于本仓库，无需调整。

## 被驳回的替代方案

- **连同约束一起收紧 `unknown`**：破坏 `interface` 事件表的可赋值性，收益（约束侧无泄漏）与代价不成比例。
- **保留 `any` 并仅补注释**：类型泄漏仍在，与 ADR 0012/0016 立场矛盾。
- **默认值改为等价的 `Record<string, never>`**：载荷无法赋值任何值，过度收紧，无实际用例支持。
