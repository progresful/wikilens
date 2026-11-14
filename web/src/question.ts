// The same check the server makes, done first in the browser so a blank question costs no request.

export const MAX_QUESTION_CHARS = 300;

const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** The trimmed question, or null when there is nothing to ask or it is too long. */
export function cleanQuestion(raw: string): string | null {
  const question = raw.trim();
  if (question.length === 0 || question.length > MAX_QUESTION_CHARS) return null;
  return HAS_LETTER_OR_DIGIT.test(question) ? question : null;
}
