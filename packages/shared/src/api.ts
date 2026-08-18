import type { AgentProgressEvent, AgentRunView, RunAgentInput } from './agent'
import type {
  AcceptedJudgmentView,
  JudgmentReviewView,
  ReviewDiagnosisInput,
  ReviewOutcomeView,
} from './judgments'
import type { PackReviewWorkbenchView, SignOffPackInput } from './methodology'
import type {
  AssistantConnectionCheckView,
  AssistantSettingsView,
  ChooseAssistantInput,
  ModelChannelSaveResult,
  SaveModelChannelInput,
} from './preferences'
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
    listPending(schoolId: string): Promise<JudgmentReviewView[]>
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
    /**
     * Really runs one throwaway turn against the chosen assistant and reports
     * what happened. Started by a person, never on launch.
     */
    checkConnection(): Promise<AssistantConnectionCheckView>
    /**
     * Stores the model connection the built-in assistant uses. The key goes
     * into the operating system's secret store and is never read back.
     */
    saveModelChannel(input: SaveModelChannelInput): Promise<ModelChannelSaveResult>
    /** Forgets the model connection, key included. */
    clearModelChannel(): Promise<AssistantSettingsView>
  }
  agent: {
    run(input: RunAgentInput): Promise<AgentRunView>
    /** Subscribes to the high-level progress of a running assistant. */
    onProgress(handler: (event: AgentProgressEvent) => void): () => void
  }
}
