import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@school-workbench/experience'
import type { SchoolView } from '@school-workbench/shared'
import { Archive, School } from 'lucide-react'
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
  const [schoolToArchive, setSchoolToArchive] = useState<SchoolView | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

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

  function closeArchiveDialog(): void {
    if (archiving) return
    setSchoolToArchive(null)
    setArchiveError(null)
  }

  async function archiveSchool(): Promise<void> {
    if (!schoolToArchive || archiving) return
    setArchiving(true)
    setArchiveError(null)
    try {
      await api.schools.archive({ schoolId: schoolToArchive.id })
      setSchools((current) => current.filter((school) => school.id !== schoolToArchive.id))
      setSchoolToArchive(null)
    } catch {
      setArchiveError('这所学校暂时没有归档成功，请稍后再试。')
    } finally {
      setArchiving(false)
    }
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
            <AlertTitle>请重新打开应用后继续</AlertTitle>
            <AlertDescription>
              关闭当前窗口后重新打开应用，然后从右上角“新建学校”开始。
            </AlertDescription>
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
            <h2 className="mt-5 text-lg font-semibold">先新建一所学校</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              点击右上角“新建学校”，为本次工作创建第一个学校空间。
            </p>
          </div>
        ) : null}

        {!loading && !error && schools.length > 0 ? (
          <div className="grid gap-3">
            {schools.map((school) => (
              <article
                key={school.id}
                className="flex items-center gap-4 rounded-xl border border-border bg-surface px-6 py-5 transition-colors hover:border-primary/35"
              >
                <Link
                  to={`/schools/${school.id}`}
                  className="group min-w-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <h2 className="font-semibold group-hover:text-primary">{school.name}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {school.currentStageTitle ?? '还没有形成当前阶段判断'}
                  </p>
                </Link>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`归档${school.name}`}
                  onClick={() => {
                    setArchiveError(null)
                    setSchoolToArchive(school)
                  }}
                >
                  <Archive className="size-4" />
                  归档
                </Button>
              </article>
            ))}
          </div>
        ) : null}
      </div>

      <Dialog
        open={schoolToArchive !== null}
        onOpenChange={(open) => {
          if (!open) closeArchiveDialog()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>归档“{schoolToArchive?.name ?? ''}”吗？</DialogTitle>
            <DialogDescription>
              归档后，这所学校不会再出现在当前学校列表中；其中已有的材料、判断和状态都会保留，不会删除。
            </DialogDescription>
          </DialogHeader>
          {archiveError ? (
            <Alert variant="destructive">
              <AlertTitle>暂时无法归档</AlertTitle>
              <AlertDescription>{archiveError}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={archiving}
              onClick={closeArchiveDialog}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={archiving}
              onClick={() => void archiveSchool()}
            >
              {archiving ? '正在归档…' : '确认归档'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
