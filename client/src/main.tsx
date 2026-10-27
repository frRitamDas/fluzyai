import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { RootBoundary } from './components/root-boundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Above the providers on purpose: see components/root-boundary.tsx. */}
    <RootBoundary>
      <App />
    </RootBoundary>
  </StrictMode>,
)
