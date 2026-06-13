import { useState } from 'react'
import { Layout, Tabs, Statistic, Row, Col, Card, Tag, Button, Input, Table, Drawer, Descriptions, Space, Progress, Select, Tooltip, Alert } from 'antd'
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { useTaskStore } from '../store/tasks'
import type { Task, TaskStatus, NodeAssignedBy } from '../types'

const { Header, Content } = Layout

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'default', running: 'processing', success: 'success', failed: 'error', retry: 'warning'
}

const ASSIGNED_BY_META: Record<NodeAssignedBy, { color: string; tagColor: string; text: string; tip: string; icon: string }> = {
  preferred: { color: '#1890ff', tagColor: 'blue', text: '首选分配', tip: '按用户指定的节点分配', icon: '✓' },
  fallback: { color: '#fa8c16', tagColor: 'orange', text: '自动回退', tip: '首选节点不合适，已自动回退到其他节点', icon: '↩' },
  random: { color: '#8c8c8c', tagColor: 'default', text: '随机分配', tip: '系统随机分配节点', icon: '○' },
}

export default function Dashboard() {
  const store = useTaskStore()
  const [newTaskName, setNewTaskName] = useState('')
  const [preferredNode, setPreferredNode] = useState<string | undefined>(undefined)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const workerNodes = store.nodes.filter(n => n.type === 'worker')

  const handleAddTask = async () => {
    if (!newTaskName || submitting) return
    setSubmitting(true)
    try {
      await store.addTask(newTaskName, preferredNode)
      setNewTaskName('')
    } finally {
      setSubmitting(false)
    }
  }

  const taskColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 100 },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: TaskStatus) => <Tag color={STATUS_COLORS[s]}>{s}</Tag> },
    {
      title: '执行节点', key: 'node', width: 220, render: (_: any, r: Task) => {
        const meta = r.nodeAssignedBy ? ASSIGNED_BY_META[r.nodeAssignedBy] : null
        return (
          <Space size={6} direction="vertical" style={{ width: '100%' }}>
            <Space size={4}>
              <span style={{ fontWeight: 500 }}>{r.node}</span>
              {meta && (
                <Tooltip title={meta.tip}>
                  <Tag color={meta.tagColor} style={{ marginInlineEnd: 0, fontSize: 11 }}>
                    {meta.icon} {meta.text}
                  </Tag>
                </Tooltip>
              )}
            </Space>
            {r.nodeAssignedBy === 'fallback' && r.preferredNode && (
              <div style={{ fontSize: 11, color: '#fa8c16', lineHeight: 1.4 }}>
                首选: {r.preferredNode} → 实际: {r.node}
              </div>
            )}
          </Space>
        )
      }
    },
    { title: '重试', key: 'retries', render: (_: any, r: Task) => `${r.retries}/${r.maxRetries}` },
    { title: '耗时', key: 'duration', render: (_: any, r: Task) => r.duration ? `${(r.duration / 1000).toFixed(1)}s` : '-' },
    { title: '操作', key: 'actions', render: (_: any, r: Task) => (
      <Space>
        {r.status === 'failed' && <Button size="small" type="primary" onClick={() => store.retryTask(r.id)}>重试</Button>}
        {r.status === 'running' && <Button size="small" danger onClick={() => store.cancelTask(r.id)}>取消</Button>}
        <Button size="small" onClick={() => { store.selectTask(r); setDrawerOpen(true) }}>详情</Button>
      </Space>
    )},
  ]

  const successCount = store.tasks.filter(t => t.status === 'success').length
  const failedCount = store.tasks.filter(t => t.status === 'failed').length
  const runningCount = store.tasks.filter(t => t.status === 'running').length

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 style={{ color: 'white', margin: 0, fontSize: 18 }}>🔧 分布式任务调度与监控平台</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <Input
            placeholder="任务名称"
            value={newTaskName}
            onChange={e => setNewTaskName(e.target.value)}
            style={{ width: 160 }}
            onPressEnter={handleAddTask}
            disabled={submitting}
          />
          <Select
            placeholder="目标节点 (可选)"
            allowClear
            value={preferredNode}
            onChange={v => setPreferredNode(v)}
            style={{ width: 200 }}
            disabled={submitting}
            options={workerNodes.map(n => ({
              label: (
                <Space size={8} style={{ width: '100%', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: n.status === 'online' ? 500 : 400, opacity: n.status === 'online' ? 1 : 0.6 }}>
                    {n.name}
                  </span>
                  <Tag
                    color={n.status === 'online' ? 'green' : n.status === 'overloaded' ? 'orange' : 'red'}
                    style={{ fontSize: 11, padding: '0 6px', lineHeight: '18px', marginInlineEnd: 0 }}
                  >
                    {n.status === 'online' ? '空闲' : n.status === 'overloaded' ? '过载' : '离线'}
                  </Tag>
                </Space>
              ),
              value: n.name,
              disabled: n.status !== 'online',
            }))}
          />
          <Button
            type="primary"
            onClick={handleAddTask}
            loading={submitting}
            disabled={!newTaskName}
          >
            添加任务
          </Button>
        </div>
      </Header>
      <Content style={{ padding: 16 }}>
        {/* Stats */}
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}><Card><Statistic title="总任务" value={store.tasks.length} /></Card></Col>
          <Col span={6}><Card><Statistic title="运行中" value={runningCount} valueStyle={{ color: '#1890ff' }} /></Card></Col>
          <Col span={6}><Card><Statistic title="成功" value={successCount} valueStyle={{ color: '#52c41a' }} /></Card></Col>
          <Col span={6}><Card><Statistic title="失败" value={failedCount} valueStyle={{ color: '#ff4d4f' }} /></Card></Col>
        </Row>

        <Tabs items={[
          { key: 'metrics', label: '监控指标', children: (
            <Row gutter={16}>
              <Col span={12}>
                <Card title="运行中任务数">
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={store.metrics}>
                      <XAxis dataKey="time" tickFormatter={t => new Date(t).toLocaleTimeString()} fontSize={10} />
                      <YAxis fontSize={10} />
                      <Tooltip labelFormatter={t => new Date(t as number).toLocaleString()} />
                      <Area type="monotone" dataKey="runningTasks" stroke="#1890ff" fill="#1890ff" fillOpacity={0.3} />
                    </AreaChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
              <Col span={12}>
                <Card title="成功率 %">
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={store.metrics}>
                      <XAxis dataKey="time" tickFormatter={t => new Date(t).toLocaleTimeString()} fontSize={10} />
                      <YAxis domain={[0, 100]} fontSize={10} />
                      <Tooltip labelFormatter={t => new Date(t as number).toLocaleString()} />
                      <Line type="monotone" dataKey="successRate" stroke="#52c41a" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
              <Col span={24} style={{ marginTop: 16 }}>
                <Card title="平均延迟 (ms)">
                  <ResponsiveContainer width="100%" height={150}>
                    <AreaChart data={store.metrics}>
                      <XAxis dataKey="time" tickFormatter={t => new Date(t).toLocaleTimeString()} fontSize={10} />
                      <YAxis fontSize={10} />
                      <Tooltip />
                      <Area type="monotone" dataKey="avgLatency" stroke="#faad14" fill="#faad14" fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
            </Row>
          )},
          { key: 'tasks', label: '任务列表', children: (
            <Table dataSource={store.tasks} columns={taskColumns} rowKey="id" size="small" pagination={{ pageSize: 10 }} />
          )},
          { key: 'nodes', label: '集群节点', children: (
            <Row gutter={16}>
              {store.nodes.map(node => (
                <Col span={8} key={node.id} style={{ marginBottom: 16 }}>
                  <Card title={<span>{node.type === 'scheduler' ? '🎯' : '⚙️'} {node.name}</span>}
                    extra={<Tag color={node.status === 'online' ? 'green' : node.status === 'overloaded' ? 'orange' : 'red'}>{node.status}</Tag>}>
                    <Progress percent={Math.round(node.cpu)} strokeColor={node.cpu > 80 ? '#ff4d4f' : '#1890ff'} format={v => `CPU ${v}%`} />
                    <Progress percent={Math.round(node.memory)} strokeColor={node.memory > 80 ? '#ff4d4f' : '#52c41a'} format={v => `MEM ${v}%`} />
                    <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
                      任务数: {node.tasks} | 运行时间: {Math.floor(node.uptime / 3600)}h
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          )},
        ]} />

        {/* Task Detail Drawer */}
        <Drawer title="任务详情" open={drawerOpen} onClose={() => setDrawerOpen(false)} width={520}>
          {store.selectedTask && (
            <>
              {store.selectedTask.nodeAssignedBy === 'fallback' && (
                <Alert
                  message="节点自动回退"
                  description={
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <div>首选节点: <b>{store.selectedTask.preferredNode}</b></div>
                      <div>实际节点: <b>{store.selectedTask.node}</b></div>
                      <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                        首选节点不可用，系统已自动分配到其他可用节点
                      </div>
                    </Space>
                  }
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                />
              )}
              {store.selectedTask.nodeAssignedBy === 'preferred' && (
                <Alert
                  message="已按首选节点分配"
                  description={`任务已分配到您指定的节点 ${store.selectedTask.node}`}
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                />
              )}
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="ID">{store.selectedTask.id}</Descriptions.Item>
                <Descriptions.Item label="名称">{store.selectedTask.name}</Descriptions.Item>
                <Descriptions.Item label="状态"><Tag color={STATUS_COLORS[store.selectedTask.status]}>{store.selectedTask.status}</Tag></Descriptions.Item>
                <Descriptions.Item label="执行节点">
                  <Space size={4}>
                    <span style={{ fontWeight: 500 }}>{store.selectedTask.node}</span>
                    {store.selectedTask.nodeAssignedBy && (
                      <Tag color={ASSIGNED_BY_META[store.selectedTask.nodeAssignedBy].tagColor}>
                        {ASSIGNED_BY_META[store.selectedTask.nodeAssignedBy].icon} {ASSIGNED_BY_META[store.selectedTask.nodeAssignedBy].text}
                      </Tag>
                    )}
                  </Space>
                </Descriptions.Item>
                {store.selectedTask.preferredNode && (
                  <Descriptions.Item label="首选节点">{store.selectedTask.preferredNode}</Descriptions.Item>
                )}
                {store.selectedTask.nodeAssignedBy && (
                  <Descriptions.Item label="分配说明">
                    {ASSIGNED_BY_META[store.selectedTask.nodeAssignedBy].tip}
                  </Descriptions.Item>
                )}
                <Descriptions.Item label="重试次数">{store.selectedTask.retries}/{store.selectedTask.maxRetries}</Descriptions.Item>
                <Descriptions.Item label="创建时间">{new Date(store.selectedTask.createdAt).toLocaleString()}</Descriptions.Item>
                <Descriptions.Item label="耗时">{store.selectedTask.duration ? `${(store.selectedTask.duration / 1000).toFixed(1)}s` : '-'}</Descriptions.Item>
              </Descriptions>
              <h4 style={{ marginTop: 16 }}>执行日志</h4>
              <pre style={{ background: '#1f1f1f', padding: 12, borderRadius: 8, fontSize: 12, maxHeight: 300, overflow: 'auto', color: '#eee' }}>
                {store.selectedTask.logs.join('\n')}
              </pre>
            </>
          )}
        </Drawer>
      </Content>
    </Layout>
  )
}
