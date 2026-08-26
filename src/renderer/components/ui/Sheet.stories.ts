import type { Meta, StoryObj } from '@storybook/vue3-vite';
import PressButton from './PressButton.vue';
import Sheet from './Sheet.vue';

/**
 * A modal sheet, sized to what is in it.
 *
 * It used to take one fixed height, which bought "no resize under the reader"
 * at the cost of a popup with six facts in it reserving room for forty. It
 * follows its content now and *animates* the change, which answers the same
 * objection where it belongs. Past four fifths of the viewport it stops and the
 * body scrolls.
 */
const meta = {
  title: 'UI/Sheet',
  component: Sheet,
  args: { modelValue: true, title: 'Export data', subtitle: 'music.album' },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

const body = (paragraphs: number) =>
  Array.from(
    { length: paragraphs },
    (_u, i) => `<p>Paragraph ${i + 1} of the sheet's body.</p>`
  ).join('');

export const Short: Story = {
  render: (args) => ({
    components: { Sheet },
    setup: () => ({ args, html: body(2) }),
    template: `<Sheet v-bind="args"><div v-html="html" /></Sheet>`,
  }),
};

/** Tall enough to hit the ceiling, at which point the body scrolls. */
export const Tall: Story = {
  render: (args) => ({
    components: { Sheet },
    setup: () => ({ args, html: body(40) }),
    template: `<Sheet v-bind="args"><div v-html="html" /></Sheet>`,
  }),
};

export const WithFooter: Story = {
  render: (args) => ({
    components: { Sheet, PressButton },
    setup: () => ({ args, html: body(3) }),
    template: `
      <Sheet v-bind="args">
        <div v-html="html" />
        <template #footer>
          <PressButton>Cancel</PressButton>
          <PressButton variant="primary">Export</PressButton>
        </template>
      </Sheet>
    `,
  }),
};

/** An icon, for a sheet that is a place rather than a task. */
export const WithIcon: Story = {
  args: { icon: 'assistant', title: 'Assistant', subtitle: 'Providers' },
  render: (args) => ({
    components: { Sheet },
    setup: () => ({ args, html: body(3) }),
    template: `<Sheet v-bind="args"><div v-html="html" /></Sheet>`,
  }),
};

/** Wider, for a form that needs two columns. */
export const Wide: Story = {
  args: { wide: true },
  render: (args) => ({
    components: { Sheet },
    setup: () => ({ args, html: body(4) }),
    template: `<Sheet v-bind="args"><div v-html="html" /></Sheet>`,
  }),
};

/** Wider still, for a drawing rather than a form. */
export const Broad: Story = {
  args: { broad: true, title: 'Query plan' },
  render: (args) => ({
    components: { Sheet },
    setup: () => ({ args, html: body(4) }),
    template: `<Sheet v-bind="args"><div v-html="html" /></Sheet>`,
  }),
};
