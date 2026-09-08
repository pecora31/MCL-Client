import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App, { runStorageMigrations } from './App.tsx'

runStorageMigrations()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
