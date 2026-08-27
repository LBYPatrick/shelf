import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { SYNTAX_SCHEMES } from '@shared/syntaxThemes';
import PaletteStrip from './PaletteStrip.vue';

/**
 * What a scheme's name means.
 *
 * Nine of them side by side is the comparison the settings row cannot show —
 * there you see one at a time, which is the point of having it beside the
 * picker rather than in a gallery.
 */
const meta = {
  title: 'Settings/PaletteStrip',
  component: PaletteStrip,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof PaletteStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every scheme, both halves — the sheet a designer wants and the app does not. */
export const AllSchemes: Story = {
  args: { light: 'nord', dark: 'nord', appearances: ['light', 'dark'], label: 'Nord' },
  render: () => ({
    components: { PaletteStrip },
    setup: () => ({ schemes: SYNTAX_SCHEMES }),
    template: `<div style="display: grid; gap: 0.75rem">
      <div v-for="scheme in schemes" :key="scheme.id"
           style="display: flex; align-items: center; gap: 0.75rem">
        <span style="width: 10rem; font-size: 0.8125rem">{{ scheme.name }}</span>
        <PaletteStrip :light="scheme.id" :dark="scheme.id"
                      :appearances="['light', 'dark']" :label="scheme.name" />
      </div>
    </div>`,
  }),
};

/** One half, which is what each picker gets when the two are chosen apart. */
export const OneHalf: Story = {
  args: { light: 'gruvbox', dark: 'gruvbox', appearances: ['dark'], label: 'Gruvbox, dark' },
};
