import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type ToastKind = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  msg: string
  kind: ToastKind
}

interface ToastApi {
  show: (msg: string, kind?: ToastKind) => void
  error: (msg: string) => void
}

const Ctx = createContext<ToastApi>({ show: () => {}, error: () => {} })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useState({ n: 1 })[0]

  const show = useCallback((msg: string, kind: ToastKind = 'success') => {
    const id = nextId.n++
    setItems((prev) => [...prev.slice(-3), { id, msg, kind }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4200)
  }, [nextId])

  const api = useMemo<ToastApi>(
    () => ({ show, error: (msg: string) => show(msg, 'error') }),
    [show],
  )

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastApi {
  return useContext(Ctx)
}
