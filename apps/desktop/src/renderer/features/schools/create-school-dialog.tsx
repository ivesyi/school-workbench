import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
} from '@school-workbench/experience'
import type { FormEvent } from 'react'
import { useState } from 'react'

export function CreateSchoolDialog({
  onCreate,
}: {
  onCreate(name: string): Promise<void>
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onCreate(name)
      setName('')
      setOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '暂时无法创建学校，请稍后再试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>新建学校</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建学校</DialogTitle>
          <DialogDescription>只需要填写学校名称，创建后就可以直接开始工作。</DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={(event) => void handleSubmit(event)}>
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="school-name">
              学校名称
            </label>
            <Input
              id="school-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              maxLength={120}
            />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? '正在创建…' : '创建'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
