export type SpeechResult = { 0: { transcript: string }; isFinal: boolean };
export type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
export type SpeechErrorEvent = { error: string };

export type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export type RecognitionConstructor = new () => Recognition;

export function getSpeechRecognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const holder = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return holder.SpeechRecognition ?? holder.webkitSpeechRecognition ?? null;
}

const ERROR_MESSAGES: Record<string, string> = {
  "no-speech": "Речь не распознана, попробуйте ещё раз",
  aborted: "Распознавание прервано",
  "audio-capture": "Микрофон не найден или недоступен",
  network: "Ошибка сети распознавания речи",
  "not-allowed": "Разрешите доступ к микрофону и распознаванию речи",
  "service-not-allowed": "Система запретила распознавание речи",
  "bad-grammar": "Ошибка распознавания речи",
  "language-not-supported": "Выбранный язык не поддерживается",
};

export function describeSpeechError(code: string): string {
  return ERROR_MESSAGES[code] ?? `Ошибка распознавания: ${code}`;
}

export function collectFinalText(event: SpeechEvent): string {
  const parts: string[] = [];
  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    const result = event.results[i];
    if (result.isFinal) {
      const text = result[0]?.transcript?.trim();
      if (text) parts.push(text);
    }
  }
  return parts.join(" ").trim();
}
