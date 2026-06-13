export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'retry'
export type NodeType = 'scheduler' | 'worker'
export type NodeAssignedBy = 'preferred' | 'fallback' | 'random'

export interface Task {
  id: string
  name: string
  status: TaskStatus
  node: string
  createdAt: number
  startedAt?: number
  completedAt?: number
  retries: number
  maxRetries: number
  duration?: number
  logs: string[]
  nodeAssignedBy?: NodeAssignedBy
}

export interface ClusterNode {
  id: string
  name: string
  type: NodeType
  status: 'online' | 'offline' | 'overloaded'
  cpu: number
  memory: number
  tasks: number
  uptime: number
}

export interface MetricsSnapshot {
  time: number
  totalTasks: number
  runningTasks: number
  successRate: number
  avgLatency: number
  nodeCount: number
}
