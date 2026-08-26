import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AppIcon from './AppIcon.vue';
import PressButton from './PressButton.vue';

/**
 * The button, in the four loudnesses it comes in.
 *
 * The rule the toolbars follow is that *loudness* carries the difference —
 * quiet by default, tonal for a mode that is on, filled accent for the one
 * action that commits, and never more than one of those per surface. Seeing
 * them side by side is the only way to check that the ladder still has rungs.
 */
const meta = {
  title: 'UI/PressButton',
  component: PressButton,
  args: { variant: 'ghost', size: 'md', disabled: false, active: false },
  argTypes: {
    variant: { control: 'select', options: ['ghost', 'primary', 'glass', 'danger'] },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
  },
  render: (args) => ({
    components: { PressButton },
    setup: () => ({ args }),
    template: `<PressButton v-bind="args">Run query</PressButton>`,
  }),
} satisfies Meta<typeof PressButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ghost: Story = {};

export const Primary: Story = { args: { variant: 'primary' } };

/** For a surface that sits over the workspace rather than in it. */
export const Glass: Story = { args: { variant: 'glass' } };

export const Danger: Story = { args: { variant: 'danger' } };

export const Disabled: Story = { args: { disabled: true } };

/** A mode that is currently on — tonal, not filled. */
export const Active: Story = { args: { active: true } };

export const Small: Story = { args: { size: 'sm' } };

/**
 * With a glyph, which is how most of them appear in a toolbar. The icon is
 * drawn at 13 there; anything larger stops matching the label's cap height.
 */
export const WithIcon: Story = {
  render: (args) => ({
    components: { PressButton, AppIcon },
    setup: () => ({ args }),
    template: `
      <PressButton v-bind="args">
        <AppIcon name="download" :size="13" />
        <span>Export</span>
      </PressButton>
    `,
  }),
};

/** The whole ladder at once — the thing worth actually looking at. */
export const EveryVariant: Story = {
  render: () => ({
    components: { PressButton },
    template: `
      <div style="display:flex; gap:0.5rem; align-items:center;">
        <PressButton>Quiet</PressButton>
        <PressButton active>On</PressButton>
        <PressButton variant="glass">Glass</PressButton>
        <PressButton variant="primary">Commits</PressButton>
        <PressButton variant="danger">Destroys</PressButton>
        <PressButton disabled>Unavailable</PressButton>
      </div>
    `,
  }),
};
