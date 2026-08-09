# 类型卫生与死分支清理：data 收窄、断言策略与哨兵描述表收敛

Status: accepted

## 背景

对 `createFetch` 的类型卫生审查（第六轮）发现以下可改进项，均不涉及运行时行为变更：

1. **`data?: any` 污染请求配置类型**：`RequestConfig.data` 为 `any`，`FullRequestConfig` 全链携带 `any`，拦截器与内部代码对 `data` 的访问失去类型检查。
2. **断言策略不一**：`as FullRequestConfig` 共 3 处（正常合并路径、同步兜底路径）、快捷方法 4 处 `as RequestConfig`，另有 `let fullRequestConfig: FullRequestConfig & RequestConfig` 的冗余交集（`FullRequestConfig` 已含 `RequestConfig`）。
3. **`getStatusCodeMsg` 的 `-4` 分支不可达**：`-4` 的 msg 恒由 `normalizeError` 直接取抛出的业务消息，该分支仅为哨兵描述表的形式完备，属死代码（注释亦自认防御性兜底）。
4. **评价项未决**：拦截器双链同构是否抽取；`HTTP_STATUS_TEXT` 覆盖有限是否扩表。

## 决策

### 1. `data` 收窄为 `unknown`

`RequestConfig.data` 由 `any` 改为 `unknown`。调用方传入任意值（`unknown` 为顶层类型，零负担）；拦截器读取 `config.data` 字段时需自行收窄/断言，属合理边界；`dispatchRequest` 传平台时按 `uni.request` 签名收窄（`data as UniApp.RequestOptions['data']`）。不引入请求体泛型 `BODY`——收益低、调用方负担加重，否决。

### 2. 断言策略：保留运行时为真的断言，消除可推断的断言

- **保留并注释**：正常合并路径（`request` 内 `as FullRequestConfig`）——spread 会把重叠字段推断为"可缺省"（如 `method: FetchMethod | undefined`），类型层面无法静态满足 `FullRequestConfig`，但运行时由 `defaults` 补齐字段，断言为真；同步兜底路径（最小兜底对象 `as FullRequestConfig`）——契约性类型谎言，字段本就缺失，注释已说明。
- **消除**：快捷方法 4 处 `as RequestConfig`（`{...requestConfig, method: 'GET'}` 可静态推断满足 `RequestConfig`）；`FullRequestConfig & RequestConfig` 冗余交集移除。

### 3. 删除 `getStatusCodeMsg` 的 `-4` 分支

删除不可达分支并调整注释：`-4` 的 msg 不经本函数，本函数仅覆盖哨兵码 `-1/-2/-3` 与 HTTP 状态码。哨兵描述表对 `-4` 的"完备性"由 `normalizeError` 承载，此处不重复。

### 4. 拦截器双链维持内联，不抽取

请求/响应两链差异参数过多（类型、校验器、catch fallback、返回值语义"整体替换"），抽取 helper 将形成高耦合函数，可读性收益为负；当前重复为"三行同形"级别，属可接受复制。

### 5. `HTTP_STATUS_TEXT` 维持 34 条，不扩表

扩表即修订 ADR 0006 的显式决策（"未收录码回退 `HTTP ${code}` 已满足恒有值"），属过度设计，维持现状。

## 后果

- `data` 类型承诺收窄：`any` 从请求配置链路退出，拦截器对 `data` 的访问获得类型检查（读取需断言）。
- 断言面收敛：3 处保留（2 处运行时为真 + 1 处兜底契约），4 处消除，冗余交集移除。
- 死代码移除，哨兵描述表职责明确（`-4` 由 `normalizeError` 产出 msg）。
- 运行时行为零变化，175 测试全绿，无需测试改动。

## 被驳回的替代方案

- **`data` 泛型化（`request<D, BODY>`）**：请求体与响应体双泛型增加调用方负担，收益低。
- **消除全部断言（含兜底对象）**：兜底对象字段本就缺失，消除即引入不诚实类型，不可行。
- **拦截器双链抽取共享 helper**：5+ 参数高耦合函数，可读性收益为负。
- **扩表 `HTTP_STATUS_TEXT`**：违背 ADR 0006 决策，过度设计。
