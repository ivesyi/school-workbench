import { cn } from '@school-workbench/experience'
import { School, Settings } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'

const navigation = [
  { to: '/', label: '学校', icon: School, end: true },
  { to: '/settings', label: '设置', icon: Settings, end: false },
]

export function AppLayout(): React.JSX.Element {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface px-4 py-5">
        <div className="px-3 py-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-white">
            校
          </div>
          <p className="mt-4 text-sm font-semibold">学校变革陪跑工作台</p>
          <p className="mt-1 text-xs text-muted-foreground">本地工作空间</p>
        </div>

        <nav className="mt-8 grid gap-1" aria-label="主导航">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'bg-primary/8 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
