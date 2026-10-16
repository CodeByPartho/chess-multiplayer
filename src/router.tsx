import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'

interface RouterValue {
  path: string
  navigate: (to: string, opts?: { replace?: boolean }) => void
}

const RouterCtx = createContext<RouterValue>({ path: '/', navigate: () => {} })

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (to === window.location.pathname) return
    if (opts?.replace) window.history.replaceState(null, '', to)
    else window.history.pushState(null, '', to)
    setPath(to)
    window.scrollTo(0, 0)
  }, [])

  const value = useMemo(() => ({ path, navigate }), [path, navigate])
  return <RouterCtx.Provider value={value}>{children}</RouterCtx.Provider>
}

export function useRoute(): RouterValue {
  return useContext(RouterCtx)
}

export function Link({
  to,
  children,
  className,
  title,
  style,
  onClick,
}: {
  to: string
  children: ReactNode
  className?: string
  title?: string
  style?: CSSProperties
  onClick?: (e: ReactMouseEvent<HTMLAnchorElement>) => void
}) {
  const { navigate } = useRoute()
  return (
    <a
      href={to}
      className={className}
      title={title}
      style={style}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented) return
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}

/** Match "/play/:id" style patterns; returns params or null. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean)
  const ap = path.split('/').filter(Boolean)
  if (pp.length !== ap.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(ap[i])
    else if (pp[i] !== ap[i]) return null
  }
  return params
}
