import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// register route-scoped styles are imported by App; global CSS is imported there too

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
