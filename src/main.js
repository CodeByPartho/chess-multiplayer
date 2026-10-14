import { Chess } from 'chess.js'
import { createClient } from '@supabase/supabase-js'
import { createEngine } from './engine.js'
import './style.css'

// --- Supabase (realtime multiplayer backend) ---
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
export const supabase = url && anonKey ? createClient(url, anonKey) : null

// --- Local game rules ---
export const game = new Chess()

const status = document.getElementById('status')

status.textContent = supabase
  ? 'Supabase connected — waiting for multiplayer wiring'
  : 'Supabase not configured (copy .env.example to .env and fill it in)'

// --- Engine smoke test: proves the whole chain works ---
async function boot() {
  try {
    const engine = await createEngine()
    const { bestmove } = await engine.analyze(game.fen())
    status.textContent = `Engine ready. Sample analysis of the start position: best move ${bestmove}`
    engine.quit()
  } catch (err) {
    status.textContent = `Engine failed to load: ${err.message}`
  }
}

boot()
