/** Sound effects manager: preloaded <audio> pools, mute + volume in settings. */

export type SoundId =
  | 'move'
  | 'capture'
  | 'check'
  | 'castle'
  | 'start'
  | 'end-win'
  | 'end-lose'
  | 'end-draw'
  | 'lowtime'
  | 'promote'

const FILES: Record<SoundId, string> = {
  move: '/sounds/move.wav',
  capture: '/sounds/capture.wav',
  check: '/sounds/check.wav',
  castle: '/sounds/castle.wav',
  start: '/sounds/start.wav',
  'end-win': '/sounds/end-win.wav',
  'end-lose': '/sounds/end-lose.wav',
  'end-draw': '/sounds/end-draw.wav',
  lowtime: '/sounds/lowtime.wav',
  promote: '/sounds/promote.wav',
}

const POOL_SIZE = 3

class SoundManager {
  private pools = new Map<SoundId, HTMLAudioElement[]>()
  private idx = new Map<SoundId, number>()
  muted = false
  volume = 0.7

  preload(): void {
    if (typeof Audio === 'undefined') return
    for (const id of Object.keys(FILES) as SoundId[]) {
      const pool: HTMLAudioElement[] = []
      for (let i = 0; i < POOL_SIZE; i++) {
        const a = new Audio(FILES[id])
        a.preload = 'auto'
        a.volume = this.volume
        pool.push(a)
      }
      this.pools.set(id, pool)
      this.idx.set(id, 0)
    }
  }

  play(id: SoundId): void {
    if (this.muted) return
    const pool = this.pools.get(id)
    if (!pool) return
    const i = (this.idx.get(id) ?? 0) % pool.length
    this.idx.set(id, i + 1)
    const a = pool[i]
    a.volume = this.volume
    a.currentTime = 0
    void a.play().catch(() => {})
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    for (const pool of this.pools.values()) for (const a of pool) a.volume = this.volume
  }

  setMuted(m: boolean): void {
    this.muted = m
  }

  /** Pick the right sound for a completed move (by SAN). */
  playMove(san: string): void {
    if (san.includes('#') || san.includes('+')) this.play('check')
    else if (san.includes('x')) this.play('capture')
    else if (/^([KQRB]..?|[a-h]x)?[a-h]?[1-8]?x?O-O(-O)?$/.test(san) && san.startsWith('O')) this.play('castle')
    else this.play('move')
  }
}

export const sounds = new SoundManager()
