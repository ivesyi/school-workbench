import type { WorkbenchApi } from '@school-workbench/shared'

declare global {
  interface Window {
    workbench: WorkbenchApi
  }
}

export {}
