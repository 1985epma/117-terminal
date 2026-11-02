import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import App from './App.jsx'

document.documentElement.dataset.platform = window.eterm.platform

createRoot(document.getElementById('root')).render(<App />)
