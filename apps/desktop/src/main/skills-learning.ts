import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { inspectStagedSkill } from './skill-stager'

export type SkillProposal = {
  id: string
  slug: string
  title: string
  draft: string
  source: 'observed' | 'selected'
  sourceRefs: string[]
  steps: string[]
  evidenceCount: number
  createdAt: number
  status: 'proposed' | 'rejected' | 'installed'
  installedPath?: string
  installedHash?: string
}

export type SkillLearningState = {
  learningEnabled: boolean
  proposals: SkillProposal[]
}

type Observation = { signature: string; steps: string[]; sourceRefs: string[] }
type StoredState = SkillLearningState & { observations: Observation[] }
type StorePaths = { stateFile: string; learnedRoot: string }
type StoreDeps = { now: () => number; id: () => string }

const MAX_ITEMS = 400
const MAX_STEPS = 12
const MAX_SOURCE_REFS = 8
const MAX_PROPOSALS = 50
const MAX_DRAFT_BYTES = 256_000
const ALLOWED_COMMANDS = new Set([
  'bun',
  'cargo',
  'cat',
  'cmake',
  'fd',
  'find',
  'git',
  'go',
  'grep',
  'gh',
  'head',
  'jq',
  'ls',
  'make',
  'npm',
  'pnpm',
  'python',
  'python3',
  'rg',
  'sed',
  'swift',
  'tail',
  'xcodebuild',
  'yarn'
])

const defaultState = (): StoredState => ({
  learningEnabled: false,
  proposals: [],
  observations: []
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validSlug = (slug: string): boolean => /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)

const isSecretLike = (text: string): boolean =>
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) ||
  /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/.test(
    text
  ) ||
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[^\s"']{8,}/i.test(
    text
  )

const validateDraft = (slug: string, draft: string): void => {
  if (!validSlug(slug)) throw new Error('Invalid skill name')
  if (Buffer.byteLength(draft, 'utf8') > MAX_DRAFT_BYTES)
    throw new Error('Skill draft is too large')
  if (isSecretLike(draft)) throw new Error('Skill draft contains secret-like text')
  const frontmatter = /^---\r?\n([\s\S]{1,16000}?)\r?\n---\r?\n/.exec(draft)?.[1]
  const name =
    frontmatter === undefined
      ? null
      : /^name:\s*([a-z0-9][a-z0-9-]{0,63})\s*$/m.exec(frontmatter)?.[1]
  const description =
    frontmatter === undefined ? null : /^description:\s*\S.{0,300}$/m.exec(frontmatter)?.[0]
  if (name !== slug || description === null)
    throw new Error('Draft must have matching name and description frontmatter')
}

const normalizedSteps = (items: unknown): string[] => {
  if (!Array.isArray(items)) return []
  const steps: string[] = []
  for (const raw of items.slice(0, MAX_ITEMS)) {
    if (!isRecord(raw)) continue
    if (raw.kind === 'exec' && typeof raw.command === 'string') {
      // Provider transcripts commonly wrap the actual command in `sh -c` or
      // `zsh -lc`. Unwrap only that fixed shell prefix, then retain allowlisted
      // command names. Arguments, paths and output never leave this function.
      const command = raw.command
        .replace(/^\s*(?:\/bin\/)?(?:ba)?sh\s+-c\s+/, '')
        .replace(/^\s*(?:\/bin\/)?zsh\s+-lc\s+/, '')
        .replace(/["'`]/g, ' ')
        .slice(0, 16_000)
      for (const segment of command.split(/&&|\|\||[;|\n]/)) {
        const first = /^\s*(?:[A-Z_][A-Z0-9_]*=[^\s]+\s+)*((?:[^\s/]+\/)*[^\s/]+)/.exec(
          segment
        )?.[1]
        if (first === undefined) continue
        const commandName = first.split('/').at(-1)?.toLowerCase() ?? ''
        if (ALLOWED_COMMANDS.has(commandName)) steps.push(commandName)
        if (steps.length >= MAX_STEPS) break
      }
    } else if (raw.kind === 'tool' && typeof raw.tool === 'string') {
      const tool = raw.tool.trim().toLowerCase()
      if (/^[a-z][a-z0-9_-]{0,30}$/.test(tool)) steps.push(`tool-${tool}`)
    }
    if (steps.length >= MAX_STEPS) break
  }
  // Collapse an exact repeated cycle inside a single transcript. Repetition
  // evidence is counted across distinct source references, not duplicate rows.
  for (let period = 1; period <= Math.floor(steps.length / 2); period += 1) {
    if (steps.length % period !== 0) continue
    if (steps.every((step, index) => step === steps[index % period])) return steps.slice(0, period)
  }
  return steps
}

const sourceRefFor = (provider: string, id: string): string | null => {
  if (provider !== 'codex' && provider !== 'opencode') return null
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) return null
  return `${provider}:${id}`
}

const workflowSignature = (steps: string[]): string =>
  createHash('sha256').update(steps.join('\0')).digest('hex')

const generatedDraft = (slug: string, steps: string[]): string => {
  const title = steps.map((step) => step.replace(/^tool-/, '')).join(', ')
  return `---\nname: ${slug}\ndescription: Proposed local workflow pattern from repeated Zero tool use.\n---\n\n# Review this workflow\n\nZero observed this repeated tool sequence: ${title}.\n\nReplace this draft with the exact steps, inputs, checks, and expected results that make the workflow useful. Review every line before approving installation.\n`
}

const proposalTitle = (steps: string[]): string =>
  `Workflow: ${steps
    .slice(0, 3)
    .map((step) => step.replace(/^tool-/, ''))
    .join(' → ')}`

const proposalSlug = (steps: string[]): string => {
  const body = steps
    .slice(0, 5)
    .map((step) => step.replace(/^tool-/, ''))
    .join('-')
  return `workflow-${body}`.slice(0, 64).replace(/-+$/, '')
}

const isProposal = (value: unknown): value is SkillProposal =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.slug === 'string' &&
  typeof value.title === 'string' &&
  typeof value.draft === 'string' &&
  (value.source === 'observed' || value.source === 'selected') &&
  Array.isArray(value.sourceRefs) &&
  value.sourceRefs.every((ref) => typeof ref === 'string') &&
  Array.isArray(value.steps) &&
  value.steps.every((step) => typeof step === 'string') &&
  typeof value.evidenceCount === 'number' &&
  typeof value.createdAt === 'number' &&
  (value.status === 'proposed' || value.status === 'rejected' || value.status === 'installed')

const readState = (file: string): StoredState => {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!isRecord(raw) || !Array.isArray(raw.proposals) || !Array.isArray(raw.observations))
      return defaultState()
    return {
      learningEnabled: raw.learningEnabled === true,
      proposals: raw.proposals.filter(isProposal).slice(-MAX_PROPOSALS),
      observations: raw.observations
        .flatMap((value) => {
          if (
            !isRecord(value) ||
            typeof value.signature !== 'string' ||
            !Array.isArray(value.steps) ||
            !value.steps.every((step) => typeof step === 'string') ||
            !Array.isArray(value.sourceRefs) ||
            !value.sourceRefs.every((ref) => typeof ref === 'string')
          )
            return []
          return [
            {
              signature: value.signature,
              steps: value.steps.slice(0, MAX_STEPS),
              sourceRefs: value.sourceRefs.slice(-MAX_SOURCE_REFS)
            }
          ]
        })
        .slice(-200)
    }
  } catch {
    return defaultState()
  }
}

export type SkillLearningStore = {
  get: () => SkillLearningState
  setLearningEnabled: (enabled: boolean) => SkillLearningState
  observe: (provider: string, sourceId: string, items: unknown) => SkillProposal[]
  proposeFromWork: (provider: string, sourceId: string, items: unknown) => SkillProposal | null
  updateDraft: (proposalId: string, slug: string, draft: string) => SkillProposal
  reject: (proposalId: string) => SkillProposal
  approve: (proposalId: string) => { path: string; hash: string }
  rollback: (proposalId: string) => void
}

export function createSkillLearningStore(
  paths: StorePaths,
  deps: Partial<StoreDeps> = {}
): SkillLearningStore {
  const now = deps.now ?? Date.now
  const id = deps.id ?? randomUUID
  const state = readState(paths.stateFile)

  const persist = (): void => {
    fs.mkdirSync(path.dirname(paths.stateFile), { recursive: true })
    const temporary = `${paths.stateFile}.${id()}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    try {
      fs.renameSync(temporary, paths.stateFile)
    } catch (error) {
      fs.rmSync(temporary, { force: true })
      throw error
    }
  }

  const createProposal = (
    steps: string[],
    source: 'observed' | 'selected',
    refs: string[]
  ): SkillProposal | null => {
    if (steps.length < 3 || refs.length === 0) return null
    const signature = workflowSignature(steps)
    const existing = state.proposals.find(
      (proposal) =>
        workflowSignature(proposal.steps) === signature && proposal.status !== 'rejected'
    )
    if (existing) {
      existing.sourceRefs = [...new Set([...existing.sourceRefs, ...refs])].slice(-MAX_SOURCE_REFS)
      existing.evidenceCount = Math.max(existing.evidenceCount, existing.sourceRefs.length)
      if (source === 'selected') existing.source = 'selected'
      persist()
      return existing
    }
    if (state.proposals.length >= MAX_PROPOSALS) return null
    let slug = proposalSlug(steps)
    if (state.proposals.some((proposal) => proposal.slug === slug))
      slug = `${slug.slice(0, 54)}-${id().slice(0, 8)}`
    const proposal: SkillProposal = {
      id: id(),
      slug,
      title: proposalTitle(steps),
      draft: generatedDraft(slug, steps),
      source,
      sourceRefs: [...new Set(refs)].slice(-MAX_SOURCE_REFS),
      steps: steps.slice(0, MAX_STEPS),
      evidenceCount: new Set(refs).size,
      createdAt: now(),
      status: 'proposed'
    }
    state.proposals = [...state.proposals, proposal]
    persist()
    return proposal
  }

  const getProposal = (proposalId: string): SkillProposal => {
    const proposal = state.proposals.find((entry) => entry.id === proposalId)
    if (!proposal) throw new Error('Skill proposal not found')
    return proposal
  }

  return {
    get: () => ({ learningEnabled: state.learningEnabled, proposals: [...state.proposals] }),
    setLearningEnabled: (enabled) => {
      state.learningEnabled = enabled
      persist()
      return { learningEnabled: state.learningEnabled, proposals: [...state.proposals] }
    },
    observe: (provider, sourceId, items) => {
      if (!state.learningEnabled) return []
      const sourceRef = sourceRefFor(provider, sourceId)
      const steps = normalizedSteps(items)
      if (sourceRef === null || steps.length < 3) return []
      const signature = workflowSignature(steps)
      let observation = state.observations.find((entry) => entry.signature === signature)
      if (!observation) {
        observation = { signature, steps, sourceRefs: [] }
        state.observations.push(observation)
      }
      if (observation.sourceRefs.includes(sourceRef)) return []
      observation.sourceRefs = [...observation.sourceRefs, sourceRef].slice(-MAX_SOURCE_REFS)
      state.observations = state.observations.slice(-200)
      if (observation.sourceRefs.length < 2) {
        persist()
        return []
      }
      const proposal = createProposal(steps, 'observed', observation.sourceRefs)
      return proposal === null ? [] : [proposal]
    },
    proposeFromWork: (provider, sourceId, items) => {
      const sourceRef = sourceRefFor(provider, sourceId)
      if (sourceRef === null) return null
      return createProposal(normalizedSteps(items), 'selected', [sourceRef])
    },
    updateDraft: (proposalId, slug, draft) => {
      const proposal = getProposal(proposalId)
      if (proposal.status !== 'proposed') throw new Error('Only pending proposals can be edited')
      validateDraft(slug, draft)
      proposal.slug = slug
      proposal.title = `Workflow: ${slug.replace(/-/g, ' ')}`
      proposal.draft = draft
      persist()
      return proposal
    },
    reject: (proposalId) => {
      const proposal = getProposal(proposalId)
      if (proposal.status !== 'proposed') throw new Error('Only pending proposals can be rejected')
      proposal.status = 'rejected'
      persist()
      return proposal
    },
    approve: (proposalId) => {
      const proposal = getProposal(proposalId)
      if (proposal.status !== 'proposed') throw new Error('Only pending proposals can be approved')
      validateDraft(proposal.slug, proposal.draft)
      if (!fs.existsSync(paths.learnedRoot)) fs.mkdirSync(paths.learnedRoot, { recursive: true })
      const rootStat = fs.lstatSync(paths.learnedRoot)
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
        throw new Error('Learned-skills root cannot be a symlink')
      const root = path.resolve(paths.learnedRoot)
      const destination = path.resolve(root, proposal.slug)
      if (!destination.startsWith(`${root}${path.sep}`))
        throw new Error('Invalid skill destination')
      if (fs.existsSync(destination)) throw new Error('A skill with this name already exists')
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        const skillPath = path.join(root, entry.name, 'SKILL.md')
        try {
          const stat = fs.lstatSync(skillPath)
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) continue
          const content = fs.readFileSync(skillPath, 'utf8')
          const name = /^---\r?\n[\s\S]*?^name:\s*([^\r\n]+)$/m.exec(content)?.[1]?.trim()
          if (name === proposal.slug) throw new Error('A skill with this name already exists')
        } catch (error) {
          if (error instanceof Error && error.message === 'A skill with this name already exists')
            throw error
        }
      }
      const stage = path.join(root, `.${proposal.slug}-${id()}.tmp`)
      fs.mkdirSync(stage, { mode: 0o700 })
      try {
        fs.writeFileSync(path.join(stage, 'SKILL.md'), proposal.draft, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600
        })
        const manifest = inspectStagedSkill(stage, `local/${proposal.slug}@1.0.0`)
        const skill = manifest.files.find((file) => file.path === 'SKILL.md')
        if (!skill) throw new Error('Invalid staged skill')
        fs.renameSync(stage, destination)
        proposal.status = 'installed'
        proposal.installedPath = destination
        proposal.installedHash = skill.sha256
        try {
          persist()
        } catch (error) {
          fs.rmSync(destination, { recursive: true, force: true })
          proposal.status = 'proposed'
          delete proposal.installedPath
          delete proposal.installedHash
          throw error
        }
        return { path: destination, hash: skill.sha256 }
      } catch (error) {
        fs.rmSync(stage, { recursive: true, force: true })
        throw error
      }
    },
    rollback: (proposalId) => {
      const proposal = getProposal(proposalId)
      if (proposal.status !== 'installed' || !proposal.installedPath || !proposal.installedHash) {
        throw new Error('Proposal has no managed installation to roll back')
      }
      const root = path.resolve(paths.learnedRoot)
      const installedPath = path.resolve(proposal.installedPath)
      if (!installedPath.startsWith(`${root}${path.sep}`) || path.dirname(installedPath) !== root) {
        throw new Error('Installed skill path is outside the learned-skills root')
      }
      const manifest = inspectStagedSkill(installedPath, `local/${proposal.slug}@1.0.0`)
      if (
        manifest.files.length !== 1 ||
        manifest.files[0]?.path !== 'SKILL.md' ||
        manifest.files[0]?.sha256 !== proposal.installedHash
      ) {
        throw new Error('Installed skill changed; refusing rollback')
      }
      fs.unlinkSync(path.join(installedPath, 'SKILL.md'))
      fs.rmdirSync(installedPath)
      proposal.status = 'proposed'
      delete proposal.installedPath
      delete proposal.installedHash
      persist()
    }
  }
}
