/**
 * Xiaohongshu note reading and downloading (Host side, no dependencies).
 *
 * Two network steps mirror what the phone app does: follow a share link to the
 * note URL (it carries the `xsec_token` the page needs), then read the note
 * page with a mobile user agent and take the `window.__INITIAL_STATE__` payload.
 * Images come from the `H5_DTL` entry of each `infoList`; a Live Photo image also
 * carries a short mute H.264 clip under `stream.h264`.
 */
import { createWriteStream } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const REFERER = 'https://www.xiaohongshu.com/'

export class NoteError extends Error {}

async function get(url, { tries = 3 } = {}) {
  let lastError
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: {
          'user-agent': MOBILE_UA,
          'accept-language': 'zh-CN,zh;q=0.9',
          referer: REFERER,
        },
      })
      if (!response.ok) throw new NoteError(`HTTP ${response.status} for ${url}`)
      return response
    } catch (error) {
      lastError = error
      if (attempt < tries) await new Promise((r) => setTimeout(r, 400 * attempt))
    }
  }
  throw lastError
}

const SHARE_LINK = /https?:\/\/[^\s"'<>]+/i

/** Pull the note URL out of a share blurb, short link, or plain URL. */
export async function resolveNoteUrl(input) {
  const text = String(input || '').trim()
  const match = text.match(SHARE_LINK)
  if (!match) throw new NoteError('没有在输入里找到链接')
  let url = match[0]
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  if (/xhslink\.(cn|com)/i.test(url)) {
    const response = await get(url)
    const landed = response.url || ''
    if (/xiaohongshu\.com|rednote\.com/i.test(landed)) return landed
    throw new NoteError('短链没有跳转到笔记页')
  }
  return url
}

function pickImageUrl(image) {
  const detail = (image.infoList || []).find((entry) => entry.imageScene === 'H5_DTL')
  return detail?.url || image.url || ''
}

function pickLiveVideo(image) {
  const streams = image.stream || {}
  for (const codec of ['h264', 'h265', 'h266', 'av1']) {
    const list = streams[codec] || []
    if (list.length > 0 && list[0].masterUrl) return list[0]
  }
  return null
}

function parseInitialState(html) {
  const marker = html.indexOf('window.__INITIAL_STATE__')
  if (marker < 0) throw new NoteError('笔记页里没有状态数据（可能需要登录或链接已失效）')
  const start = html.indexOf('=', marker) + 1
  const end = html.indexOf('</script>', start)
  const raw = html.slice(start, end < 0 ? undefined : end).trim().replace(/undefined/g, 'null')
  try {
    return JSON.parse(raw)
  } catch {
    throw new NoteError('无法解析笔记数据')
  }
}

/** Read one note: title, body, and every image, Live Photo clip, or video. */
export async function fetchNote(input) {
  const noteUrl = await resolveNoteUrl(input)
  const response = await get(noteUrl)
  const html = await response.text()
  const state = parseInitialState(html)
  const note = state?.noteData?.data?.noteData
  if (!note) throw new NoteError('链接指向的笔记不存在或已删除')

  const noteId = note.noteId || 'note'
  const items = []
  const images = Array.isArray(note.imageList) ? note.imageList : []
  images.forEach((image, index) => {
    const imageUrl = pickImageUrl(image)
    if (imageUrl === '') return
    const live = image.livePhoto === true ? pickLiveVideo(image) : null
    items.push({
      index: index + 1,
      kind: live ? 'live' : 'image',
      imageUrl,
      videoUrl: live?.masterUrl || '',
      width: image.width || live?.width || 0,
      height: image.height || live?.height || 0,
      duration: live?.duration ? Math.round(live.duration) / 1000 : 0,
    })
  })

  const video = note.video
  if (items.length === 0 && video) {
    const streams = video.media?.stream || video.stream || {}
    for (const codec of ['h264', 'h265', 'h266', 'av1']) {
      const list = streams[codec] || []
      if (list.length > 0 && list[0].masterUrl) {
        items.push({
          index: 1,
          kind: 'video',
          imageUrl: '',
          videoUrl: list[0].masterUrl,
          width: list[0].width || 0,
          height: list[0].height || 0,
          duration: list[0].duration ? list[0].duration / 1000 : 0,
        })
        break
      }
    }
  }

  if (items.length === 0) throw new NoteError('这条笔记里没有可下载的图片或视频')

  return {
    noteId,
    title: (note.title || '').trim(),
    desc: (note.desc || '').trim(),
    author: note.user?.nickname || note.user?.nickName || '',
    type: note.type || 'normal',
    noteUrl,
    liveCount: items.filter((item) => item.kind === 'live').length,
    items,
  }
}

function extensionOf(url, fallback) {
  const pathname = (() => {
    try {
      return new URL(url).pathname
    } catch {
      return url
    }
  })()
  const ext = extname(pathname).toLowerCase().replace('.', '')
  return ext && ext.length <= 5 ? ext : fallback
}

async function downloadTo(url, target) {
  const response = await get(url)
  const total = Number(response.headers.get('content-length') || 0)
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createWriteStream(target)
    const reader = response.body?.getReader()
    if (!reader) {
      rejectPromise(new NoteError('响应没有内容'))
      return
    }
    const write = async () => {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!stream.write(Buffer.from(value))) {
          await new Promise((r) => stream.once('drain', r))
        }
      }
      stream.end()
    }
    stream.on('error', rejectPromise)
    stream.on('finish', resolvePromise)
    write().catch(rejectPromise)
    void total
  })
  return target
}

/**
 * Download every item of a note.
 *
 * `buildPair` receives (stillFile, videoFile, targetDirectory, name) and returns
 * the written Live Photo pair when the note marks the image as a Live Photo, so
 * the caller decides whether Photos import happens.
 */
/** Download one item into `outDir`; Live Photo items are paired through `options.buildPair`. */
export async function downloadItem(item, outDir, options = {}) {
  await mkdir(outDir, { recursive: true })
  const name = options.name || `${String(item.index).padStart(2, '0')}-${options.safeTitle || 'note'}`
  if (item.kind === 'video') {
    const file = join(outDir, `${name}.mp4`)
    await downloadTo(item.videoUrl, file)
    return { index: item.index, kind: 'video', files: [file], imported: false, error: '' }
  }

  const imageExt = extensionOf(item.imageUrl, 'jpg').replace('jpeg', 'jpg')
  const imageFile = join(outDir, `${name}.${imageExt}`)
  await downloadTo(item.imageUrl, imageFile)
  if (item.kind !== 'live' || !item.videoUrl) {
    return { index: item.index, kind: 'image', files: [imageFile], imported: false, error: '' }
  }

  const videoFile = join(outDir, `${name}.source.mp4`)
  await downloadTo(item.videoUrl, videoFile)
  let pair = null
  let pairError = ''
  try {
    pair = await options.buildPair?.(imageFile, videoFile, outDir, `IMG_${String(item.index).padStart(4, '0')}`)
  } catch (error) {
    pairError = error instanceof Error ? error.message : String(error)
  }
  if (pair && pair.video) {
    await rm(videoFile, { force: true })
    await rm(imageFile, { force: true })
    return {
      index: item.index,
      kind: 'live',
      files: [pair.photo, pair.video],
      identifier: pair.identifier || '',
      imported: pair.imported === true,
      error: pair.error || '',
    }
  }
  return {
    index: item.index,
    kind: 'live',
    files: [imageFile, videoFile],
    imported: false,
    error: pairError || pair?.error || 'Live Photo pair was not built',
  }
}

function safeNameOf(note) {
  return (note.title || note.noteId).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || note.noteId
}

export async function downloadNote(note, options = {}) {
  const outDir = options.outputDir
  await mkdir(outDir, { recursive: true })
  const safeTitle = safeNameOf(note)
  const results = []
  for (const item of note.items) {
    const result = await downloadItem(item, outDir, {
      ...options,
      safeTitle,
      name: `${String(item.index).padStart(2, '0')}-${safeTitle}`,
    })
    results.push(result)
  }
  const manifest = {
    noteId: note.noteId,
    title: note.title,
    desc: note.desc,
    noteUrl: note.noteUrl,
    downloadedAt: new Date().toISOString(),
    items: results,
  }
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  return { outputDir: outDir, results, manifest: join(outDir, 'manifest.json') }
}
