import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_USERNAME_RE,
  isReservedUsername,
  usernameKey,
  validateAccountUsername,
} from './usernames'

describe('account username validation', () => {
  it('accepts 3-20 chars of letters, numbers, underscore, hyphen', () => {
    expect(validateAccountUsername('bob')).toBeNull()
    expect(validateAccountUsername('Bob_42-x')).toBeNull()
    expect(validateAccountUsername('  chessking  ')).toBeNull()
    expect(ACCOUNT_USERNAME_RE.test('a'.repeat(20))).toBe(true)
  })

  it('rejects wrong length and wrong characters', () => {
    expect(validateAccountUsername('ab')).toMatch(/at least 3/)
    expect(validateAccountUsername('a'.repeat(21))).toMatch(/at most 20/)
    expect(validateAccountUsername('has space')).toMatch(/letters, numbers/)
    expect(validateAccountUsername('emoji😀name')).toMatch(/letters, numbers/)
    expect(validateAccountUsername('dots.name')).toMatch(/letters, numbers/)
    expect(validateAccountUsername('')).toMatch(/at least 3/)
  })

  it('blocks reserved / impersonation names case-insensitively', () => {
    for (const n of ['admin', 'Admin', 'ADMIN', 'moderator', 'Support', 'theadmin', 'admin1', 'mod_team', 'staff', 'root']) {
      expect(isReservedUsername(n)).toBe(true)
      expect(validateAccountUsername(n)).toMatch(/reserved/)
    }
    expect(isReservedUsername('admiration')).toBe(false)
    expect(isReservedUsername('bobby')).toBe(false)
    expect(validateAccountUsername('normalname')).toBeNull()
  })

  it('reports already-taken names (case-insensitive)', () => {
    expect(validateAccountUsername('ChessKing', true)).toMatch(/already taken/)
    expect(validateAccountUsername('chessking', true)).toMatch(/already taken/)
    expect(usernameKey('ChessKing')).toBe('chessking')
    expect(usernameKey('ChessKing')).toBe(usernameKey('chessking'))
  })
})
