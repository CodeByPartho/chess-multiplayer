/**
 * Stockfish UCI client. One worker per Engine instance; jobs run strictly
 * sequentially per worker (UCI is stateful). A small pool covers the two
 * concurrent consumers we have: live play and analysis.
 */

export interface Score {
  cp?: number
  mate?: number
}

export interface PvLine {
  multipv: number
  depth: number
  score: Score
  /** uci moves */
  pv: string[]
  nodes: number
}

export interface AnalyzeOptions {
  depth?: number
  movetime?: number
  multiPv?: number
}

export interface Analysis {
  lines: PvLine[]
  bestmove: string | null
  /** ponder hint if the engine sent one */
  ponder: string | null
}

type Job = {
  fen: string
  opts: AnalyzeOptions
  resolve: (a: Analysis) => void
  reject: (e: Error) => void
  lines: Map<number, PvLine>
  stopped: boolean
}

const ENGINE_PATH = '/engine/stockfish-19-lite-single.js'

export class Engine {
  private worker: Worker
  private queue: Job[] = []
  private current: Job | null = null
  private ready = false
  private disposed = false
  private onLineHandlers = new Set<(line: PvLine) => void>()

  private constructor(worker: Worker) {
    this.worker = worker
    worker.addEventListener('message', (e: MessageEvent) => this.handle(String(e.data)))
  }

  static create(): Promise<Engine> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(ENGINE_PATH)
      const eng = new Engine(worker)
      const timeout = setTimeout(() => reject(new Error('Engine did not start')), 20000)
      const onErr = (e: ErrorEvent) => {
        clearTimeout(timeout)
        reject(new Error(`Engine failed to load: ${e.message}`))
      }
      worker.addEventListener('error', onErr, { once: true })
      const check = (data: string) => {
        if (data === 'uciok') {
          worker.postMessage('setoption name Clear Hash')
          worker.postMessage('isready')
        } else if (data === 'readyok') {
          clearTimeout(timeout)
          worker.removeEventListener('error', onErr)
          eng.ready = true
          worker.addEventListener('message', function seen(e: MessageEvent) {
            if (String(e.data) === 'readyok') worker.removeEventListener('message', seen)
          })
          resolve(eng)
        }
      }
      worker.addEventListener('message', function once(e: MessageEvent) {
        const d = String(e.data)
        if (d === 'uciok' || d === 'readyok') check(d)
      })
      worker.postMessage('uci')
    })
  }

  get isReady(): boolean {
    return this.ready && !this.disposed
  }

  /** Subscribe to live info lines while an analysis runs. */
  onLine(cb: (line: PvLine) => void): () => void {
    this.onLineHandlers.add(cb)
    return () => this.onLineHandlers.delete(cb)
  }

  setSkill(level: number): void {
    const l = Math.max(0, Math.min(20, Math.round(level)))
    this.worker.postMessage(`setoption name Skill Level value ${l}`)
    if (l < 20) {
      // map skill0-19 to a plausible Elo band for weak play
      const elo = 850 + l * 95
      this.worker.postMessage('setoption name UCI_LimitStrength value true')
      this.worker.postMessage(`setoption name UCI_Elo value ${Math.min(elo, 2850)}`)
    } else {
      this.worker.postMessage('setoption name UCI_LimitStrength value false')
    }
    this.worker.postMessage('setoption name Clear Hash')
  }

  setThreads(_n: number): void {
    // single-threaded build; present for API symmetry
  }

  analyze(fen: string, opts: AnalyzeOptions = {}): Promise<Analysis> {
    if (this.disposed) return Promise.reject(new Error('Engine disposed'))
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, opts, resolve, reject, lines: new Map(), stopped: false })
      this.pump()
    })
  }

  /** Stop the current search early, resolving with whatever was found. */
  stop(): void {
    if (this.current) {
      this.current.stopped = true
      this.worker.postMessage('stop')
    }
  }

  newGame(): void {
    this.worker.postMessage('setoption name Clear Hash')
  }

  dispose(): void {
    this.disposed = true
    this.worker.postMessage('quit')
    this.worker.terminate()
    for (const j of this.queue) j.reject(new Error('Engine disposed'))
    this.queue = []
  }

  private pump(): void {
    if (this.current || this.queue.length === 0) return
    const job = this.queue.shift()!
    this.current = job
    job.lines.clear()
    this.worker.postMessage(`position fen ${job.fen}`)
    const parts = ['go']
    if (job.opts.depth) parts.push(`depth ${job.opts.depth}`)
    if (job.opts.movetime) parts.push(`movetime ${job.opts.movetime}`)
    this.worker.postMessage(parts.join(' '))
  }

  private handle(line: string): void {
    if (!this.current) return
    if (line.startsWith('info ') && line.includes(' pv ')) {
      const parsed = parseInfo(line)
      if (parsed) {
        this.current.lines.set(parsed.multipv, parsed)
        for (const cb of this.onLineHandlers) cb(parsed)
      }
      return
    }
    if (line.startsWith('bestmove')) {
      const job = this.current
      this.current = null
      const bm = line.split(/\s+/)[1]
      const ponder = line.includes('ponder') ? line.split(/\s+/)[3] ?? null : null
      const lines = [...job.lines.values()].sort((a, b) => a.multipv - b.multipv)
      job.resolve({ lines, bestmove: bm === '(none)' ? null : bm, ponder })
      this.pump()
    }
  }
}

export function parseInfo(line: string): PvLine | null {
  const tokens = line.split(/\s+/)
  const getNum = (key: string): number | undefined => {
    const i = tokens.indexOf(key)
    return i >= 0 && tokens[i + 1] !== undefined ? Number(tokens[i + 1]) : undefined
  }
  const depth = getNum('depth')
  const pvIdx = tokens.indexOf('pv')
  if (depth === undefined || pvIdx < 0) return null
  const scoreIdx = tokens.indexOf('score')
  let score: Score | undefined
  if (scoreIdx >= 0) {
    const kind = tokens[scoreIdx + 1]
    const val = Number(tokens[scoreIdx + 2])
    if (kind === 'cp' && !Number.isNaN(val)) score = { cp: val }
    else if (kind === 'mate' && !Number.isNaN(val)) score = { mate: val }
  }
  if (!score) return null
  return {
    multipv: getNum('multipv') ?? 1,
    depth,
    score,
    pv: tokens.slice(pvIdx + 1),
    nodes: getNum('nodes') ?? 0,
  }
}

/** Flip a score from side-to-move POV to a fixed color POV. */
export function scoreForColor(score: Score, stmIsWhite: boolean): Score {
  if (score.mate !== undefined) return { mate: stmIsWhite ? score.mate : -score.mate }
  return { cp: (score.cp ?? 0) * (stmIsWhite ? 1 : -1) }
}

let shared: Engine | null = null
let sharedPromise: Promise<Engine> | null = null

/** Lazily-created shared engine (analysis, hints). */
export function getSharedEngine(): Promise<Engine> {
  if (!sharedPromise) {
    sharedPromise = Engine.create().then((e) => {
      shared = e
      return e
    })
  }
  return sharedPromise
}

export function disposeSharedEngine(): void {
  shared?.dispose()
  shared = null
  sharedPromise = null
}
