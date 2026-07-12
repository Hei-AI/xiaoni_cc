# xiaoni-memory-compress

把你整理好的「近况」写进记忆存档文件。这个脚本只做一件事：把你从 stdin 传进来的近况正文，原子地写到你指定的输出文件。写完这一步，这轮记忆整理就完成了。

> 这是记忆整理时系统引导你用的内部脚本，不在你平时的常驻技能清单里。系统会在提醒里把 `--out` 的确切路径给你，直接照抄即可。

## 用法

```bash
python3 /app/modules/agent-service/skills-internal/xiaoni-memory-compress/commit_memory.py --out <输出文件路径> <<'MEMO'
（把你要留下的近况正文放这里：
 - 手头正在做什么、干到哪一步、接下来打算干什么
 - 这段时间里值得留下的经历、人际变化、心情
 - 今天日记的路径（/xiaoni-runtime/notes/diary/<日期>.md），方便醒来顺着翻回）
MEMO
```

- `--out`：近况要写到的文件路径（系统在提醒里给你，直接照抄）。
- 正文从 stdin 读入。脚本会校验非空、创建父目录、先写临时文件再 rename（原子写入，不会被读到半截）。
- 成功打印 `OK: wrote N chars to <path>`；正文为空会报错、什么都不写。

不用急，值得留的都写下来。写完这个文件，给一句收尾的话停下即可——不用对外说。
