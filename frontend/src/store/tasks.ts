import { create } from 'zustand'
import type { Task, ClusterNode, MetricsSnapshot, TaskStatus, NodeAssignedBy } from '../types'

const API_BASE = 'http://localhost:4000/api'

function mockNodes(): ClusterNode[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `node-${i + 1}`,
    name: i === 0 ? 'scheduler-main' : `worker-${i}`,
    type: i === 0 ? 'scheduler' as const : 'worker' as const,
    status: Math.random() > 0.1 ? 'online' as const : 'overloaded' as const,
    cpu: 20 + Math.random() * 60,
    memory: 30 + Math.random() * 50,
    tasks: Math.floor(Math.random() * 8),
    uptime: 3600 + Math.floor(Math.random() * 86400),
  }))
}

function mockTasks(nodes: ClusterNode[]): Task[] {
  const names = ['data_sync', 'email_batch', 'report_gen', 'cache_warm', 'log_rotate', 'db_backup', 'index_rebuild', 'health_check']
  return Array.from({ length: 12 }, (_, i) => {
    const status: TaskStatus[] = ['pending', 'running', 'success', 'failed']
    const s = status[Math.floor(Math.random() * 4)]
    const node = nodes[Math.floor(Math.random() * nodes.length)]
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
    }
  })
}

const initialNodes = mockNodes()

function getWorkerNodes(nodes: ClusterNode[]): ClusterNode[] {
  return nodes.filter(n => n.type === 'worker')
}

function isNodeSuitable(nodeName: string, tasks: Task[], nodes: ClusterNode[]): boolean {
  const node = nodes.find(n => n.name === nodeName)
  if (!node || node.type !== 'worker') return false
  if (node.status === 'offline') return false
  const runningCount = tasks.filter(t => t.node === nodeName && (t.status === 'pending' || t.status === 'running')).length
  const loadHigh = node.cpu > 85 || node.memory > 85 || node.status === 'overloaded'
  return runningCount < 6 && !loadHigh
}

function assignNode(preferredNode: string | undefined, tasks: Task[], nodes: ClusterNode[]): { node: string; assignedBy: NodeAssignedBy; extraLogs: string[] } {
  const workers = getWorkerNodes(nodes)
  if (workers.length === 0) {
    return { node: 'unknown', assignedBy: 'random', extraLogs: [] }
  }

  if (!preferredNode) {
    const random = workers[Math.floor(Math.random() * workers.length)]
    return { node: random.name, assignedBy: 'random', extraLogs: [] }
  }

  const validWorker = workers.find(n => n.name === preferredNode)
  if (!validWorker) {
    const fallback = workers[Math.floor(Math.random() * workers.length)]
    return {
      node: fallback.name,
      assignedBy: 'random',
      extraLogs: [`[WARN] Preferred node "${preferredNode}" invalid, randomly assigned to ${fallback.name}`],
    }
  }

  if (isNodeSuitable(preferredNode, tasks, nodes)) {
    return {
      node: preferredNode,
      assignedBy: 'preferred',
      extraLogs: [`[INFO] Assigned to preferred node ${preferredNode}`],
    }
  }

  const suitableCandidates = workers.filter(n => isNodeSuitable(n.name, tasks, nodes))
  const fallback = suitableCandidates.length > 0
    ? suitableCandidates[Math.floor(Math.random() * suitableCandidates.length)]
    : workers[Math.floor(Math.random() * workers.length)]

  return {
    node: fallback.name,
    assignedBy: 'fallback',
    extraLogs: [`[WARN] Preferred node ${preferredNode} overloaded, fell back to ${fallback.name}`],
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
    }
  } catch {
    return null
  }
}

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

    const { node, assignedBy, extraLogs } = assignNode(preferredNode, get().tasks, get().nodes)
    const task: Task = {
      id: `task-${Date.now()}`,
      name,
      status: 'pending',
      node,
      createdAt: Date.now(),
      retries: 0,
      maxRetries: 3,
      logs: [`[INFO] Task ${name} queued`, ...extraLogs],
      nodeAssignedBy: assignedBy,
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
