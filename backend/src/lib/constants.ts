/** Visual customisation for Spaces is limited to these keys; the frontend maps them to styles. */
export const SPACE_COLORS = ['blue', 'indigo', 'violet', 'cyan', 'teal', 'emerald', 'amber', 'rose', 'slate'] as const;
export type SpaceColor = (typeof SPACE_COLORS)[number];

export const SPACE_ICONS = [
  'book',
  'brain',
  'code',
  'flask',
  'calculator',
  'globe',
  'palette',
  'music',
  'briefcase',
  'rocket',
  'cpu',
  'languages',
  'chart',
  'atom',
  'scale',
  'graduation',
] as const;
export type SpaceIcon = (typeof SPACE_ICONS)[number];
