import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

/**
 * The editor's appearance.
 *
 * Built from the same custom properties as the rest of the interface rather
 * than a fixed palette, so the editor follows the accent and the light/dark
 * theme without needing to be told when either changes.
 */
const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--color-base-content)',
    backgroundColor: 'transparent',
    fontSize: '0.8125rem',
  },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    padding: 'var(--gap) 0',
    caretColor: 'var(--color-primary)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.55',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--color-primary)',
    borderLeftWidth: '2px',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--color-primary) 26%, transparent)',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklab, var(--color-primary) 32%, transparent)',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'color-mix(in oklab, var(--color-base-content) 32%, transparent)',
    border: 'none',
    paddingInline: 'var(--gap-tight) var(--gap)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--color-base-content)',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in oklab, var(--color-base-content) 4%, transparent)',
  },
  /*
   * The statement under the cursor is tinted, so "run current" always says what
   * it is about to run before you press it rather than after.
   */
  '.cm-currentStatement': {
    backgroundColor: 'color-mix(in oklab, var(--color-primary) 9%, transparent)',
  },
  '.cm-queryError': {
    textDecoration: 'underline wavy var(--color-error)',
    textUnderlineOffset: '3px',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in oklab, var(--color-primary) 22%, transparent)',
    outline: 'none',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--color-base-100)',
    border: '1px solid color-mix(in oklab, var(--color-base-content) 14%, transparent)',
    borderRadius: 'var(--radius-field)',
    boxShadow: '0 8px 28px oklch(0% 0 0 / 0.18)',
    overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete ul li': {
    fontFamily: 'var(--font-mono)',
    padding: '3px var(--gap)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-primary-content)',
  },
  '.cm-completionIcon': { display: 'none' },
  '.cm-completionDetail': {
    marginInlineStart: 'var(--gap)',
    fontStyle: 'normal',
    opacity: 0.55,
  },
  '.cm-panels': {
    backgroundColor: 'var(--color-base-200)',
    color: 'var(--color-base-content)',
  },
});

/**
 * Syntax colours. Hues are fixed but lightness and chroma are expressed against
 * the theme, so the same definitions stay legible on a light and a dark surface.
 */
const highlighting = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syntax-keyword)', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-number)' },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: 'var(--syntax-comment)',
    fontStyle: 'italic',
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--syntax-function)',
  },
  { tag: [tags.typeName, tags.className], color: 'var(--syntax-type)' },
  { tag: tags.operator, color: 'var(--syntax-operator)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--syntax-property)' },
  { tag: tags.invalid, color: 'var(--color-error)' },
]);

export function shelfEditorTheme(): Extension {
  return [theme, syntaxHighlighting(highlighting)];
}
