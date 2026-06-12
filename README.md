# 分布式任务调度与监控平台

基于 Elixir/Phoenix GenServer 的分布式任务调度系统，配套 React + Ant Design 监控大屏。

## 功能

- 任务 CRUD + 状态管理（pending/running/success/failed）
- 失败任务自动重试（可配置最大重试次数）
- 集群节点健康监控（CPU/内存/任务数）
- 实时指标图表（运行中任务数、成功率、平均延迟）
- GenServer 状态管理 + PubSub 事件广播
- REST API（任务列表/创建/重试/取消/统计/节点）

## 技术栈

- 前端：React + TypeScript + Ant Design + Recharts + Zustand
- 后端：Elixir + Phoenix + GenServer + PubSub
- 数据库：PostgreSQL（Ecto）

## 运行

```bash
# 后端
cd backend && mix deps.get && mix run --no-halt

# 前端
cd frontend && npm install && npm run dev
```
