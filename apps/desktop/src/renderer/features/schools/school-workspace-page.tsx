import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Skeleton,
  Textarea,
} from '@school-workbench/experience'
import type { SchoolView } from '@school-workbench/shared'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useWorkbenchApi } from '../../lib/workbench-api'

export function SchoolWorkspacePage(): React.JSX.Element {
  const { schoolId = '' } = useParams()
  const api = useWorkbenchApi()
  const [school, setSchool] = useState<SchoolView | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [noticeVisible, setNoticeVisible] = useState(false)

  useEffect(() => {
    let current = true
    void api.schools
      .get(schoolId)
      .then((result) => {
        if (current) setSchool(result)
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [api, schoolId])

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-10 py-12">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-10 h-48 w-full" />
      </div>
    )
  }

  if (!school) {
    return (
      <div className="mx-auto w-full max-w-3xl px-10 py-12">
        <Alert variant="destructive">
          <AlertTitle>没有找到这所学校</AlertTitle>
          <AlertDescription>它可能已经被移除，或者当前链接已经失效。</AlertDescription>
        </Alert>
        <Button asChild variant="secondary" className="mt-6">
          <Link to="/">返回学校</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-10 py-10">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        所有学校
      </Link>

      <header className="mt-7">
        <p className="mb-2 text-sm font-medium text-primary">工作台</p>
        <h1 className="text-3xl font-semibold tracking-tight">{school.name}</h1>
      </header>

      <section className="mt-10 rounded-xl border border-border bg-surface p-7">
        <h2 className="text-lg font-semibold">把你已经知道的情况告诉我</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          也可以直接把已有材料交给我。AI 分析将在下一阶段接入，这里先验证本地学校空间。
        </p>
        <Textarea
          className="mt-5"
          value={message}
          onChange={(event) => {
            setMessage(event.target.value)
            setNoticeVisible(false)
          }}
          placeholder="说说这个学校现在的情况……"
        />
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            disabled={message.trim().length === 0}
            onClick={() => setNoticeVisible(true)}
          >
            开始
          </Button>
        </div>
      </section>

      {noticeVisible ? (
        <Alert variant="quiet" className="mt-5">
          <AlertTitle>学校空间已经准备好</AlertTitle>
          <AlertDescription>
            当前阶段不调用 AI，也不会保存这段输入。下一阶段接入 Evidence 和 Diagnosis
            后再正式开始分析。
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
