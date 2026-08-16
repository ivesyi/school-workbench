import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '../../lib/cn'

const alertVariants = cva('grid gap-1 rounded-[var(--radius)] border p-4 text-sm', {
  variants: {
    variant: {
      default: 'border-border bg-surface text-foreground',
      quiet: 'border-primary/15 bg-primary/5 text-foreground',
      destructive: 'border-destructive/25 bg-destructive/5 text-destructive',
    },
  },
  defaultVariants: { variant: 'default' },
})

export function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>): React.JSX.Element {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}

export function AlertTitle({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('font-medium', className)} {...props} />
}

export function AlertDescription({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('leading-6 text-muted-foreground', className)} {...props} />
}
