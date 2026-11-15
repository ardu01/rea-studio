import { z } from 'zod'
import { PROVIDER_IDS } from './providers.js'

const toolPath = z.string().max(4096)
const model = z.string().max(120)
const endpoint = z.string().max(300)

export const settingsPatchSchema = z
  .object({
    tools: z
      .object({
        rea: toolPath.optional(),
        ghidra: toolPath.optional(),
        java: toolPath.optional(),
        radare2: toolPath.optional(),
        rabin2: toolPath.optional(),
        rizin: toolPath.optional(),
        rzBin: toolPath.optional(),
        codex: toolPath.optional(),
        claude: toolPath.optional(),
        gemini: toolPath.optional(),
      })
      .strict()
      .optional(),
    providers: z
      .object({
        openai: z.object({ model: model.optional(), endpoint: endpoint.optional() }).strict().optional(),
        anthropic: z.object({ model: model.optional(), endpoint: endpoint.optional() }).strict().optional(),
        xai: z.object({ model: model.optional(), endpoint: endpoint.optional() }).strict().optional(),
        gemini: z.object({ model: model.optional(), endpoint: endpoint.optional() }).strict().optional(),
        compatible: z.object({ model: model.optional(), endpoint: endpoint.optional() }).strict().optional(),
        codexCli: z.object({ model: model.optional() }).strict().optional(),
        claudeCli: z.object({ model: model.optional() }).strict().optional(),
        geminiCli: z.object({ model: model.optional() }).strict().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const jobStartSchema = z
  .object({
    adapterId: z.string().regex(/^[a-z0-9-]{1,40}$/),
    actionId: z.string().regex(/^[a-z0-9-]{1,60}$/),
    targetPath: z.string().max(4096).optional(),
    timeoutSec: z.number().int().min(1).max(3600),
  })
  .strict()

export const secretSchema = z
  .object({
    id: z.enum(PROVIDER_IDS),
    value: z.string().min(1).max(4096).optional(),
  })
  .strict()

export const cloudSchema = z
  .object({
    providerId: z.enum(PROVIDER_IDS),
    prompt: z.string().min(1).max(12000),
    artifactRels: z.array(z.string().min(1).max(1024)).max(12),
    optIn: z.boolean().optional(),
    hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .strict()

export const idSchema = z.object({ id: z.string().min(1).max(80) }).strict()
export const pathSchema = z.object({ path: z.string().min(1).max(4096) }).strict()
export const relSchema = z.object({ relativePath: z.string().min(1).max(1024) }).strict()
export const urlSchema = z.object({ url: z.string().url().max(300) }).strict()

export const ollamaPullSchema = z
  .object({
    model: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/),
  })
  .strict()

export const projectCreateSchema = z
  .object({
    parentDir: z.string().min(1).max(4096),
    name: z.string().min(1).max(60),
    template: z.enum(['node', 'python', 'dotnet', 'cmake']),
    references: z.array(z.string().min(1).max(1024)).max(50),
  })
  .strict()

export const projectStepSchema = z.object({ stepId: z.string().regex(/^[0-9a-f]{7,64}$/) }).strict()
export const projectDiffSchema = z.object({ stepId: z.string().regex(/^[0-9a-f]{7,64}$/).optional() }).strict()

const commandName = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,30}$/)
const commandArgs = z.array(z.string().max(1000)).max(40)
export const commandCheckSchema = z.object({ command: commandName, args: commandArgs }).strict()
export const commandRunSchema = z
  .object({ command: commandName, args: commandArgs, confirmed: z.boolean(), timeoutSec: z.number().int().min(1).max(1800).optional() })
  .strict()
export const autonomousSchema = z.object({ enabled: z.boolean() }).strict()
