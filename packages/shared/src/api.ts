import type {
  AcceptedJudgmentView,
  JudgmentReviewView,
  ReviewDiagnosisInput,
  ReviewOutcomeView,
  SubmitSituationInput,
} from './judgments'
import type { CreateSchoolInput, SchoolView } from './schools'

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
}
