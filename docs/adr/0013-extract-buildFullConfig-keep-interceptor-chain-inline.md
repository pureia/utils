# 模块化抽取：buildFullConfig 独立导出，拦截器链维持内联

Status: accepted

## 背景

第六轮审查（ADR 0012）后，`createFetch` 主体仍包含两处可再分解的逻辑：`request()` 内的配置合并（默认/请求配置 + header 深合并 + rawRequestConfig）与 `core()` 内的双拦截器链。

对两者的拆解价值评估：

1. **配置合并适合抽取**：纯同步函数、无闭包依赖、可独立单测；`request()` 内的同步兜底 catch 保持不变，抽取后 `request()` 体量立减。
2. **拦截器链不适合整链抽取**：两链差异参数多（类型、校验器、warn 文案、catch fallback、返回值语义"整体替换"），且**响应链的成功值自身就是 `ResponseResult`**，与失败返回值同形状——整链抽取需引入判别联合（`{done,value} | {done,result}`）或哨兵返回值才能区分成败，比内联多一层运行时包装。ADR 0012 §4 已论证"维持内联"。

## 决策

### 1. 抽取并导出 `buildFullConfig`

模块级新增纯函数 `buildFullConfig<R, RC>(defaults, requestConfig)`，合并规则与 `request()` 原实现一致（header 深合并、其余字段整体替换、rawRequestConfig 保留原始引用）；`request()` 改为调用它，同步兜底 catch 留在 `request()` 原位（全局仅一处）。

**导出面决策**：`buildFullConfig` 以模块级导出形式公开（`src/uniapp/index.ts` 为 `export *`，模块级导出即进入 `@purea/utils` 公共 API）。理由：(a) 独立单测需要从包入口导入；(b) 它是纯合并工具，具备独立复用价值。若后续认为公共 API 面过大，可回收（库处于 0.0.x，破坏性变更代价可接受）。

### 2. 拦截器链维持内联

`executeInterceptorChain` 不抽取，确认 ADR 0012 §4 结论：两链差异参数多、响应链存在判别歧义，抽取的耦合成本大于行数收益。

### 3. 单元测试

新增 `buildFullConfig` 两条单测：header 字段深合并、请求配置字段整体覆盖默认配置（含 rawRequestConfig 保留）。既有集成测试（`配置合并` describe）继续守卫通过公共 API 的合并行为。

## 后果

- `request()` 体量下降，合并规则文档收敛到 `buildFullConfig` 的 JSDoc。
- `buildFullConfig` 成为公共 API 纯工具，可独立单测与复用。
- 拦截器链保持内联，判别歧义不引入。
- 运行时行为零变化，177 测试全绿。

## 被驳回的替代方案

- **拦截器链整链抽取（executeInterceptorChain）**：6+ 参数泛型 + 判别联合返回值，响应链成功值与失败值同形导致判别歧义，抽取后比内联更难读。
- **buildFullConfig 仅闭包内联不导出**：无法独立单测，抽取收益打折。
- **配置合并与同步兜底一并抽入**：catch 兜底全局仅一处，留在 `request()` 更直白。
