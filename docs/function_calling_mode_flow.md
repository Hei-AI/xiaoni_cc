# Function Calling Mode Resolution Flow

```mermaid
flowchart TD
    A[Incoming Message] --> B{Resolve Prompt}
    B -->|Group/Private Settings| C[agent_prompt_id]
    C --> D[Load agent_prompts record]
    D --> E[convertToUnifiedConfig]
    E --> F[buildToolsConfig]

    subgraph buildToolsConfig
        F --> G{Function registry enabled?}
        G -->|No| H[Use advanced_config.toolsConfig]
        G -->|Yes| I[Fetch prompts id functions]
        I --> J{Registry has bindings?}
        J -->|Yes| K[Merge registry functions (no mode)]
        J -->|No| H
    end

    H --> L[Mode from advanced_config.toolsConfig/functionCalling]
    K --> L

    L --> M[index.ts injects toolConfig.functionCallingConfig]
    M --> N[LLM Job / direct generateContent request]
```

## Notes

- The UI updates `agent_prompts.advanced_config.toolsConfig.functionCalling.mode` and syncs only the function list to the registry.
- `qqbot-core` merges registry-returned functions (if any) with local custom tools, but the mode always comes from the prompt’s advanced configuration.
