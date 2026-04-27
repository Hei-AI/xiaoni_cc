export type ImagePromptUseCase =
  | 'portrait'
  | 'poster'
  | 'product'
  | 'character'
  | 'scene'
  | 'ui'
  | 'edit'
  | 'general';

export type ImagePromptPattern = {
  id: string;
  label: string;
  useCase: ImagePromptUseCase;
  cues: string[];
  promptDna: string[];
  sourceUrl?: string;
};

const AWESOME_GPT_IMAGE_2_PROMPTS_URL =
  'https://github.com/EvoLinkAI/awesome-gpt-image-2-prompts/blob/main/README_zh-CN.md';

export const IMAGE_PROMPT_PATTERNS: ImagePromptPattern[] = [
  {
    id: 'portrait-cinematic-photo',
    label: 'Cinematic portrait photography',
    useCase: 'portrait',
    cues: ['人像', '头像', '写真', 'idol', 'portrait', '自拍', '人物'],
    promptDna: ['subject identity', 'wardrobe', 'pose', 'camera distance', 'lens', 'lighting', 'skin texture', 'background atmosphere'],
    sourceUrl: AWESOME_GPT_IMAGE_2_PROMPTS_URL
  },
  {
    id: 'dark-eastern-fantasy-scene',
    label: 'Dark Eastern fantasy scene',
    useCase: 'scene',
    cues: ['中式', '西游', '东方', '神话', '妖怪', '玄幻', '武侠', '山海经', 'fantasy'],
    promptDna: ['mythic setting', 'main figures', 'scale contrast', 'low angle composition', 'dramatic shadows', 'material detail', 'atmospheric depth'],
    sourceUrl: AWESOME_GPT_IMAGE_2_PROMPTS_URL
  },
  {
    id: 'editorial-poster',
    label: 'Editorial poster design',
    useCase: 'poster',
    cues: ['海报', '封面', 'poster', '宣传图', '小红书', 'banner', '标题'],
    promptDna: ['visual hierarchy', 'headline placement', 'graphic style', 'layout grid', 'negative space', 'color system', 'print texture'],
    sourceUrl: AWESOME_GPT_IMAGE_2_PROMPTS_URL
  },
  {
    id: 'premium-product-photo',
    label: 'Premium product photography',
    useCase: 'product',
    cues: ['产品', '商品', '广告', '包装', '饮料', '键盘', 'product', '电商'],
    promptDna: ['product hero angle', 'surface material', 'studio lighting', 'props', 'background', 'reflections', 'commercial polish'],
    sourceUrl: AWESOME_GPT_IMAGE_2_PROMPTS_URL
  },
  {
    id: 'character-reference',
    label: 'Character design sheet',
    useCase: 'character',
    cues: ['角色', '设定', '立绘', '皮肤', 'character', 'cosplay', '机甲', '卡片'],
    promptDna: ['character silhouette', 'costume design', 'materials', 'pose', 'expression', 'reference sheet clarity', 'worldbuilding details'],
    sourceUrl: AWESOME_GPT_IMAGE_2_PROMPTS_URL
  },
  {
    id: 'ui-mockup',
    label: 'UI and social screenshot',
    useCase: 'ui',
    cues: ['UI', '界面', '截图', 'app', '网页', '社交媒体', 'dashboard', 'mockup'],
    promptDna: ['screen context', 'interface layout', 'component density', 'device frame', 'typography intent', 'state realism', 'legible content constraints'],
    sourceUrl: AWESOME_GPT_IMAGE_2_PROMPTS_URL
  },
  {
    id: 'reference-edit',
    label: 'Reference image edit',
    useCase: 'edit',
    cues: ['参考图', '改成', '换背景', '保持', 'edit', 'reference', '修改', '重绘'],
    promptDna: ['preserve elements', 'changed elements', 'edit boundary', 'style transfer', 'identity consistency', 'background replacement', 'no unwanted changes'],
    sourceUrl: AWESOME_GPT_IMAGE_2_PROMPTS_URL
  },
  {
    id: 'general-visual-brief',
    label: 'General visual brief',
    useCase: 'general',
    cues: [],
    promptDna: ['subject', 'environment', 'style', 'composition', 'lighting', 'color palette', 'texture', 'constraints'],
    sourceUrl: AWESOME_GPT_IMAGE_2_PROMPTS_URL
  }
];

export function selectImagePromptPatterns(input: {
  prompt: string;
  mode?: string;
  limit?: number;
}): ImagePromptPattern[] {
  const text = input.prompt.toLowerCase();
  const limit = Math.max(1, Math.min(input.limit || 3, 5));
  const scored = IMAGE_PROMPT_PATTERNS.map((pattern) => {
    const score = pattern.cues.reduce((sum, cue) => sum + (cue && text.includes(cue.toLowerCase()) ? 1 : 0), 0)
      + (input.mode === 'edit' && pattern.useCase === 'edit' ? 2 : 0);
    return { pattern, score };
  }).sort((a, b) => b.score - a.score);

  const matches = scored.filter((item) => item.score > 0).map((item) => item.pattern);
  if (matches.length === 0) {
    return [IMAGE_PROMPT_PATTERNS.find((pattern) => pattern.id === 'general-visual-brief')!];
  }

  return matches.slice(0, limit);
}
