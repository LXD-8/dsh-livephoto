/**
 * Xiaohongshu downloads — Web page.
 *
 * One sidebar entry and one panel. The Host resolves the note, downloads one
 * item per request (so the tiles can report their own progress) and builds the
 * Live Photo pairs; this page only renders state and asks for the next item.
 */
window.__ModuleLoader__.load({
  id: 'dsh-livephoto',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-livephoto'
    const PANEL_ID = 'dsh-livephoto'
    const NOTE_PATH = '/xhs/api/note'
    const ITEM_PATH = '/xhs/api/item'
    const STATUS_PATH = '/xhs/api/status'
    const REVEAL_PATH = '/xhs/api/reveal'
    const MEDIA_PATH = '/xhs/api/media?url='

    const zh = {
      panel: '小红书下载',
      title: '小红书下载',
      subtitle: '粘贴链接，图片、实况图、视频一次下全',
      status: { ready: '实况引擎就绪', building: '引擎待编译', loading: '检查中…' },
      form: {
        label: '笔记链接',
        placeholder: '粘贴分享口令或链接，例如 https://xhslink.cn/o/…',
        resolve: '解析笔记',
        resolving: '解析中…',
        download: '下载全部',
        downloading: '下载中…',
        clear: '清空',
        hint: '实况图会合成为 JPEG + MOV 一对并自动导入「照片」，iCloud 随后同步到 iPhone。',
      },
      note: { items: '{count} 项', live: '{count} 张实况', author: '@{name}', noTitle: '无标题笔记', expand: '展开全文', collapse: '收起' },
      badge: { live: '实况', image: '图片', video: '视频' },
      item: { queued: '排队', downloading: '下载中', done: '已完成', failed: '失败', imported: '已导入' },
      result: {
        title: '下载完成',
        saved: '{count} 项已保存',
        imported: '{count} 张已导入照片',
        folder: '保存目录',
        reveal: '在 Finder 中显示',
        open: '打开原笔记',
        retryFailed: '重试失败项',
      },
      empty: '还没有解析笔记',
      emptyHint: '在上方粘贴小红书链接，解析后即可预览并一键下载。',
      error: { prefix: '出错了' },
      boundary: { message: '面板渲染出错。', retry: '重试', details: '详情' },
    }

    const en = {
      panel: 'Xiaohongshu',
      title: 'Xiaohongshu download',
      subtitle: 'Paste a link; images, Live Photos and videos come down at once',
      status: { ready: 'Live Photo engine ready', building: 'Engine not built yet', loading: 'Checking…' },
      form: {
        label: 'Note link',
        placeholder: 'Paste the share text or a link, e.g. https://xhslink.cn/o/…',
        resolve: 'Read note',
        resolving: 'Reading…',
        download: 'Download all',
        downloading: 'Downloading…',
        clear: 'Clear',
        hint: 'Live Photo images become a JPEG + MOV pair, added to Photos automatically so iCloud syncs them to the iPhone.',
      },
      note: { items: '{count} items', live: '{count} Live', author: '@{name}', noTitle: 'Untitled note', expand: 'Show more', collapse: 'Show less' },
      badge: { live: 'Live', image: 'Image', video: 'Video' },
      item: { queued: 'Queued', downloading: 'Downloading', done: 'Done', failed: 'Failed', imported: 'In Photos' },
      result: {
        title: 'Finished',
        saved: '{count} items saved',
        imported: '{count} added to Photos',
        folder: 'Folder',
        reveal: 'Show in Finder',
        open: 'Open note',
        retryFailed: 'Retry failed',
      },
      empty: 'No note yet',
      emptyHint: 'Paste a Xiaohongshu link above, then read it to preview and download everything.',
      error: { prefix: 'Failed' },
      boundary: { message: 'The panel failed to render.', retry: 'Retry', details: 'Details' },
    }

    const CSS = `
.xhs-page{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary)}
.xhs-scroll{flex:1;min-height:0;overflow:auto}
.xhs-content{max-width:820px;margin:0 auto;padding:26px 24px 56px}
.xhs-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
.xhs-head h1{margin:0;font-size:20px;line-height:28px;font-weight:600;letter-spacing:.1px}
.xhs-sub{margin:6px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.xhs-chip{display:inline-flex;align-items:center;gap:6px;flex:none;font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:3px 10px;background:var(--dsw-alias-bg-layer-1)}
.xhs-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary) 22%,transparent)}
.xhs-dot[data-ok='false']{background:var(--dsw-alias-label-tertiary);box-shadow:none}
.xhs-card{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);padding:16px;margin-bottom:14px}
.xhs-label{display:block;font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary);margin-bottom:6px}
.xhs-inputrow{display:flex;align-items:center;gap:8px}
.xhs-input{box-sizing:border-box;flex:1;min-width:0;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:9px 11px;outline:none;transition:border-color .15s,box-shadow .15s}
.xhs-input:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent)}
.xhs-actions{display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap}
.xhs-primary{height:32px;padding:0 14px;border:0;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-business-primary);color:var(--dsw-static-neutral-00);font-size:13px;font-weight:500;cursor:pointer;transition:opacity .15s}
.xhs-primary:hover:not(:disabled){opacity:.9}
.xhs-primary:disabled{opacity:.45;cursor:default}
.xhs-secondary{height:32px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer;transition:background .15s}
.xhs-secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.xhs-secondary:disabled{opacity:.45;cursor:default}
.xhs-textbtn{border:0;background:transparent;color:var(--dsw-alias-link);font:inherit;font-size:12px;cursor:pointer;padding:2px 4px;border-radius:var(--dsw-radius-sm)}
.xhs-textbtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.xhs-hint{margin:10px 0 0;font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.xhs-note{display:flex;gap:12px;align-items:flex-start}
.xhs-avatar{flex:none;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1)}
.xhs-note-main{flex:1;min-width:0}
.xhs-note-title{margin:0;font-size:15px;line-height:22px;font-weight:600;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.xhs-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.xhs-tag{font-size:11px;line-height:18px;padding:1px 8px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.xhs-tag[data-live='true']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,transparent);color:var(--dsw-alias-state-business-primary)}
.xhs-desc{margin:10px 0 0;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}
.xhs-desc[data-collapsed='true']{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.xhs-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}
.xhs-tile{position:relative;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);overflow:hidden;background:var(--dsw-alias-bg-layer-2);aspect-ratio:3/4;padding:0;cursor:zoom-in;transition:transform .16s,border-color .16s}
.xhs-tile:hover{transform:translateY(-1px);border-color:var(--dsw-alias-border-l2)}
.xhs-tile img{width:100%;height:100%;object-fit:cover;display:block}
.xhs-tile[data-state='idle'] img,.xhs-tile[data-state='queued'] img{opacity:.94}
.xhs-tile[data-state='downloading']::after{content:'';position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent) 50%,transparent 80%);background-size:200% 100%;animation:xhs-shimmer 1.1s infinite}
@keyframes xhs-shimmer{from{background-position:120% 0}to{background-position:-20% 0}}
.xhs-badge{position:absolute;left:6px;top:6px;font-size:10px;line-height:16px;padding:0 6px;border-radius:999px;background:color-mix(in srgb,#000 55%,transparent);color:#fff;backdrop-filter:blur(2px)}
.xhs-badge[data-kind='live']{background:var(--dsw-alias-state-business-primary)}
.xhs-state{position:absolute;right:6px;bottom:6px;font-size:10px;line-height:16px;padding:0 6px;border-radius:999px;background:color-mix(in srgb,#000 55%,transparent);color:#fff}
.xhs-state[data-state='done']{background:var(--dsw-alias-state-success-primary)}
.xhs-state[data-state='failed']{background:var(--dsw-alias-state-error-primary)}
.xhs-progress{display:flex;align-items:center;gap:10px;margin-top:12px}
.xhs-bar{flex:1;height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.xhs-bar span{display:block;height:100%;background:var(--dsw-alias-state-business-primary);transition:width .3s ease}
.xhs-bar[data-failed='true'] span{background:var(--dsw-alias-state-error-primary)}
.xhs-progress-text{font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary);flex:none}
.xhs-rows{margin-top:6px}
.xhs-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:.5px solid var(--dsw-alias-border-l1);min-width:0}
.xhs-row:first-of-type{border-top:0}
.xhs-row-index{flex:none;width:20px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.xhs-row-kind{flex:none;font-size:11px;line-height:18px;padding:0 8px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.xhs-row-kind[data-live='true']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,transparent);color:var(--dsw-alias-state-business-primary)}
.xhs-row-path{flex:1;min-width:0;font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.xhs-empty{margin:0;padding:26px 16px;border:.5px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);text-align:center}
.xhs-empty b{display:block;font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.xhs-empty span{display:block;margin-top:4px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.xhs-error{margin:12px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}
.xhs-saved{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:2px 0 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-success-primary)}
.xhs-pathrow{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary);min-width:0}
.xhs-pathrow code{font-family:var(--ds-font-family-code);font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl}
.xhs-lightbox{position:fixed;inset:0;z-index:80;background:color-mix(in srgb,#000 72%,transparent);display:flex;align-items:center;justify-content:center;padding:32px}
.xhs-lightbox img{max-width:92vw;max-height:88vh;border-radius:var(--dsw-radius-md);box-shadow:0 18px 60px rgba(0,0,0,.45)}
.xhs-lightbox button{position:absolute;right:22px;top:18px;height:30px;padding:0 12px;border-radius:var(--dsw-radius-md);border:.5px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:#fff;font-size:12px;cursor:pointer}
@media (max-width:620px){.xhs-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.xhs-head{flex-direction:column}.xhs-content{padding:20px 16px 40px}}
`

    function flatten(source, prefix = '') {
      const out = {}
      for (const [key, value] of Object.entries(source)) {
        const name = prefix === '' ? key : `${prefix}.${key}`
        if (value !== null && typeof value === 'object') Object.assign(out, flatten(value, name))
        else out[name] = value
      }
      return out
    }

    async function requestJson(url, options) {
      const response = await fetch(url, options)
      let data = {}
      try {
        data = await response.json()
      } catch {
        data = {}
      }
      if (!response.ok) throw new Error(data && data.error ? data.error : `HTTP ${response.status}`)
      return data
    }

    function XhsIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 3.2, y: 6.4, width: 17.6, height: 12.4, rx: 3.2, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('circle', { cx: 9.4, cy: 12.6, r: 2.6, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('path', { d: 'M14.6 10.4c1.2.9 2 1.6 2 2.2s-.8 1.3-2 2.2', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }))
    }

    function PageContent(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const [status, setStatus] = React.useState(null)
      const [input, setInput] = React.useState('')
      const [note, setNote] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [error, setError] = React.useState('')
      const [expanded, setExpanded] = React.useState(false)
      const [states, setStates] = React.useState({})
      const [results, setResults] = React.useState({})
      const [running, setRunning] = React.useState(false)
      const [preview, setPreview] = React.useState('')
      const [finished, setFinished] = React.useState(false)

      React.useEffect(() => {
        requestJson(STATUS_PATH).then(setStatus).catch(() => setStatus(null))
      }, [])

      React.useEffect(() => {
        if (preview === '') return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') setPreview('')
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [preview])

      const items = note && Array.isArray(note.items) ? note.items : []
      const done = Object.values(states).filter((value) => value === 'done' || value === 'failed').length

      const readNote = React.useCallback(async () => {
        const link = input.trim()
        if (link === '' || busy !== '' || running) return
        setError('')
        setNote(null)
        setStates({})
        setResults({})
        setFinished(false)
        setBusy('note')
        try {
          const data = await requestJson(NOTE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ input: link }),
          })
          setNote(data)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        } finally {
          setBusy('')
        }
      }, [input, busy, running])

      const downloadAll = React.useCallback(async () => {
        if (!note || items.length === 0 || running) return
        setError('')
        setFinished(false)
        setRunning(true)
        const next = {}
        for (const item of items) next[item.index] = 'queued'
        setStates(next)
        const collected = {}
        for (const item of items) {
          setStates((prev) => ({ ...prev, [item.index]: 'downloading' }))
          try {
            const data = await requestJson(ITEM_PATH, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                noteId: note.noteId,
                safeTitle: (note.title || note.noteId).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40),
                item,
                import: true,
              }),
            })
            collected[item.index] = data.result
            setResults((prev) => ({ ...prev, [item.index]: data.result }))
            setStates((prev) => ({ ...prev, [item.index]: data.result && data.result.error ? 'failed' : 'done' }))
          } catch (err) {
            collected[item.index] = { index: item.index, kind: item.kind, files: [], error: err && err.message ? err.message : String(err) }
            setResults((prev) => ({ ...prev, [item.index]: collected[item.index] }))
            setStates((prev) => ({ ...prev, [item.index]: 'failed' }))
          }
        }
        setRunning(false)
        setFinished(true)
      }, [note, items, running])

      const reveal = React.useCallback(async () => {
        if (!note) return
        try {
          await requestJson(REVEAL_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ noteId: note.noteId }),
          })
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
        }
      }, [note])

      const resultList = Object.keys(results).map((key) => results[key]).sort((a, b) => a.index - b.index)
      const savedCount = resultList.length
      const importedCount = resultList.filter((entry) => entry && entry.imported).length
      const failedCount = resultList.filter((entry) => entry && entry.error).length

      const header = h('div', { className: 'xhs-head' },
        h('div', null,
          h('h1', null, t('title')),
          h('p', { className: 'xhs-sub' }, t('subtitle'))),
        h('span', { className: 'xhs-chip' },
          h('span', { className: 'xhs-dot', 'data-ok': status && status.helperBuilt ? 'true' : 'false' }),
          status === null ? t('status.loading') : status.helperBuilt ? t('status.ready') : t('status.building')))

      const formCard = h('div', { className: 'xhs-card' },
        h('label', { className: 'xhs-label', htmlFor: 'xhs-link' }, t('form.label')),
        h('div', { className: 'xhs-inputrow' },
          h('input', {
            id: 'xhs-link',
            className: 'xhs-input',
            value: input,
            placeholder: t('form.placeholder'),
            spellCheck: false,
            onChange: (event) => setInput(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') readNote()
            },
          }),
          input === ''
            ? null
            : h('button', { type: 'button', className: 'xhs-textbtn', onClick: () => setInput('') }, t('form.clear'))),
        h('div', { className: 'xhs-actions' },
          h('button', {
            type: 'button',
            className: 'xhs-primary',
            disabled: busy !== '' || running || input.trim() === '',
            onClick: readNote,
          }, busy === 'note' ? t('form.resolving') : t('form.resolve')),
          h('button', {
            type: 'button',
            className: 'xhs-secondary',
            disabled: !note || items.length === 0 || running || busy !== '',
            onClick: downloadAll,
          }, running ? t('form.downloading') : t('form.download'))),
        h('p', { className: 'xhs-hint' }, t('form.hint')),
        error === ''
          ? null
          : h('p', { className: 'xhs-error' }, `${t('error.prefix')}: ${error}`))

      const tiles = items.map((item) => {
        const state = states[item.index] || 'idle'
        const entry = results[item.index]
        const label = state === 'downloading' ? t('item.downloading')
          : state === 'done' ? (entry && entry.imported ? t('item.imported') : t('item.done'))
            : state === 'failed' ? t('item.failed')
              : state === 'queued' ? t('item.queued') : ''
        return h('button', {
          key: `tile-${item.index}`,
          type: 'button',
          className: 'xhs-tile',
          'data-state': state,
          onClick: () => {
            if (item.imageUrl) setPreview(item.imageUrl)
          },
          title: label,
        },
          item.imageUrl === ''
            ? null
            : h('img', { src: `${MEDIA_PATH}${encodeURIComponent(item.imageUrl)}`, alt: '', loading: 'lazy' }),
          h('span', { className: 'xhs-badge', 'data-kind': item.kind }, t(`badge.${item.kind}`)),
          label === '' ? null : h('span', { className: 'xhs-state', 'data-state': state }, label))
      })

      const progress = running || finished
        ? h('div', { className: 'xhs-progress' },
          h('div', { className: 'xhs-bar', 'data-failed': failedCount > 0 ? 'true' : 'false' },
            h('span', { style: { width: `${items.length === 0 ? 0 : Math.round((done / items.length) * 100)}%` } })),
          h('span', { className: 'xhs-progress-text' }, `${Math.min(done, items.length)}/${items.length}`))
        : null

      const noteCard = note === null
        ? h('div', { className: 'xhs-empty' },
          h('b', null, t('empty')),
          h('span', null, t('emptyHint')))
        : h('div', { className: 'xhs-card' },
          h('div', { className: 'xhs-note' },
            h('div', { className: 'xhs-avatar' }, (note.author || '小').slice(0, 1)),
            h('div', { className: 'xhs-note-main' },
              h('h2', { className: 'xhs-note-title' }, note.title || t('note.noTitle')),
              h('div', { className: 'xhs-meta' },
                note.author ? h('span', { className: 'xhs-tag' }, t('note.author', { name: note.author })) : null,
                h('span', { className: 'xhs-tag' }, t('note.items', { count: items.length })),
                note.liveCount > 0 ? h('span', { className: 'xhs-tag', 'data-live': 'true' }, t('note.live', { count: note.liveCount })) : null),
              note.desc === '' ? null : h('p', { className: 'xhs-desc', 'data-collapsed': expanded ? 'false' : 'true' }, note.desc),
              note.desc !== '' && note.desc.length > 70
                ? h('button', { type: 'button', className: 'xhs-textbtn', style: { paddingLeft: 0 }, onClick: () => setExpanded(!expanded) },
                  expanded ? t('note.collapse') : t('note.expand'))
                : null)),
          items.length === 0 ? null : h('div', { className: 'xhs-grid' }, tiles),
          progress,
          resultList.length === 0
            ? null
            : h('div', { className: 'xhs-rows' },
              h('p', { className: 'xhs-saved' },
                t('result.saved', { count: savedCount }),
                importedCount > 0 ? ` · ${t('result.imported', { count: importedCount })}` : ''),
              resultList.map((entry) => h('div', { key: `row-${entry.index}`, className: 'xhs-row' },
                h('span', { className: 'xhs-row-index' }, String(entry.index).padStart(2, '0')),
                h('span', { className: 'xhs-row-kind', 'data-live': entry.kind === 'live' ? 'true' : 'false' }, t(`badge.${entry.kind}`)),
                h('span', { className: 'xhs-row-path', title: (entry.files || []).join('\n') }, (entry.files || []).join('  ·  '))))),
          note
            ? h('div', { className: 'xhs-pathrow' },
              h('span', null, t('result.folder')),
              h('code', { title: status && status.downloadRoot ? `${status.downloadRoot}/${note.noteId}` : note.noteId },
                status && status.downloadRoot ? `${status.downloadRoot}/${note.noteId}` : note.noteId),
              h('button', { type: 'button', className: 'xhs-textbtn', onClick: reveal }, t('result.reveal')),
              h('a', { className: 'xhs-textbtn', href: note.noteUrl, target: '_blank', rel: 'noreferrer' }, t('result.open')))
            : null,
          failedCount > 0
            ? h('p', { className: 'xhs-error' }, resultList.filter((entry) => entry && entry.error).map((entry) => `${entry.index}: ${entry.error}`).join('\n'))
            : null)

      const lightbox = preview === ''
        ? null
        : h('div', {
          className: 'xhs-lightbox',
          role: 'dialog',
          'aria-modal': 'true',
          onClick: () => setPreview(''),
        },
          h('img', { src: `${MEDIA_PATH}${encodeURIComponent(preview)}`, alt: '' }),
          h('button', { type: 'button', onClick: () => setPreview('') }, '✕'))

      return h('section', { className: 'xhs-page' },
        h('style', null, CSS),
        h('div', { className: 'xhs-scroll' },
          h('div', { className: 'xhs-content' }, header, formCard, noteCard)),
        lightbox)
    }

    class PageBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      render() {
        const t = typeof this.props.t === 'function' ? this.props.t : (key) => key
        if (this.state.error === null) return this.props.children
        const detail = String(this.state.error && this.state.error.stack ? this.state.error.stack : this.state.error)
        return h('section', { className: 'xhs-page' },
          h('div', { className: 'xhs-content' },
            h('h1', { style: { paddingTop: '28px' } }, t('title')),
            h('p', { className: 'xhs-error', style: { display: 'block', marginTop: '16px' } }, t('boundary.message')),
            h('details', { className: 'xhs-error', style: { display: 'block', marginTop: '12px' } },
              h('summary', null, t('boundary.details')),
              h('pre', { style: { whiteSpace: 'pre-wrap', maxHeight: '50vh', overflow: 'auto', margin: '12px 0 0' } }, detail)),
            h('button', {
              type: 'button',
              className: 'xhs-secondary',
              style: { marginTop: '16px' },
              onClick: () => this.setState({ error: null }),
            }, t('boundary.retry'))))
      }
    }

    function Page(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      return h(PageBoundary, { t }, h(PageContent, props))
    }

    return {
      name: 'dsh-livephoto-client',
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', flatten(zh)), 'dsh-livephoto: zh dictionary')
        ctx.effect(() => ctx.locale.register(NS, 'en', flatten(en)), 'dsh-livephoto: en dictionary')
        const translate = ctx.locale.bind(NS)
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, Page))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 26,
          locale: NS,
          label: () => translate('panel'),
        }, XhsIcon))
      },
    }
  },
})
