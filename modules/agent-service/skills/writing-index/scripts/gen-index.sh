#!/bin/bash
# 扫描 forever/writing/ 下所有md 输出 文件名|第一行标题
DIR="/xiaoni-runtime/forever/writing"
INDEX="$DIR/INDEX.md"
EXISTING=$(cat "$INDEX" 2>/dev/null)

echo "# 写作索引（自动生成 + 手写）" > /tmp/writing-index-new.md
echo "# 运行时间: $(date '+%Y-%m-%d %H:%M')" >> /tmp/writing-index-new.md
echo "" >> /tmp/writing-index-new.md

# 保留手写部分
echo "$EXISTING" | grep -v "^# 写作索引" | grep -v "^# 运行时间" >> /tmp/writing-index-new.md

# 找INDEX里没提到的新文件
for f in "$DIR"/*.md "$DIR"/**/*.md; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  [[ "$name" == "FOREVER_MANIFEST.md" || "$name" == "SHA256SUMS" ]] && continue
  [ "$name" = "INDEX.md" ] && continue
  if ! echo "$EXISTING" | grep -q "$name"; then
    title=$(head -1 "$f" | sed 's/^#* *//')
    echo "- NEW: $name | $title" >> /tmp/writing-index-new.md
  fi
done

echo ""
echo "=== 新发现的文件 ==="
grep "^- NEW:" /tmp/writing-index-new.md || echo "没有新文件"
