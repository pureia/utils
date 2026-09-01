# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- 新增核心工具 `debounce(func, wait, options?)`：时间窗防抖——`immediate: true`（默认）为 leading（首次立即执行、等待期内调用被合并），`immediate: false` 为 trailing（窗口结束执行最后一次）；返回携带 `cancel()`（丢弃 pending）与 `flush()`（立即补发最后一次被合并调用）的可调用函数；`src/core/debounce.ts` 子路径导出（含类型 `DebouncedFunction`），README 工具表与 CONTEXT.md「防抖」词条同步
- `createEventEmitter`：`once` 注册的处理器支持按原引用 `off` 退订（`once` 包装保存原始监听器引用供匹配，对齐 Node EventEmitter 惯例）
- 测试：`stableStringify` 数组元素 key 与原生一致性回归 2 条（toJSON/replacer 的 key 为字符串索引、根 key 为空字符串）
- 测试：`createEventEmitter` once 与 off 原引用交互回归 5 条（退订生效 / once 仍只触发一次 / 返回取消函数仍有效 / 双 once 移除其一 / on 语义不变）
- 测试：`createFetch` 的 `getErrorMessage` 未覆盖路径补 2 条（拦截器抛字符串、抛仅含 `msg` 字段的对象），uniapp 行覆盖达 99.2%
- 测试：`createCancelable` Proxy 包装 Promise（异常 then）、同 key 多并发 + cancel + 工作晚 reject（settle 卫语句）；`createEventEmitter` keys 快照语义；`debounce` 负 wait；`createFetch` complete 兜底（数字 errMsg / null result / 字符串 statusCode / keyed abort 对照）、buildFullConfig undefined 覆盖与实测（201 实判 / uni.request 收 GET）、去重快照时机、空串 key 校验（abort 实测）、响应结果 NaN/±Infinity code 校验

### Changed

- `debounce`：`options.immediate?: boolean` 更名为 `options.edge?: 'leading' | 'trailing'`，默认由 leading 改为 **trailing**（对齐主流防抖惯例；破坏性签名调整，0.x 未使用阶段）。leading 语义（首次立即执行、等待期合并、`flush` 补发最后一次）与 `wait` 非负校验不变
- `createCancelable`/`createAsyncDedupe`：`asyncFunc` 契约放宽——返回值经 `Promise.resolve` 归一，原生 Promise、thenable、同步值均可（此前仅支持原生 Promise，同步返回值/thenable/跨 realm Promise 以 `TypeError` 拒绝；破坏性行为调整，0.x 未使用阶段），同步抛错仍以原始错误拒绝
- `createFetch`：拦截器返回值运行时校验收敛为**核心形状**——请求拦截器须返回完整请求配置（url/host/method/header/timeout/isDedup，key 可选），响应拦截器须返回统一响应结果（ok/code/msg/data）；移除丢 key/空串 key/有限 code/缺 data 显式 undefined 等深度特判与专属告警文案（统一为一条告警并沿用上一值）
- `createFetch`：移除 `cancelIntentEmitter` 起跑前取消短路——`request()` 与 `abort()` 处于同一 tick 时，去重 keyed 请求的 `abort` 不再生效（该窗口无取消注册，请求照常发出并返回真实结果）；非去重 keyed 请求原语义不变（取消注册在同步栈内已建立，中止传输层或拦截器阶段）
- 测试：持平裁减约 43 例重复/空洞/接线琐事用例（278 → 236），保留全部行为契约钉住与高价值回归保护（fire-and-forget 失败防护、取消/落定竞态仲裁、平台异常数据挂起防护、负码不撞哨兵等），覆盖率维持 100%
- CONTEXT.md 词表同步：「取消」「同 tick 取消的路径差异」「取消执行」「异步去重」「防抖」「拦截器返回值校验」「拦截器与失败结果的边界」按新语义改写；README debounce 工具表与拦截器校验描述同步
- `debounce`：新增 `edge` 选项（替代 `immediate`，见上）；仅 `edge: 'leading'` 时窗口过期后 `flush` 仍补发最后一次被合并调用（trailing 语义下窗口结束即执行、无滞留 pending）
- `createCancelable`：`cancelable` 的 `asyncFunc` 签名收窄为 `() => Promise<T>`——仅支持返回原生 Promise 的异步函数；同步返回值、thenable、跨 realm/polyfill Promise（如 Bluebird）均为契约违规，调用以 `TypeError` 拒绝（破坏性签名调整，0.x 未使用阶段）
- `createAsyncDedupe`：`asyncDedupe` 的 `asyncFunc` 签名同步收窄为 `() => Promise<V>`（与「取消执行」契约一致；破坏性签名调整，0.x 未使用阶段）
- 公共 API 注释统一重写：补 `CmpFunc`/`ReplacerFunc` 文档、`buildFullConfig` 新增 `@example`，注释改以行为契约级描述并移除全部 ADR 编号引用
- CONTEXT.md 词表同步：「事件发射器」词条改为与实现一致（处理器抛错统一输出 `console.error`，`onError` 注入已移除）；移除词条中的 ADR 编号引用；补充 once 按原引用退订语义
- README 轻量修正：`FetchCode` 与 `ResponseResult` 中 `-4` 措辞统一、`buildFullConfig`/`FetchCode` 示例改为子路径导入（与 uni-app 环境警告自洽）、核心工具表补 `onCancel`
- `createCancelable`：移除启动前取消的 never-promise 悬挂——已取消分支直接短路返回（resolve-after-reject 为 no-op），行为等价、实现与注释简化
- 测试命名清理：`originalRequestConfig` → `rawRequestConfig`（对齐断言字段）；移除测试名中残留的两处 ADR 编号（aDR 0003/0004 → 描述性名称）
- `createEventEmitter`：store 内部类型改为擦除类型（`ErasedHandler`）收敛 `as` 断言（9 行 → 7 行，剩余为边界收窄/解包装声明；公共泛型签名不变）；once 包装 `.listener` + `ONCE_WRAPPER_MARKER` 双字段合并为单 symbol 字段（原始引用即标记值）
- `createEventEmitter`：`keys()` 返回快照数组而非活迭代器（与 emit 快照迭代哲学一致；破坏性返回类型变更，0.x 未使用阶段）
- `createCancelable`：settleResolve/settleReject 提炼 `finish()` 并增加 `state === 'settled'` 卫语句（取消胜出路径免去 emitter 未命中 O(N) 扫描）；`onCancel` 抛错 surface 文档修正（unhandledrejection 而非 uncaught exception，与实现一致）
- `createFetch`：get/post/put/delete 四个快捷方法改为 `shortcut` 工厂生成（消除四份重复与 4 处 `as` 断言；公共签名不变）
- `createAsyncDedupe`：`started.then` 双分支提炼为 `cleanup`（语义等价；仍不可用 `.finally`——派生 promise 会以原 reason 拒绝产生 unhandledrejection）
- CONTEXT.md 词表同步：「配置合并」补显式 undefined 语义、「拦截器返回值校验」补空串 key/有限 code、「code」补非数字状态码归一、「拦截器/业务错误」补平台回调异常数据、「去重」补拦截器链快照时机、「防抖」补非负 wait、「事件发射器」补 keys 快照

### Removed

- `createFetch`：去重请求起跑前（同一 tick）的 `abort(key)` 短路承诺（0.1.0 引入）——`request()` 与 `abort()` 同 tick 的场景现实不可达，经 2026-09 过度处理审查裁定移除，CONTEXT「同 tick 取消的路径差异」词条同步改写
- `createEventEmitter` 的 `onError` 注入参数（**补记**：该移除发生在 0.2.0 之后，此前未记入 CHANGELOG）
- 测试：移除 `createEventEmitter` onError 注入的过时用例（API 已移除，2 个用例此前持续失败）

### Fixed

- `stableStringify`：数组元素传给 toJSON/replacer 的 key 由数字索引改为字符串索引，与原生 `JSON.stringify` 行为对齐（此前与"签名与原生 replacer 一致"的注释声明不符）；`ReplacerFunc` 的 `key` 类型由 `string | number` 收窄为 `string`
- `createCancelable`：修复"取消与落定竞态窗口"——取消裁决经微任务延后、与结算门闩仲裁（内部实现，无外部 API）：工作函数结果已产出（如底层回调已触发）但结算微任务尚未执行时，`cancel(key)` 不再覆盖已完成的结果；作废的取消不触发 `onCancel`（不再对已完成工作重复 abort）。`cancelable` 可选参数合并为 options 对象——`cancelable(key, fn, onCancel?, options?)` 改为 `cancelable(key, fn, options?: { onCancel? })`（破坏性签名调整，0.x 未使用阶段）
- `createFetch`：拦截器返回值运行时校验强化——请求拦截器须返回完整请求配置（url/host/method/header/timeout/isDedup，key 可选；原配置含 key 而返回值丢 key 视为非法，保证 `abort(key)` 不失效），响应拦截器须返回完整 `ResponseResult`（ok/code/msg/header/cookies/data/requestConfig），非法返回值告警并沿用上一值
- `createFetch`：`dispatchRequest` 的 complete 回调增加异常兜底——平台回调收到异常数据（errMsg 非字符串、result 为 null）时归一化为 `code: -4` 而非让 `responsePromise` 永不落定（此前后台回调异常数据下无 key 请求永久挂起、无 abort 脱身路径）；字符串 statusCode（平台异常数据）走哨兵路径而非透传（违约 `code: number` 声明且 `includes` 误判失败）
- `createFetch`：`buildFullConfig` 显式 `undefined` 字段视为"未提供"、不再覆盖默认值（此前可选解构再传参会静默替换默认，如 `successStatusCodes: undefined` 令 201 被判失败）
- `createFetch`：拦截器链快照时机统一——以 `request()` 同步栈为准拍取，去重与非去重路径一致（此前去重 executor 微任务内才快照，同 tick 注册的拦截器会污染进行中的去重请求）
- `createFetch`：请求拦截器返回空串 `key` 视为非法（沿用上一配置，保证 `abort('')` 不脱落取消体系）；响应结果 `code` 为有限数字校验（NaN/±Infinity 拒绝，避免 "HTTP NaN/Infinity" msg）
- `debounce`：`wait` 为负值时抛 RangeError（此前仅校验有限数字，负值交给引擎平台差异化钳制，与"避免平台差异化钳制"设计原则冲突）

### Docs

- README：新增「请求去重的语义边界」（去重键 = 拦截器前全量配置序列化、等待者不执行拦截器链）、「失败类别速查表」、ESM-only 说明；修正 `lint:fix` 脚本说明
- CONTEXT.md「取消执行」词条同步 `isCompleted` 谓词语义
- CHANGELOG 补 `[unreleased]`/`[0.2.0]` 版本链接定义
- AGENTS.md：Domain docs 修正（`docs/adr/` 已归档并入 CONTEXT.md）、新增「提交规范」一节；`docs/agents/domain.md` 同步
- 测试：补行为契约用例（取消广播、主动取消跳过响应链、`getErrorMessage` 对象 message 分支、once 抛错自移除、default 导出、BigInt 行为）并统一测试收尾纪律（fake timers、queueMicrotask、try/finally 恢复 spy）

## [0.2.0] - 2026-08-29

### Added

- 发布钩子：`prepublishOnly: pnpm build`（自动构建 `dist`，防止干净 clone 上发布空/陈旧包）
- `createCancelable` 与 `stableStringify` 补 `default` 导出，5 个工具模块的导出约定统一（命名导出不受影响）
- package.json `exports` 为各子路径补显式 `types` 条件（不再依赖 .mjs 兄弟 .d.mts 的隐式解析）
- 新增回归测试：合并阶段 requestConfig getter 抛错兜底；`cancelCall` 同一 tick 等待者；非去重 keyed 请求同 tick abort 的「已发出」断言（与去重路径语义区分）
- CONTEXT.md 新增「同 tick 取消的路径差异」词条
- `createAsyncDedupe` 新增 `isPending(key)` 在途查询

### Changed

- `createEventEmitter` 无类型参数时默认事件载荷类型 `any` → `unknown`（仅类型层、默认用法）
- eslint 配置仍为 `eslint.config.ts`：显式声明 `jiti` devDependency（此前仅随 eslint peer 解析），并对 0.1.0 的过期描述补充勘误（见下）
- tsdown 显式 `target: node18`，与 `engines >=18` 显式对齐
- CI 移除重复的 `test` 步骤（`test:coverage` 已含执行与 95% 阈值门禁）
- README 补齐公共导出（`buildFullConfig`、`FetchCode`）说明、uni-app 环境说明与开发/本地 lint 版本要求
- 内部整洁：去重键前缀/哈希种子/HTTP 状态码边界/默认成功码提取为常量；`getStatusCodeMsg` 收窄 `code<0` 分支为 `-3`；`strRepeat` 以原生 `space.repeat` 替换
- 去重实现改为在途注册表：执行者与等待者共享同一 promise 对象（`p1 === p2` 可观察）；去重与可取消执行的 key 类型放宽为 string | number | symbol

### Fixed

- CHANGELOG 0.1.0「eslint 配置改为 .mjs 并移除 jiti」与实际不符的勘误（最终为 `eslint.config.ts` + jiti peer）
- 符号键下 `cancel` 不再抛 TypeError（`CancelError` 消息改用 `String(key)`）

## [0.1.0] - 2026-08-15

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
- CI 工程补强：Node 22/24 版本矩阵（lint 工具链依赖 `Object.groupBy`，要求 Node 21+，Node 18/20 无法运行 lint；`engines >=18` 为运行时契约）；新增 `publint`（包元数据检查）与 `attw`（arethetypeswrong，`esm-only` 模式类型解析检查）两道门禁（新增 devDependencies：`publint`、`@arethetypeswrong/cli`）
- ~~eslint 配置由 `eslint.config.ts` 改为 `eslint.config.mjs`（纯样板配置，绕开 jiti 转译），移除 `jiti` devDependency~~（勘误：该条描述的是发布前中途状态；最终 0.1.0 保留 `eslint.config.ts`，`jiti` 当时随 eslint peer 解析、未显式声明，见 [Unreleased]）
- 测试稳定性：`createAsyncDedupe` 计时/性能断言改用假计时器（消除慢 CI 上的毫秒阈值抖动）；`createAsyncDedupe`/`createCancelable` 测试改为每测试新建实例（消除共享实例的隐藏耦合）；`createFetch` 测试显式 `unstubAllGlobals` 收尾
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

[unreleased]: https://github.com/pureia/utils/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/pureia/utils/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pureia/utils/compare/v0.0.6...v0.1.0
[0.0.6]: https://github.com/pureia/utils/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/pureia/utils/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/pureia/utils/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/pureia/utils/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/pureia/utils/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/pureia/utils/releases/tag/v0.0.1
