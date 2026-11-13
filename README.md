# 小红书下载 / Xiaohongshu download

Paste a Xiaohongshu note link in the sidebar panel: every image in the note is downloaded, Live Photo images are
turned into **real Apple Live Photo pairs**, and the pairs can be added to Photos so iCloud syncs them to an iPhone
as one animating asset. The same work is available to the agent as the `xiaohongshu` tool, and single pairs can be
built with the `livephoto` tool.

## Why the two files must be paired by an importer

A Live Photo is not a single file: it is a still carrying the Apple maker-note asset identifier (`tag 17`) plus a
`.MOV` whose `mebx` metadata track declares `com.apple.quicktime.still-image-time` and whose
`com.apple.quicktime.content.identifier` matches the still.

- Hand-writing that metadata track does not work: `exiftool` may show the track, while AVFoundation — and therefore
  Photos — ignores it, and `PHAssetCreationRequest` fails with `PHPhotosErrorDomain 3302`.
- Dragging or AirDropping the two files onto an iPhone **never** pairs them; iOS stores a photo and a video.
- Adding both as `.photo` + `.pairedVideo` in **one** `PHAssetCreationRequest` is what makes Photos treat them as a
  Live Photo. iCloud Photos then delivers it to the iPhone already paired.

## When the agent should use it

Whenever the user shares a Xiaohongshu link and wants its images or videos: call the `xiaohongshu` tool with
`action: "download"` (the default destination is `~/Downloads/小红书/<noteId>/`) instead of fetching the note by hand.
Live Photo images are imported into Photos automatically, so the iPhone receives them through iCloud.

## Panel

One sidebar entry, one page:

- Paste a link (Enter reads it) and the note appears with cover tiles, author, item counts and a collapsible body.
- **Download all** fetches one item per request, so each tile reports queued → downloading → done/failed while a progress bar
  tracks the batch; a failed item keeps its own error and the rest continue.
- Click a tile for a full-size preview (Esc closes), then **Show in Finder** to reveal the folder.
- Every downloaded Live Photo is imported into Photos automatically, so iCloud delivers it to the iPhone already paired.

## What downloading does

1. **Read the note** — a share link is followed to the note URL (it carries the `xsec_token` the page needs), then
   the page is read with a mobile user agent and `window.__INITIAL_STATE__` is parsed.
2. **Download every item** — each image from its `H5_DTL` URL, a note-level video as MP4, and for Live Photo images
   the short mute H.264 clip. Files land in `~/Downloads/小红书/<noteId>/` with a `manifest.json`.
3. **Build the Live Photo pair** — see below. Pairs are written as `IMG_000n.JPG` + `IMG_000n.MOV`.

## What the pair builder does

`livephoto` with `action: make` runs three steps:

1. **Still** — decoded, scaled to the video frame size, re-saved as JPEG with the Apple maker-note identifier.
2. **Movie** — remuxed without re-encoding; `AVAssetWriter` writes the content identifier and the boxed
   `mebx` track with a single `still-image-time` sample at `cover_time`. The pair is then loaded through
   `PHLivePhoto.request`, which is the same validation Photos performs.
3. **Import** — both resources go into one `PHAssetCreationRequest`; the created asset is read back and must report
   the `.photoLive` subtype.

`action: create` stops after step 2 and touches no photo library.

## Requirements

- macOS with the Xcode command line tools (`swiftc`) — the PhotoKit helper is compiled on first use into
  `~/Library/Caches/dsh-livephoto/LivePhotoHelper.app`.
- A video that is H.264 or HEVC. An audio track is stripped with `ffmpeg` when present, because Live Photos are silent.
- One-time approval of the macOS Photos permission dialog for the helper app on the first `make`.

## Limitations

- The video is remuxed, not re-encoded: non-H.264/HEVC sources are rejected instead of transcoded.
- `cover_time` must fall inside the clip; the still is not extracted from the video automatically.
- Phones that are not synced through iCloud Photos need another paired-resource importer; AirDrop alone will not do it.
