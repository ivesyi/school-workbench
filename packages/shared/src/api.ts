import type {
  AcceptedJudgmentView,
  JudgmentReviewView,
  ReviewDiagnosisInput,
  ReviewOutcomeView,
  SubmitSituationInput,
} from './judgments'
import type { PackReviewWorkbenchView, SignOffPackInput } from './methodology'
import type { CreateSchoolInput, SchoolView } from './schools'
import type { AdjustStageInput, ConfirmStageInput, StageWorkspaceView } from './stages'
import type { AdjustStateInput, ConfirmStateInput, StateWorkspaceView } from './states'

export type WorkbenchApi = {
  schools: {
    list(): Promise<SchoolView[]>
    create(input: CreateSchoolInput): Promise<SchoolView>
    get(id: string): Promise<SchoolView | null>
  }
  judgments: {
    submitSituation(input: SubmitSituationInput): Promise<JudgmentReviewView>
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
}
