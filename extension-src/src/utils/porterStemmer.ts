// Porter Stemmer implementation for English words
// Used for generating word stems for patent search truncation

export class PorterStemmer {
  private static step1a(word: string): string {
    if (word.endsWith('sses')) return word.slice(0, -2);
    if (word.endsWith('ies')) return word.slice(0, -2);
    if (word.endsWith('ss')) return word;
    if (word.endsWith('s')) return word.slice(0, -1);
    return word;
  }

  private static step1b(word: string): string {
    if (word.endsWith('eed')) {
      const stem = word.slice(0, -3);
      if (this.measure(stem) > 0) return stem + 'ee';
      return word;
    }

    let result = word;
    if (word.endsWith('ed')) {
      const stem = word.slice(0, -2);
      if (this.hasVowel(stem)) {
        result = stem;
      } else {
        return word;
      }
    } else if (word.endsWith('ing')) {
      const stem = word.slice(0, -3);
      if (this.hasVowel(stem)) {
        result = stem;
      } else {
        return word;
      }
    } else {
      return word;
    }

    if (result.endsWith('at') || result.endsWith('bl') || result.endsWith('iz')) {
      return result + 'e';
    }

    if (this.endsWithDoubleConsonant(result) && !result.endsWith('l') && !result.endsWith('s') && !result.endsWith('z')) {
      return result.slice(0, -1);
    }

    if (this.measure(result) === 1 && this.endsCVC(result)) {
      return result + 'e';
    }

    return result;
  }

  private static isConsonant(word: string, i: number): boolean {
    const c = word[i];
    if ('aeiou'.includes(c)) return false;
    if (c === 'y') return i === 0 || !this.isConsonant(word, i - 1);
    return true;
  }

  private static measure(word: string): number {
    let count = 0;
    let isVowelGroup = false;

    for (let i = 0; i < word.length; i++) {
      if (!this.isConsonant(word, i)) {
        isVowelGroup = true;
      } else if (isVowelGroup) {
        count++;
        isVowelGroup = false;
      }
    }

    return count;
  }

  private static hasVowel(word: string): boolean {
    for (let i = 0; i < word.length; i++) {
      if (!this.isConsonant(word, i)) return true;
    }
    return false;
  }

  private static endsWithDoubleConsonant(word: string): boolean {
    if (word.length < 2) return false;
    return word[word.length - 1] === word[word.length - 2] && this.isConsonant(word, word.length - 1);
  }

  private static endsCVC(word: string): boolean {
    if (word.length < 3) return false;
    const len = word.length;
    return (
      this.isConsonant(word, len - 3) &&
      !this.isConsonant(word, len - 2) &&
      this.isConsonant(word, len - 1) &&
      !('wxy'.includes(word[len - 1]))
    );
  }

  static stem(word: string): string {
    if (word.length < 3) return word;
    let result = word.toLowerCase();
    result = this.step1a(result);
    result = this.step1b(result);
    return result;
  }
}
