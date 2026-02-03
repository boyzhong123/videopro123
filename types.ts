export interface GeneratedItem {
  id: string;
  prompt: string;
  imageUrl?: string;
  loading: boolean;
  error?: string;
  /** 可复制的详细报错（生成失败时的 debug 片段，或加载失败时的图片 URL 等） */
  errorDetail?: string;
}

export interface PromptResponse {
  prompts: string[];
}
