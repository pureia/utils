# 合并响应结果类型：只保留 ResponseResult

Status: accepted

## 背景

`createFetch` 对统一响应结果维护了三层类型：`BaseResponseResult<R>`（公共字段）、`SuccessResponseResult<R, D>` / `ErrorResponseResult<R, D>`（以 `ok` 字面量 true/false 为判别字段的两个分支接口）、以及 `ResponseResult<R, D>`（判别联合）。三者同时导出。

核查结论：

- 仓库内（源码、测试）无任何外部引用，仅 `createFetch.ts` 自身与旧 ADR 文档提及 `ErrorResponseResult`/`SuccessResponseResult` 名称；
- `@purea/utils` 处于 0.0.x 早期版本，公开导出面收敛的破坏性变更代价可接受；
- 类型守卫 `isSuccessResult` 注释自述"等价于 `result.ok`"，仓库内零调用，功能冗余。

## 决策

### 1. 拍平为单接口 `ResponseResult`

两个分支接口合并为一个扁平接口，公共字段（`BaseResponseResult`）一并吸收，`BaseResponseResult` 不再单独存在：

```ts
interface ResponseResult<R, D> {
  ok: boolean;
  code: number;
  msg: string;
  header: Record<string, string>;
  cookies: string[];
  requestConfig: R;
  data: D | null;
  error?: unknown;
}
```

### 2. 删除 `isSuccessResult` 类型守卫

该守卫的收窄目标依赖被删接口，且与 `if (result.ok)` 等价、零调用，随本次一并删除。

### 3. 导出表与内部调用同步

- 响应结果相关导出收敛为 `type ResponseResult` 一个名字：删除 `type SuccessResponseResult`、`type ErrorResponseResult`、`isSuccessResult`；同时移除 `CancelError` 的再导出（消费端对 `error` 做 `instanceof CancelError` 时，改从 `@purea/utils/core/createCancelable` 导入）；
- `normalizeError` 返回类型由 `ErrorResponseResult<FullRequestConfig, D>` 改为 `ResponseResult<FullRequestConfig, D>`；
- `dispatchRequest` 中成功/失败按分支展开的构造简化为单分支（`ok` 为普通 boolean，`data` 统一为 `D | null`）。

## 后果

- 导出面收敛为单类型，调用方记忆负担降低；破坏性变更：依赖旧两接口名、`isSuccessResult` 或从 `uniapp/createFetch` 导入 `CancelError` 的调用方需迁移（`CancelError` 改由 core 子路径提供）。
- 语义代价：`ok` 不再是字面量判别，`if (result.ok)` 后 `data` 不自动收窄为 `D`，成功路径下仍需调用方按 `ok` 自行断言。
- 运行时行为零变化：`isResponseResultLike` 校验（`ok` boolean + `code` number）与归一化逻辑不受影响，无需测试改动。
- 文档同步：ADR 0005 中 `ErrorResponseResult.error` 名称引用改为 `ResponseResult.error`。

## 被驳回的替代方案

- **保留判别联合、内联分支**（`ResponseResult = BaseResponseResult & ({ ok: true; data: D } | { ok: false; data: D | null; error? })`）：可保留 `ok` 收窄能力，但 `normalizeError` 与守卫需写 `Extract<ResponseResult<...>, { ok: false }>` 类长类型，且对外的名义"合并"并不减少调用方接触的分支形状；本次以导出面简化为首要目标，接受收窄损失。
- **保留 `isSuccessResult`**：与 `result.ok` 完全等价且无人使用，维持导出只增加维护面。
