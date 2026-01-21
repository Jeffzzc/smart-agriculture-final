import fs from "node:fs"
import path from "node:path"

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

export function readJson(filePath, fallbackValue) {
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    return JSON.parse(raw)
  } catch {
    return fallbackValue
  }
}

export function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath)
  ensureDir(dir)
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf8")
  fs.renameSync(tmpPath, filePath)
}

export function appendJsonl(filePath, value) {
  const dir = path.dirname(filePath)
  ensureDir(dir)
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8")
}

export function readJsonlRange(filePath, fromTs, toTs, limit = 2000) {
  if (!fs.existsSync(filePath)) return []
  const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean)
  const out = []
  for (const line of lines) {
    if (out.length >= limit) break
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    const ts = Number(obj.ts ?? obj.timestamp ?? 0)
    if (!Number.isFinite(ts)) continue
    if (fromTs != null && ts < fromTs) continue
    if (toTs != null && ts > toTs) continue
    out.push(obj)
  }
  return out
}

