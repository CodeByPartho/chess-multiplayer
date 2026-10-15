import { describe, expect, it } from 'vitest'
import { INVITE_TTL_MS, joinViewState, type JoinGameInfo } from './joinState'

const NOW = 1_760_000_000_000
const TC = { base: 300_000, inc: 0, type: 'blitz', label: '5+0' } as const

function game(over: Partial<JoinGameInfo> = {}): JoinGameInfo {
  return {
    id: 'game-1',
    status: 'waiting',
    white_id: 'creator',
    black_id: null,
    invite_code: 'ABCD1234',
    created_at: new Date(NOW - 60_000).toISOString(),
    tc: TC,
    rated: false,
    ...over,
  }
}

describe('joinViewState', () => {
  it('not-found when the id/code matches no game', () => {
    expect(joinViewState(null, 'guest', NOW)).toEqual({ state: 'not-found' })
  })

  it('joinable: open black seat for a fresh waiting invite', () => {
    const v = joinViewState(game(), 'friend', NOW)
    expect(v).toEqual({
      state: 'joinable',
      gameId: 'game-1',
      code: 'ABCD1234',
      myColor: 'b',
      tc: TC,
      rated: false,
    })
  })

  it('joinable: open white seat when the creator picked black', () => {
    const v = joinViewState(game({ white_id: null, black_id: 'creator' }), 'friend', NOW)
    expect(v.state).toBe('joinable')
    expect((v as { myColor: string }).myColor).toBe('w')
  })

  it('creator-waiting: same guest id as the creator while waiting', () => {
    expect(joinViewState(game(), 'creator', NOW)).toEqual({
      state: 'creator-waiting',
      gameId: 'game-1',
      code: 'ABCD1234',
    })
  })

  it('full: active game the caller does not sit in', () => {
    expect(joinViewState(game({ status: 'active', black_id: 'other' }), 'stranger', NOW)).toEqual({
      state: 'full',
      gameId: 'game-1',
    })
  })

  it('reconnect: active game where I am seated', () => {
    expect(joinViewState(game({ status: 'active', black_id: 'me' }), 'me', NOW)).toEqual({
      state: 'reconnect',
      gameId: 'game-1',
    })
  })

  it('finished: over game the caller does not sit in', () => {
    expect(joinViewState(game({ status: 'over', black_id: 'other' }), 'stranger', NOW)).toEqual({
      state: 'finished',
      gameId: 'game-1',
    })
  })

  it('reconnect: over game where I am seated', () => {
    expect(joinViewState(game({ status: 'over', black_id: 'me' }), 'me', NOW).state).toBe('reconnect')
  })

  it('cancelled: aborted game, regardless of who opens it', () => {
    expect(joinViewState(game({ status: 'aborted' }), 'stranger', NOW)).toEqual({ state: 'cancelled' })
  })

  it('expired: waiting invite older than the TTL', () => {
    const old = game({ created_at: new Date(NOW - INVITE_TTL_MS - 1).toISOString() })
    expect(joinViewState(old, 'friend', NOW)).toEqual({ state: 'expired', gameId: 'game-1' })
  })

  it('joinable: waiting invite just inside the TTL', () => {
    const old = game({ created_at: new Date(NOW - INVITE_TTL_MS + 1_000).toISOString() })
    expect(joinViewState(old, 'friend', NOW).state).toBe('joinable')
  })

  it('joinable: signed-out caller (myId null) is treated as a fresh guest', () => {
    expect(joinViewState(game(), null, NOW).state).toBe('joinable')
  })
})
