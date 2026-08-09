# buildFullConfig 返回类型别名化与内部函数不抽离确认

Status: accepted

## 背景

第七轮审查的两处可选微调：

1. **返回类型重复且签名冗长**：`buildFullConfig` 的返回类型 `Omit<R, keyof RC> & RC & { readonly rawRequestConfig: RC; header: Record<string, string> }` 在签名与内部断言各出现一次，且调用方在 IDE 中看到的是一长串交集而非有名字的类型。
2. **是否抽离 `core`/`dispatchRequest` 为独立模块**：用户自评"当前内聚性已很好，非必须"。

## 决策

### 1. 返回类型提为模块级别名 `MergedRequestConfig<R, RC>`

模块级新增两个类型别名：

- `RequestConfigLike<R>`：`buildFullConfig` 的请求配置约束（默认配置的部分覆盖 + url/data/key 扩展），`method`/`header` 显式放开为可选，避免默认配置字面量（如 `method: 'GET'`）卡死请求配置类型；约束定义收敛为一处。
- `MergedRequestConfig<R, RC>`：合并结果类型（Omit 形态）——请求配置提供的字段整体替换为请求配置的类型。

闭包内 `FullRequestConfig` **保持交集形态不变**：二者语义不同——`MergedRequestConfig` 对"必填型请求配置"调用方给出精确的合并结果；`FullRequestConfig` 需要 `R` 的必填字段（请求配置全可选覆盖时由 defaults 补齐）。若让 `FullRequestConfig` 派生自 `MergedRequestConfig`，Omit 语义会移除被全可选 `RequestConfig` 覆盖的必填字段，破坏 `dispatchRequest` 等处的读取，不可行。

### 2. 不抽离 `core`/`dispatchRequest` 为独立模块

维持现状。理由：这些函数共享闭包内 5+ 依赖（三类配置类型、`normalizeError`、`interceptors`、`asyncDedupe`、`cancelable`），抽离需全部参数化传入或将类型提升为模块级泛型（ADR 0013 已论证该 churn 成本），耦合不降反升；"一个请求实例的全部生命周期逻辑收在单个闭包、对外只暴露窄接口"是深模块形态，抽离会破坏内聚。

## 后果

- `buildFullConfig` 签名与内部断言引用 `MergedRequestConfig`，两处重复交集消失；d.ts 中该类型以有名字的别名呈现（非导出名，但 IDE 可读）。
- 约束定义（`RequestConfigLike`）收敛为一处。
- 运行时行为零变化，177 测试全绿。

## 被驳回的替代方案

- **`FullRequestConfig` 派生自 `MergedRequestConfig`**：Omit 语义在全可选覆盖场景丢失 `R` 必填字段，破坏内部读取。
- **抽离 `core`/`dispatchRequest` 为独立模块**：参数化 5+ 依赖或类型提升的 churn 成本大于收益，破坏闭包内聚。
