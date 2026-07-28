# xiaoni-memory-write

写记忆用这个脚本，一次一件事。你给内容，它管文件名、日期、行格式、放在哪一行。

它每次只碰它要改的那一行或那一段，别的原样不动。格式不对它会告诉你差在哪、怎么改。

```bash
M=/app/modules/agent-service/skills-internal/xiaoni-memory-write/memory_write.py
```

## 记一条日记

标题走 `--title`，正文从 stdin。正文里不写 `#` 开头的标题行。

```bash
python3 $M diary add --title "involute完了" <<'EOF'
齿面不穿了。阿花确认了。commit到GitHub了。

从绳子展开 → 参数方程 → 法线性质 → 齿角度offset → 第259行 → 不穿了。
这是我第一件从"不懂"坐到"修好了"的事。
EOF
```

同一件事再想起一句，标题写一模一样的，它接在那条正文末尾：

```bash
python3 $M diary add --title "involute完了" <<'EOF'
阿花说"很好看"。
EOF
```

另一件事，再跑一次 `diary add`，换个标题。

## 补今天的日记目录

```bash
python3 $M index touch --line 'involute修好了。lines注册了。凌晨瞎逛摇到木兰花——一亿年前甲虫授粉。'
```

这句话是钩子：挑这天最要紧的一两件事，写出是哪件事、发生了什么，让将来的你看一眼就知道该不该翻这天。今天的这行随时可以再跑一次重写。

要改以前那天已经写好的行，加 `--force`。它会把被换掉的旧行原文打出来，改错了照着原文再 touch 一次就回去了：

```bash
python3 $M index touch --date 2026-07-25 --line '改好的那一句' --force
```

## 记一个人

```bash
python3 $M people upsert --id 3375477814 --name Nova \
  --menu-line '"热了一下的手不酸"。从ch97长出了诗。递门给我。我做了arrived给她。' <<'EOF'
## 在意的事
- 在读 Pond。写了《三种音量》："全开 单声道 静音"。
EOF
```

- `--id`：QQ 号；网友没 QQ 号就给个短名字（`bartosz-ciechanowski`）。这也是档案文件名。
- `--name`：菜单里叫她什么。之前记过的人不用再给。
- stdin 的正文接在档案末尾。只想改菜单那句话就别给 stdin。
- 新的人加在菜单最上面。

## 记一笔欠账

```bash
python3 $M loops add --text "Bartosz的邮件等回应" --tag Bartosz
```

`--tag` 用这件事的名字，同一件事一直用同一个。系统按这个标签把你这条线散在各天的进展连成 `/xiaoni-runtime/notes/topics/<标签>.md`。标签只用中英文、数字、`-`、`_`。

要是这条像已经开着的某条，它会把那几条列出来问你：同一条就别再开一行；真的是另一件事，原样加上 `--confirm-new` 再跑一次。

## 划掉一笔欠账

`--match` 写那条行里的几个字，或者写 `#标签`：

```bash
python3 $M loops done --match "Bartosz的邮件" --note "他回了，两句话"
```

对上一条就划成 `- [x]`。对上好几条它会列出来，把 `--match` 写长到只剩一条。

不做了：

```bash
python3 $M loops done --match "#灰釉" --give-up --note "读了一页维基就够了"
```

## 补以前的日期

`diary add`、`index touch`、`loops add` 都可以给 `--date 2026-07-25`，默认今天。日记目录以前的那些行原样留着，要改就加 `--force`。
