# Google AI Studio Run Settings Observations

Baseline snapshot (before interacting with controls):
- Model: `gemini-2.5-pro`
- `config.thinkingConfig.thinkingBudget`: `-1`
- `config.safetySettings`: four categories all at `BLOCK_NONE`
- `config.systemInstruction[0].text`: supplied default engineering persona
- No `temperature`, `topP`, `candidateCount`, or tool-related keys emitted

Subsequent entries will be appended immediately after each control change on the right pane.

### Model selection (Gemini 2.5 Pro ➜ Gemini Flash Latest)
- `model` literal switched from `'gemini-2.5-pro'` to `'gemini-flash-latest'` (`tmp/getcode_prev.ts` ➜ `tmp/getcode_curr.ts`)
- Safety helpers dropped: `HarmBlockThreshold`/`HarmCategory` imports removed alongside the entire `config.safetySettings` array (diff shows ~20-line deletion)
- Other config blocks unchanged; `thinkingBudget` remains `-1`

### System instructions (append summary requirement)
- Updated `config.systemInstruction[0].text` to include an extra bullet `- 额外要求：输出前附简短总结。`
- `diff -u tmp/getcode_prev.ts tmp/getcode_curr.ts` shows the new line appended inside the template literal; no other config keys changed

### Temperature (1 ➜ 0.4)
- New `temperature: 0.4` property added under `config`
- No other config sections changed; `thinkingBudget` and system instructions preserved

### Media resolution (Default ➜ Low)
- Added `mediaResolution: 'MEDIA_RESOLUTION_LOW'` inside `config`
- System instruction text restored; no other keys modified

### Thinking mode (switch disabled for this model)
- Attempting to toggle the switch shows the UI banner “Unable to disable thinking mode for this model.”
- No change in the generated code (`diff -u tmp/getcode_prev.ts tmp/getcode_curr.ts` returns empty); `thinkingConfig.thinkingBudget` stays `-1`

### Set thinking budget (Auto ➜ Manual at 4096 tokens)
- Flipping the “Set thinking budget” switch to manual exposes a numeric slider; updating it to `4096` writes that literal into `config.thinkingConfig.thinkingBudget`
- No other config sections move; diff only replaces the previous `-1` sentinel with `4096` in `tmp/getcode_curr.ts`

### Function calling (toggle on)
- Enabling the switch injects a new `const tools = []` declaration before the config block
- The generated config now includes a `tools,` entry referencing that array; all other sections remain untouched

### Grounding with Google Search (attempt to toggle on)
- UI shows banner “Use Google Search – This tool is not compatible with the current active tools.” and the switch stays disabled once Function Calling is enabled
- Re-checking Get code reveals the snippet unchanged (`const tools = []` and `tools,` remain the only additions); no grounding-related fields appear

### URL context (attempt to toggle on)
- Switching is blocked with the toast “Browse the url context – This tool is not compatible with the current active tools.”
- Get code output stays identical to the Function Calling state (no `urlContext` or similar fields emitted)

### Safety settings (Harassment ➜ Block few)
- Adjusting the Harassment slider to “Block few” updates the corresponding entry in `config.safetySettings`, replacing `HarmBlockThreshold.BLOCK_NONE` with `HarmBlockThreshold.BLOCK_ONLY_HIGH`
- Other categories remain untouched and comments inline within the emitted code reflect the new policy label

### Add stop sequence (`END_OF_RESPONSE`)
- Entering `END_OF_RESPONSE` creates a `stopSequences` array in `config` with the provided literal
- Subsequent Get code output lists the token and keeps existing safety and tool configurations intact

### Output length (65536 ➜ 2048)
- Refreshing the Get code panel after setting the spinbox to `2048` inserts `maxOutputTokens: 2048` as the first property inside `const config = { ... }`
- No other fields were touched; `thinkingBudget` and the existing `safetySettings` array appear exactly as before

### Top P (0.95 ➜ 0.6)
- After lowering the Top P control to `0.6` and reopening Get code, the snippet prepends `topP: 0.6` ahead of `maxOutputTokens` within the `config` object
- Configuration order now reads `topP`, `maxOutputTokens`, and then the previously emitted blocks; none of the other config sections changed
