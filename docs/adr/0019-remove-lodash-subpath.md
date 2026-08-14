# 移除 lodash 子路径导出

Status: accepted

## 背景

`@purea/utils/lodash` 子路径（`src/third-party/lodash.ts`，`export * from 'lodash-es'`）的历史来源：

1. 0.0.4 曾修正 `lodash-es` 在 uni-app 模块中的导入路径（CHANGELOG 0.0.4 Fixed）——当时的库代码直接依赖 lodash 工具函数；
2. 其后库自身的 lodash 使用逐渐移除，该文件退化为纯穿透再导出：库源码零使用，仅向使用方转发 `lodash-es` 全量导出。

代价评估：

- 使用方经 `@purea/utils/lodash` 导入即隐式承担 `lodash-es` 运行时依赖，且打包器可能无法完全 tree-shake 全量 re-export，体积代价由每个使用方承担；
- `lodash-es` 与 `@types/lodash-es` 占据 `dependencies`，使库的依赖面为「零使用代码」买单；
- 该穿透价值仅为一行 `export *`，使用方自行 `pnpm add lodash-es` 即可等价替代。

## 决策

**移除 `@purea/utils/lodash` 子路径**：

1. 删除 `src/third-party/lodash.ts` 与 exports 表中的 `./lodash` 条目；
2. 移除 `lodash-es`、`@types/lodash-es` 依赖（pnpm-lock 同步更新）；
3. 测试中经该子路径导入的 `merge` 改为本地浅展开（测试配置仅顶层覆盖，语义等价）；
4. vitest 别名与 tsconfig paths 中对应条目一并删除。

使用方如需 lodash，直接安装 `lodash-es`（或 `lodash`）。

## 后果

- **破坏性变更**：`@purea/utils/lodash` 导入路径失效，按 SemVer 0.x 规则版本升为 0.1.0；
- 库的 `dependencies` 清空，依赖面仅剩 devDependencies；
- 打包产物移除 `dist/third-party/`，构建输出从 19 文件降至 16 文件；
- CHANGELOG 0.1.0 的 Removed 段记录该破坏性变更。

## 被驳回的替代方案

- **保留子路径、依赖降为 peerDependency**：保留穿透但引入 peer 版本协商与使用方的安装义务，为一个一行 re-export 的便利性付出依赖管理复杂度，不成比例。
- **保留为常规 dependency 但文档化**：维持现状的零使用依赖，未消除体积与依赖面代价，仅增加文档。
