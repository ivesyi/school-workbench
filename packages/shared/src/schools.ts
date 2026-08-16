import { z } from 'zod'

export const schoolIdSchema = z.string().min(1)

export const schoolNameSchema = z
  .string()
  .trim()
  .min(1, '请输入学校名称')
  .max(120, '学校名称不能超过 120 个字')

export const createSchoolInputSchema = z.object({
  name: schoolNameSchema,
})

export const schoolViewSchema = z.object({
  id: schoolIdSchema,
  name: schoolNameSchema,
  currentStageId: z.string().nullable(),
  currentStageTitle: z.string().nullable(),
  createdAt: z.string().datetime(),
})

export const schoolListSchema = z.array(schoolViewSchema)

export type CreateSchoolInput = z.infer<typeof createSchoolInputSchema>
export type SchoolView = z.infer<typeof schoolViewSchema>

export const schoolIpcChannels = {
  list: 'schools:list',
  create: 'schools:create',
  get: 'schools:get',
} as const
