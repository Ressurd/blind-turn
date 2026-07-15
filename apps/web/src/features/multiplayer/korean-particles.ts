function hasFinalConsonant(word: string): boolean {
  const lastCharacter = word.trim().at(-1);
  if (!lastCharacter) return false;
  const codePoint = lastCharacter.charCodeAt(0);
  if (codePoint < 0xac00 || codePoint > 0xd7a3) return false;
  return (codePoint - 0xac00) % 28 !== 0;
}

function attach(word: string, withFinal: string, withoutFinal: string): string {
  return `${word}${hasFinalConsonant(word) ? withFinal : withoutFinal}`;
}

export const asSubject = (word: string) => attach(word, "이", "가");
export const asObject = (word: string) => attach(word, "을", "를");
export const withAnd = (word: string) => attach(word, "과", "와");
