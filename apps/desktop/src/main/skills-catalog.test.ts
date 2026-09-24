import { describe, expect, it } from 'vitest'
import { parseSkillsFind } from './skills-catalog'

describe('parseSkillsFind', () => {
  it('accepts paired official find rows and rejects hostile or unrelated lines', () => {
    const output =
      '\u001b[36mowner/repo@nice-skill 1.2K installs\u001b[0m\n└ https://skills.sh/owner/repo/nice-skill\nowner/repo@evil;touch 5 installs\n└ https://skills.sh/owner/repo/evil;touch\n'
    expect(parseSkillsFind(output)).toEqual([
      {
        id: 'owner/repo@nice-skill',
        source: 'owner/repo',
        skill: 'nice-skill',
        url: 'https://skills.sh/owner/repo/nice-skill',
        installs: '1.2K'
      }
    ])
  })
})
