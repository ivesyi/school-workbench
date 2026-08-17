import { Alert, AlertDescription, AlertTitle, Separator } from '@school-workbench/experience'
import { CheckCircle2, ChevronRight, CircleDashed } from 'lucide-react'
import { Link } from 'react-router-dom'

export function SettingsPage(): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-3xl px-10 py-12">
      <p className="mb-2 text-sm font-medium text-primary">应用</p>
      <h1 className="text-3xl font-semibold tracking-tight">设置</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">日常使用不需要维护技术配置。</p>

      <section className="mt-10 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between px-6 py-5">
          <div>
            <h2 className="font-medium">本地数据</h2>
            <p className="mt-1 text-sm text-muted-foreground">学校数据保存在这台电脑上</p>
          </div>
          <span className="inline-flex items-center gap-2 text-sm text-primary">
            <CheckCircle2 className="size-4" />
            正常
          </span>
        </div>
        <Separator />
        <div className="flex items-center justify-between px-6 py-5">
          <div>
            <h2 className="font-medium">AI 助手</h2>
            <p className="mt-1 text-sm text-muted-foreground">将在后续 Runtime 阶段接入</p>
          </div>
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <CircleDashed className="size-4" />
            尚未启用
          </span>
        </div>
      </section>

      <details className="mt-6 rounded-xl border border-border bg-surface px-6 py-5">
        <summary className="cursor-pointer text-sm font-medium">高级设置</summary>
        <div className="mt-4">
          <Link
            to="/settings/methodology-review"
            className="flex items-center justify-between gap-4 rounded-lg px-3 py-3 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>
              <span className="block font-medium">方法论内容审核</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                逐条确认这些判断标准是否可以用来约束正式判断
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </div>
      </details>

      <Alert variant="quiet" className="mt-6">
        <AlertTitle>第一阶段实现</AlertTitle>
        <AlertDescription>
          当前只验证桌面应用、本地数据库、学校空间和安全进程边界。
        </AlertDescription>
      </Alert>
    </div>
  )
}
