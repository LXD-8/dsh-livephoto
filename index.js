/**
 * Live Photo bundle — Host half.
 *
 * Turns a still image plus a short video into the one pair of files that
 * AVFoundation, PHLivePhoto and Photos all accept as a real Apple Live Photo,
 * then optionally adds both resources to the Photos library in a single
 * PHAssetCreationRequest so iCloud syncs them to the iPhone as one asset.
 *
 * Layering:
 *   - `livephoto` tool: `make` / `create` / `status` for the agent.
 *   - helper/*.swift: compiled on demand into
 *     `~/Library/Caches/dsh-livephoto/LivePhotoHelper.app`, because PhotoKit
 *     only shows its permission dialog for a real `.app` bundle with the usage
 *     descriptions in its Info.plist.
 *
 * The video is only remuxed (no re-encode); the still is re-saved as JPEG with
 * the Apple maker-note identifier and scaled to the video frame size.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadItem, downloadNote, fetchNote } from './xhs.js'

export const name = 'dsh-livephoto'
export const inject = ['tools', 'workingDirectory', 'webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
const HELPER_SOURCE = join(HERE, 'helper', 'main.swift')
const CACHE_ROOT = join(homedir(), 'Library', 'Caches', 'dsh-livephoto')
const APP_PATH = join(CACHE_ROOT, 'LivePhotoHelper.app')
const APP_BINARY = join(APP_PATH, 'Contents', 'MacOS', 'LivePhotoHelper')
const APP_PLIST = join(APP_PATH, 'Contents', 'Info.plist')
const BUILD_STAMP = join(CACHE_ROOT, 'helper.sha256')

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>LivePhotoHelper</string>
    <key>CFBundleIdentifier</key><string>local.dsh.livephoto.helper</string>
    <key>CFBundleName</key><string>LivePhotoHelper</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>1.0</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    <key>NSPhotoLibraryUsageDescription</key><string>Reads back the Live Photo it just created to confirm Photos paired the still and the video.</string>
    <key>NSPhotoLibraryAddUsageDescription</key><string>Adds the generated Live Photo to your photo library so it can sync to your iPhone.</string>
</dict>
</plist>
`

const DEFAULTS = {
  photo: '',
  video: '',
  outputDir: '',
  baseName: 'IMG_0001',
  coverTime: 0,
  importToPhotos: true,
  helperTimeoutMs: 300_000,
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(file, args, { maxBuffer: 8 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${file} failed: ${(stderr || error.message).trim()}`
        rejectPromise(error)
        return
      }
      resolvePromise({ stdout, stderr })
    })
  })
}

function which(binary) {
  for (const dir of (process.env.PATH || '').split(':')) {
    if (dir && existsSync(join(dir, binary))) return join(dir, binary)
  }
  return ''
}

async function commandVersion(binary, args) {
  const path = which(binary)
  if (!path) return ''
  try {
    const { stdout } = await execFileAsync(path, args, { timeout: 20_000 })
    return stdout.trim().split('\n')[0]
  } catch {
    return path
  }
}

/** Compile the PhotoKit helper once per helper source revision. */
export async function ensureHelper(log) {
  const source = readFileSync(HELPER_SOURCE)
  const stamp = createHash('sha256').update(source).update(INFO_PLIST).digest('hex')
  if (existsSync(APP_BINARY) && existsSync(BUILD_STAMP) && readFileSync(BUILD_STAMP, 'utf8').trim() === stamp) {
    return APP_PATH
  }
  const swiftc = which('swiftc')
  if (!swiftc) {
    throw new Error('swiftc not found; install the Xcode command line tools (xcode-select --install) to build the Live Photo helper')
  }
  log?.('building the Live Photo helper (first run only)…')
  mkdirSync(join(APP_PATH, 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(APP_PLIST, INFO_PLIST)
  const sourceCopy = join(CACHE_ROOT, 'main.swift')
  writeFileSync(sourceCopy, source)
  await execFileAsync(swiftc, [
    '-O', sourceCopy, '-o', APP_BINARY,
    '-framework', 'AVFoundation', '-framework', 'Photos',
    '-framework', 'ImageIO', '-framework', 'AppKit',
    '-framework', 'UniformTypeIdentifiers',
  ], { timeout: 600_000 })
  await execFileAsync('codesign', ['--force', '--sign', '-', '--deep', APP_PATH], { timeout: 60_000 }).catch(() => {})
  writeFileSync(BUILD_STAMP, stamp)
  return APP_PATH
}

/** Run one job through the helper app and read back its JSON result. */
export async function runHelper(job, timeoutMs) {
  const app = await ensureHelper()
  const runDir = join(CACHE_ROOT, `run-${Date.now()}`)
  mkdirSync(runDir, { recursive: true })
  const jobPath = join(runDir, 'job.json')
  const resultPath = join(runDir, 'result.json')
  writeFileSync(jobPath, JSON.stringify(job, null, 2))
  await execFileAsync('open', ['-n', '-a', app, '--args', jobPath, resultPath], { timeout: 30_000 })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(resultPath)) {
      const text = readFileSync(resultPath, 'utf8').trim()
      if (text !== '') {
        const payload = JSON.parse(text)
        rmSync(runDir, { recursive: true, force: true })
        return payload
      }
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  rmSync(runDir, { recursive: true, force: true })
  throw new Error('the helper did not report back in time; if a Photos permission dialog is waiting, approve it and run again')
}

/** Remove an audio track so the pair stays a valid Live Photo. */
async function silentVideo(videoPath, log) {
  const ffprobe = which('ffprobe')
  const ffmpeg = which('ffmpeg')
  if (!ffprobe || !ffmpeg) return videoPath
  let hasAudio = false
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index',
      '-of', 'csv=p=0', videoPath,
    ])
    hasAudio = stdout.trim() !== ''
  } catch {
    return videoPath
  }
  if (!hasAudio) return videoPath
  log?.('stripping the audio track (Live Photos are silent)…')
  const target = videoPath.replace(/(\.[a-z0-9]+)$/i, '') + '-silent.mov'
  await execFileAsync(ffmpeg, ['-y', '-v', 'error', '-i', videoPath, '-c', 'copy', '-an', target])
  return target
}

function resolveInput(value, cwd) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed === '') return ''
  return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed)
}

function statusReport() {
  return {
    action: 'status',
    ok: true,
    message: 'Live Photo helper toolchain',
    helperBuilt: existsSync(APP_BINARY),
    helper: APP_PATH,
    outputDir: '',
  }
}

/** Reject cross-origin calls; the page and the Host share one origin. */
function trusted(ctx, req) {
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== host) return false
    } catch {
      return false
    }
  }
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  if (name === '127.0.0.1' || name === 'localhost' || name === '::1') return true
  try {
    return host === new URL(ctx.webServer.getOrigin()).host
  } catch {
    return false
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

async function readJson(req, limit = 262_144) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > limit) throw new Error('request body too large')
  }
  return body === '' ? {} : JSON.parse(body)
}

/** Build one Live Photo pair from a downloaded still and clip. */
async function buildLivePair(photo, video, outputDir, baseName, importToPhotos) {
  const result = await runHelper({
    action: importToPhotos ? 'make' : 'create',
    photo,
    video,
    outputDir,
    coverTime: 0,
    baseName,
  }, 300_000)
  // A refused Photos import still leaves a valid pair on disk; report both facts.
  return {
    photo: result.photo || '',
    video: result.video || '',
    identifier: result.identifier || '',
    imported: result.imported === true,
    error: result.ok === true ? '' : (result.error || 'helper reported a failure'),
  }
}

function defaultDownloadRoot() {
  return join(homedir(), 'Downloads', '小红书')
}

export function apply(ctx, config = {}) {
  const settings = { ...DEFAULTS, ...config }

  ctx.tools.register({
    name: 'livephoto',
    description: [
      'Create a real Apple Live Photo from a still image and a short video, and optionally add it to the Photos library.',
      '`make` writes the JPEG + MOV pair and imports both in one Photos request (what iOS needs, and what lets iCloud sync it to an iPhone as one asset);',
      '`create` only writes and verifies the pair; `status` reports whether the helper is built.',
      'The video is remuxed without re-encoding: it must be H.264 or HEVC and silent (an audio track is stripped when ffmpeg is available).',
      'The still is re-saved as JPEG with the Live Photo identifier and scaled to the video frame size.',
      'The first `make` shows a macOS Photos permission dialog for the helper app; approve it once.',
      'Deliver the result to an iPhone through iCloud Photos: AirDropping the two files separately never pairs them.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['make', 'create', 'status'],
          description: 'make (write + import) | create (write only) | status',
        },
        photo: { type: 'string', description: 'Still image path (JPEG, PNG or HEIC), absolute or relative to the workspace.' },
        video: { type: 'string', description: 'Video path (MP4 or MOV), absolute or relative to the workspace. Required for make and create.' },
        output_dir: { type: 'string', description: 'Directory for the pair; defaults to livephoto/ under the workspace.' },
        name: { type: 'string', description: 'Base file name for the pair, without extension. Defaults to IMG_0001.' },
        cover_time: { type: 'number', description: 'Seconds into the video that the still represents; defaults to 0 (the first frame).' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'message'],
        properties: {
          action: { type: 'string' },
          message: { type: 'string' },
          ok: { type: 'boolean' },
          identifier: { type: 'string' },
          photo: { type: 'string' },
          video: { type: 'string' },
          stillTime: { type: 'number' },
          imported: { type: 'boolean' },
          assetID: { type: 'string' },
          helperBuilt: { type: 'boolean' },
          helper: { type: 'string' },
          outputDir: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    presentCall: (args) => ({
      card: 'generic',
      title: args.action === 'status' ? 'Live Photo status' : 'Live Photo',
      kind: 'other',
      rawInput: { action: args.action, photo: args.photo, video: args.video },
    }),
    async execute(args, exec) {
      if (args.action === 'status') return statusReport()
      if (exec.agent === undefined) throw new Error('livephoto requires an agent session')

      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const photo = resolveInput(args.photo, cwd)
      const video = resolveInput(args.video, cwd)
      if (photo === '' || video === '') throw new Error('make and create need both photo and video paths')
      if (!existsSync(photo)) throw new Error(`still image not found: ${photo}`)
      if (!existsSync(video)) throw new Error(`video not found: ${video}`)

      const outputDir = resolveInput(
        typeof args.output_dir === 'string' && args.output_dir.trim() !== ''
          ? args.output_dir
          : join('livephoto', String(Number(Date.now() / 1000)).slice(-6)),
        cwd,
      )
      mkdirSync(outputDir, { recursive: true })

      const baseName = (typeof args.name === 'string' && args.name.trim() !== ''
        ? args.name.trim()
        : settings.baseName).replace(/[^A-Za-z0-9_.-]/g, '_')
      const coverTime = Number.isFinite(args.cover_time) && args.cover_time > 0 ? args.cover_time : 0

      const source = await silentVideo(video, () => {})
      let result
      try {
        result = await runHelper({
          action: args.action === 'create' ? 'create' : 'make',
          photo,
          video: source,
          outputDir,
          coverTime,
          baseName,
        }, settings.helperTimeoutMs)
      } catch (error) {
        return {
          action: args.action,
          ok: false,
          message: `Live Photo failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      }

      if (result.ok !== true) {
        return {
          action: result.action || args.action,
          ok: false,
          message: `Live Photo failed: ${result.error || 'unknown error'}`,
        }
      }
      const imported = result.imported === true
      const message = imported
        ? `Live Photo written and added to Photos (${result.identifier}). It syncs to the iPhone through iCloud Photos.`
        : `Live Photo pair written to ${outputDir} (${result.identifier}); Photos import was not requested.`
      return {
        action: result.action || args.action,
        ok: true,
        message,
        identifier: result.identifier,
        photo: result.photo,
        video: result.video,
        stillTime: result.stillTime,
        imported,
        assetID: result.assetID || '',
        outputDir,
      }
    },
  })
  ctx.tools.register({
    name: 'xiaohongshu',
    description: [
      'Use this whenever the user sends a Xiaohongshu (小红书) link — or share text containing one — and asks to download its images or videos; do not fetch the note by hand.',
      'Read the note from the link and download everything in it.',
      '`note` returns the title, body and the ordered images without writing files.',
      '`download` saves every image plus, for Live Photo images, a JPEG + MOV pair that iOS accepts as a real 实况照片;',
      'a note-level video is saved as MP4. Files go to ~/Downloads/小红书/<noteId>/ with a manifest.json.',
      'Set `import` to add each Live Photo pair to Photos as one paired asset, which is how iCloud delivers it to an iPhone as 实况.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['input'],
      properties: {
        input: { type: 'string', description: 'Share text, xhslink.cn short link, or a xiaohongshu.com note URL.' },
        action: {
          type: 'string',
          enum: ['note', 'download'],
          description: 'note (read only) | download (default).',
        },
        import: { type: 'boolean', description: 'Add Live Photo pairs to Photos; defaults to true.' },
        output_dir: { type: 'string', description: 'Directory for the files; defaults to ~/Downloads/小红书/<noteId>.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['message'],
        properties: {
          message: { type: 'string' },
          noteId: { type: 'string' },
          title: { type: 'string' },
          desc: { type: 'string' },
          author: { type: 'string' },
          liveCount: { type: 'integer' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                index: { type: 'integer' },
                kind: { type: 'string' },
                imageUrl: { type: 'string' },
                videoUrl: { type: 'string' },
                width: { type: 'integer' },
                height: { type: 'integer' },
              },
            },
          },
          outputDir: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          imported: { type: 'integer' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    presentCall: (args) => ({
      card: 'generic',
      title: args.action === 'note' ? 'Xiaohongshu note' : 'Xiaohongshu download',
      kind: 'other',
      rawInput: { input: args.input, action: args.action },
    }),
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('xiaohongshu requires an agent session')
      const input = String(args.input || '').trim()
      if (input === '') throw new Error('input needs the share text or note link')
      const note = await fetchNote(input)
      const summary = {
        noteId: note.noteId,
        title: note.title,
        desc: note.desc,
        author: note.author,
        liveCount: note.liveCount,
        items: note.items.map((item) => ({
          index: item.index, kind: item.kind, imageUrl: item.imageUrl,
          videoUrl: item.videoUrl, width: item.width, height: item.height,
        })),
      }
      if (args.action !== 'download') {
        return {
          ...summary,
          message: `「${note.title || note.noteId}」共 ${note.items.length} 项，其中 ${note.liveCount} 张实况图。加 action=download 下载。`,
        }
      }
      const wanted = typeof args.output_dir === 'string' && args.output_dir.trim() !== '' ? args.output_dir.trim() : ''
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const outputDir = wanted === ''
        ? join(defaultDownloadRoot(), note.noteId)
        : (isAbsolute(wanted) ? wanted : resolve(cwd, wanted))
      const importFlag = args.import !== false
      const { results } = await downloadNote(note, {
        outputDir,
        buildPair: (photo, video, dir, baseName) => buildLivePair(photo, video, dir, baseName, importFlag),
      })
      const files = results.flatMap((item) => item.files || [])
      const imported = results.filter((item) => item.imported === true).length
      const failed = results.filter((item) => item.error)
      return {
        ...summary,
        outputDir,
        files,
        imported,
        message: [
          `已保存 ${results.length} 项到 ${outputDir}`,
          note.liveCount > 0 ? `${note.liveCount} 张实况已合成为 JPEG+MOV 对` : '',
          imported > 0 ? `${imported} 张已导入「照片」，iCloud 会同步到 iPhone` : '',
          failed.length > 0 ? `${failed.length} 项失败：${failed[0].error}` : '',
        ].filter(Boolean).join('；'),
      }
    },
  })

  const mediaHosts = /(^|\.)(rednotecdn\.com|xhscdn\.com|xiaohongshu\.com)$/i

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/xhs/api/status',
    handler: (req, res) => {
      if (!trusted(ctx, req)) return sendJson(res, 403, { error: 'cross-origin request rejected' })
      sendJson(res, 200, { helperBuilt: existsSync(APP_BINARY), downloadRoot: defaultDownloadRoot() })
    },
  }), 'dsh-livephoto: status route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/xhs/api/note',
    handler: async (req, res) => {
      if (!trusted(ctx, req)) return sendJson(res, 403, { error: 'cross-origin request rejected' })
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      try {
        const body = await readJson(req)
        const note = await fetchNote(body.input)
        sendJson(res, 200, {
          noteId: note.noteId,
          title: note.title,
          desc: note.desc,
          author: note.author,
          liveCount: note.liveCount,
          items: note.items,
        })
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-livephoto: note route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/xhs/api/download',
    handler: async (req, res) => {
      if (!trusted(ctx, req)) return sendJson(res, 403, { error: 'cross-origin request rejected' })
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      try {
        const body = await readJson(req)
        const note = await fetchNote(body.input)
        const outputDir = join(defaultDownloadRoot(), note.noteId)
        const importFlag = body.import !== false
        const { results, manifest } = await downloadNote(note, {
          outputDir,
          buildPair: (photo, video, dir, baseName) => buildLivePair(photo, video, dir, baseName, importFlag),
        })
        sendJson(res, 200, {
          noteId: note.noteId,
          title: note.title,
          outputDir,
          manifest,
          imported: results.filter((item) => item.imported === true).length,
          results: results.map((item) => ({
            index: item.index, kind: item.kind, files: item.files,
            imported: item.imported === true, error: item.error || '',
          })),
        })
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-livephoto: download route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/xhs/api/media',
    handler: async (req, res) => {
      if (!trusted(ctx, req)) return sendJson(res, 403, { error: 'cross-origin request rejected' })
      let target
      try {
        target = new URL(new URL(req.url, ctx.webServer.getOrigin()).searchParams.get('url') || '')
      } catch {
        return sendJson(res, 400, { error: 'bad url' })
      }
      if (!mediaHosts.test(target.hostname)) return sendJson(res, 403, { error: 'host not allowed' })
      try {
        const upstream = await fetch(target, {
          headers: {
            'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            referer: 'https://www.xiaohongshu.com/',
          },
        })
        if (!upstream.ok || !upstream.body) return sendJson(res, 502, { error: `upstream ${upstream.status}` })
        res.writeHead(200, {
          'content-type': upstream.headers.get('content-type') || 'image/jpeg',
          'cache-control': 'private, max-age=3600',
        })
        const reader = upstream.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(Buffer.from(value))
        }
        res.end()
      } catch (error) {
        sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-livephoto: media route')

  const safeHost = (value) => {
    try {
      return mediaHosts.test(new URL(value).hostname)
    } catch {
      return false
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/xhs/api/item',
    handler: async (req, res) => {
      if (!trusted(ctx, req)) return sendJson(res, 403, { error: 'cross-origin request rejected' })
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      try {
        const body = await readJson(req)
        const noteId = String(body.noteId || '')
        if (!/^[A-Za-z0-9]+$/.test(noteId)) return sendJson(res, 400, { error: 'bad noteId' })
        const item = body.item || {}
        const kind = item.kind === 'live' || item.kind === 'video' ? item.kind : 'image'
        if (kind !== 'video' && !safeHost(item.imageUrl)) return sendJson(res, 403, { error: 'image host not allowed' })
        if (kind !== 'image' && !safeHost(item.videoUrl)) return sendJson(res, 403, { error: 'video host not allowed' })
        const safeTitle = String(body.safeTitle || noteId).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
        const importFlag = body.import !== false
        const result = await downloadItem(
          { index: Number(item.index) || 1, kind, imageUrl: item.imageUrl || '', videoUrl: item.videoUrl || '' },
          join(defaultDownloadRoot(), noteId),
          {
            ...(body.name ? { name: String(body.name) } : { safeTitle }),
            buildPair: (photo, video, dir, baseName) => buildLivePair(photo, video, dir, baseName, importFlag),
          },
        )
        sendJson(res, 200, { result })
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-livephoto: item route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/xhs/api/reveal',
    handler: async (req, res) => {
      if (!trusted(ctx, req)) return sendJson(res, 403, { error: 'cross-origin request rejected' })
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      try {
        const body = await readJson(req)
        const noteId = String(body.noteId || '')
        const dir = join(defaultDownloadRoot(), noteId)
        if (!/^[A-Za-z0-9]+$/.test(noteId) || !dir.startsWith(defaultDownloadRoot()) || !existsSync(dir)) {
          return sendJson(res, 404, { error: 'nothing to reveal yet' })
        }
        await execFileAsync('open', [dir], { timeout: 10_000 })
        sendJson(res, 200, { revealed: dir })
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-livephoto: reveal route')
}
