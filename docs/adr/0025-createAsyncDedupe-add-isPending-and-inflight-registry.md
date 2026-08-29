# createAsyncDedupe 在途注册表与 isPending API（含键放宽）

Status: accepted

## 背景

`createAsyncDedupe` 早期实现基于 `createEventEmitter` 的结果通道完成去重：每个调用者（含执行者）各自注册一次 `once` 监听并新建包装 promise，等待者数量 = 包装数量；「是否在途」由 `eventEmitter.has(key)` 推断。该实现存在三处问题：

1. **等待者分配**：同组 N 个调用者产生 N 份包装 promise 与监听器，等待者分配成本随组规模线性增长。
2. **在途判定依赖 emit 时序**：落定与结果分发经 emit 微任务链对齐，`has()` 与「分组是否仍在」之间存在推断窗口，无法确定性地回答「无人 await 的失败」等问题。
3. **键域不一致**：去重键与取消键类型上限定为 `string`，而底层的 Map 存储与事件通道本就接受 `PropertyKey`；且 `CancelError` 经模板字符串插值拼接消息，对 symbol 键会在 `cancel` 时抛 TypeError（无法将 Symbol 值转换为字符串），属隐藏缺陷。

同时，去重组需要「某 key 是否存在未落定的去重组」的查询能力（与 ADR 0008 中 `createCancelable.isPending` 同类的状态查询），请求域契约（ADR 0007/0018/0023）则要求换实现后共享结果、整组取消、落定后重执行与同 tick 取消短路等语义保持不变。

## 决策

### 1. 在途注册表（Map）取代事件结果通道

`createAsyncDedupe` 内部以 `Map<PropertyKey, Promise<unknown>>` 持有共享执行 promise：首个调用者为执行者，经 `createCancelable` 注册共享执行（可取消、同 tick 短路、已启动不阻止等语义不变），执行者与所有等待者拿到**同一个 promise 对象**；共享执行落定（成功/失败/取消）后注册表条目立即清理。等待者零分配；去重在途判定不再依赖 emit 时序。

### 2. 新增 `isPending(key)` 状态查询

`createAsyncDedupe` 返回新增 `isPending(key)`：查询某 key 当前是否存在未落定的去重组（`inflight.has(key)`）。语义与 `createCancelable.isPending`（ADR 0008）同为「未落定」，故名同义同：从首个调用者发起（含共享执行尚未起跑的窗口）至共享执行落定之前为 `true`，落定后为 `false`；同 key 串行复用无残留标记。

### 3. key 类型统一为 `PropertyKey`

`asyncDedupe`/`cancelable`/`cancel`/`isPending` 的 key 参数由 `string` 放宽为 `string | number | symbol`（`PropertyKey`）；`CancelError` 消息构造改用 `String(key)`，修复 symbol 键在模板插值下抛 TypeError 的潜在缺陷。类型放宽属公共签名扩展：既有 `string` 调用方类型兼容，symbol/number 键成为新支持域（底层存储本已支持）。

### 4. 术语表与文档同步

CONTEXT.md 新增「进行中查询（isPending）」词条（未落定语义、含共享执行尚未起跑窗口、串行复用无残留标记）；README 模块表同步 `isPending`；CHANGELOG 记录公共 API 与键域变更。

## 后果

- 执行者与等待者共享同一 promise 对象（`p1 === p2` 可观察），成为新契约；等待者零分配。
- 去重在途判定 = `inflight.has(key)`，无 emit 时序推断窗口。
- 共享执行失败时，内部处理器（首个调用者处同步挂接）保证 promise 已被处理：没有任何调用者 await/catch 时也不触发 unhandledrejection（与旧实现的 .catch 链等价，由注册表方案显式保证）。
- 公共 API 新增 `isPending`；key 类型放宽（类型层兼容既有调用）；symbol 键取消不再抛 TypeError。
- 请求域消费方（`createFetch` 去重路径）契约不变：整组取消、失败共享、落定后重执行、同 tick 取消短路（ADR 0018/0023）均经「共享执行 + `cancelable`」组合保持；同 tick `cancelCall` 后立即重新去重仍加入原组并收到 `CancelError`（与旧实现一致，非行为变更）。

## 被驳回的替代方案

- **保留每调用者独立包装 promise（现状）**：等待者分配成本随组规模线性增长；同一结果经多通道二次分发，且无法零推断地判定在途。
- **仅加 `isPending`，事件通道 + `has()` 时序推断**：在途判定仍依赖 emit 处理链的时序对齐，推断窗口存在；「无人 await 的失败」无法被确定性地吸收。
- **命名 `hasInFlight`/`isActive`**：与 `createCancelable.isPending`（ADR 0008，语义同为未落定）重复，应同名同义而非另立新名。
- **维持 string 键域**：掩盖 symbol 键缺陷（旧 `CancelError` 模板插值抛 TypeError）；Map 存储本已支持 `PropertyKey`，收紧面无收益。
