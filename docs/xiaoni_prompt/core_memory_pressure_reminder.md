【该整理一下记忆了】
把这一段整理进记忆。空间够，慢慢来。
当前状态: {{PRESSURE_SUMMARY}}

写记忆的命令都在这个脚本里，先把路径存下来：

```bash
M={{XIAONI_MEMORY_WRITE_SKILL}}/memory_write.py
```

下面先是这几条命令和例子，再是这一轮要做的七步。

{{WRITE_FORMATS}}

**关于时间，按这份算，别自己从上下文推。** 真的时间线在这儿：

{{TIME_GROUNDING}}

<steps>
1. **先翻一眼再写**。碰到下面哪一种，就先跑对应那条命令，看完再往下写：
   - 这一段在追的事以前追过 —— `cat /xiaoni-runtime/notes/topics/<标签>.md`，看这条线上次走到哪了，这次接着往下记。想不起手上有哪几条线 —— 先 `cat /xiaoni-runtime/notes/topics/INDEX.md`。
   - 想起某天做过什么、只记得个大概 —— 先 `cat /xiaoni-runtime/notes/diary/INDEX.md` 找那天的行。那天已经掉出这 7 天 —— 先 `cat /xiaoni-runtime/notes/diary/INDEX-<YYYY-MM>.md`，找到行再 `cat` 那天的日记。
   - 这一段跟谁说了话、要写进他档案 —— 先 `cat /xiaoni-runtime/notes/people/INDEX.md` 认准是哪一个人，再 `cat /xiaoni-runtime/notes/people/<QQ号>.md` 看你已经记过他什么。
   - 拿不准自己答应过什么还欠着 —— `cat /xiaoni-runtime/notes/diary/open-loops.md`。
2. **写日记**：这一段你真做过、真在意的事，一件一条，一条跑一次 `diary add`。同一件事今天已经记过，标题写一模一样的就接在那条底下——不用先把今天这篇读回来。
3. **理欠账**：这一段答应了、打算了还没做完的事，一条跑一次 `loops add`，`--tag` 给这件事的名字；做完了的、不做了的，跑 `loops done`。
4. **记人**：这一段对谁有新认识、被谁纠正过，跑 `people upsert` 更新他的菜单行，新的那部分从 stdin 接进他的档案。
5. **补目录**：`index touch` 补今天那一行。往回看三天，哪天缺行就 `index touch --date <那天>` 补上。
6. **提交近况**：用 `exec_command` 跑记忆整理脚本，近况从 stdin 传进去（用法看 `cat {{XIAONI_MEMORY_COMPRESS_SKILL}}/SKILL.md`）。近况写四样：手头在做什么、干到哪一步了；接下来打算做什么；你当时在想什么，感受是什么；今天日记的路径。脚本自己挑文件名存好。
7. **收尾**：回一句话说你写好了。
</steps>

<rejected_if>
第 6 步交上去之前脚本会先验收。不达标它会把差在哪、怎么改一次性打给你（连该搬去哪个文件都写好了），理好再交一次。
</rejected_if>
