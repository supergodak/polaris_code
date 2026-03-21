export interface EvalTask {
  name: string;
  prompt: string;
  setup?: (workDir: string) => Promise<void>;
  verify: (workDir: string) => Promise<EvalResult>;
}

export interface EvalResult {
  pass: boolean;
  details: string;
}
