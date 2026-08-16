import { Alert, AlertDescription, AlertTitle, Skeleton } from '@school-workbench/experience'
import type { SchoolView } from '@school-workbench/shared'
import { School } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useWorkbenchApi } from '../../lib/workbench-api'
import { CreateSchoolDialog } from './create-school-dialog'

export function SchoolListPage(): React.JSX.Element {
  const api = useWorkbenchApi()
  const navigate = useNavigate()
  const [schools, setSchools] = useState<SchoolView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void api.schools
      .list()
      .then((result) => {
        if (current) setSchools(result)
      })
      .catch(() => {
        if (current) setError('暂时无法读取本地学校数据。请重新打开应用后再试。')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [api])

  async function createSchool(name: string): Promise<void> {
    const school = await api.schools.create({ name })
    setSchools((current) => [...current, school])
    navigate(`/schools/${school.id}`)
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-10 py-12">
      <header className="flex items-start justify-between gap-6">
        <div>
          <p className="mb-2 text-sm font-medium text-primary">学校空间</p>
          <h1 className="text-3xl font-semibold tracking-tight">学校</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            进入一所学校，说情况、做判断、看变化。
          </p>
        </div>
        <CreateSchoolDialog onCreate={createSchool} />
      </header>

      <div className="mt-10">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>本地数据暂时不可用</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <div className="grid gap-3" aria-label="正在读取学校">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}

        {!loading && !error && schools.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface px-8 py-14 text-center">
            <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary/8 text-primary">
              <School className="size-5" />
            </div>
            <h2 className="mt-5 text-lg font-semibold">还没有学校</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              新建一所学校后，就可以把已经知道的情况和材料放进同一个持续工作空间。
            </p>
          </div>
        ) : null}

        {!loading && !error && schools.length > 0 ? (
          <div className="grid gap-3">
            {schools.map((school) => (
              <Link
                key={school.id}
                to={`/schools/${school.id}`}
                className="group rounded-xl border border-border bg-surface px-6 py-5 outline-none transition-colors hover:border-primary/35 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <h2 className="font-semibold group-hover:text-primary">{school.name}</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {school.currentStageTitle ?? '还没有形成当前阶段判断'}
                </p>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
