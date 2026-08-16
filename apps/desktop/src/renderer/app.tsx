import type { WorkbenchApi } from '@school-workbench/shared'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { AppLayout } from './app-layout'
import { SchoolListPage } from './features/schools/school-list-page'
import { SchoolStatePage } from './features/schools/school-state-page'
import { SchoolWorkspacePage } from './features/schools/school-workspace-page'
import { SettingsPage } from './features/settings/settings-page'
import { WorkbenchApiProvider } from './lib/workbench-api'

export function App({ api }: { api: WorkbenchApi }): React.JSX.Element {
  return (
    <WorkbenchApiProvider api={api}>
      <HashRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<SchoolListPage />} />
            <Route path="schools/:schoolId" element={<SchoolWorkspacePage />} />
            <Route path="schools/:schoolId/state" element={<SchoolStatePage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </HashRouter>
    </WorkbenchApiProvider>
  )
}
