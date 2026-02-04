export interface GeneratedItem {
  id: string;
  prompt: string;
  /** 对应的中文/原文场景描述，便于用户理解图与内容的对应关系 */
  sceneText?: string;
  imageUrl?: string;
  loading: boolean;
  error?: string;
  /** 可复制的详细报错（生成失败时的 debug 片段，或加载失败时的图片 URL 等） */
  errorDetail?: string;
}

export interface PromptResponse {
  prompts: string[];
}
