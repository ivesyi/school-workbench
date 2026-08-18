import type { AgentProgressEvent, AgentRunView, RunAgentInput } from './agent'
import type { AcceptedJudgmentView, ReviewDiagnosisInput, ReviewOutcomeView } from './judgments'
import type { PackReviewWorkbenchView, SignOffPackInput } from './methodology'
import type { AssistantSettingsView, ChooseAssistantInput } from './preferences'
import type { ArchiveSchoolInput, CreateSchoolInput, SchoolView } from './schools'
import type { AdjustStageInput, ConfirmStageInput, StageWorkspaceView } from './stages'
import type { AdjustStateInput, ConfirmStateInput, StateWorkspaceView } from './states'

export type WorkbenchApi = {
  schools: {
    list(): Promise<SchoolView[]>
    create(input: CreateSchoolInput): Promise<SchoolView>
    get(id: string): Promise<SchoolView | null>
    archive(input: ArchiveSchoolInput): Promise<void>
  }
  judgments: {
    review(input: ReviewDiagnosisInput): Promise<ReviewOutcomeView>
    listAccepted(schoolId: string): Promise<AcceptedJudgmentView[]>
  }
  stages: {
    getWorkspace(schoolId: string): Promise<StageWorkspaceView>
    adjust(input: AdjustStageInput): Promise<StageWorkspaceView>
    confirm(input: ConfirmStageInput): Promise<StageWorkspaceView>
  }
  states: {
    getWorkspace(schoolId: string): Promise<StateWorkspaceView>
    adjust(input: AdjustStateInput): Promise<StateWorkspaceView>
    confirm(input: ConfirmStateInput): Promise<StateWorkspaceView>
  }
  methodology: {
    getReviewWorkbench(): Promise<PackReviewWorkbenchView>
    signOff(input: SignOffPackInput): Promise<PackReviewWorkbenchView>
  }
  settings: {
    getAssistant(): Promise<AssistantSettingsView>
    chooseAssistant(input: ChooseAssistantInput): Promise<AssistantSettingsView>
  }
  agent: {
    run(input: RunAgentInput): Promise<AgentRunView>
    /** Subscribes to the high-level progress of a running assistant. */
    onProgress(handler: (event: AgentProgressEvent) => void): () => void
  }
}
