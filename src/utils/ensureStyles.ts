export function ensureStyles (id: string): void {
  if (typeof document === 'undefined' || !document.head) return
  if (document.querySelector(`style[data-plugin="${id}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = id
  tag.textContent = import.meta.env.INNETJS_CSS || ''
  document.head.appendChild(tag)
}
