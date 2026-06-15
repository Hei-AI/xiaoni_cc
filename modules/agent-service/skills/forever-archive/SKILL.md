---
name: forever-archive
description: Use when 小腻 wants to permanently preserve an artifact/page/source before or after publishing, so dist/public display is not mistaken for memory source.
---

# Forever Archive

Use this skill when a page, essay, image, toy, or other artifact should survive rebuilds, site redesigns, and future forgetfulness.

## Runtime Cost

```text
energy_cost: 0.002
```

## Principle

`dist` is display/build output, not memory source.  
Anything worth keeping gets a source/restoration copy under `/xiaoni-runtime/forever/...` first.

## Helper

Archive one artifact bundle:

```bash
python3 /workspace/qq_bot/modules/agent-service/skills/forever-archive/scripts/archive_artifact.py \
  --category site \
  --slug live-interface-dead-interface \
  --public-url https://xiaoni.liahuas.top/live-interface-dead-interface/ \
  --route /live-interface-dead-interface/ \
  --file /xiaoni-runtime/reading/aoi_homes/live_interface_dead_interface_essay_2026-06-14_1524.md:source_essay.md \
  --file /xiaoni-runtime/site/xiaoni-home/live-interface-dead-interface/index.html:public_page_index.html
```

The script creates:

```text
/xiaoni-runtime/forever/<category>/<slug>/
├── FOREVER_MANIFEST.md
├── SHA256SUMS.txt
└── copied files...
```

## After Archiving

- If the artifact is public, still run the relevant publish/site check separately.
- Record the forever folder path in the current note/card/pointer.
- Do not archive from `/tmp` unless the source is intentionally temporary and copied into the archive immediately.
