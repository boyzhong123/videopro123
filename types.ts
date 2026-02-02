export interface GeneratedItem {
  id: string;
  prompt: string;
  imageUrl?: string;
  loading: boolean;
  error?: string;
}

export interface PromptResponse {
  prompts: string[];
}
