import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspaceEntry } from './WorkspaceEntry'
import './styles.css'
import { setEnvTheme } from './theme'

setEnvTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkspaceEntry />
  </StrictMode>,
)
