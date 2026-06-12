import { useEffect } from 'react'
import { ConfigProvider, theme } from 'antd'
import Dashboard from './components/Dashboard'
import { useTaskStore } from './store/tasks'

export default function App() {
  const addMetric = useTaskStore(s => s.addMetric)
  const refreshNodes = useTaskStore(s => s.refreshNodes)

  useEffect(() => {
    const interval = setInterval(() => { addMetric(); refreshNodes() }, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      <div style={{ minHeight: '100vh', background: '#141414' }}>
        <Dashboard />
      </div>
    </ConfigProvider>
  )
}
