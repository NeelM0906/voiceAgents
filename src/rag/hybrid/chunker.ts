import { estimateTokens } from '../cost.js';

export type Chunk = {
  content: string;
  sectionPath: string[];
  position: number;
  tokenEstimate: number;
};

type Section = {
  path: string[];
  content: string;
  position: number;
};

const TARGET_MIN_TOKENS = 400;
const TARGET_MAX_TOKENS = 800;
const OVERLAP_TOKENS = 100;

export function chunkMarkdownDocument(input: { title: string; text: string }): Chunk[] {
  const sections = parseMarkdownSections(input);
  const chunks: Chunk[] = [];

  for (const section of sections) {
    const split = splitSection(section);

    for (const chunk of split) {
      chunks.push({
        ...chunk,
        position: chunks.length,
      });
    }
  }

  return chunks;
}

function parseMarkdownSections(input: { title: string; text: string }): Section[] {
  const lines = input.text.replace(/\r\n/g, '\n').split('\n');
  const headingStack: Array<{ level: number; title: string }> = [];
  const sections: Section[] = [];
  let currentLines: string[] = [];
  let currentPath = [input.title];

  const flush = () => {
    const content = currentLines.join('\n').trim();

    if (!content) {
      currentLines = [];
      return;
    }

    sections.push({
      path: currentPath,
      content,
      position: sections.length,
    });
    currentLines = [];
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);

    if (!heading) {
      currentLines.push(line);
      continue;
    }

    flush();

    const level = heading[1]?.length ?? 1;
    const title = (heading[2] ?? '').trim();

    while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= level) {
      headingStack.pop();
    }

    headingStack.push({ level, title });
    currentPath = headingStack.map((item) => item.title);
    currentLines.push(line);
  }

  flush();

  if (sections.length === 0) {
    return [
      {
        path: [input.title],
        content: input.text.trim(),
        position: 0,
      },
    ];
  }

  return sections;
}

function splitSection(section: Section): Omit<Chunk, 'position'>[] {
  const tokenEstimate = estimateTokens(section.content);

  if (tokenEstimate <= TARGET_MAX_TOKENS) {
    return [
      {
        content: section.content,
        sectionPath: section.path,
        tokenEstimate,
      },
    ];
  }

  const sentences = splitIntoSentences(section.content);
  const chunks: Omit<Chunk, 'position'>[] = [];
  let cursor = 0;

  while (cursor < sentences.length) {
    const selected: string[] = [];
    let tokenCount = 0;
    let index = cursor;

    while (index < sentences.length) {
      const sentence = sentences[index]!;
      const sentenceTokens = estimateTokens(sentence);
      const wouldExceed = selected.length > 0 && tokenCount + sentenceTokens > TARGET_MAX_TOKENS;

      if (wouldExceed && tokenCount >= TARGET_MIN_TOKENS) {
        break;
      }

      selected.push(sentence);
      tokenCount += sentenceTokens;
      index += 1;

      if (tokenCount >= TARGET_MIN_TOKENS && tokenCount >= TARGET_MAX_TOKENS) {
        break;
      }
    }

    if (selected.length === 0) {
      selected.push(sentences[cursor]!);
      index = cursor + 1;
      tokenCount = estimateTokens(selected[0]!);
    }

    chunks.push({
      content: selected.join(' ').trim(),
      sectionPath: section.path,
      tokenEstimate: tokenCount,
    });

    if (index >= sentences.length) {
      break;
    }

    cursor = Math.max(cursor + 1, rewindForOverlap(sentences, index));
  }

  return chunks;
}

function rewindForOverlap(sentences: string[], endExclusive: number): number {
  let tokenCount = 0;

  for (let index = endExclusive - 1; index >= 0; index -= 1) {
    tokenCount += estimateTokens(sentences[index]!);

    if (tokenCount >= OVERLAP_TOKENS) {
      return index;
    }
  }

  return endExclusive;
}

function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return [];
  }

  const sentences = normalized.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g);

  if (!sentences || sentences.length === 0) {
    return [normalized];
  }

  return sentences.map((sentence) => sentence.trim()).filter(Boolean);
}
