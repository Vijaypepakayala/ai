/** Normalize a repository-relative path into the portable corpus-ID form. */
export function normalizeRelativePath(value) {
  return value.replaceAll("\\", "/");
}

/** Return the directory immediately below skills/ on every host platform. */
export function skillDirectoryFromRelativePath(value) {
  const [root, skillDirectory] = normalizeRelativePath(value).split("/");
  return root === "skills" ? (skillDirectory ?? "") : "";
}
