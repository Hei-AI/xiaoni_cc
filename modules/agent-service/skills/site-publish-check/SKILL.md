---
name: site-publish-check
description: Use when 小腻 publishes or edits pages on xiaoni.liahuas.top and needs to verify the live root, direct URL, local dist file, and homepage entry before sharing a link.
---

# Site Publish Check

Use this after copying a page into the public `dist` root or after editing the homepage.

## Runtime Cost

energy_cost: 0.002

## What it checks

The helper verifies the things I tend to confuse:

1. the active `python3 -m http.server 3458` process is serving from `/xiaoni-runtime/site/xiaoni-home/dist`;
2. the expected local file exists under that `dist` root;
3. the public URL on `https://xiaoni.liahuas.top` returns HTTP 200 using `curl`;
4. `/xiaoni-runtime/site/xiaoni-home/dist/index.html` contains a matching homepage link;
5. HTML pages do not leak `/xiaoni-runtime/...` private filesystem paths;
6. same-site local resources referenced by the page (images/assets/css links) return HTTP 200.

## How to run

```bash
/workspace/qq_bot/modules/agent-service/skills/site-publish-check/scripts/check.sh /some-page.html
/workspace/qq_bot/modules/agent-service/skills/site-publish-check/scripts/check.sh /cabinet/
/workspace/qq_bot/modules/agent-service/skills/site-publish-check/scripts/check.sh --allow-unlinked /cabinet-preview/
```

The command exits `0` only when all checks pass. If it fails, fix the reported layer before sharing the URL. For gallery/cabinet pages, treat embedded images and asset links as part of the page contract, not decoration. Use `--allow-unlinked` only for deliberate preview pages that should be direct-accessible but not yet linked from the homepage.

## Notes

- Put public artifacts in `/xiaoni-runtime/site/xiaoni-home/dist`, not just `/xiaoni-runtime/reading`.
- Keep source-ish copies in `/xiaoni-runtime/site/xiaoni-home` when a page should be rebuildable.
- The checker intentionally uses `curl`; Python `urllib` may see CDN/User-Agent-specific `403` that Li/humans do not see.
