# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.0.5]: https://github.com/purea/utils/compare/v0.0.4...HEAD
[0.0.4]: https://github.com/purea/utils/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/purea/utils/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/purea/utils/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/purea/utils/releases/tag/v0.0.1
