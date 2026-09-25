import { pagesLabel } from './sources';

/**
 * The "not enough evidence" reply (PRD §7). Deliberately deterministic: when retrieval finds nothing that
 * supports an answer, no model is asked to write one — so nothing can be fabricated, and it costs nothing.
 * The learner can still opt in to a clearly-labelled general-knowledge answer.
 */
export function buildInsufficientReply(input: {
  projectName: string;
  readyMaterials: number;
  pendingMaterials: number;
  concepts: string[];
  nearest: { materialTitle: string; pageStart: number; pageEnd: number } | null;
}): { content: string; suggestions: string[]; reason: 'no_materials' | 'no_evidence' } {
  const suggestions = input.concepts.slice(0, 3).map((c, i) => (i === 1 ? `Give me an example of ${c}` : `Explain ${c}`));

  if (input.readyMaterials === 0) {
    const pending = input.pendingMaterials
      ? ` ${input.pendingMaterials === 1 ? 'One material is' : `${input.pendingMaterials} materials are`} still being processed — ask me again once ${input.pendingMaterials === 1 ? 'it is' : 'they are'} ready.`
      : '';
    return {
      reason: 'no_materials',
      suggestions,
      content: [
        `I can't answer this from your materials yet — **${input.projectName}** doesn't have any processed study material.${pending}`,
        '',
        'I answer from your own materials so you can always check where an explanation comes from. You can:',
        '- **Upload a PDF** on the Materials tab and ask me again when it is ready',
        '- **Ask for a general-knowledge answer** — I will clearly mark it as not coming from your materials',
      ].join('\n'),
    };
  }

  const covered = input.concepts.length ? `**What your materials do cover:** ${input.concepts.slice(0, 6).join(', ')}.` : '';
  const nearest = input.nearest
    ? `The closest passage I found is in *${input.nearest.materialTitle}* (${pagesLabel(input.nearest)}), but it doesn't answer your question.`
    : '';
  return {
    reason: 'no_evidence',
    suggestions,
    content: [
      `I couldn't find enough evidence in your materials for **${input.projectName}** to answer that reliably, so I won't guess.`,
      '',
      [covered, nearest].filter(Boolean).join(' '),
      '',
      'You can:',
      '- **Rephrase** the question using terms from your notes',
      '- **Add a material** that covers this topic',
      '- **Ask for a general-knowledge answer** — clearly marked as not coming from your materials',
    ]
      .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
      .join('\n'),
  };
}

/**
 * Graceful degradation when the model is unavailable but evidence exists: show the passages themselves
 * (still cited) instead of failing the learner's request.
 */
export function buildExtractiveFallback(sources: Array<{ ref: string; materialTitle: string; pageStart: number; pageEnd: number; text: string }>) {
  const passages = sources.slice(0, 3).map((s) => {
    const excerpt = s.text.replace(/\s+/g, ' ').trim().slice(0, 420);
    return `> ${excerpt}${excerpt.length >= 420 ? '…' : ''} [${s.ref}]\n>\n> — *${s.materialTitle}*, ${pagesLabel(s)}`;
  });
  return [
    "I'm having trouble reaching my AI service right now, so I can't explain this properly yet. Here are the most relevant passages from your materials:",
    '',
    passages.join('\n\n'),
    '',
    'Ask me again in a moment and I will walk you through it.',
  ].join('\n');
}
