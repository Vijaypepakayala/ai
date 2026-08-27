const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function frontmatterDescription(text) {
  const block = text.match(FRONTMATTER)?.[1]?.replace(/\r\n/g, "\n");
  if (!block) return null;
  const description = block.match(/description:\s*>?-?\s*\n?([\s\S]*?)(?:\n[a-z_]+:|$)/);
  return description
    ? description[1].replace(/\s+/g, " ").trim().slice(0, 300)
    : null;
}

export function frontmatterMetadataValue(text, key) {
  const block = text.match(FRONTMATTER)?.[1]?.replace(/\r\n/g, "\n");
  if (!block) return null;
  const value = block.match(new RegExp(`^ {2}${key}:\\s*([^#\\n]+?)\\s*$`, "m"))?.[1]?.trim();
  if (!value) return null;
  return value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
}
