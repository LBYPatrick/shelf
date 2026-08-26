import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { withEntities } from '../../../../.storybook/seed';
import CommandPalette from './CommandPalette.vue';

/**
 * Everything the app can do, as one list.
 *
 * Every command sets an explicit final state, so running it twice leaves the
 * app where running it once did — which rules out bare toggles: "toggle dark
 * mode" is a different action depending on what you cannot see.
 *
 * `/` switches from searching tables to searching commands.
 */
const meta = {
  title: 'Chrome/CommandPalette',
  component: CommandPalette,
  args: { modelValue: true },
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    components: { CommandPalette },
    setup: () => {
      withEntities();
      return { args };
    },
    template: `<div style="height:32rem;"><CommandPalette v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
