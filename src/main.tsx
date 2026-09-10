import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Bundled with the app rather than fetched from Google Fonts: the page used to wait on that
// request before painting anything, and had no font at all offline
import '@fontsource/plus-jakarta-sans/300.css'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import '@fontsource/plus-jakarta-sans/800.css'
import '@fontsource/plus-jakarta-sans/400-italic.css'
import '@fontsource/plus-jakarta-sans/600-italic.css'
import './index.css'
import App from './App.tsx'
import { runStorageMigrations } from './services/storage'

runStorageMigrations()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
