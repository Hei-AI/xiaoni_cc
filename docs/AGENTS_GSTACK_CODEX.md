# Codex And GStack Local Setup

本页是 Codex + gstack 本机安装的仓库级指引。它只记录当前工作站和本仓库协作需要的约束；gstack 本体版本、技能内容和生成逻辑以 `/home/liahua/gstack` 为准。

## Current Truth
- gstack 源码单一来源：`/home/liahua/gstack`
- Codex 可见技能入口：`~/.codex/skills/gstack` 和 `~/.codex/skills/gstack-*`
- `~/.codex/skills/gstack` 只能是 gstack runtime root，不能再指向整个 `/home/liahua/gstack` 仓库
- 不要在本仓库新增 `.agents/skills/gstack` vendored copy；这会让 Codex 重复扫描并制造版本漂移
- 不要同时保留短名 alias 和 `gstack-*` alias；skill frontmatter `name` 相同会在 Codex skill selector 里重复出现

## Install Or Repair
```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git /home/liahua/gstack
cd /home/liahua/gstack
./setup --host codex
```

如果目录已存在，用：

```bash
cd /home/liahua/gstack
git pull --ff-only origin main
./setup --host codex
```

## Verify
```bash
cat /home/liahua/gstack/VERSION
/home/liahua/gstack/bin/gstack-update-check --force
find ~/.codex/skills -maxdepth 1 -mindepth 1 -printf '%f\n' | sort
```

重复检查：

```bash
for f in ~/.codex/skills/*/SKILL.md; do
  [ -f "$f" ] || continue
  d=$(basename "$(dirname "$f")")
  name=$(awk -F: '/^name:/ {gsub(/[[:space:]]/,"",$2); print $2; exit}' "$f")
  printf '%s\t%s\n' "$name" "$d"
done | sort
```

同一个 `name` 不应对应多个 gstack 目录。发现旧短名 symlink 或 `gstack.bak-*` 目录时，先确认它们指向 gstack 旧生成目录，再移到 `~/.gstack/backups/` 或删除。

## Notes
- OpenAI Codex skills 是带 `SKILL.md` 的目录；Codex 会用 progressive disclosure 先读取 skill 元数据，再按需读取完整说明。
- gstack 最新 Codex 安装路径是 `~/.codex/skills/gstack-*/`，通过 `./setup --host codex` 生成，不要手动复制源目录。
- `AGENTS.md` 只放仓库级行为约束；gstack 本机安装细节放在本页。
