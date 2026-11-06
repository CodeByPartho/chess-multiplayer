import { describe, expect, it } from 'vitest'
import { buildReviewInsights } from './reviewInsights'
import type { GameReviewResult } from './review'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

describe('buildReviewInsights', () => {
  it('flags the move that allows forced mate as the key moment', () => {
    const result: GameReviewResult = {
      evals: [{ cp: 20 }, { cp: 10 }, { cp: 30 }, { mate: -1 }, { mate: 0 }],
      bestUcis: ['', '', 'e2e3', ''],
      classes: [null, null, 'blunder', 'best'],
      accuracy: { w: 40, b: 95 },
      analyzed: 4,
    }
    const out = buildReviewInsights(result, START, ['f2f3', 'e7e5', 'g2g4', 'd8h4'], ['f3', 'e5', 'g4', 'Qh4#'])
    expect(out.keyMoments).toHaveLength(1)
    expect(out.keyMoments[0].ply).toBe(2)
    expect(out.explanations.get(2)).toContain('forced mate')
    expect(out.explanations.get(2)).toContain("engine's move was e3")
  })

  it('explains a hung queen in plain words', () => {
    const fen = '4q2k/8/8/8/8/8/8/4Q2K w - - 0 1'
    const result: GameReviewResult = {
      evals: [{ cp: 850 }, { cp: -60 }],
      bestUcis: ['e1a5'],
      classes: ['blunder'],
      accuracy: { w: 30, b: 100 },
      analyzed: 1,
    }
    const out = buildReviewInsights(result, fen, ['e1e5'], ['Qe5'])
    const text = out.explanations.get(0) ?? ''
    expect(text).toContain('undefended')
    expect(text).toContain('queen')
    expect(text).toContain('Qa5')
  })

  it('stays quiet for a clean game', () => {
    const result: GameReviewResult = {
      evals: [{ cp: 15 }, { cp: 20 }, { cp: 10 }],
      bestUcis: ['e2e4', 'e7e5'],
      classes: ['best', 'best'],
      accuracy: { w: 98, b: 97 },
      analyzed: 2,
    }
    const out = buildReviewInsights(result, START, ['e2e4', 'e7e5'], ['e4', 'e5'])
    expect(out.keyMoments).toHaveLength(0)
    expect(out.explanations.size).toBe(0)
  })
})
