import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSkillLearningStore } from './skills-learning'

const roots: string[] = []
const createRoots = (): { stateFile: string; learnedRoot: string } => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-skill-learning-'))
  roots.push(root)
  return { stateFile: path.join(root, 'state.json'), learnedRoot: path.join(root, 'learned') }
}

const items = [
  { kind: 'exec', command: "/bin/zsh -lc 'rg --files src && git status && npm test'" },
  { kind: 'exec', command: "/bin/zsh -lc 'rg --files src && git status && npm test'" }
]

const validDraft = (name = 'review-repository-workflow'): string => `---\nname: ${name}\ndescription: Review a repository workflow.\n---\n\n# Review repository workflow\n\nInspect the project state, locate the relevant files, and run focused checks.\n`

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('local skill learning proposals', () => {
  it('starts disabled and persists an explicit opt-in across reloads', () => {
    const paths = createRoots()
    let store = createSkillLearningStore(paths, { now: () => 10, id: () => 'proposal-1' })
    expect(store.get().learningEnabled).toBe(false)
    store.setLearningEnabled(true)
    store = createSkillLearningStore(paths)
    expect(store.get().learningEnabled).toBe(true)
  })

  it('ignores observations while disabled and drafts only from repeated command families when enabled', () => {
    const paths = createRoots()
    const store = createSkillLearningStore(paths, { now: () => 20, id: () => 'proposal-1' })
    store.observe('codex', 'thread-1', items)
    expect(store.get().proposals).toEqual([])
    store.setLearningEnabled(true)
    expect(store.observe('codex', 'thread-1', items)).toEqual([])
    const proposals = store.observe('opencode', 'session-2', items)
    expect(proposals).toHaveLength(1)
    expect(proposals[0]).toMatchObject({
      id: 'proposal-1',
      status: 'proposed',
      source: 'observed',
      evidenceCount: 2,
      sourceRefs: ['codex:thread-1', 'opencode:session-2'],
      steps: ['rg', 'git', 'npm']
    })
    expect(proposals[0]?.draft).not.toContain('--files src')
  })

  it('caps stored evidence references and skips repeated reads of the same source', () => {
    const paths = createRoots()
    const store = createSkillLearningStore(paths, { now: () => 30, id: () => 'proposal-1' })
    store.setLearningEnabled(true)
    store.observe('codex', 'thread-1', items)
    store.observe('codex', 'thread-1', items)
    for (let i = 2; i < 12; i += 1) store.observe('codex', `thread-${i}`, items)
    const state = store.get()
    expect(state.proposals).toHaveLength(1)
    expect(state.proposals[0]?.sourceRefs).toHaveLength(8)
    expect(state.proposals[0]?.evidenceCount).toBe(8)
  })

  it('allows a user selected transcript to create a proposal with learning disabled', () => {
    const paths = createRoots()
    const store = createSkillLearningStore(paths, { now: () => 40, id: () => 'proposal-1' })
    const proposal = store.proposeFromWork('codex', 'thread-7', items)
    expect(store.get().learningEnabled).toBe(false)
    expect(proposal?.source).toBe('selected')
    expect(proposal?.evidenceCount).toBe(1)
  })

  it('persists edits and rejection state without retaining transcript text', () => {
    const paths = createRoots()
    const store = createSkillLearningStore(paths, { now: () => 50, id: () => 'proposal-1' })
    const proposal = store.proposeFromWork('codex', 'thread-7', items)
    expect(proposal).not.toBeNull()
    store.updateDraft('proposal-1', 'custom-workflow', validDraft('custom-workflow'))
    let next = createSkillLearningStore(paths)
    expect(next.get().proposals[0]).toMatchObject({ slug: 'custom-workflow', draft: validDraft('custom-workflow') })
    next.reject('proposal-1')
    next = createSkillLearningStore(paths)
    expect(next.get().proposals[0]?.status).toBe('rejected')
    expect(fs.readFileSync(paths.stateFile, 'utf8')).not.toContain('/bin/zsh')
    expect(fs.readFileSync(paths.stateFile, 'utf8')).not.toContain('files src')
  })

  it('rejects path escapes, secret-like text, and an existing skill name', () => {
    const paths = createRoots()
    const store = createSkillLearningStore(paths, { now: () => 60, id: () => 'proposal-1' })
    store.proposeFromWork('codex', 'thread-7', items)
    expect(() => store.updateDraft('proposal-1', '../outside', validDraft('outside'))).toThrow(/name/i)
    expect(() => store.updateDraft('proposal-1', 'credential-example', `${validDraft('credential-example')}\napi_key = "sk-test_abcdefghijklmnopqrstuvwxyz123456"`)).toThrow(/secret/i)
    store.updateDraft('proposal-1', 'custom-workflow', validDraft('custom-workflow'))
    fs.mkdirSync(paths.learnedRoot, { recursive: true })
    fs.mkdirSync(path.join(paths.learnedRoot, 'custom-workflow'))
    fs.writeFileSync(path.join(paths.learnedRoot, 'custom-workflow', 'SKILL.md'), validDraft('custom-workflow'))
    expect(() => store.approve('proposal-1')).toThrow(/already exists/i)
  })

  it('installs only after approval and rolls back only unchanged managed files', () => {
    const paths = createRoots()
    const store = createSkillLearningStore(paths, { now: () => 70, id: () => 'proposal-1' })
    store.proposeFromWork('codex', 'thread-7', items)
    store.updateDraft('proposal-1', 'review-repository-workflow', validDraft())
    expect(fs.existsSync(paths.learnedRoot)).toBe(false)
    const installed = store.approve('proposal-1')
    expect(fs.readFileSync(path.join(installed.path, 'SKILL.md'), 'utf8')).toBe(validDraft())
    expect(store.get().proposals[0]?.status).toBe('installed')
    store.rollback('proposal-1')
    expect(fs.existsSync(installed.path)).toBe(false)
    expect(store.get().proposals[0]?.status).toBe('proposed')
  })

  it('refuses to follow a symlinked learned-skills root', () => {
    const paths = createRoots()
    const actual = path.join(path.dirname(paths.learnedRoot), 'actual')
    fs.mkdirSync(actual)
    fs.symlinkSync(actual, paths.learnedRoot)
    const store = createSkillLearningStore(paths, { now: () => 80, id: () => 'proposal-1' })
    store.proposeFromWork('codex', 'thread-7', items)
    store.updateDraft('proposal-1', 'review-repository-workflow', validDraft())
    expect(() => store.approve('proposal-1')).toThrow(/symlink/i)
    expect(fs.readdirSync(actual)).toEqual([])
  })
})
