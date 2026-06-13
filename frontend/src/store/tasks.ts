import { create } from 'zustand'
import type { Task, ClusterNode, MetricsSnapshot, TaskStatus, NodeAssignedBy } from '../types'

const API_BASE = 'http://localhost:4000/api'

function mockNodes(): ClusterNode[] {
  const scheduler: ClusterNode = {
    id: 'node-1',
    name: 'scheduler-main',
    type: 'scheduler',
    status: 'online',
    cpu: 15 + Math.random() * 25,
    memory: 25 + Math.random() * 30,
    tasks: 0,
    uptime: 3600 + Math.random() * 86400,
  }

  const workers: ClusterNode[] = Array.from({ length: 4 }, (_, i) => ({
    id: `node-${i + 2}`,
    name: `worker-${i + 1}`,
    type: 'worker' as const,
    status: Math.random() > 0.15 ? 'online' as const : 'overloaded' as const,
    cpu: 20 + Math.random() * 60,
    memory: 30 + Math.random() * 50,
    tasks: Math.floor(Math.random() * 5),
    uptime: 3600 + Math.random() * 86400,
  }))

  return [scheduler, ...workers]
}

function getWorkerNodes(nodes: ClusterNode[]): ClusterNode[] {
  return nodes.filter(n => n.type === 'worker')
}

function mockTasks(nodes: ClusterNode[]): Task[] {
  const workerNodes = getWorkerNodes(nodes)
  const names = ['data_sync', 'email_batch', 'report_gen', 'cache_warm', 'log_rotate', 'db_backup', 'index_rebuild', 'health_check']
  return Array.from({ length: 8 }, (_, i) => {
    const status: TaskStatus[] = ['pending', 'running', 'success', 'failed']
    const s = status[Math.floor(Math.random() * 4)]
    const node = workerNodes[Math.floor(Math.random() * workerNodes.length)]
    return {
      id: `task-${1000 + i}`,
      name: names[i % names.length],
      status: s,
      node: node.name,
      createdAt: Date.now() - Math.floor(Math.random() * 600000),
      startedAt: s !== 'pending' ? Date.now() - Math.floor(Math.random() * 300000) : undefined,
      completedAt: (s === 'success' || s === 'failed') ? Date.now() - Math.floor(Math.random() * 60000) : undefined,
      retries: s === 'failed' ? Math.floor(Math.random() * 3) : 0,
      maxRetries: 3,
      duration: s === 'success' ? 1000 + Math.floor(Math.random() * 30000) : undefined,
      logs: [`[INFO] Task ${names[i % names.length]} started`, `[INFO] Processing on ${node.name}`],
      nodeAssignedBy: 'random',
      preferredNode: null,
    }
  })
}

function isNodeSuitable(nodeName: string, tasks: Task[], nodes: ClusterNode[]): boolean {
  const node = nodes.find(n => n.name === nodeName)
  if (!node || node.type !== 'worker') return false
  if (node.status === 'offline') return false
  if (node.status === 'overloaded') return false
  const activeCount = tasks.filter(t => t.node === nodeName && (t.status === 'pending' || t.status === 'running')).length
  return activeCount < 6
}

function pickSuitableNode(tasks: Task[], nodes: ClusterNode[]): string {
  const workers = getWorkerNodes(nodes)
  const suitable = workers.filter(n => isNodeSuitable(n.name, tasks, nodes))
  const pool = suitable.length > 0 ? suitable : workers
  return pool[Math.floor(Math.random() * pool.length)].name
}

interface AssignResult {
  node: string
  assignedBy: NodeAssignedBy
  extraLogs: string[]
  preferredNode: string | null
}

function assignNode(preferredNode: string | undefined, tasks: Task[], nodes: ClusterNode[]): AssignResult {
  const workers = getWorkerNodes(nodes)
  if (workers.length === 0) {
    return { node: 'unknown', assignedBy: 'random', extraLogs: [], preferredNode: null }
  }

  if (!preferredNode) {
    const node = pickSuitableNode(tasks, nodes)
    return { node, assignedBy: 'random', extraLogs: [], preferredNode: null }
  }

  const validWorker = workers.find(n => n.name === preferredNode)
  if (!validWorker) {
    const fallback = pickSuitableNode(tasks, nodes)
    return {
      node: fallback,
      assignedBy: 'fallback',
      extraLogs: [
        `[WARN] 指定节点 "${preferredNode}" 不存在`,
        `[INFO] 自动回退到节点 ${fallback}`,
      ],
      preferredNode: preferredNode,
    }
  }

  if (isNodeSuitable(preferredNode, tasks, nodes)) {
    return {
      node: preferredNode,
      assignedBy: 'preferred',
      extraLogs: [`[INFO] 优先分配到指定节点 ${preferredNode}`],
      preferredNode: preferredNode,
    }
  }

  const reason = validWorker.status === 'overloaded' ? '节点过载' : '任务队列已满'
  const fallback = pickSuitableNode(tasks, nodes)

  return {
    node: fallback,
    assignedBy: 'fallback',
    extraLogs: [
      `[WARN] 首选节点 ${preferredNode} 不可用（${reason}）`,
      `[INFO] 自动回退到节点 ${fallback}`,
    ],
    preferredNode: preferredNode,
  }
}

async function apiAddTask(name: string, preferredNode?: string): Promise<Task | null> {
  try {
    const body: Record<string, unknown> = { name }
    if (preferredNode) body.preferred_node = preferredNode
    const res = await fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    const data = await res.json()
    const t = data.task
    return {
      id: t.id,
      name: t.name,
      status: t.status as TaskStatus,
      node: t.node,
      createdAt: new Date(t.created_at).getTime(),
      retries: t.retries,
      maxRetries: t.max_retries,
      logs: t.logs,
      nodeAssignedBy: t.node_assigned_by as NodeAssignedBy,
      preferredNode: t.preferred_node ?? null,
    }
  } catch {
    return null
  }
}

const initialNodes = mockNodes()

interface TaskStore {
  tasks: Task[]
  nodes: ClusterNode[]
  metrics: MetricsSnapshot[]
  selectedTask: Task | null
  addTask: (name: string, preferredNode?: string) => Promise<void>
  retryTask: (id: string) => void
  cancelTask: (id: string) => void
  selectTask: (t: Task | null) => void
  refreshNodes: () => void
  addMetric: () => void
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: mockTasks(initialNodes),
  nodes: initialNodes,
  metrics: Array.from({ length: 20 }, (_, i) => ({
    time: Date.now() - (20 - i) * 5000,
    totalTasks: 100 + i * 2,
    runningTasks: 3 + Math.floor(Math.random() * 5),
    successRate: 85 + Math.random() * 14,
    avgLatency: 500 + Math.random() * 2000,
    nodeCount: 5,
  })),
  selectedTask: null,
  addTask: async (name, preferredNode) => {
    const apiTask = await apiAddTask(name, preferredNode)

    if (apiTask) {
      set({ tasks: [apiTask, ...get().tasks] })
      return
    }

    const result = assignNode(preferredNode, get().tasks, get().nodes)
    const task: Task = {
      id: `task-${Date.now()}`,
      name,
      status: 'pending',
      node: result.node,
      createdAt: Date.now(),
      retries: 0,
      maxRetries: 3,
      logs: [`[INFO] Task ${name} queued`, ...result.extraLogs],
      nodeAssignedBy: result.assignedBy,
      preferredNode: result.preferredNode,
    }
    set({ tasks: [task, ...get().tasks] })
  },
  retryTask: (id) => set({
    tasks: get().tasks.map(t => t.id === id ? { ...t, status: 'pending', retries: t.retries + 1, logs: [...t.logs, '[INFO] Retrying...'] } : t)
  }),
  cancelTask: (id) => set({
    tasks: get().tasks.map(t => t.id === id ? { ...t, status: 'failed' as TaskStatus, logs: [...t.logs, '[WARN] Cancelled by user'] } : t)
  }),
  selectTask: (t) => set({ selectedTask: t }),
  refreshNodes: () => set({ nodes: mockNodes() }),
  addMetric: () => {
    const m: MetricsSnapshot = {
      time: Date.now(),
      totalTasks: get().tasks.length,
      runningTasks: get().tasks.filter(t => t.status === 'running').length,
      successRate: (get().tasks.filter(t => t.status === 'success').length / Math.max(get().tasks.length, 1)) * 100,
      avgLatency: 500 + Math.random() * 2000,
      nodeCount: get().nodes.filter(n => n.status !== 'offline').length,
    }
    set({ metrics: [...get().metrics.slice(-30), m] })
  },
}))
