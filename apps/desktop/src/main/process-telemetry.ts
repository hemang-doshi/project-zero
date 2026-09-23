import type { TelemetryProcess } from '../shared/ipc'

// `comm` contains the executable name rather than its arguments. Strip the
// path so the UI does not surface usernames or command-line parameters.
export function parseProcessRows(section: string): TelemetryProcess[] {
  const rows: TelemetryProcess[] = []
  for (const line of section.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 4) continue
    const pid = Number(fields[0])
    const cpu = Number(fields[1])
    const rssKb = Number(fields[2])
    const rawName = fields.slice(3).join(' ')
    const name = rawName.slice(rawName.lastIndexOf('/') + 1).slice(0, 80)
    if (!Number.isInteger(pid) || pid <= 0 || name === '') continue
    rows.push({
      pid,
      name,
      cpuPercent: Number.isFinite(cpu) && cpu >= 0 ? cpu : null,
      residentBytes: Number.isFinite(rssKb) && rssKb >= 0 ? rssKb * 1024 : null
    })
  }
  return rows.sort((a, b) => (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1)).slice(0, 10)
}
