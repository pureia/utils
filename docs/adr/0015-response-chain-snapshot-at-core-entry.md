# 响应拦截器链快照前置：进入 core 时统一快照

Status: accepted

## 背景

第八轮审查发现 `core` 内响应拦截器链的快照时机与 ADR 0004 §2 不符：

- 请求拦截器链在进入 `core` 时快照（`[...interceptors.request.handlers]`）；
- 响应拦截器链却延后到 `await dispatchRequest` 之后才快照。

后果：请求在网络上飞行期间新注册的响应拦截器，会被**进行中的请求**执行——请求链与响应链的快照语义不一致，行为不可预期，与 ADR 0004 §2「进行中的请求只执行发起时刻已注册的拦截器」的字面要求相悖。

## 决策

进入 `core` 时对请求/响应拦截器链**一次统一快照**，两链快照并排取于请求发出之前：

```ts
const requestInterceptorChain = [...interceptors.request.handlers];
const responseInterceptorChain = [...interceptors.response.handlers];
// 两链随后分别被请求/响应阶段遍历执行（略）
void [requestInterceptorChain, responseInterceptorChain];
```

响应链快照点由「响应阶段开始前」前移至「core 入口」，注释同步更新（删除原「链快照与取消 key 理由同请求拦截」的延后声明）。

## 后果

- 请求链与响应链快照语义一致：进行中的请求（含响应阶段）只执行发起时刻已注册的拦截器，执行期间新注册的只影响后续请求。
- 行为变更：此前响应阶段会执行网络期间新注册的响应拦截器，现在不会——与文档化语义（ADR 0004 §2）对齐。
- 现有测试均在任何请求发出前注册拦截器，无破坏；177 测试全绿。

## 被驳回的替代方案

- **维持延后快照（响应阶段开始前取）**：与请求链语义不一致，网络期间注册竞态继续存在。
- **仅请求链快照、响应链继续实时遍历**：响应阶段竞态未解决，与 ADR 0004 的对称设计背离。
