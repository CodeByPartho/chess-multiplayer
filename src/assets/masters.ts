/**
 * The masters and their signature lines — the routes each great player
 * made his own. Every line here is standard theory from his repertoire;
 * step through it and read what he was actually trying to do.
 */
export interface MasterLine {
  name: string
  asColor: 'w' | 'b'
  sans: string[]
  note: string
}

export interface MasterProfile {
  id: string
  name: string
  years: string
  style: string
  lines: MasterLine[]
}

export const MASTERS: MasterProfile[] = [
  {
    id: 'magnus',
    name: 'Magnus Carlsen',
    years: 'World Champion 2013–2023',
    style: 'Outplays you in equal positions. Quiet moves, small edges, endgames squeezed until something breaks.',
    lines: [
      {
        name: 'Ruy Lopez, Breyer Variation',
        asColor: 'w',
        sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'h3', 'Nb8', 'd4', 'Nbd7'],
        note: 'The Nb8–d7 regroup looks slow, but it frees the c-pawn and keeps every piece on the board. Magnus wins these positions in the endgame, twenty moves later.',
      },
      {
        name: 'Berlin Defence Endgame',
        asColor: 'b',
        sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Nxe4', 'd4', 'Nd6', 'Bxc6', 'dxc6', 'dxe5', 'Nf5', 'Qxd8+', 'Kxd8'],
        note: 'Queens off by move 8, and somehow White is the one suffering. The lesson: an "equal" endgame is a weapon if you play it better than everyone else.',
      },
    ],
  },
  {
    id: 'hikaru',
    name: 'Hikaru Nakamura',
    years: 'Five-time US Champion',
    style: 'Sharp theory at bullet speed. Grabs space, opens lines, and trusts his tactics more than your preparation.',
    lines: [
      {
        name: 'Sicilian Najdorf',
        asColor: 'b',
        sans: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e5', 'Nb3', 'Be7', 'f3', 'O-O', 'Qd2', 'Nc6'],
        note: '…e5 kicks the knight and claims the dark squares. Hikaru has defended this structure for twenty years at every speed, down to bullet.',
      },
    ],
  },
  {
    id: 'kasparov',
    name: 'Garry Kasparov',
    years: 'World Champion 1985–2000',
    style: 'Attacks with preparation and fury. Pawn storms, piece sacrifices, and pressure until the position catches fire.',
    lines: [
      {
        name: 'Najdorf vs the English Attack',
        asColor: 'b',
        sans: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e6', 'f3', 'b5', 'g4', 'h6', 'Qd2', 'Nbd7', 'O-O-O', 'Bb7'],
        note: 'Opposite-side castling means both kings come under attack. Kasparov\u2019s …b5 and …Bb7 setup became the textbook way to win the race.',
      },
      {
        name: 'King\u2019s Indian Defence',
        asColor: 'b',
        sans: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5', 'O-O', 'Nc6', 'd5', 'Ne7', 'Ne1', 'Nd7', 'f3', 'f5'],
        note: 'White gets the center and the space; Black gets the kingside attack with …f5. Kasparov made a generation fear this pawn storm.',
      },
    ],
  },
  {
    id: 'karpov',
    name: 'Anatoly Karpov',
    years: 'World Champion 1975–1985',
    style: 'Prophylaxis first: stops your ideas before they exist, then improves his worst piece until you run out of moves.',
    lines: [
      {
        name: 'Caro-Kann, Classical Variation',
        asColor: 'b',
        sans: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7', 'h5', 'Bh7', 'Bd3', 'Bxd3', 'Qxd3', 'e6'],
        note: 'Trade the light-squared bishop, keep everything solid, then squeeze with small edges. Karpov\u2019s Caro-Kann scored like a White opening.',
      },
    ],
  },
  {
    id: 'capablanca',
    name: 'José Raúl Capablanca',
    years: 'World Champion 1921–1927',
    style: 'Simplicity as strength. Exchanges, endgames, and positions so clear his opponents felt there was nothing to play against.',
    lines: [
      {
        name: 'Queen\u2019s Gambit Declined',
        asColor: 'b',
        sans: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'Nbd7', 'Rc1', 'c6', 'Bd3', 'dxc4', 'Bxc4', 'Nd5'],
        note: 'Develop simply, trade accurately, and head for an endgame where the better structure tells. Capablanca\u2019s clarity made strong players look helpless.',
      },
      {
        name: 'Beating the Marshall Gambit',
        asColor: 'w',
        sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'O-O', 'c3', 'd5', 'exd5', 'Nxd5', 'Nxe5'],
        note: 'In 1918 Marshall unveiled this pawn sacrifice against him. Capablanca took the pawn, defended calmly under a famous attack, and won. Patience as a weapon.',
      },
    ],
  },
  {
    id: 'fischer',
    name: 'Bobby Fischer',
    years: 'World Champion 1972–1975',
    style: 'Crystal-clear plans played at full force. Grabs material others fear, centralizes everything, calculates to the end.',
    lines: [
      {
        name: 'Najdorf Poisoned Pawn',
        asColor: 'b',
        sans: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Bg5', 'e6', 'f4', 'Qb6', 'Qd2', 'Qxb2', 'Rb1', 'Qa3'],
        note: 'The queen grabs b2 and dares White to prove it was poisoned. Fischer trusted his calculation more than the fear everyone else felt.',
      },
      {
        name: 'King\u2019s Indian Attack',
        asColor: 'w',
        sans: ['e4', 'e6', 'd3', 'd5', 'Nd2', 'Nf6', 'Ngf3', 'c5', 'g3', 'Nc6', 'Bg2', 'Be7', 'O-O', 'O-O', 'e5', 'Nd7', 'Re1', 'b5'],
        note: 'd3, g3, e5: a modest setup hiding the same kingside attack every time. Fischer scored win after win with this one simple plan.',
      },
    ],
  },
]
