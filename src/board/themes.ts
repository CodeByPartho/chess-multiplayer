export interface BoardTheme {
  id: string
  name: string
  light: string
  dark: string
}

export const boardThemes: BoardTheme[] = [
  { id: 'classic', name: 'Classic', light: '#f0d9b5', dark: '#b58863' },
  { id: 'blue', name: 'Ocean', light: '#dee3e6', dark: '#8ca2ad' },
  { id: 'green', name: 'Green', light: '#eeeed2', dark: '#769656' },
  { id: 'walnut', name: 'Walnut', light: '#e4c9a8', dark: '#7d5a43' },
  { id: 'midnight', name: 'Midnight', light: '#9fa9b8', dark: '#4a5568' },
  { id: 'ice', name: 'Glacier', light: '#e8f1f5', dark: '#7fb2c9' },
]
