# 项目优化项清单（@purea/utils）

> 本文档是项目的优化项跟踪台账：只记录**候选优化**及其状态，不记录实现细节（实现细节与决策留痕应落在 ADR）。
> 生成日期：2026-08-29 ｜ 更新日期：2026-08-29（P0 批次已实施）｜ 范围：全仓库（src/test/docs/工程配置/CI），排除 .tmp-dsh-routing-suite/
> 数据来源：本地门禁实测 + 全仓代码审计（约 34 条候选，含 8 维度）

## 状态图例

| 状态 | 含义 |
|------|------|
| 候选 | 已评估、尚未拍板，等待实施轮次决策 |
| 已决策-待实施 | 讨论已拍板具体方案，实施在下一轮 |
| 已完成 | 已实施并验证 |
| 不做 | 评估后决定不实施（原因见备注） |
| 观察 | 暂不实施；条件变化时重新评估 |

## 门禁现状（本地实测）

| 门禁 | 结果 | 说明 |
|------|------|------|
| typecheck（tsc --noEmit） | 通过 | — |
| build（tsdown） | 通过 | 16 个产物，共 74.8 kB；createFetch 19.42 kB（gzip 7.26 kB）；target 显式 node18 |
| lint（全仓 eslint .） | 通过 | .tmp 残留目录移出后恢复全绿 |
| test（vitest） | 未验证 | 本环境 vite 配置加载 spawn EPERM（沙箱限制，非项目缺陷）；CI 为权威 |
| publint / attw | 未验证 | npm pack spawn EPERM（同上环境限制） |

---

## 桶 A：P0 快修（已实施 2026-08-29）

| 编号 | 维度 | 问题 | 建议 | 严重度 | breaking | 状态 |
|------|------|------|------|--------|----------|------|
| 6.1 | 工程化 | files: ["dist"] 且 dist/ 被 gitignore，无发布前构建钩子；干净 clone 上 pnpm publish 会发空/陈旧包 | 加 prepublishOnly: pnpm build | 高 | 否 | 已完成 |
| 4.1 | API | 公共导出面大于 README：buildFullConfig、FetchCode 等已公开但文档未提 | README 补公共 API 表 | 中 | 否 | 已完成（补文档；不做回收） |
| 5.1 | 文档 | CHANGELOG 0.1.0 记『配置改为 .mjs 并移除 jiti』，实际仍是 eslint.config.ts（隐式依赖 eslint 的 jiti peer） | 保留 .ts；显式加 jiti devDep；CHANGELOG 勘误 + Unreleased | 中 | 否 | 已完成 |
| 6.2 | 工程化 | CI 里 test 与 test:coverage 各跑一遍完整套件 | CI 只跑 test:coverage | 低 | 否 | 已完成 |
| 5.2 | 文档 | README 未提及 buildFullConfig | 并入 4.1 | 中 | 否 | 已完成（并入 4.1） |
| 6.3 | 工程化 | exports 子路径未显式声明 types 条件 | 每个子路径补 types 条件 | 中低 | 否 | 已完成 |
| 1.2 | 代码 | 魔法值散落（Request: 前缀、hash 种子、100/600、默认 [200]） | 提取命名常量 | 低 | 否 | 已完成 |
| 1.3 | 代码 | getStatusCodeMsg 的 code<0 分支语义宽度大于实际调用面 | 收窄为 code===UNKNOWN 并补注释 | 低 | 否 | 已完成 |
| 7.4 | 性能 | strRepeat 手写循环冗余 | 用 space.repeat(level) 替换并删除 strRepeat | 低 | 否 | 已完成 |
| 3.3 | 测试 | 弱断言：ok 意外为 true 时假阳性 | 改为无条件断言 | 低中 | 否 | 已完成 |
| 3.4 | 测试 | createEventEmitter.test.ts 共享实例 + afterEach clear | 改为每个 it 新建 | 中 | 否 | 已完成 |
| 1.4 | 代码 | 测试辅助 createFetch/getOriginalRequestConfig 遮蔽导入名 | 改名（makeFetch/baseConfig） | 低 | 否 | 已完成 |
| 6.4 | 工程化 | tsdown 未显式 target（默认已是 node18；防漂移） | 显式 target: node18；README 注明本地 lint 需 Node22+ | 低 | 否 | 已完成 |

## 桶 B：P1 排期实施（其中已决策项已实施 2026-08-29）

| 编号 | 维度 | 问题 | 建议 | 严重度 | breaking | 状态 |
|------|------|------|------|--------|----------|------|
| 1.1 | 代码 | createFetch.ts 680 行；模块级纯函数与请求实例闭包混排 | 抽到 src/uniapp/ 子模块并可独立单测。红线：不拆闭包内 core/dispatchRequest/拦截器链（ADR 0013/0014） | 中 | 否 | 候选 |
| 2.1 | 类型 | createFetch.d.mts 约 620 行，公共方法签名反复内联匿名 FullRequestConfig 交集 | 导出命名公共类型，收敛 d.mts、改善 IDE hover | 中 | 类型层 | 候选 |
| 2.2 | 类型 | 4 个 shortcut 方法 as RequestConfig 断言偏多 | 配合 2.1 用更精确类型消除 | 中 | 类型层改善 | 候选 |
| 3.2 | 测试 | 三处契约边界缺测：getter 抛错；非去重同 tick abort；cancelCall 等待者窗口 | 各补一用例 | 中 | 否 | 已完成 |
| 3.2b | 文档 | 同 tick abort 精确语义（非去重已发出 vs 去重不发出） | CONTEXT.md 补精确词条；测试断言现有语义 | 中 | 否 | 已完成 |
| 5.3 | 文档 | 缺构建/发布工具链选型决策留痕 | 新增 ADR 0024 | 低中 | 否 | 候选 |
| 8.2 | 依赖 | createFetch 运行时依赖全局 uni；d.mts 不泄漏 UniApp 类型 | README 明示 uni-app 环境与子路径建议；保持 devDep | 中低 | 否 | 已完成（仅 README） |
| 4.2 | API | 5 个模块仅 3 个有 default 导出 | 补 default（非破坏性统一） | 低 | 否 | 已完成 |
| 2.3 | 类型 | createEventEmitter 泛型默认 Record<string, any> | 默认改 Record<string, unknown> | 低 | 类型层 | 已完成 |
| 2.4 | 类型 | MergedRequestConfig 约束 RequestConfigLike 未导出 | 导出或收敛为命名类型，与 2.1 同批 | 低 | 类型层 | 候选 |

## 桶 C：观察项（暂不实施，条件变化时重估）

| 编号 | 维度 | 问题 | 现状/重估条件 | 严重度 | breaking | 状态 |
|------|------|------|----------------|--------|----------|------|
| 4.3 | API | 0.1.0 后 data/ok/导出面/FetchCode 再调整即破坏已发布用户 | 风险提示：后续语义变更走 minor + 新 ADR | 低 | — | 观察（说明性） |
| 2.5 | 类型 | createEventEmitter 内部 Set 变体 cast | 常见且可注释说明；低收益 | 低 | 否 | 观察 |
| 2.6 | 类型 | stableStringify 内部 any（移植固有） | 可局部收紧；收益低 | 低 | 否 | 观察 |
| 7.1 | 性能 | 每请求重建 merged 配置/header | 设计使然（动态默认配置语义） | 低 | — | 观察 |
| 7.2 | 性能 | dedup key 全量 stableStringify + simpleHash | 去重语义需要全量；仅当 data 巨大时再评估（需 ADR） | 低 | — | 观察 |
| 7.3 | 性能 | emit 每轮 [...handlers] 快照分配 | 对齐 Node 快照语义；高频场景再改 | 低 | — | 观察 |
| 7.5 | 性能 | dist 未压缩、无显式 sourcemap 配置 | 库源码可读性优先；可选 sourcemap | 低 | — | 观察 |
| 8.1 | 依赖 | devDependencies 全部被使用、无冗余 | 达标 | 低 | — | 观察 |
| 8.3 | 依赖 | @purea/eslint-config 私有 devDep | 可选：注释说明来源 | 低 | — | 观察 |
| 8.4 | 依赖 | caret 版本 + CI frozen-lockfile | 达标 | 低 | — | 观察 |

## 桶 D：仓库卫生

| 编号 | 问题 | 建议 | 状态 |
|------|------|------|------|
| H1 | 未跟踪的 .tmp-dsh-routing-suite/ 使本地全仓 lint 失败、混入 tsconfig 扫描 | 移出仓库外 | 已完成（目录已不在仓库内，git status 干净） |
| H2 | lint/tsconfig 范围未对非项目目录设防 | 如再有残留可评估 lint ignores 配置 | 观察 |

---

## Top 10（风险序，正确性/契约优先）

| # | 条目 | 类别 | 理由 |
|---|------|------|------|
| 1 | 6.1 发布前构建钩子 | 高 | 已完成：prepublishOnly 防发空/陈旧包 |
| 2 | 4.1/5.1/5.2 文档一致性 | 中 | 已完成：CHANGELOG 勘误 + README 补齐公共 API |
| 3 | 3.2 契约测试缺口 | 中 | 已完成：三处边界补测 |
| 4 | 2.1 命名公共类型 | 中 | 候选：d.mts 减半、IDE DX（下一批） |
| 5 | 1.1 createFetch 模块级拆分 | 中 | 候选：遵守 ADR 红线（下一批） |
| 6 | 3.3/3.4 测试质量 | 中低 | 已完成：弱断言/实例隔离 |
| 7 | 6.3 exports types 条件 | 中低 | 已完成 |
| 8 | 6.2 CI 去重 test | 低 | 已完成 |
| 9 | 6.4 显式 target | 低 | 已完成 |
| 10 | 1.2/1.3/7.4/4.2/2.3 低值组 | 低 | 已完成 |

## 性价比 Top 3（收益/成本比）

1. 6.1 发布钩子：1 行配置，防发布空包（已完成）。
2. 4.1/5.1/5.2 文档组：纯文档，0 风险（已完成）。
3. 3.2 契约测试组：3 个用例固定核心契约（已完成）。

---

## 附录：环境限制说明

- 本机沙箱无法运行 vitest（vite 配置加载需 spawn 子进程被拦截）、publint/attw（npm pack spawn 被拦截）；test/coverage/publint/attw 以 CI（Node 22/24 × 6 门禁）为权威。
- P0 批次验证：typecheck/lint/build 本地通过；测试代码经类型检查与代码评审、待 CI 跑全量。
