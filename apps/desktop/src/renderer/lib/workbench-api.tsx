import type { WorkbenchApi } from '@school-workbench/shared'
import { createContext, type ReactNode, useContext } from 'react'

const WorkbenchApiContext = createContext<WorkbenchApi | null>(null)

export function WorkbenchApiProvider({
  api,
  children,
}: {
  api: WorkbenchApi
  children: ReactNode
}): React.JSX.Element {
  return <WorkbenchApiContext.Provider value={api}>{children}</WorkbenchApiContext.Provider>
}

export function useWorkbenchApi(): WorkbenchApi {
  const api = useContext(WorkbenchApiContext)
  if (!api) throw new Error('WorkbenchApiProvider is missing')
  return api
}
