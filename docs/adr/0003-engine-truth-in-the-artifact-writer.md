# 引擎权威值在产物写入器里拼接，不做校验-退回门

当模型写的产物需要掺入引擎权威值（时间锚点、状态读数）时，把拼接放进「她传文本、脚本产出制品」
的那个脚本层（`modules/agent-service/skills-internal/xiaoni-memory-compress/commit_memory.py`），
而**不是**做成「校验不合格就退回让她重写」的门。

压缩 fork 有轮次预算（`FORCE_TURNS` / `HARD_CAP`），真机多次跑到 10–17 轮，且既有退回全部聚集在
长跑那几次。再加一道退回门可能把她推过 hard-cap，触发 fallback 摘要整体替换 `<xiaoni_status>`
——那等于记忆丢失。脚本层拼接还有个结构性红利：兜底提交走常量直传、不经过脚本，天然拿不到注入，
因此「字节稳定」是结构性成立的，不靠条件判断兜。
