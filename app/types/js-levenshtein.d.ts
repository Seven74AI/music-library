declare module "js-levenshtein" {
  /**
   * Calculate the Levenshtein distance between two strings.
   * @param str1 The first string
   * @param str2 The second string
   * @returns The Levenshtein distance (number of edits required)
   */
  export default function levenshtein(str1: string, str2: string): number;
}
