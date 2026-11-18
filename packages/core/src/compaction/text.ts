/** Python 的 len() 按 Unicode 码点计数，而不是 UTF-16 码元。 */
export function charCount(text: string): number {
  return Array.from(text).length;
}
