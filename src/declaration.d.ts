interface ImportMeta {
  readonly env: Record<string, string>;
  readonly require: (src?: string) => any
}
