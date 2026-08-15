# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-14

### Added

- `createEventEmitter` 支持 `onError` 注入，处理器抛错时可接管默认的 `console.error` 输出
- 补 `MergedRequestConfig` 类型按名导出（`buildFullConfig` 的返回类型）
- 去重请求起跑前（同一 tick）的 `abort(key)` 支持：执行者短路、整组归一化为 `-1` 且不发起请求（见 ADR 0018）
- 测试直连源码（vitest 别名 + tsconfig paths），避免测到陈旧构建产物
- 新增 CI 工作流：typecheck / lint / test / coverage（阈值 95%）/ build 五道门禁；`lint:check`、`test:coverage` 脚本
- 新增回归测试：isPending 状态查询、`off(key, handler)` 直接调用形态、拦截器非法返回值告警分支、1-99 异常状态码归一化、`getErrorMessage` 兜底分支
- MIT LICENSE 与包元数据（license / author / repository / description / keywords / engines）
- README（简介、安装、快速上手、核心工具表）
- CONTEXT.md 新增「核心工具域」词条；ADR 索引新增 0019

### Changed

- `getStatusCode` 收紧有效 HTTP 状态码范围为 100-599：1-99 的异常正数归一为 `-3` 而非透传
- `stableStringify` 循环检测由 O(n²) 数组扫描改为 Set（O(1)），并补充 json-stable-stringify 移植版权声明
- `stableStringify` 的 `space` 与空容器格式对齐原生 `JSON.stringify`：数字截断并钳制 [0,10]（负数/NaN 无缩进，Infinity/超大值不挂死）、字符串取前 10 码元、非数字/字符串类型按无缩进、空容器恒紧凑输出；移除 `collapseEmpty` 选项
- `createCancelable` 启动前取消短路：同一 tick 内 `cancel` 后工作函数不再启动（副作用不发生）；已启动的工作仍跑完（见 ADR 0023）
- `createEventEmitter` 的 `emit` 改为快照迭代（本轮触发期间订阅/取消不影响本轮，对齐 Node 惯例；杜绝 once 互相重订阅导致的活迭代无限增长）
- `getErrorMessage` 对 `message`/`msg` 分别校验非空字符串：空 `message` 不再遮蔽有效的 `msg`
- `createInterceptorManager` 收敛公共面：拦截器数组私有化，仅暴露 `use`；core 经 `snapshot()` 读取拦截器链快照（调用方无法绕过 `use` 修改拦截器链）
- package.json 工程补强：新增 `typecheck` 脚本（CI 复用）、`publishConfig.access: public`、exports 补 `./package.json` 子路径
- CI 工程补强：Node 18/22 版本矩阵；新增 `publint`（包元数据检查）与 `attw`（arethetypeswrong，`esm-only` 模式类型解析检查）两道门禁（新增 devDependencies：`publint`、`@arethetypeswrong/cli`）
- tsconfig 收紧：`noUnusedLocals` / `noUnusedParameters` / `isolatedModules` / `verbatimModuleSyntax`
- `@purea/eslint-config` 由 `latest` 锁为 `^0.0.6`，保证 CI 可复现
- ADR 索引新增 0018；ADR 0009/0015 文档代码块 lint 修复

### Removed

- **破坏性变更**：移除 `@purea/utils/lodash` 子路径导出与 `lodash-es`/`@types/lodash-es` 依赖（库自身未使用，使用方如需请直接安装 `lodash-es`，见 ADR 0019）

## [0.0.6] - 2026-08-09

### Added

- 新增 `createCancelable` 核心工具：可取消的异步执行（`CancelError` / `cancel` / `onCancel` / `isPending`）
- 导出 `buildFullConfig` 与 `MergedRequestConfig` 类型，配置合并成为公共 API
- 项目文档体系：CONTEXT.md 词表 + 架构决策记录（ADR 0001–0017）与索引表

### Changed

- 请求错误归一化：成功、传输错误、HTTP 错误、业务错误、取消全部归一为统一响应结果，永不 reject
- 拦截器返回值运行时校验：请求拦截器校验 url/host，响应拦截器校验 ok/code，非法返回值告警并沿用上一值
- `data` 类型收窄为 `unknown`：请求配置与响应数据需调用方自行收窄/断言
- 响应拦截器链快照前置到 core 入口，与请求链快照语义一致
- 快捷方法（get/post/put/delete）类型断言调整
- `simpleHash` 补全哈希字符串长度

### Fixed

- 哨兵码取值空间守卫：平台异常负状态码归一为 `-3` 而非透传，避免与 `-1/-2/-3/-4` 哨兵码冲突
- 去重请求取消语义修复（整组取消）

## [0.0.5] - 2026-07-22

### Added

- 新增 `stableStringify` 工具函数

### Changed

- `createAsyncDedupe` 新增取消功能（`cancelCall`），支持请求取消
- 替换 `eventStore` 为 `eventEmitter` 实现异步去重
- 重命名 `CancelError` 为 `DedupeCancelError`，完善导出
- 重构请求取消逻辑，替换为 abort API
- 提取取消执行错误类并独立导出
- 重命名 cancel 相关变量和函数为 `cancelCall`
- 简化事件订阅相关的条件判断代码
- 调整 lodash 导入方式并整理配置
- 优化打包配置并更新依赖

## [0.0.4] - 2026-07-05

### Changed

- 重命名 `use` 相关导出为 `create` 前缀，统一工具库命名规范（`useEventStore` → `createEventStore`，`useAsyncDedupe` → `createAsyncDedupe`）
- 替换 `useAsyncDebounce` 为 `createAsyncDedupe`，优化异步防抖/去重实现

### Fixed

- 修正 `lodash-es` 在 uni-app 模块中的导入路径

## [0.0.3] - 2026-05-03

### Added

- `useFetch` 新增 `ShortcutRequestConfig` 类型，支持更便捷的快捷请求配置

### Fixed

- 处理未定义状态码的边界情况

## [0.0.2] - 2026-04-26

### Added

- 新增 uni-app 请求工具 `useFetch` 及相关配置
- `useFetch` 新增 PUT 和 DELETE 快捷方法支持

### Changed

- 重构 `useFetch` 请求模块，增强功能
- 重构 `useFetch` 请求配置处理逻辑，优化类型定义
- 移除 `BaseRequestConfig` 的扩展属性，简化配置接口
- 使用 `Extensible` 类型替代内联类型定义
- 优化 `useFetch` 状态码处理和请求任务管理
- 内联 HTTP 方法函数，简化代码结构
- 重命名防抖功能为请求去重（dedupe）

### Fixed

- 修正 `useFetch` 请求中止和超时的状态码处理
- 修正 `useFetch` 状态码和描述处理逻辑

## [0.0.1] - 2026-04-22

### Added

- 初始化项目，搭建基础构建配置（tsdown + vitest）
- 新增事件存储功能 `useEventStore`，支持全局单例模式
- 新增异步防抖功能 `useAsyncDebounce`

[0.1.0]: https://github.com/pureia/utils/compare/v0.0.6...v0.1.0
[0.0.6]: https://github.com/pureia/utils/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/pureia/utils/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/pureia/utils/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/pureia/utils/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/pureia/utils/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/pureia/utils/releases/tag/v0.0.1
