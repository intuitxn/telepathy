import { useEffect, useState } from 'react'
import App from './App'
import { SharedApp } from './SharedApp'

export function WorkspaceEntry() {
  const configured = (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_WORKSPACE_MODE
  const [mode, setMode] = useState(configured === 'shared' ? 'shared' : configured === 'demo' ? 'demo' : 'loading')
  useEffect(() => {
    if (configured === 'shared' || configured === 'demo') return
    const controller = new AbortController()
    fetch('/api/config', { credentials: 'same-origin', signal: controller.signal })
      .then(async response => {
        if (response.status === 404 || response.headers.get('content-type')?.includes('text/html')) return setMode('demo')
        if (!response.ok) throw new Error('Workspace configuration unavailable')
        const config = await response.json()
        setMode(config.mode === 'shared' ? 'shared' : 'demo')
      })
      .catch(error => { if (error.name !== 'AbortError') setMode('error') })
    return () => controller.abort()
  }, [configured])
  if (mode === 'shared') return <SharedApp />
  if (mode === 'demo') return <App />
  return <main className="view"><h1>Telepathy</h1><p role="status">{mode === 'error' ? 'The workspace could not be reached. Reload to reconnect.' : 'Opening your workspace…'}</p></main>
}
